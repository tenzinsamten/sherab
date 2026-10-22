import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { service, signIn, type TestUser } from './fixtures';

/**
 * Mobile-first story 10: the app-wide toast (Sonner behind showToast), one
 * test per toast row of the story's I/O matrix. Real actions on My account:
 * "Save name" succeeds; a name of spaces fails on the server
 * (`fail(400, { error })`), which the root layout toasts.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
let user: TestUser;

test.beforeAll(async () => {
	const email = `e2e-toast-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role: 'teacher' },
		user_metadata: { display_name: `Toast ${tag}` }
	});
	if (error || !data.user) throw new Error(`create user: ${error?.message}`);
	user = { id: data.user.id, email, password };
});

test.afterAll(async () => {
	if (user) await service.auth.admin.deleteUser(user.id);
});

const toasts = (page: Page) => page.locator('[data-sonner-toast]');

/** Waits until the toast has slid in (Sonner's 400ms enter transition). */
async function settled(toast: Locator) {
	await expect(toast).toHaveAttribute('data-mounted', 'true');
	await toast.page().waitForTimeout(500);
}

async function accountPage(browser: Browser, width: number, height: number) {
	const context = await browser.newContext({ viewport: { width, height } });
	const page = await context.newPage();
	await signIn(page, user);
	await page.goto('/account');
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
	return page;
}

async function saveName(page: Page, name: string) {
	await page.locator('#displayName').fill(name);
	await page.locator('form[action="?/updateName"] button[type="submit"]').click();
}

test('success toast at 1440px: the same text, top right, closes by itself after about 5 s', async ({
	browser
}) => {
	const page = await accountPage(browser, 1440, 900);
	try {
		await saveName(page, `Toast renamed ${tag}`);
		const toast = toasts(page);
		await expect(toast).toHaveCount(1);
		await expect(toast).toHaveText('Name updated.');
		await expect(toast).toHaveAttribute('data-type', 'success');
		await settled(toast);
		await expect(toast).toHaveAttribute('data-y-position', 'top');
		await expect(toast).toHaveAttribute('data-x-position', 'right');
		const box = (await toast.boundingBox())!;
		// In the top-right corner, inside Sonner's 24px offset.
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.y).toBeLessThanOrEqual(32);
		expect(box.x).toBeGreaterThan(1440 / 2);
		expect(1440 - (box.x + box.width)).toBeLessThanOrEqual(32);
		// Still there after 3 s, gone well before 7 s (duration 5 s).
		await page.waitForTimeout(3000);
		await expect(toast).toHaveCount(1);
		await expect(toast).toHaveCount(0, { timeout: 4000 });
	} finally {
		await page.context().close();
	}
});

test('error toast at 1440px: one fail(…, { error }) result gives exactly one error toast, never twice', async ({
	browser
}) => {
	const page = await accountPage(browser, 1440, 900);
	try {
		// Spaces pass the field's `required`, the server trims and refuses.
		await saveName(page, '   ');
		const toast = toasts(page);
		await expect(toast).toHaveCount(1);
		await expect(toast).toHaveText('Enter a name of 1 to 80 characters.');
		await expect(toast).toHaveAttribute('data-type', 'error');
		await expect(toast).toHaveAttribute('data-rich-colors', 'true');
		// The same form result stays in page.form while the page re-renders
		// (typing updates its state): it is not toasted again.
		await page.getByLabel('Display name').fill(`Toast typing ${tag}`);
		await page.waitForTimeout(1000);
		await expect(toast).toHaveCount(1);
	} finally {
		await page.context().close();
	}
});

test('phone toast at 375px: full width at the top, the close button dismisses it', async ({
	browser
}) => {
	const page = await accountPage(browser, 375, 812);
	try {
		await saveName(page, `Toast phone ${tag}`);
		const toast = toasts(page);
		await expect(toast).toHaveCount(1);
		await expect(toast).toHaveText('Name updated.');
		await settled(toast);
		const box = (await toast.boundingBox())!;
		// Sonner's 16px mobile offset on each side and at the top.
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.y).toBeLessThanOrEqual(24);
		expect(box.x).toBeLessThanOrEqual(16);
		expect(box.width).toBeGreaterThanOrEqual(375 - 2 * 16 - 1);
		const close = toast.getByRole('button', { name: 'Close' });
		await expect(close).toBeVisible();
		// CAP-3: it looks 20px, but a centred pseudo-element gives it a 44×44px
		// hit area; a tap 20px right of and below its centre still hits it.
		const hit = await close.evaluate((button) => {
			const after = getComputedStyle(button, '::after');
			const rect = button.getBoundingClientRect();
			const x = rect.left + rect.width / 2 + 20;
			const y = rect.top + rect.height / 2 + 20;
			const target = document.elementFromPoint(x, y);
			return {
				width: parseFloat(after.width),
				height: parseFloat(after.height),
				visible: rect.width,
				hits: target !== null && button.contains(target)
			};
		});
		expect(hit.width).toBeGreaterThanOrEqual(44);
		expect(hit.height).toBeGreaterThanOrEqual(44);
		expect(hit.visible).toBeLessThan(44);
		expect(hit.hits).toBe(true);
		await close.click();
		// Well before the 5 s auto-close.
		await expect(toast).toHaveCount(0, { timeout: 2000 });
	} finally {
		await page.context().close();
	}
});

test('Tibetan interface at 375px: the toast is drawn in Atisha with the taller line', async ({
	browser
}) => {
	const page = await accountPage(browser, 375, 812);
	try {
		// A /bo/... address sets the language cookie and redirects (#79).
		await page.goto('/bo/account');
		await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
		await expect(page.locator('html')).toHaveAttribute('lang', 'bo');
		await saveName(page, `Toast bo ${tag}`);
		const toast = toasts(page);
		await expect(toast).toHaveCount(1);
		await expect(toast).toHaveAttribute('data-type', 'success');
		const font = await toast.evaluate((el) => {
			const title = el.querySelector('[data-title]')!;
			const style = getComputedStyle(title);
			return {
				toastFamily: getComputedStyle(el).fontFamily,
				titleFamily: style.fontFamily,
				size: parseFloat(style.fontSize),
				lineHeight: style.lineHeight
			};
		});
		expect(font.toastFamily).toMatch(/^Atisha,/);
		expect(font.titleFamily).toMatch(/^Atisha,/);
		expect(font.lineHeight).toBe(`${2 * font.size}px`);
	} finally {
		await page.context().close();
	}
});
