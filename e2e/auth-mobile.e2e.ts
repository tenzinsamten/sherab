import { expect, test, type Browser, type Page } from '@playwright/test';
import { service, type TestUser } from './fixtures';

/**
 * Mobile-first redesign, story 6 (auth pages): sign in, register, forgot
 * and reset password, resend confirmation, the email-link page and the
 * signed-out home on the new component system, under the new signed-out
 * header. One test per row of the story's I/O matrix at 375px (phone) and
 * 820px (iPad portrait), plus the fit check per migrated page in en, de and
 * bo: no sideways scroll, every input and button at least 44×44px, labels
 * visible, the header not truncated.
 *
 * The join flow (/join, /join/pending) is story 6b and stays iX.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);

const VIEWPORTS = [
	{ name: 'phone', width: 375, height: 740 },
	{ name: 'tablet', width: 820, height: 1180 }
] as const;

const LOCALES = ['en', 'de', 'bo'] as const;

const userIds: string[] = [];
/** Addresses registered through the form (their accounts are removed at the end). */
const registered: string[] = [];

async function createParent(key: string): Promise<TestUser> {
	const email = `e2e-auth-${key}-${tag}@example.test`;
	const password = `pw-${crypto.randomUUID()}`;
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role: 'parent' },
		user_metadata: { display_name: `Auth ${key} ${tag}` }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

