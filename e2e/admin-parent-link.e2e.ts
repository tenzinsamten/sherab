import { expect, test, type Page } from '@playwright/test';
import { fixtureTeam, linkParent, service, signIn, type TestUser } from './fixtures';

/**
 * spec-second-parent story 4 (CAP-4, AD-10): on /admin/parents the admin sees
 * A ("registered the child") and B ("invited by A") under the child, each
 * with the other as co-parent; removes B's link after confirming; then the
 * child is listed only under A with no co-parent and no Remove, B's /parent
 * no longer lists the child and B's child page is a 404.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const childName = `APL Kid ${tag}`;
const nameA = `APL Parent A ${tag}`;
const nameB = `APL Parent B ${tag}`;

let admin: TestUser;
let parentA: TestUser;
let parentB: TestUser;
let child: TestUser;
/** Deletion order: the student first (a parent with links cannot be deleted). */
const userIds: string[] = [];
const team = fixtureTeam(tag);

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'student' | 'parent' | 'admin', key: string): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-apl-${key}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	if (role === 'student') userIds.unshift(data.user.id);
	else userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

test.beforeAll(async () => {
	admin = await createUser('admin', 'admin');
	parentA = await createUser('parent', 'a');
	parentB = await createUser('parent', 'b');
	for (const [p, displayName] of [
		[parentA, nameA],
		[parentB, nameB]
	] as const) {
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', p.id),
			'approve parent'
		);
		check(
			await service.from('profiles').update({ display_name: displayName }).eq('id', p.id),
			'name parent'
		);
	}
	child = await createUser('student', 'kid');
	check(
		await service
			.from('profiles')
			.update({
				status: 'approved',
				registration_name: childName,
				display_name: childName,
				team_id: await team.id()
			})
			.eq('id', child.id),
		'set up child'
	);
	await linkParent(child.id, parentA.id);
	// B in slot 2, invited by A (what accept_parent_invite writes).
	check(
		await service
			.from('student_parents')
			.insert({ student_id: child.id, parent_id: parentB.id, slot: 2, invited_by: parentA.id }),
		'link parent B'
	);
});

test.afterAll(async () => {
	const problems: string[] = [];
	for (const id of userIds.slice()) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	if (problems.length) throw new Error(problems.join('; '));
});

async function open(page: Page, path: string) {
	await page.goto(path);
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

/** The parent's row by its Name cell (the other rows name this parent too, as inviter or co-parent). */
const parentRow = (page: Page, name: string) =>
	page.getByTestId('parent-row').filter({ has: page.getByRole('cell', { name, exact: true }) });
const childOf = (page: Page, parentName: string) =>
	parentRow(page, parentName).getByTestId('parent-child').filter({ hasText: childName });

test('the admin sees both parents with the inviter, removes B after confirming, and B loses the child', async ({
	browser
}) => {
	const contextAdmin = await browser.newContext();
	const contextB = await browser.newContext();
	try {
		// B is signed in and on the child's page before the removal.
		const pageB = await contextB.newPage();
		await signIn(pageB, parentB);
		await open(pageB, `/parent/children/${child.id}`);
		await expect(pageB.getByRole('heading', { level: 1 })).toContainText(childName);

		const page = await contextAdmin.newPage();
		await signIn(page, admin);
		await open(page, '/admin/parents');

		const underA = childOf(page, nameA);
		const underB = childOf(page, nameB);
		await expect(underA).toContainText('Registered the child');
		await expect(underA).toContainText('Linked on');
		await expect(underA).toContainText(`Other parent: ${nameB}`);
		await expect(underB).toContainText(`Invited by ${nameA}`);
		await expect(underB).toContainText(`Other parent: ${nameA}`);
		await expect(underA.getByRole('button', { name: 'Remove link' })).toBeVisible();

		// Cancel first: nothing changes.
		await underB.getByRole('button', { name: 'Remove link' }).click();
		const dialog = page.getByTestId('confirm-dialog');
		await expect(dialog).toContainText(`Remove ${nameB} as a parent of ${childName}?`);
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toHaveCount(0);
		await expect(underB).toBeVisible();

		// Confirm: B's link goes.
		await underB.getByRole('button', { name: 'Remove link' }).click();
		await dialog.getByRole('button', { name: 'Remove link' }).click();
		await expect(page.getByText('The parent link was removed.')).toBeVisible();
		await expect(underB).toHaveCount(0);
		await expect(underA).toBeVisible();
		await expect(underA.getByTestId('parent-child-co-parent')).toHaveCount(0);
		await expect(underA.getByRole('button', { name: 'Remove link' })).toHaveCount(0);

		const { data: links } = await service
			.from('student_parents')
			.select('parent_id, removed_by')
			.eq('student_id', child.id)
			.order('slot');
		expect(links).toEqual([
			{ parent_id: parentA.id, removed_by: null },
			{ parent_id: parentB.id, removed_by: admin.id }
		]);

		// B, in the same session: the reloaded child page is refused, and
		// /parent no longer lists the child.
		const response = await pageB.reload();
		expect([403, 404]).toContain(response?.status());
		await expect(pageB.getByRole('heading', { level: 1 })).not.toContainText(childName);
		await open(pageB, '/parent');
		await expect(pageB.getByTestId('child-card').filter({ hasText: childName })).toHaveCount(0);
	} finally {
		await contextAdmin.close();
		await contextB.close();
	}
});
