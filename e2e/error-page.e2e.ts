import { expect, test } from '@playwright/test';
import { mainNav, service, signIn, type TestUser } from './fixtures';

/**
 * #115: errors land on a translated page inside the shell, with the status
 * and one way back (the role's home, or `/` signed out), never the server's
 * own English message.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
let teacher: TestUser;

test.beforeAll(async () => {
	const email = `e2e-115-teacher-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role: 'teacher' }
	});
	if (error || !data.user) throw new Error(`create teacher: ${error?.message}`);
	teacher = { id: data.user.id, email, password };
});

test.afterAll(async () => {
	if (!teacher) return;
	const { error } = await service.auth.admin.deleteUser(teacher.id);
	if (error) throw new Error(`delete teacher: ${error.message}`);
});

test('signed out, an unknown address shows "Page not found" and leads to the start page', async ({
	page
}) => {
	const response = await page.goto(`/no-such-page-${tag}`);
	expect(response?.status()).toBe(404);
	const errorPage = page.getByTestId('error-page');
	await expect(errorPage.getByRole('heading', { level: 1 })).toHaveText('Page not found');
	await expect(page.getByTestId('error-status')).toHaveText('Error 404');
	await expect(page).toHaveTitle('Page not found — Sherab');
	await page.getByTestId('error-home').click();
	await expect(page).toHaveURL(/\/$/);
});

test('a teacher on an admin page sees "No access" in the shell and goes back to /teacher', async ({
	page
}) => {
	await signIn(page, teacher);
	const response = await page.goto('/admin');
	expect(response?.status()).toBe(403);
	const errorPage = page.getByTestId('error-page');
	await expect(errorPage.getByRole('heading', { level: 1 })).toHaveText('No access');
	await expect(page.getByTestId('error-status')).toHaveText('Error 403');
	await expect(errorPage).not.toContainText('Admin access only');
	// The shell stays: the navigation is still there.
	await expect(mainNav(page)).toBeVisible();
	await page.getByTestId('error-home').click();
	await expect(page).toHaveURL(/\/teacher$/);
});

test('under Tibetan the page is Tibetan, with Tibetan digits', async ({ page }) => {
	// A /bo/... address sets the language and redirects without the prefix (#79).
	const response = await page.goto(`/bo/no-such-page-${tag}`);
	expect(response?.status()).toBe(404);
	await expect(page.locator('html')).toHaveAttribute('lang', 'bo');
	await expect(page.getByTestId('error-page').getByRole('heading', { level: 1 })).toHaveText(
		'ཤོག་ངོས་རྙེད་མ་བྱུང་།'
	);
	await expect(page.getByTestId('error-status')).toHaveText('ནོར་འཁྲུལ་ ༤༠༤');
});
