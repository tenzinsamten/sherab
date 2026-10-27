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
 * Story 6b adds the join flow (/join, /join/pending): its matrix rows at
 * both widths, and its pages (each join step) in the fit check.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);

const VIEWPORTS = [
	{ name: 'phone', width: 375, height: 740 },
	{ name: 'tablet', width: 820, height: 1180 }
] as const;

const LOCALES = ['en', 'de', 'bo'] as const;

/** #16: the signed-out home's two section headings per interface language. */
const HOME_SECTIONS: Record<(typeof LOCALES)[number], [string, string]> = {
	en: ['How joining works', 'What Sherab tracks'],
	de: ['So funktioniert der Beitritt', 'Was Sherab festhält'],
	bo: ['འཛིན་གྲྭར་ཇི་ལྟར་ཞུགས་དགོས།', 'ཤེས་རབ་ཀྱིས་ཐོ་འགོད་བྱེད་པ།']
};

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

/** Story 6b: a class to join and an approved parent to name as guardian. */
const joinClassName = `E2E Auth Join ${tag}`;
const joinCode = `J${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
let joinClassId = '';
let joinParent: TestUser;

test.beforeAll(async () => {
	const { data: cls, error } = await service
		.from('classes')
		.insert({ name: joinClassName, code: joinCode })
		.select('id')
		.single();
	if (error || !cls) throw new Error(`create join class: ${error?.message}`);
	joinClassId = cls.id;
	joinParent = await createParent('guardian');
	const { error: approveError } = await service
		.from('parents')
		.update({ status: 'approved' })
		.eq('id', joinParent.id);
	if (approveError) throw new Error(`approve parent: ${approveError.message}`);
});

test.afterAll(async () => {
	const problems: string[] = [];
	// Students registered through /join first: a parent with linked children
	// cannot be deleted (student_parents), and a class with students cannot be deleted.
	if (joinParent) {
		const { data: students } = await service
			.from('profiles')
			.select('id')
			.eq('role', 'student')
			.eq('registered_by_parent_id', joinParent.id);
		for (const { id } of students ?? []) {
			const { error } = await service.auth.admin.deleteUser(id);
			if (error) problems.push(`delete student ${id}: ${error.message}`);
		}
	}
	for (const email of registered) {
		const { data } = await service.from('profiles').select('id').eq('email', email);
		for (const row of data ?? []) userIds.push(row.id);
	}
	for (const id of userIds) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error && !/not found/i.test(error.message)) problems.push(`delete ${id}: ${error.message}`);
	}
	if (joinClassId) {
		const { error } = await service.from('classes').delete().eq('id', joinClassId);
		if (error) problems.push(`delete join class: ${error.message}`);
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
	page.locator('[data-sonner-toast]').getByText(text).first();

/**
 * #117: the action's error also stays in the form, as a message at
 * `#<at>-error`, and each marked field is invalid and described by it.
 */
async function expectFormError(page: Page, at: string, text: string, marked: string[]) {
	const error = page.locator(`#${at}-error`);
	await expect(error).toHaveText(text);
	// No live role: the toast already announces it.
	await expect(error).not.toHaveAttribute('role');
	for (const id of marked) {
		await expect(page.locator(`#${id}`)).toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator(`#${id}`)).toHaveAttribute('aria-describedby', `${at}-error`);
	}
}