test.afterAll(async () => {
	const problems: string[] = [];
	for (const email of registered) {
		const { data } = await service.from('profiles').select('id').eq('email', email);
		for (const row of data ?? []) userIds.push(row.id);
	}
	for (const id of userIds) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error && !/not found/i.test(error.message)) problems.push(`delete ${id}: ${error.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
});

/** The page's new-UI root is hydrated (its form is enhanced from then on). */
async function ready(page: Page) {
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

async function open(page: Page, path: string) {
	await page.goto(path);
	await ready(page);
}

const toast = (page: Page, text: string | RegExp) =>
	page.locator('ix-toast').getByText(text).first();

async function setLocale(page: Page, locale: string) {
	await page
		.context()
		.addCookies([{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }]);
}

/**
 * CAP-2/3/6: no sideways scroll; every visible input and button in the
 * page at least 44×44px (footer links at least 44px tall); every field has
 * a visible label; the header (signed out, or the signed-in one on
 * /reset-password) fits, its controls at least 44×44px and its language
 * switch inside it.
 */
async function expectFits(page: Page) {
	const result = await page.evaluate(() => {
		const doc = document.documentElement;
		const visible = (el: Element) => el.getClientRects().length > 0;
		const describe = (el: Element, box: DOMRect) =>
			`${el.id || el.textContent?.trim() || el.getAttribute('aria-label')}: ${Math.round(box.width)}×${Math.round(box.height)}`;
		const header =
			document.querySelector<HTMLElement>('[data-testid="public-header"]') ??
			document.querySelector<HTMLElement>('[data-testid="app-header"]');
		const small: string[] = [];
		const targets = [
			...document.querySelectorAll('main input:not([type="hidden"]), main button'),
			...(header?.querySelectorAll('a, button') ?? [])
		];
		for (const el of targets) {
			if (!visible(el)) continue;
			const box = el.getBoundingClientRect();
			if (box.width < 43.5 || box.height < 43.5) small.push(describe(el, box));
		}
		for (const el of document.querySelectorAll('main a')) {
			if (!visible(el)) continue;
			const box = el.getBoundingClientRect();
			if (box.height < 43.5) small.push(describe(el, box));
		}
		const unlabelled = [...document.querySelectorAll('main input:not([type="hidden"])')]
			.filter(visible)
			.filter((input) => {
				const label = document.querySelector(`label[for="${input.id}"]`);
				return !label || !visible(label) || !label.textContent?.trim();
			})
			.map((input) => input.id || input.getAttribute('name'));
		const language = header?.querySelector<HTMLElement>('[data-testid="language-menu"]');
		const languageBox = language?.getBoundingClientRect();
		const headerBox = header?.getBoundingClientRect();
		return {
			header: Boolean(header),
			scrollWidth: doc.scrollWidth,
			width: doc.clientWidth,
			small,
			unlabelled,
			headerFits: header ? header.scrollWidth <= header.clientWidth : false,
			// The language name is a nowrap flex item: it is cut when the
			// trigger runs past the header's right edge.
			languageCut:
				!languageBox ||
				!headerBox ||
				languageBox.right > headerBox.right + 0.5 ||
				[...language!.querySelectorAll('span')].some((s) => s.scrollWidth > s.clientWidth + 1),
			languageRight: languageBox?.right ?? Infinity
		};
	});
	expect(result.scrollWidth).toBeLessThanOrEqual(result.width);
	expect(result.small).toEqual([]);
	expect(result.unlabelled).toEqual([]);
	expect(result.header).toBe(true);
	expect(result.headerFits).toBe(true);
	expect(result.languageCut).toBe(false);
	expect(result.languageRight).toBeLessThanOrEqual(result.width);
}

/** A recovery session in `page` (as from a reset mail), on /reset-password. */
async function recoverySession(page: Page, email: string) {
	const { data, error } = await service.auth.admin.generateLink({ type: 'recovery', email });
	const token = data?.properties?.hashed_token;
	if (error || !token) throw new Error(`recovery link: ${error?.message}`);
	await open(page, `/auth/confirm?token_hash=${token}&type=recovery`);
	// The page's one button (its name is in the interface language).
	await page.locator('main button').click();
	await expect(page).toHaveURL(/\/reset-password$/);
	await ready(page);
}

/** Outline and box shadow of every control, unfocused (compared by focusShows). */
async function recordResting(page: Page) {
	await page.evaluate(() => {
		const rest = new Map<Element, string>();
		for (const el of document.querySelectorAll('a, button, input')) {
			const style = getComputedStyle(el);
			rest.set(el, `${style.outlineStyle} ${style.outlineWidth} | ${style.boxShadow}`);
		}
		(window as unknown as { __rest: Map<Element, string> }).__rest = rest;
	});
}

/**
 * Whether the focused element draws a focus indicator: an outline or ring
 * it does not have at rest (recordResting).
 */
async function focusShows(page: Page) {
	return page.evaluate(() => {
		const el = document.activeElement;
		if (!el || el === document.body) return false;
		const style = getComputedStyle(el);
		const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
		const now = `${style.outlineStyle} ${style.outlineWidth} | ${style.boxShadow}`;
		const rest = (window as unknown as { __rest: Map<Element, string> }).__rest.get(el);
		return (outline || style.boxShadow !== 'none') && now !== rest;
	});
}

async function viewportPage(browser: Browser, width: number, height: number) {
	const context = await browser.newContext({ viewport: { width, height } });
	return context.newPage();
}

for (const v of VIEWPORTS) {
	test.describe(`at ${v.width}px`, () => {
		test.use({ viewport: { width: v.width, height: v.height } });

		test(`sign in (${v.name}): a wrong password toasts and keeps the email; the right one signs in`, async ({
			page
		}) => {
			const parent = await createParent(`login-${v.name}`);
			await open(page, '/login');
			await expect(page.locator('ix-button, ix-input, ix-application-header')).toHaveCount(0);
			await page.getByLabel('Email or username').fill(parent.email);
			await page.locator('#password').fill('wrong-password');
			await page.getByRole('button', { name: 'Sign in' }).click();
			await expect(toast(page, 'Invalid email or password.')).toBeVisible();
			await expect(page).toHaveURL(/\/login$/);
			await expect(page.locator('#email')).toHaveValue(parent.email);
			// The fields password managers fill keep their names and hints.
			await expect(page.locator('#email')).toHaveAttribute('autocomplete', 'username');
			await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'current-password');

			await page.locator('#password').fill(parent.password);
			await page.getByRole('button', { name: 'Sign in' }).click();
			await expect(page).not.toHaveURL(/\/login/);
			await expect(page.locator('[data-app-shell]')).toBeVisible();
		});

		test(`register (${v.name}): a server error toasts and keeps the fields; success shows the receipt`, async ({
			page
		}) => {
			const existing = await createParent(`exists-${v.name}`);
			await open(page, '/register');
			const name = `Auth Reg ${v.name} ${tag}`;
			await page.getByLabel('Your name').fill(name);
			await page.getByLabel('Email', { exact: true }).fill(existing.email);
			await page.locator('#password').fill('secret-123');
			await page.locator('#confirm').fill('secret-123');
			await page.getByRole('button', { name: 'Create account' }).click();
			await expect(toast(page, /An account with this email already exists/)).toBeVisible();
			await expect(page.locator('#displayName')).toHaveValue(name);
			await expect(page.locator('#email')).toHaveValue(existing.email);
			await expect(page.locator('#password')).toHaveValue('secret-123');

			const email = `e2e-auth-reg-${v.name}-${tag}@example.test`;
			registered.push(email);
			await page.locator('#email').fill(email);
			await page.getByRole('button', { name: 'Create account' }).click();
			await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
			await expect(page.getByText(email)).toBeVisible();
		});

		test(`forgot and resend (${v.name}): a toast and a status line; an expired link toasts`, async ({
			page
		}) => {
			await open(page, '/forgot-password?error=expired');
			await expect(
				toast(page, 'That reset link is invalid or has expired. Please request a new one.')
			).toBeVisible();
			await page.locator('#email').fill(`nobody-${v.name}-${tag}@example.test`);
			await page.getByRole('button', { name: 'Send reset link' }).click();
			await expect(toast(page, /If an account exists for that email/)).toBeVisible();

			await open(page, '/resend-confirmation');
			await page.locator('#email').fill(`nobody-${v.name}-${tag}@example.test`);
			await page.getByRole('button', { name: 'Send link' }).click();
			await expect(page.getByRole('status')).toContainText(
				'If this email is waiting for confirmation, a new link is on its way.'
			);
		});

		test(`reset password (${v.name}): inside the signed-in shell; a mismatch toasts, a match saves`, async ({
			page
		}) => {
			const parent = await createParent(`reset-${v.name}`);
			await recoverySession(page, parent.email);
			await expect(page.locator('[data-app-shell] main > [data-auth-card]')).toBeVisible();
			await page.locator('#password').fill('new-secret-1');
			await page.locator('#confirm').fill('new-secret-2');
			await page.getByRole('button', { name: 'Update password' }).click();
			await expect(toast(page, 'Passwords do not match.')).toBeVisible();
			await expect(page).toHaveURL(/\/reset-password$/);

			await page.locator('#password').fill('new-secret-1');
			await page.locator('#confirm').fill('new-secret-1');
			await page.getByRole('button', { name: 'Update password' }).click();
			await expect(page).not.toHaveURL(/\/reset-password/);
			await expect(page.locator('[data-app-shell]')).toBeVisible();
		});

		test(`home (${v.name}): signed out, Sign in opens /login and Join a class opens /join`, async ({
			page
		}) => {
			await open(page, '/');
			await page.locator('main').getByRole('link', { name: 'Sign in' }).click();
			await expect(page).toHaveURL(/\/login$/);
			await page.goBack();
			await expect(page).toHaveURL(/\/$/);
			await ready(page);
			await page.locator('main').getByRole('link', { name: 'Join a class' }).click();
			await expect(page).toHaveURL(/\/join$/);
		});

		test(`auth confirm (${v.name}): the link shows one button, which posts the form`, async ({
			page
		}) => {
			await open(page, '/auth/confirm?token_hash=not-a-token&type=email');
			await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
			const buttons = page.locator('main button');
			await expect(buttons).toHaveCount(1);
			await expect(page.locator('main form')).toHaveAttribute('method', /post/i);
			await buttons.click();
			// The made-up token fails: back on /login with the inline alert.
			await expect(page).toHaveURL(/\/login\?error=confirm$/);
			await expect(page.getByRole('alert')).toContainText('invalid or has expired');
		});

		test(`language switch (${v.name}): signed out, de and bo, the header fits`, async ({
			page
		}) => {
			await open(page, '/login');
			for (const [name, locale] of [
				['Deutsch', 'de'],
				['བོད་སྐད།', 'bo'],
				['English', 'en']
			] as const) {
				await page.getByTestId('language-menu').click();
				await page.getByRole('menuitemradio', { name }).click();
				await expect(page.locator('html')).toHaveAttribute('lang', locale);
				await ready(page);
				await expect(page.getByTestId('language-menu')).toContainText(name);
				await expect(page).toHaveURL(/\/login$/);
				await expectFits(page);
			}
		});

		test(`keyboard (${v.name}): every control on sign in shows focus, in order`, async ({
			page
		}) => {
			await open(page, '/login');
			await recordResting(page);
			await page.locator('body').focus();
			const order: string[] = [];
			for (let i = 0; i < 9; i++) {
				await page.keyboard.press('Tab');
				const id = await page.evaluate(() => {
					const el = document.activeElement as HTMLElement | null;
					return (
						el?.dataset.testid ||
						el?.id ||
						el?.getAttribute('aria-label') ||
						el?.textContent?.trim() ||
						''
					);
				});
				order.push(id);
				expect(await focusShows(page), `focus visible on ${id}`).toBe(true);
			}
			expect(order).toEqual([
				'header-home',
				'language-menu',
				'email',
				'password',
				'Show password',
				'Sign in',
				'Forgot password?',
				'Parent? Create an account',
				'Need help?'
			]);
		});
	});
}

for (const locale of LOCALES) {
	test(`every auth page at 375px in ${locale}: fits, 44px targets, labels, header not cut`, async ({
		browser
	}) => {
		test.setTimeout(120_000);
		const page = await viewportPage(browser, 375, 740);
		try {
			await page.goto('/');
			await setLocale(page, locale);
			for (const path of [
				'/',
				'/login',
				'/register',
				'/forgot-password',
				'/resend-confirmation',
				'/auth/confirm?token_hash=not-a-token&type=email',
				'/auth/confirm?token_hash=not-a-token&type=recovery'
			]) {
				await open(page, path);
				await expect(page.locator('html')).toHaveAttribute('lang', locale);
				await expect(page.locator('ix-button, ix-input, ix-application-header')).toHaveCount(0);
				await expectFits(page);
			}

			// /reset-password needs a recovery session (and shows in the signed-in shell).
			const parent = await createParent(`fit-${locale}`);
			await recoverySession(page, parent.email);
			await expect(page.locator('html')).toHaveAttribute('lang', locale);
			await expectFits(page);
		} finally {
			await page.context().close();
		}
	});
}
