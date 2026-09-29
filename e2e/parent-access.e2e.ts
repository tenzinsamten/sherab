import { expect, test, type Page } from '@playwright/test';
import { service, signIn, type TestUser } from './fixtures';

/**
 * B14a (#68): a teacher requests parent access on /account, the admin
 * approves it in the /requests parent queue, and the teacher's avatar menu
 * then offers Parent (the B13 switcher).
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const userIds: string[] = [];

let teacher: TestUser;
let admin: TestUser;

async function createUser(role: 'teacher' | 'admin', key: string): Promise<TestUser> {
	const email = `e2e-68a-${key}-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role },
		user_metadata: { display_name: `B14a ${key} ${tag}` }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

test.beforeAll(async () => {
	teacher = await createUser('teacher', 'teacher');
	admin = await createUser('admin', 'admin');
});

test.afterAll(async () => {
	const problems: string[] = [];
	for (const id of userIds) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
});

const card = (page: Page) =>
	page.locator('section', { has: page.getByRole('heading', { name: 'Parent access' }) });
const parentOption = (page: Page) =>
	page.locator('ix-avatar ix-dropdown-item[data-role-option="parent"]');

async function openAccount(page: Page) {
	await page.goto('/account');
	await page.waitForFunction(() => customElements.get('ix-button') !== undefined);
	await page.waitForLoadState('networkidle');
}

test('teacher requests parent access, the admin approves, Parent appears in the switcher', async ({
	page,
	browser
}) => {
	await signIn(page, teacher);
	await openAccount(page);
	await expect(card(page)).toBeVisible();
	await card(page).getByRole('button', { name: 'Request parent access' }).click();
	await expect(
		page.locator('ix-toast').getByText('Request sent. The admin will review it.')
	).toBeVisible();
	await expect(card(page)).toContainText('Awaiting admin approval.');
	await expect(parentOption(page)).toHaveCount(0);

	const context = await browser.newContext();
	const adminPage = await context.newPage();
	try {
		await signIn(adminPage, admin);
		await adminPage.goto('/requests');
		await adminPage.waitForFunction(() => customElements.get('ix-button') !== undefined);
		await adminPage.waitForLoadState('networkidle');
		const row = adminPage.locator('tr', { hasText: teacher.email });
		await expect(row).toContainText('Teacher');
		await row.getByRole('button', { name: 'Approve' }).click();
		await expect(adminPage.locator('ix-toast').getByText(/was approved as a parent/)).toBeVisible();
	} finally {
		await context.close();
	}

	await openAccount(page);
	await expect(card(page)).toContainText('You have parent access.');
	await expect(card(page)).toContainText(teacher.email);
	await page.waitForFunction(() => customElements.get('ix-avatar') !== undefined);
	await page.locator('ix-avatar').click();
	await expect(parentOption(page)).toHaveCount(1);
});

test('a parent-only login sees no Parent access card', async ({ page }) => {
	const email = `e2e-68a-parent-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role: 'parent' }
	});
	if (error || !data.user) throw new Error(`create parent: ${error?.message}`);
	userIds.push(data.user.id);
	const { error: approveError } = await service
		.from('parents')
		.update({ status: 'approved' })
		.eq('id', data.user.id);
	expect(approveError).toBeNull();

	await signIn(page, { id: data.user.id, email, password });
	await openAccount(page);
	await expect(page.getByRole('heading', { name: 'Your name' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Parent access' })).toHaveCount(0);
});
