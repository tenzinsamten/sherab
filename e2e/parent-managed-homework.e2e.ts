import { expect, test, type Page } from '@playwright/test';
import { berlinToday, fixtureTeam, linkParent, service, signIn, type TestUser } from './fixtures';

/**
 * spec-parent-managed-homework story 2 (CAP-1 UI, CAP-2 child page): with
 * the flag off the child's Homework tab has no Mark done button. Parent A
 * turns "I manage homework for this child" on in the Overview; parent B
 * sees it on and the buttons too. A marks an open item done (after the
 * confirm dialog): it moves to Done, recorded by A for the child. A turns
 * it off again and the card shows it off.
 *
 * Story 3 (CAP-3): from the Homework tab a parent opens an item's detail
 * page and reads its body; B sees the same page; with the flag on A marks
 * it done there and the status shows Done.
 *
 * Story 4 (CAP-2 on /parent/homework): with the flag on, A marks an open
 * item done from the shared homework list and it leaves the list.
 *
 * Story 5 (CAP-4): after A marks an item done, A sees "Marked done by you"
 * and B sees A's name, on the Done list and on the detail page.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const childName = `MH Kid ${tag}`;
const className = `MH class ${tag}`;
const openTitle = `MH open ${tag}`;
const detailTitle = `MH detail ${tag}`;
const detailBody = `Practise the alphabet song ${tag}`;
const listTitle = `MH list ${tag}`;
const parentAName = `MH Parent A ${tag}`;

let teacher: TestUser;
let parentA: TestUser;
let parentB: TestUser;
let child: TestUser;
let classId: string;
let instanceId: string;
/** Story 3: a second open item, with a body, marked done on its detail page. */
let detailInstanceId: string;
/** Story 4: a third open item, marked done from /parent/homework. */
let listInstanceId: string;
/** Deletion order: the student first (a parent with links cannot be deleted). */
const userIds: string[] = [];
const team = fixtureTeam(tag);

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

function plusDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

async function createUser(role: 'teacher' | 'student' | 'parent', key: string): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-mh-${key}-${tag}@${domain}`;
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

async function cleanup() {
	const problems: string[] = [];
	for (const id of userIds.slice()) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
		else userIds.splice(userIds.indexOf(id), 1);
	}
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	if (classId) {
		const { error: hwError } = await service
			.from('homework_assignments')
			.delete()
			.eq('class_id', classId);
		if (hwError) problems.push(`delete homework: ${hwError.message}`);
		const { error } = await service.from('classes').delete().eq('id', classId);
		if (error) problems.push(`delete class: ${error.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
}

