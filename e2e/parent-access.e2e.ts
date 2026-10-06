import { expect, test, type Page } from '@playwright/test';
import { service, signIn, type TestUser } from './fixtures';

/**
 * B14a (#68): a teacher requests parent access on /account, the admin
 * approves it in the /requests parent queue, and the teacher's avatar menu
 * then offers Parent (the B13 switcher).
 *
 * B14b (#68): the admin creates a teacher with an approved parent-only
 * login's email, cancels once (nothing changes), confirms the promotion, and
 * that login is then Teacher and Parent. Removing them as teacher later keeps
 * the parent account: they sign in and land on /parent.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const userIds: string[] = [];
const classIds: string[] = [];

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
	for (const id of classIds) {
		const { error } = await service.from('classes').delete().eq('id', id);
		if (error) problems.push(`delete class ${id}: ${error.message}`);
	}
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

test('B14b: the admin creates a teacher with a parent-only email, confirms, and the login is Teacher and Parent', async ({
	page,
	browser
}) => {
	const email = `e2e-68b-parent-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role: 'parent' },
		user_metadata: { display_name: `B14b parent ${tag}` }
	});
	if (error || !data.user) throw new Error(`create parent: ${error?.message}`);
	userIds.push(data.user.id);
	const { error: approveError } = await service
		.from('parents')
		.update({ status: 'approved' })
		.eq('id', data.user.id);
	expect(approveError).toBeNull();

	const className = `B14b class ${tag}`;
	const { data: cls, error: classError } = await service
		.from('classes')
		.insert({ name: className, code: `B${tag.slice(0, 5).toUpperCase()}` })
		.select('id')
		.single();
	if (classError || !cls) throw new Error(`create class: ${classError?.message}`);
	classIds.push(cls.id);

	const roleOf = async () => {
		const { data: profile } = await service
			.from('profiles')
			.select('role')
			.eq('id', data.user!.id)
			.single();
		return profile?.role;
	};

	const context = await browser.newContext();
	const adminPage = await context.newPage();
	try {
		await signIn(adminPage, admin);
		await adminPage.goto('/admin/teachers');
		await adminPage.waitForFunction(() => customElements.get('ix-checkbox') !== undefined);
		await adminPage.waitForLoadState('networkidle');
		await adminPage.waitForFunction(() => customElements.get('ix-input') !== undefined);
		await adminPage.locator('#email input').first().fill(email);
		await adminPage.locator(`ix-checkbox[value="${cls.id}"]`).click();
		await adminPage.getByRole('button', { name: 'Create teacher' }).click();

		const modal = adminPage.locator('ix-modal');
		const question = modal.getByText(
			'This email already has a parent account. Make them a teacher too?',
			{ exact: false }
		);

		// Cancel first: nothing changes.
		await expect(question).toBeVisible();
		await modal.getByRole('button', { name: 'Cancel' }).click();
		await expect(question).toHaveCount(0);
		await expect(adminPage.locator('ix-toast')).toHaveCount(0);
		expect(await roleOf()).toBe('parent');
		await expect(adminPage.locator('tr', { hasText: email })).toHaveCount(0);

		// Submit again and confirm.
		await adminPage.getByRole('button', { name: 'Create teacher' }).click();
		await expect(question).toBeVisible();
		await modal.getByRole('button', { name: 'Make teacher' }).click();

		await expect(
			adminPage.locator('ix-toast').getByText(`${email} is now a teacher too.`, { exact: false })
		).toBeVisible();
		const row = adminPage.locator('tr', { hasText: email });
		await expect(row).toContainText(className);
		await expect(row).toContainText('Also a parent');
		await expect(adminPage.getByText('Temporary password')).toHaveCount(0);
		expect(await roleOf()).toBe('teacher');
	} finally {
		await context.close();
	}

	const promoted = { id: data.user.id, email, password };
	await signIn(page, promoted);
	await expect(page).toHaveURL(/\/teacher$/);
	await page.waitForFunction(() => customElements.get('ix-avatar') !== undefined);
	await page.locator('ix-avatar').click();
	await expect(page.locator('ix-avatar ix-dropdown-item[data-role-option="teacher"]')).toHaveCount(
		1
	);
	await expect(parentOption(page)).toHaveCount(1);

	// The admin removes them as teacher: the parent account is kept.
	const removeContext = await browser.newContext();
	const removePage = await removeContext.newPage();
	try {
		await signIn(removePage, admin);
		await removePage.goto('/admin/teachers');
		await removePage.waitForFunction(() => customElements.get('ix-button') !== undefined);
		await removePage.waitForLoadState('networkidle');
		const row = removePage.locator('tr', { hasText: email });
		await row.getByRole('button', { name: 'Remove' }).click();
		const modal = removePage.locator('ix-modal');
		await expect(modal.getByText('keep their parent account', { exact: false })).toBeVisible();
		await modal.getByRole('button', { name: 'Remove' }).click();
		await expect(
			removePage.locator('ix-toast').getByText('Their parent account is kept.', { exact: false })
		).toBeVisible();
		await expect(removePage.locator('tr', { hasText: email })).toHaveCount(0);
		expect(await roleOf()).toBe('parent');
	} finally {
		await removeContext.close();
	}

	const fresh = await browser.newContext();
	const parentPage = await fresh.newPage();
	try {
		await signIn(parentPage, promoted);
		await expect(parentPage).toHaveURL(/\/parent$/);
	} finally {
		await fresh.close();
	}
});

/** How many local mails `to` has received (Mailpit, `supabase start`). */
async function mailCount(to: string): Promise<number> {
	const res = await fetch(
		`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`
	);
	return ((await res.json()) as { messages?: unknown[] }).messages?.length ?? 0;
}

