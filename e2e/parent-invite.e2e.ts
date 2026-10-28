import { expect, test, type Page } from '@playwright/test';
import { fixtureTeam, linkParent, service, signIn, type TestUser } from './fixtures';

/**
 * spec-second-parent story 3 (AD-16): parent A invites B's email from the
 * child page's Overview, cancels and invites again, B (an approved parent with no children) accepts on
 * /parent, the child appears on B's landing page and B opens the child's
 * page. A's invite card then shows nothing: the child has two parents.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const childName = `PI Kid ${tag}`;
const nameA = `PI Parent A ${tag}`;

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

async function createUser(role: 'student' | 'parent', key: string): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-pi-${key}-${tag}@${domain}`;
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
	parentA = await createUser('parent', 'a');
	parentB = await createUser('parent', 'b');
	for (const p of [parentA, parentB]) {
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', p.id),
			'approve parent'
		);
	}
	check(
		await service.from('profiles').update({ display_name: nameA }).eq('id', parentA.id),
		'name parent A'
	);
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

test('A invites, cancels and invites again; B accepts on /parent and opens the child page', async ({
	browser
}) => {
	const contextA = await browser.newContext();
	const contextB = await browser.newContext();
	try {
		// A: the invite card on the child's Overview.
		const pageA = await contextA.newPage();
		await signIn(pageA, parentA);
		await open(pageA, `/parent/children/${child.id}?tab=overview`);
		const cardA = pageA.getByTestId('invite-card');
		const emailField = cardA.getByLabel('Their email address');
		const sendInvite = async () => {
			await emailField.fill(`  ${parentB.email.toUpperCase()} `);
			await cardA.getByRole('button', { name: 'Invite' }).click();
			await expect(cardA.getByText('Invite pending')).toBeVisible();
			await expect(cardA.getByTestId('invite-pending')).toContainText(parentB.email);
		};
		await expect(cardA).toBeVisible();
		await sendInvite();

		// Cancel: the form is back and the invite is cancelled.
		await cardA.getByRole('button', { name: 'Cancel invite' }).click();
		await expect(emailField).toBeVisible();
		await expect(cardA.getByText('Invite pending')).toHaveCount(0);
		const { data: cancelled } = await service
			.from('parent_invites')
			.select('status')
			.eq('student_id', child.id);
		expect(cancelled).toEqual([{ status: 'cancelled' }]);

		// Invite again.
		await sendInvite();

		// B: the invite on /parent, above the (empty) children list.
		const pageB = await contextB.newPage();
		await signIn(pageB, parentB);
		await open(pageB, '/parent');
		const invites = pageB.getByTestId('invites-card');
		await expect(invites).toBeVisible();
		await expect(invites).toContainText(`${childName}, invited by ${nameA}`);
		await invites.getByRole('button', { name: 'Accept' }).click();

		// The child is listed; the invite is gone.
		const card = pageB.getByTestId('child-card').filter({ hasText: childName });
		await expect(card).toBeVisible();
		await expect(pageB.getByTestId('invites-card')).toHaveCount(0);

		// B sees the same Overview as A, with no invite card (two parents).
		await card.click();
		await expect(pageB).toHaveURL(new RegExp(`/parent/children/${child.id}`));
		await pageB.locator('main > [data-ui="new"][data-hydrated]').waitFor();
		await expect(pageB.getByRole('heading', { level: 1 })).toContainText(childName);
		await expect(pageB.getByRole('heading', { name: 'Request deletion' })).toBeVisible();
		await expect(pageB.getByTestId('invite-card')).toHaveCount(0);

		// A's invite card now shows nothing.
		await open(pageA, `/parent/children/${child.id}?tab=overview`);
		await expect(pageA.getByTestId('invite-card')).toHaveCount(0);

		const { data: links } = await service
			.from('student_parents')
			.select('parent_id, slot, invited_by')
			.eq('student_id', child.id)
			.is('removed_at', null)
			.order('slot');
		expect(links).toEqual([
			{ parent_id: parentA.id, slot: 1, invited_by: null },
			{ parent_id: parentB.id, slot: 2, invited_by: parentA.id }
		]);
	} finally {
		await contextA.close();
		await contextB.close();
	}
});
