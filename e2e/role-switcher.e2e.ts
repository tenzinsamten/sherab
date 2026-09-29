import { expect, test, type Page } from '@playwright/test';
import { service, signIn, type TestUser } from './fixtures';

/**
 * B13 (#68): the role switcher in the header avatar menu. Fixtures: a
 * teacher who is also an approved parent (a service-role parents row, like
 * rls.spec.ts's dualRole), a teacher whose parents row is still pending,
 * and a parent-only login. No children, so the parent calendar shows its
 * "no approved children" hint.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const userIds: string[] = [];

let teacherParent: TestUser;
let pendingTeacher: TestUser;
let parentOnly: TestUser;

async function createUser(role: 'teacher' | 'parent', key: string): Promise<TestUser> {
	const email = `e2e-68-${key}-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

async function parentRow(id: string, status: 'approved' | 'pending') {
	const { error } = await service.from('parents').upsert({ id, status });
	if (error) throw new Error(`parents row: ${error.message}`);
}

test.beforeAll(async () => {
	teacherParent = await createUser('teacher', 'dual');
	await parentRow(teacherParent.id, 'approved');
	pendingTeacher = await createUser('teacher', 'pending');
	await parentRow(pendingTeacher.id, 'pending');
	parentOnly = await createUser('parent', 'parent');
	await parentRow(parentOnly.id, 'approved');
});

test.afterAll(async () => {
	const problems: string[] = [];
	for (const id of userIds) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
});

const menu = (page: Page) => page.locator('ix-menu');
const roleOption = (page: Page, role: string) =>
	page.locator(`ix-avatar ix-dropdown-item[data-role-option="${role}"]`);

async function openAvatarMenu(page: Page) {
	await page.waitForFunction(() => customElements.get('ix-avatar') !== undefined);
	await page.locator('ix-avatar').click();
}

async function expectTeacherMenu(page: Page) {
	await expect(menu(page).locator('ix-menu-item', { hasText: 'Requests' })).toHaveCount(1);
	await expect(menu(page).locator('ix-menu-item', { hasText: 'Homework' })).toHaveCount(0);
}

async function expectParentMenu(page: Page) {
	await expect(menu(page).locator('ix-menu-item', { hasText: 'Homework' })).toHaveCount(1);
	await expect(menu(page).locator('ix-menu-item', { hasText: 'Requests' })).toHaveCount(0);
}

test('teacher-parent: switch to Parent, remembered, URL wins, switch back', async ({ page }) => {
	await signIn(page, teacherParent);
	// Default: Teacher active, `/` lands on /teacher.
	await expect(page).toHaveURL(/\/teacher$/);
	await expectTeacherMenu(page);
	await expect(roleOption(page, 'teacher')).toHaveAttribute('checked', /.*/);
	await expect(roleOption(page, 'parent')).not.toHaveAttribute('checked', /.*/);

	// Switch to Parent: lands on /parent with the parent menu.
	await openAvatarMenu(page);
	await roleOption(page, 'parent').click();
	await expect(page).toHaveURL(/\/parent$/);
	await expectParentMenu(page);
	await expect(roleOption(page, 'parent')).toHaveAttribute('checked', /.*/);
	await expect(roleOption(page, 'teacher')).not.toHaveAttribute('checked', /.*/);

	// Shared route: /calendar is the parent (children) view.
	await page.goto('/calendar');
	await expect(page.getByText('No approved children yet.')).toBeVisible();
	await expectParentMenu(page);

	// Remembered over a reload and a new visit to `/`.
	await page.reload();
	await expect(page.getByText('No approved children yet.')).toBeVisible();
	await page.goto('/');
	await expect(page).toHaveURL(/\/parent$/);

	// URL wins: a /teacher page makes Teacher active for that page.
	await page.goto('/teacher');
	await expectTeacherMenu(page);
	await expect(roleOption(page, 'teacher')).toHaveAttribute('checked', /.*/);

	// A forged cookie is ignored.
	await page.context().addCookies([{ name: 'active_role', value: 'admin', url: page.url() }]);
	await page.goto('/');
	await expect(page).toHaveURL(/\/teacher$/);
	await page.goto('/admin');
	await expect(page.locator('body')).toContainText(/403|Admin access only/);

	// Switch back to Teacher.
	await page.goto('/calendar');
	await openAvatarMenu(page);
	await roleOption(page, 'parent').click();
	await expect(page).toHaveURL(/\/parent$/);
	await openAvatarMenu(page);
	await roleOption(page, 'teacher').click();
	await expect(page).toHaveURL(/\/teacher$/);
	await page.goto('/calendar');
	await expectTeacherMenu(page);
	await expect(page.getByText('No approved children yet.')).toHaveCount(0);
});

test('a forged role switch is refused', async ({ page }) => {
	await signIn(page, teacherParent);
	// Same-origin, so SvelteKit's CSRF check passes and /role itself decides.
	const post = (role: string) =>
		page.request.post('/role', {
			form: { role },
			headers: { origin: new URL(page.url()).origin },
			maxRedirects: 0
		});
	const held = await post('parent');
	expect(held.status()).toBe(303);
	expect(held.headers().location).toBe('/parent');
	expect((await post('admin')).status()).toBe(403);
});

test('a teacher with a pending parents row sees no switcher', async ({ page }) => {
	await signIn(page, pendingTeacher);
	await expect(page).toHaveURL(/\/teacher$/);
	await expectTeacherMenu(page);
	await expect(page.locator('ix-avatar ix-dropdown-item[data-role-option]')).toHaveCount(0);
	await expect(page.locator('ix-avatar ix-dropdown-header')).toHaveCount(0);
});

test('a parent-only login sees no switcher', async ({ page }) => {
	await signIn(page, parentOnly);
	await expect(page).toHaveURL(/\/parent$/);
	await expectParentMenu(page);
	await expect(page.locator('ix-avatar ix-dropdown-item[data-role-option]')).toHaveCount(0);
	await expect(page.locator('ix-avatar ix-dropdown-header')).toHaveCount(0);
});

test('header: the Sherab logo is the home link on desktop, the name text on a phone', async ({
	page
}) => {
	await signIn(page, parentOnly);
	await expect(page).toHaveURL(/\/parent$/);
	const header = page.locator('ix-application-header');
	const logoLink = header.locator('a.header-logo');
	const name = header.locator('.name');
	// Computed display of the name in iX's shadow root (a locator's
	// toBeHidden also passes when it matches nothing).
	const nameDisplay = () =>
		header.evaluate((el) => {
			const n = el.shadowRoot?.querySelector('.left-side .name');
			return n ? getComputedStyle(n).display : 'missing';
		});

	// Desktop: the logo shows (with its text alternative), the name is hidden.
	await page.goto('/calendar');
	await expect(logoLink.getByRole('img', { name: 'Sherab – ཤེས་རབ་' })).toBeVisible();
	await expect.poll(nameDisplay).toBe('none');
	await logoLink.click();
	await expect(page).toHaveURL(/\/parent$/);

	// Phone: iX hides the logo slot; the "Sherab" name shows and goes home.
	await page.setViewportSize({ width: 390, height: 800 });
	await page.goto('/calendar');
	await expect(logoLink).toBeHidden();
	await expect.poll(nameDisplay).not.toMatch(/^(none|missing)$/);
	await expect(name).toBeVisible();
	await expect(name).toHaveText('Sherab');
	await name.click();
	await expect(page).toHaveURL(/\/parent$/);
});