test.beforeAll(async () => {
	try {
		teacher = await createUser('teacher', 'teacher');
		parentA = await createUser('parent', 'a');
		parentB = await createUser('parent', 'b');
		for (const p of [parentA, parentB]) {
			check(
				await service.from('parents').update({ status: 'approved' }).eq('id', p.id),
				'approve parent'
			);
		}
		check(
			await service.from('profiles').update({ display_name: parentAName }).eq('id', parentA.id),
			'name parent A'
		);
		classId = check(
			await service
				.from('classes')
				.insert({
					name: className,
					code: `M${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
					badge_subject: 'language',
					default_start_time: '10:00',
					default_duration_minutes: 60,
					schedule_starts_on: '2000-01-02',
					schedule_ends_on: '2000-01-02'
				})
				.select('id')
				.single(),
			'create class'
		).id;
		check(
			await service.from('class_teachers').insert({ class_id: classId, teacher_id: teacher.id }),
			'assign teacher'
		);

		child = await createUser('student', 'kid');
		check(
			await service
				.from('profiles')
				.update({
					class_id: classId,
					status: 'approved',
					registration_name: childName,
					display_name: childName,
					team_id: await team.id()
				})
				.eq('id', child.id),
			'set up child'
		);
		await linkParent(child.id, parentA.id);
		await linkParent(child.id, parentB.id);
		const enrolled = check(
			await service
				.from('class_enrollments')
				.select('class_id')
				.eq('student_id', child.id)
				.eq('class_id', classId),
			'read enrollment'
		);
		if (!enrolled?.length) {
			check(
				await service.from('class_enrollments').insert({ student_id: child.id, class_id: classId }),
				'enroll child'
			);
		}

		const due = plusDays(berlinToday(), 5);
		const assignment = check(
			await service
				.from('homework_assignments')
				.insert({
					class_id: classId,
					title: openTitle,
					skill_area: 'language',
					whole_class: false,
					created_by: teacher.id
				})
				.select('id')
				.single(),
			'create homework'
		).id;
		instanceId = check(
			await service
				.from('homework_instances')
				.insert({ assignment_id: assignment, class_id: classId, period_start: due, due_date: due })
				.select('id')
				.single(),
			'create instance'
		).id;
		check(
			await service.from('homework_status_history').insert({
				instance_id: instanceId,
				class_id: classId,
				student_id: child.id,
				status: 'assigned',
				recorded_by: teacher.id
			}),
			'assign homework'
		);

		const detailAssignment = check(
			await service
				.from('homework_assignments')
				.insert({
					class_id: classId,
					title: detailTitle,
					skill_area: 'song',
					whole_class: false,
					created_by: teacher.id,
					content_language: 'en',
					content: {
						type: 'doc',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: detailBody }] }]
					}
				})
				.select('id')
				.single(),
			'create detail homework'
		).id;
		detailInstanceId = check(
			await service
				.from('homework_instances')
				.insert({
					assignment_id: detailAssignment,
					class_id: classId,
					period_start: due,
					due_date: due
				})
				.select('id')
				.single(),
			'create detail instance'
		).id;
		check(
			await service.from('homework_status_history').insert({
				instance_id: detailInstanceId,
				class_id: classId,
				student_id: child.id,
				status: 'assigned',
				recorded_by: teacher.id
			}),
			'assign detail homework'
		);

		const listAssignment = check(
			await service
				.from('homework_assignments')
				.insert({
					class_id: classId,
					title: listTitle,
					skill_area: 'dance',
					whole_class: false,
					created_by: teacher.id
				})
				.select('id')
				.single(),
			'create list homework'
		).id;
		listInstanceId = check(
			await service
				.from('homework_instances')
				.insert({
					assignment_id: listAssignment,
					class_id: classId,
					period_start: due,
					due_date: due
				})
				.select('id')
				.single(),
			'create list instance'
		).id;
		check(
			await service.from('homework_status_history').insert({
				instance_id: listInstanceId,
				class_id: classId,
				student_id: child.id,
				status: 'assigned',
				recorded_by: teacher.id
			}),
			'assign list homework'
		);
	} catch (error) {
		await cleanup().catch(() => undefined);
		throw error;
	}
});

test.afterAll(async () => {
	await cleanup();
});

async function open(page: Page, tab: 'overview' | 'homework') {
	await page.goto(`/parent/children/${child.id}?tab=${tab}`);
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

const openSection = (page: Page) => page.locator('section', { has: page.locator('#open-heading') });
const doneSection = (page: Page) => page.locator('section', { has: page.locator('#done-heading') });
const openRow = (page: Page, title: string) => openSection(page).locator('li', { hasText: title });

test('flag off: the Homework tab has no Mark done button', async ({ page }) => {
	await signIn(page, parentA);
	await open(page, 'overview');
	const card = page.getByTestId('managed-card');
	await expect(card.getByTestId('managed-status')).toHaveAttribute('data-on', 'false');
	await expect(
		card.getByRole('button', { name: 'I manage homework for this child' })
	).toBeVisible();

	await open(page, 'homework');
	await expect(openSection(page)).toContainText(openTitle);
	await expect(page.getByRole('button', { name: 'Mark done' })).toHaveCount(0);
});

test('A turns it on, B sees it on, A marks the item done, then turns it off', async ({
	browser
}) => {
	const contextA = await browser.newContext();
	const contextB = await browser.newContext();
	try {
		const pageA = await contextA.newPage();
		await signIn(pageA, parentA);
		await open(pageA, 'overview');
		const cardA = pageA.getByTestId('managed-card');
		await cardA.getByRole('button', { name: 'I manage homework for this child' }).click();
		await expect(pageA.getByText('You now manage homework for this child.')).toBeVisible();
		await expect(cardA.getByTestId('managed-status')).toHaveAttribute('data-on', 'true');
		await expect(pageA).toHaveURL(/tab=overview/);
		await expect(cardA.getByRole('button', { name: 'Stop managing homework' })).toBeVisible();

		// B (the second linked parent) sees the card on and the button.
		const pageB = await contextB.newPage();
		await signIn(pageB, parentB);
		await open(pageB, 'overview');
		await expect(pageB.getByTestId('managed-status')).toHaveAttribute('data-on', 'true');
		await open(pageB, 'homework');
		await expect(openRow(pageB, openTitle).getByRole('button', { name: 'Mark done' })).toHaveCount(
			1
		);

		// A marks the open item done, after the confirm dialog.
		await open(pageA, 'homework');
		await openRow(pageA, openTitle).getByRole('button', { name: 'Mark done' }).click();
		const dialog = pageA.getByTestId('mark-done-confirm');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Mark done' }).click();
		await expect(pageA.getByText('Marked done.')).toBeVisible();
		await expect(pageA).toHaveURL(/tab=homework/);
		await expect(openSection(pageA)).not.toContainText(openTitle);
		await expect(doneSection(pageA)).toContainText(openTitle);
		// Done items never get the button.
		await expect(doneSection(pageA).getByRole('button', { name: 'Mark done' })).toHaveCount(0);
		// Story 5: A sees "by you", B sees A's name.
		const doneRow = (page: Page) => doneSection(page).locator('li', { hasText: openTitle });
		await expect(doneRow(pageA).getByTestId('homework-done-by')).toHaveText('Marked done by you');
		await open(pageB, 'homework');
		await expect(doneRow(pageB).getByTestId('homework-done-by')).toHaveText(
			`Marked done by ${parentAName}`
		);

		const { data: rows } = await service
			.from('homework_status_history')
			.select('student_id, status, recorded_by')
			.eq('instance_id', instanceId)
			.eq('status', 'done');
		expect(rows).toEqual([{ student_id: child.id, status: 'done', recorded_by: parentA.id }]);

		// A turns it off again.
		await open(pageA, 'overview');
		await cardA.getByRole('button', { name: 'Stop managing homework' }).click();
		await expect(pageA.getByText('You no longer manage homework for this child.')).toBeVisible();
		await expect(cardA.getByTestId('managed-status')).toHaveAttribute('data-on', 'false');
	} finally {
		await contextA.close();
		await contextB.close();
	}
});

async function openDetail(page: Page) {
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
}

async function setManaged(on: boolean) {
	check(
		await service.from('profiles').update({ parent_managed: on }).eq('id', child.id),
		'set parent_managed'
	);
}

test('story 3: the detail page shows the full item to A and B; A marks it done there', async ({
	browser
}) => {
	await setManaged(false);
	const contextA = await browser.newContext();
	const contextB = await browser.newContext();
	try {
		const pageA = await contextA.newPage();
		await signIn(pageA, parentA);

		// The flag is off: no Mark done.
		await open(pageA, 'homework');
		await openRow(pageA, detailTitle).getByRole('link', { name: detailTitle }).click();
		await expect(pageA).toHaveURL(
			new RegExp(`/parent/children/${child.id}/homework/${detailInstanceId}$`)
		);
		await openDetail(pageA);
		await expect(pageA.getByRole('heading', { level: 1 })).toContainText(detailTitle);
		await expect(pageA.getByText(detailBody)).toBeVisible();
		await expect(pageA.getByTestId('homework-class')).toHaveText(className);
		await expect(pageA.getByTestId('homework-class').getByRole('link')).toHaveCount(0);
		await expect(pageA.getByTestId('homework-status')).toContainText('Not done yet');
		await expect(pageA.getByRole('button', { name: 'Mark done' })).toHaveCount(0);

		// B (also linked) sees the same details at the same URL.
		const pageB = await contextB.newPage();
		await signIn(pageB, parentB);
		await pageB.goto(`/parent/children/${child.id}/homework/${detailInstanceId}`);
		await openDetail(pageB);
		await expect(pageB.getByRole('heading', { level: 1 })).toContainText(detailTitle);
		await expect(pageB.getByText(detailBody)).toBeVisible();

		// A turns the flag on; the detail page now has Mark done.
		await open(pageA, 'overview');
		await pageA
			.getByTestId('managed-card')
			.getByRole('button', { name: 'I manage homework for this child' })
			.click();
		await expect(pageA.getByTestId('managed-status')).toHaveAttribute('data-on', 'true');
		await open(pageA, 'homework');
		await openRow(pageA, detailTitle).getByRole('link', { name: detailTitle }).click();
		// The tab also lists the story 4 item's button: wait for the detail page.
		await expect(pageA).toHaveURL(
			new RegExp(`/parent/children/${child.id}/homework/${detailInstanceId}$`)
		);
		await openDetail(pageA);
		await pageA.getByRole('button', { name: 'Mark done' }).click();
		const dialog = pageA.getByTestId('mark-done-confirm');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Mark done' }).click();
		await expect(pageA.getByText('Marked done.')).toBeVisible();
		await expect(pageA.getByTestId('homework-status')).toContainText('Done');
		await expect(pageA.getByRole('button', { name: 'Mark done' })).toHaveCount(0);
		// Story 5: the status line says who marked it, for A and for B.
		await expect(pageA.getByTestId('homework-done-by')).toHaveText('Marked done by you');
		await pageB.goto(`/parent/children/${child.id}/homework/${detailInstanceId}`);
		await openDetail(pageB);
		await expect(pageB.getByTestId('homework-done-by')).toHaveText(`Marked done by ${parentAName}`);

		const { data: rows } = await service
			.from('homework_status_history')
			.select('student_id, status, recorded_by')
			.eq('instance_id', detailInstanceId)
			.eq('status', 'done');
		expect(rows).toEqual([{ student_id: child.id, status: 'done', recorded_by: parentA.id }]);

		// The breadcrumb leads back to the child's Homework tab.
		await pageA.getByTestId('page-breadcrumb').getByRole('link', { name: childName }).click();
		await expect(pageA).toHaveURL(/tab=homework/);
		await expect(doneSection(pageA)).toContainText(detailTitle);
	} finally {
		await contextA.close();
		await contextB.close();
		await setManaged(false);
	}
});

test('story 4: A marks an open item done from /parent/homework and it leaves the list', async ({
	page
}) => {
	await setManaged(false);
	try {
		await signIn(page, parentA);
		const list = page.getByTestId('homework-list');
		const row = list.locator('li', { hasText: listTitle });
		const openList = async () => {
			await page.goto('/parent/homework');
			await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
		};

		// Flag off: the row is listed without Mark done; its title opens the detail page.
		await openList();
		await expect(row).toHaveCount(1);
		await expect(row.getByRole('button', { name: 'Mark done' })).toHaveCount(0);
		await expect(row.getByRole('link', { name: new RegExp(listTitle) })).toHaveAttribute(
			'href',
			`/parent/children/${child.id}/homework/${listInstanceId}`
		);

		const dialog = page.getByTestId('mark-done-confirm');

		// Refused (the flag turned off after the list loaded): the message shows,
		// the data reloads, and the row stays without Mark done.
		await setManaged(true);
		await openList();
		await expect(row.getByRole('button', { name: 'Mark done' })).toHaveCount(1);
		await setManaged(false);
		await row.getByRole('button', { name: 'Mark done' }).click();
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Mark done' }).click();
		await expect(
			page.getByText(
				"You can't mark this homework done. Managing homework for this child may be off."
			)
		).toBeVisible();
		await expect(row).toHaveCount(1);
		await expect(row.getByRole('button', { name: 'Mark done' })).toHaveCount(0);

		// Flag on: the row gets Mark done; after the confirm dialog it is saved and gone.
		await setManaged(true);
		await openList();
		await row.getByRole('button', { name: 'Mark done' }).click();
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Mark done' }).click();
		await expect(page.getByText('Marked done.')).toBeVisible();
		await expect(list.locator('li', { hasText: listTitle })).toHaveCount(0);
		await expect(page).toHaveURL(/\/parent\/homework/);

		const { data: rows } = await service
			.from('homework_status_history')
			.select('student_id, status, recorded_by')
			.eq('instance_id', listInstanceId)
			.eq('status', 'done');
		expect(rows).toEqual([{ student_id: child.id, status: 'done', recorded_by: parentA.id }]);
	} finally {
		await setManaged(false);
	}
});