/** Turns off the browser's checks (required, minlength, type="email") so the server's run. */
async function skipBrowserChecks(page: Page) {
	await page.locator('[data-auth-card] form[method="POST"]').evaluate((form) => {
		(form as HTMLFormElement).noValidate = true;
	});
}

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
			// A checkbox is tapped through its label row (story 6b's consent).
			const target = el.matches('input[type="checkbox"]') ? (el.closest('label') ?? el) : el;
			const box = target.getBoundingClientRect();
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
			await page.getByLabel('Email or username').fill(parent.email);
			await page.locator('#password').fill('wrong-password');
			await page.getByRole('button', { name: 'Sign in' }).click();
			await expect(toast(page, 'Invalid email or password.')).toBeVisible();
			await expect(page).toHaveURL(/\/login$/);
			await expect(page.locator('#email')).toHaveValue(parent.email);
			// #117: above the button, both fields marked; still there once the toast has gone.
			await expectFormError(page, 'form', 'Invalid email or password.', ['email', 'password']);
			await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
			await expect(page.locator('#form-error')).toHaveText('Invalid email or password.');
			await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
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
			await expectFormError(
				page,
				'email',
				'An account with this email already exists. Sign in instead. If you are a teacher and also a parent, sign in and use “Request parent access” under My Account.',
				['email']
			);

			// #117: too short (past the browser's minlength) under Password; the
			// email's error is replaced.
			await skipBrowserChecks(page);
			await page.locator('#password').fill('abc');
			await page.locator('#confirm').fill('abc');
			await page.getByRole('button', { name: 'Create account' }).click();
			await expectFormError(page, 'password', 'Password must be at least 6 characters.', [
				'password'
			]);
			await expect(page.locator('#email-error')).toHaveCount(0);
			await expect(page.locator('#email')).not.toHaveAttribute('aria-invalid');

			// A mismatch under Confirm.
			await page.locator('#password').fill('secret-123');
			await page.locator('#confirm').fill('secret-456');
			await page.getByRole('button', { name: 'Create account' }).click();
			await expectFormError(page, 'confirm', 'Passwords do not match.', ['confirm']);
			await expect(page.locator('#password-error')).toHaveCount(0);
			await page.locator('#confirm').fill('secret-123');

			const email = `e2e-auth-reg-${v.name}-${tag}@example.test`;
			registered.push(email);
			await page.locator('#email').fill(email);
			await page.getByRole('button', { name: 'Create account' }).click();
			await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
			await expect(page.getByText(email)).toBeVisible();
		});

		test(`forgot and resend (${v.name}): status lines; an expired link toasts`, async ({
			page
		}) => {
			await open(page, '/forgot-password?error=expired');
			await expect(
				toast(page, 'That reset link is invalid or has expired. Please request a new one.')
			).toBeVisible();
			// #117: a student's username, under Email.
			await page.locator('#email').fill(`student-${v.name}`);
			await page.getByRole('button', { name: 'Send reset link' }).click();
			await expectFormError(
				page,
				'email',
				"Students can't reset their own password yet. Please ask your teacher.",
				['email']
			);
			await page.locator('#email').fill(`nobody-${v.name}-${tag}@example.test`);
			await page.getByRole('button', { name: 'Send reset link' }).click();
			// #129: a status line that stays, and no success toast.
			await expect(page.getByRole('status')).toContainText('If an account exists for that email');
			// At once, not retried: a returning success toast would still be there.
			expect(
				await page
					.locator('[data-sonner-toast]')
					.filter({ hasText: /If an account exists/ })
					.count()
			).toBe(0);
			await expect(page.locator('#email-error')).toHaveCount(0);
			await expect(page.locator('#email')).not.toHaveAttribute('aria-invalid');

			await open(page, '/resend-confirmation');
			// #117: empty (past the browser's check), under Email.
			await skipBrowserChecks(page);
			await page.getByRole('button', { name: 'Send link' }).click();
			await expectFormError(page, 'email', 'Enter the email you registered with.', ['email']);
			await page.locator('#email').fill(`nobody-${v.name}-${tag}@example.test`);
			await page.getByRole('button', { name: 'Send link' }).click();
			await expect(page.getByRole('status')).toContainText(
				'If this email is waiting for confirmation, a new link is on its way.'
			);
			await expect(page.locator('#email-error')).toHaveCount(0);
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
			await expectFormError(page, 'confirm', 'Passwords do not match.', ['confirm']);

			// #117: too short (past the browser's minlength), under Password.
			await skipBrowserChecks(page);
			await page.locator('#password').fill('abc');
			await page.locator('#confirm').fill('abc');
			await page.getByRole('button', { name: 'Update password' }).click();
			await expectFormError(page, 'password', 'Password must be at least 6 characters.', [
				'password'
			]);
			await expect(page.locator('#confirm-error')).toHaveCount(0);

			await page.locator('#password').fill('new-secret-1');
			await page.locator('#confirm').fill('new-secret-1');
			await page.getByRole('button', { name: 'Update password' }).click();
			await expect(page).not.toHaveURL(/\/reset-password/);
			await expect(page.locator('[data-app-shell]')).toBeVisible();
		});

		test(`sending (${v.name}): sign in, forgot, resend and reset show a busy button; one post per press (#118)`, async ({
			page
		}) => {
			// Held at the network: the button is disabled and busy until the answer,
			// and a second submit of the form (Enter cannot: the button is disabled)
			// is ignored, so one POST goes out.
			async function heldSubmit(button: string) {
				let release!: () => void;
				const held = new Promise<void>((resolve) => (release = resolve));
				let posts = 0;
				await page.route('**/*', async (route) => {
					if (route.request().method() !== 'POST') return route.fallback();
					posts += 1;
					await held;
					await route.continue();
				});
				try {
					const submit = page.getByRole('button', { name: button });
					await submit.click();
					await expect(submit).toBeDisabled();
					await expect(submit).toHaveAttribute('aria-busy', 'true');
					await page.locator('main form').evaluate((form: HTMLFormElement) => form.requestSubmit());
					release();
					await expect(submit).toBeEnabled();
					await expect(submit).not.toHaveAttribute('aria-busy');
					expect(posts).toBe(1);
				} finally {
					release();
					await page.unroute('**/*');
				}
			}

			await open(page, '/login');
			await page.locator('#email').fill(`nobody-send-${v.name}-${tag}@example.test`);
			await page.locator('#password').fill('wrong-password');
			await heldSubmit('Sign in');
			await expect(page.locator('#form-error')).toHaveText('Invalid email or password.');
			await expect(page.locator('#email')).toHaveValue(`nobody-send-${v.name}-${tag}@example.test`);

			await open(page, '/forgot-password');
			await page.locator('#email').fill(`nobody-send-${v.name}-${tag}@example.test`);
			await heldSubmit('Send reset link');
			await expect(page.getByRole('status')).toContainText('If an account exists for that email');
			// At once, not retried: a returning success toast would still be there.
			expect(
				await page
					.locator('[data-sonner-toast]')
					.filter({ hasText: /If an account exists/ })
					.count()
			).toBe(0);

			await open(page, '/resend-confirmation');
			await page.locator('#email').fill(`nobody-send-${v.name}-${tag}@example.test`);
			await heldSubmit('Send link');
			await expect(page.getByRole('status')).toContainText('a new link is on its way');

			const parent = await createParent(`send-${v.name}`);
			await recoverySession(page, parent.email);
			await page.locator('#password').fill('new-secret-1');
			await page.locator('#confirm').fill('new-secret-2');
			await heldSubmit('Update password');
			await expect(page.locator('#confirm-error')).toHaveText('Passwords do not match.');
		});

		test(`no connection (${v.name}): a failed sign-in post toasts and keeps the page (#120)`, async ({
			page
		}) => {
			await open(page, '/login');
			const email = `nobody-offline-${v.name}-${tag}@example.test`;
			await page.locator('#email').fill(email);
			await page.locator('#password').fill('any-password');
			await page.route('**/*', (route) =>
				route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback()
			);
			try {
				await page.getByRole('button', { name: 'Sign in' }).click();
				await expect(
					toast(page, 'No connection. Check your internet and try again.')
				).toBeVisible();
				await expect(page).toHaveURL(/\/login$/);
				await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
				await expect(page.locator('#email')).toHaveValue(email);
				await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
			} finally {
				await page.unroute('**/*');
			}
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

		test(`skip link (${v.name}): the first Tab shows it; Enter moves focus to the page (#122)`, async ({
			page
		}) => {
			await open(page, '/login');
			await page.locator('body').focus();
			await page.keyboard.press('Tab');
			const skip = page.getByRole('link', { name: 'Skip to content' });
			await expect(skip).toBeFocused();
			await expect(skip).toBeInViewport();
			await page.keyboard.press('Enter');
			await expect(page.locator('main#main')).toBeFocused();
			// The next Tab goes into the page, not back to the header.
			await page.keyboard.press('Tab');
			await expect(page.locator('#email')).toBeFocused();
		});

		test(`keyboard (${v.name}): every control on sign in shows focus, in order`, async ({
			page
		}) => {
			await open(page, '/login');
			await recordResting(page);
			await page.locator('body').focus();
			const order: string[] = [];
			for (let i = 0; i < 10; i++) {
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
			// #122: the skip link first.
			expect(order).toEqual([
				'Skip to content',
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

/** The join stepper's steps (story 6b). */
const joinSteps = (page: Page) => page.getByTestId('join-steps').getByRole('listitem');
const stepButtons = (page: Page) => page.getByTestId('join-steps').getByRole('button');

/** The step (1-based) marked `aria-current="step"`; exactly one must be. */
async function currentStep(page: Page): Promise<number> {
	const marked = await joinSteps(page).evaluateAll((steps) =>
		steps.flatMap((s, i) => (s.getAttribute('aria-current') === 'step' ? [i + 1] : []))
	);
	if (marked.length !== 1) throw new Error(`steps marked current: ${JSON.stringify(marked)}`);
	return marked[0];
}

/** No step label is cut: each label's box stays inside its row's box. */
async function expectStepsFit(page: Page) {
	const cut = await page.getByTestId('join-steps').evaluate((root) =>
		[...root.querySelectorAll('li')].flatMap((li) => {
			const row = li.firstElementChild?.getBoundingClientRect();
			const label = li.querySelector('[data-step-label]')?.getBoundingClientRect();
			const inside =
				row &&
				label &&
				label.width > 0 &&
				label.left >= row.left - 0.5 &&
				label.right <= row.right + 0.5 &&
				label.top >= row.top - 0.5 &&
				label.bottom <= row.bottom + 0.5;
			return inside ? [] : [li.textContent?.trim() ?? ''];
		})
	);
	expect(cut).toEqual([]);
}

/** /join to step 3 in any language (ids and form roles, not English names). */
async function joinToStep3(page: Page, name: string) {
	await open(page, '/join');
	await page.locator('#classCode').fill(joinCode.toLowerCase());
	await page.locator('main form button[type="submit"]').click();
	await expect(page.locator('#registrationName')).toBeVisible();
	await page.locator('#registrationName').fill(name);
	// Step 2's first action is Continue (the steps above are no data-slot buttons).
	await page.locator('main button[data-slot="button"]').first().click();
	await expect(page.locator('#guardianEmail')).toBeVisible();
}

for (const v of VIEWPORTS) {
	test.describe(`join at ${v.width}px`, () => {
		test.use({ viewport: { width: v.width, height: v.height } });

		test(`join step 1 (${v.name}): a lower-case code shows upper-cased; empty and unknown codes say so`, async ({
			page
		}) => {
			await open(page, '/join');
			const code = page.getByLabel('What is your class code?');
			const cont = page.getByRole('button', { name: 'Continue' });

			// Empty: the error under the field and a toast, still step 1.
			await cont.click();
			await expect(page.locator('#classCode-error')).toHaveText('Enter your class code.');
			await expect(toast(page, 'Enter your class code.')).toBeVisible();
			await expect(code).toHaveAttribute('aria-invalid', 'true');
			await expect(code).toHaveAccessibleDescription('Enter your class code.');

			// Unknown: the same, with its own message.
			await code.fill('ZZZZZZ');
			await expect(code).not.toHaveAttribute('aria-invalid');
			await cont.click();
			await expect(page.locator('#classCode-error')).toHaveText(
				'No class has that code. Check it with your teacher.'
			);
			await expect(toast(page, 'No class has that code.')).toBeVisible();
			await expect(code).toHaveAttribute('aria-invalid', 'true');
			await expect.poll(() => currentStep(page)).toBe(1);

			// Typed mid-string: upper-cased with the caret kept where it was.
			await code.fill('');
			await code.pressSequentially('abd');
			await code.press('ArrowLeft');
			await code.pressSequentially('c');
			await expect(code).toHaveValue('ABCD');
			expect(await code.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(3);

			// Lower-case typed, shown upper-cased; step 2 with the class badge.
			await code.fill('');
			await code.pressSequentially(joinCode.toLowerCase());
			await expect(code).toHaveValue(joinCode);
			await cont.click();
			await expect.poll(() => currentStep(page)).toBe(2);
			await expect(
				page.locator('main [data-slot="badge"]', { hasText: `${joinClassName} · ${joinCode}` })
			).toBeVisible();
			await expect(page.getByText('Step 2 of 4: Your name')).toBeAttached();
			await expectFits(page);
			await expectStepsFit(page);
		});

		test(`join step 2 (${v.name}): Continue waits for a name`, async ({ page }) => {
			await open(page, '/join');
			await page.getByLabel('What is your class code?').fill(joinCode);
			await page.getByRole('button', { name: 'Continue' }).click();
			const cont = page.getByRole('button', { name: 'Continue' });
			await expect(cont).toBeDisabled();
			await page.getByLabel('Full name').fill('   ');
			await expect(cont).toBeDisabled();
			await page.getByLabel('Full name').fill(`Auth Join ${v.name} ${tag}`);
			await expect(cont).toBeEnabled();
			await cont.click();
			await expect.poll(() => currentStep(page)).toBe(3);
		});

		test(`join step 3 and pending (${v.name}): a server error toasts and keeps the email; success shows the credentials once`, async ({
			page
		}) => {
			const name = `Auth Join ${v.name} ${tag}`;
			await joinToStep3(page, name);
			const email = page.getByLabel("Guardian's email");
			const submit = page.getByRole('button', { name: 'Submit' });
			await expect(submit).toBeDisabled();
			const unknown = `nobody-join-${v.name}-${tag}@example.test`;
			await email.fill(unknown);
			await expect(submit).toBeDisabled();
			await page.getByRole('checkbox').check();
			await expect(submit).toBeEnabled();
			await expectFits(page);
			await expectStepsFit(page);

			await submit.click();
			await expect(toast(page, 'No parent account found.')).toBeVisible();
			await expect(page).toHaveURL(/\/join$/);
			await expect(email).toHaveValue(unknown);
			await expect.poll(() => currentStep(page)).toBe(3);

			await email.fill(joinParent.email);
			await submit.click();
			await expect(page).toHaveURL(/\/join\/pending$/);
			await ready(page);
			await expect.poll(() => currentStep(page)).toBe(4);
			await expect(page.getByText('Step 4 of 4: Waiting for approval')).toBeAttached();
			await expect(page.locator('main [data-slot="badge"]', { hasText: 'Pending' })).toBeVisible();
			// The receipt keeps its row headers.
			await expect(page.getByRole('rowheader', { name: 'Name' })).toBeVisible();
			await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
			await expect(page.getByRole('cell', { name: joinClassName, exact: true })).toBeVisible();
			const credentials = page.getByTestId('join-credentials');
			await expect(credentials.locator('.credential')).toHaveCount(2);
			await expect(credentials).toContainText('shown here only once');
			await expect(page.getByText(/You can sign in right away/)).toBeVisible();
			await expect(page.getByRole('link', { name: 'Start over' })).toHaveAttribute(
				'href',
				/\/join$/
			);
			await expect(page.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
				'href',
				/\/login$/
			);
			await expectFits(page);
			await expectStepsFit(page);
		});

		test(`join go back (${v.name}): a finished step goes back with focus in its field, not while sending`, async ({
			page
		}) => {
			await joinToStep3(page, `Auth Back ${v.name} ${tag}`);
			await page.getByLabel("Guardian's email").fill(`nobody-back-${v.name}-${tag}@example.test`);
			await page.getByRole('checkbox').check();

			// While the form is sent, no step can be picked.
			let release: () => void = () => {};
			const held = new Promise<void>((resolve) => (release = resolve));
			await page.route('**/*?/register', async (route) => {
				await held;
				await route.continue();
			});
			await page.getByRole('button', { name: 'Submit' }).click();
			await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();
			await expect(page.getByRole('button', { name: 'Submit' })).toHaveAttribute(
				'aria-busy',
				'true'
			);
			await expect(stepButtons(page)).toHaveCount(0);
			await expect(joinSteps(page).nth(0).locator('[data-step-sr]')).toHaveText('Class code, done');
			release();
			await expect(toast(page, 'No parent account found.')).toBeVisible();
			await page.unroute('**/*?/register');
			await expect(stepButtons(page)).toHaveCount(2);

			// Step 1 picked from step 3: the code kept, focus in its field.
			await page.getByRole('button', { name: 'Class code, done' }).click();
			await expect.poll(() => currentStep(page)).toBe(1);
			const code = page.getByLabel('What is your class code?');
			await expect(code).toBeFocused();
			await expect(code).toHaveValue(joinCode);
		});

		test(`join pending (${v.name}): without credentials, no sign-in promise`, async ({ page }) => {
			await open(page, '/join/pending');
			await expect.poll(() => currentStep(page)).toBe(4);
			await expect(page.locator('main [data-slot="badge"]', { hasText: 'Pending' })).toBeVisible();
			await expect(page.getByTestId('join-credentials')).toHaveCount(0);
			await expect(page.getByText(/If you have your username and PIN/)).toBeVisible();
			await expect(page.getByText(/You can sign in right away/)).toHaveCount(0);
			await expect(page.getByRole('link', { name: 'Start over' })).toBeVisible();
			await expect(page.getByRole('link', { name: 'Go to sign in' })).toBeVisible();
			await expectFits(page);
			await expectStepsFit(page);
		});
	});
}

for (const locale of LOCALES) {
	test(`every auth page at 375px (join also at 820px) in ${locale}: fits, 44px targets, labels, header not cut`, async ({
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
				await expectFits(page);
				if (path === '/') {
					// #16: How joining works (3 steps) and What Sherab tracks (4 cards).
					const [join, tracks] = HOME_SECTIONS[locale];
					await expect(page.getByRole('heading', { level: 2, name: join })).toBeVisible();
					await expect(page.getByRole('heading', { level: 2, name: tracks })).toBeVisible();
					const steps = page.getByTestId('home-join').locator('ol > li');
					await expect(steps).toHaveCount(3);
					for (const step of await steps.all()) await expect(step).toBeVisible();
					const cards = page.getByTestId('home-tracks').locator('ul > li');
					await expect(cards).toHaveCount(4);
					for (const card of await cards.all()) await expect(card).toBeVisible();

					// From 820px: the welcome card first, then the sections; the
					// cards in two columns; at 1440px the sections at most 5xl wide.
					await page.setViewportSize({ width: 820, height: 1180 });
					const h1 = await page.locator('[data-auth-card] h1').boundingBox();
					const h2 = await page.getByTestId('home-join').locator('h2').boundingBox();
					expect(h2!.y).toBeGreaterThanOrEqual(h1!.y + h1!.height);
					const first = await cards.nth(0).boundingBox();
					const second = await cards.nth(1).boundingBox();
					expect(Math.abs(first!.y - second!.y)).toBeLessThan(1);
					expect(second!.x).toBeGreaterThan(first!.x);
					await page.setViewportSize({ width: 1440, height: 900 });
					const sections = await page.getByTestId('home-sections').boundingBox();
					expect(sections!.width).toBeLessThanOrEqual(1024);
					await page.setViewportSize({ width: 375, height: 740 });
				}
			}

			// The join flow (story 6b): each step, at phone and iPad width.
			for (const width of [375, 820]) {
				await page.setViewportSize({ width, height: width === 375 ? 740 : 1180 });
				await joinToStep3(page, `Auth Fit ${locale} ${tag}`);
				await expect(page.locator('html')).toHaveAttribute('lang', locale);
				await expectFits(page);
				await expectStepsFit(page);
				// Back to step 1 through the stepper, then step 2 again.
				await stepButtons(page).first().click();
				await expect(page.locator('#classCode')).toBeFocused();
				await expectFits(page);
				await expectStepsFit(page);
				await page.locator('main form button[type="submit"]').click();
				await expect(page.locator('#registrationName')).toBeVisible();
				await expectFits(page);
				await expectStepsFit(page);
				await open(page, '/join/pending');
				await expectFits(page);
				await expectStepsFit(page);
			}
			await page.setViewportSize({ width: 375, height: 740 });

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