test('#90: the admin resends the confirmation mail and approves a parent whose email is unconfirmed', async ({
	page,
	browser
}) => {
	const email = `e2e-90-parent-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: false,
		app_metadata: { role: 'parent' },
		user_metadata: { display_name: `Unconfirmed ${tag}` }
	});
	if (error || !data.user) throw new Error(`create parent: ${error?.message}`);
	userIds.push(data.user.id);
	const parentId = data.user.id;
	expect(await mailCount(email)).toBe(0);

	await signIn(page, admin);
	await page.goto('/requests');
	await page.waitForFunction(() => customElements.get('ix-button') !== undefined);
	await page.waitForLoadState('networkidle');
	const row = page.locator('tr', { hasText: email });
	await expect(row).toContainText('Email not confirmed');

	await row.getByRole('button', { name: 'Resend confirmation email' }).click();
	await expect(
		page.locator('ix-toast').getByText(/A new confirmation email was sent/)
	).toBeVisible();
	await expect.poll(() => mailCount(email)).toBe(1);

	// Approve asks first; Cancel changes nothing.
	const modal = page.locator('ix-modal');
	await row.getByRole('button', { name: 'Approve' }).click();
	await expect(modal).toContainText(email);
	await modal.getByRole('button', { name: 'Cancel' }).click();
	await expect(modal).toHaveCount(0);
	const status = async () =>
		(await service.from('parents').select('status').eq('id', parentId).single()).data?.status;
	expect(await status()).toBe('pending');

	await row.getByRole('button', { name: 'Approve' }).click();
	await modal.getByRole('button', { name: 'Approve' }).click();
	await expect(page.locator('ix-toast').getByText(/was approved as a parent/)).toBeVisible();
	expect(await status()).toBe('approved');
	const { data: profile } = await service
		.from('profiles')
		.select('email_confirmed_at')
		.eq('id', parentId)
		.single();
	expect(profile?.email_confirmed_at).not.toBeNull();

	// The parent signs in without ever opening a mail and is past both gates.
	const fresh = await browser.newContext();
	try {
		const parentPage = await fresh.newPage();
		await signIn(parentPage, { id: parentId, email, password });
		await expect(parentPage).toHaveURL(/\/parent$/);
		await expect(parentPage.getByText('Open the confirmation link we sent to')).toHaveCount(0);
	} finally {
		await fresh.close();
	}
});

test('#91: rejecting a parent asks first; Cancel keeps the request', async ({ page }) => {
	const email = `e2e-91-parent-${tag}@example.test`;
	const { data, error } = await service.auth.admin.createUser({
		email,
		password: crypto.randomUUID(),
		email_confirm: true,
		app_metadata: { role: 'parent' },
		user_metadata: { display_name: `Reject me ${tag}` }
	});
	if (error || !data.user) throw new Error(`create parent: ${error?.message}`);
	const parentId = data.user.id;
	userIds.push(parentId);

	await signIn(page, admin);
	await page.goto('/requests');
	await page.waitForFunction(() => customElements.get('ix-button') !== undefined);
	await page.waitForLoadState('networkidle');
	const row = page.locator('tr', { hasText: email });
	const modal = page.locator('ix-modal');

	await row.getByRole('button', { name: 'Reject' }).click();
	await expect(modal).toContainText('Their account is deleted');
	await modal.getByRole('button', { name: 'Cancel' }).click();
	await expect(modal).toHaveCount(0);
	const { data: kept } = await service.from('parents').select('status').eq('id', parentId).single();
	expect(kept?.status).toBe('pending');

	await row.getByRole('button', { name: 'Reject' }).click();
	await modal.getByRole('button', { name: 'Reject' }).click();
	await expect(page.locator('ix-toast').getByText(/was rejected/)).toBeVisible();
	const { data: gone } = await service.auth.admin.getUserById(parentId);
	expect(gone.user).toBeNull();
	userIds.splice(userIds.indexOf(parentId), 1);
});
