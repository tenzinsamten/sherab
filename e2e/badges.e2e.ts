import { expect, test, type Page } from '@playwright/test';
import { fixtureTeam, linkParent, service, signIn, type TestUser } from './fixtures';

/**
 * Badge detail story 3: the Badges tile on /student shows each earned badge
 * as its icon, two subjects at the same milestone both show (the deferred
 * each-key item from story 2), and each track's next badge shows as its
 * icon greyed, with no progress text. Nothing inside the tile is clickable
 * on its own; the badge page's detail dialog opens and closes (story 4).
 *
 * Story 4: the whole tile links to /student/badges with every badge of the
 * student's subjects (earned and locked); the teacher reaches the same page
 * from the class roster and the linked parent from their child's page.
 *
 * Story 5: the "New badge!" celebration shows both new badges once, is
 * dismissed by keyboard (or by its link to the badge page) and then stays
 * gone on reload and on another device; parent and teacher views never show
 * or consume it.
 *
 * Its own fixture: a teacher, a language and a dance class, an approved
 * parent, and an approved student (their child) enrolled in both with one
 * Done homework in each (badges are trigger-written: language-homework-1,
 * then dance-homework-1).
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
let teacher: TestUser;
let student: TestUser;
let parent: TestUser;
let danceClassId = '';
const userIds: string[] = [];
const classIds: string[] = [];
const team = fixtureTeam(tag);

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'teacher' | 'student' | 'parent'): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-bd3-${role}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${role}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

async function createClass(subject: 'language' | 'dance') {
	const id = check(
		await service
			.from('classes')
			.insert({
				name: `E2E BD3 ${subject} ${tag}`,
				code: `E${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
				badge_subject: subject
			})
			.select('id')
			.single(),
		`create ${subject} class`
	).id;
	classIds.push(id);
	check(
		await service.from('class_teachers').insert({ class_id: id, teacher_id: teacher.id }),
		'assign teacher'
	);
	return id;
}

/** One past homework in `classId`, marked Done by the student. */
async function homeworkDone(classId: string) {
	const assignment = check(
		await service
			.from('homework_assignments')
			.insert({
				class_id: classId,
				title: `E2E BD3 HW ${tag}`,
				skill_area: 'language',
				whole_class: false,
				created_by: teacher.id
			})
			.select('id')
			.single(),
		'create assignment'
	).id;
	const instance = check(
		await service
			.from('homework_instances')
			.insert({
				assignment_id: assignment,
				class_id: classId,
				period_start: '1890-01-06',
				due_date: '1890-01-06'
			})
			.select('id')
			.single(),
		'create instance'
	).id;
	check(
		await service.from('homework_status_history').insert({
			instance_id: instance,
			class_id: classId,
			student_id: student.id,
			status: 'done',
			recorded_by: teacher.id
		}),
		'mark homework done'
	);
}

async function cleanup() {
	const problems: string[] = [];
	// Students first: a class with students cannot be deleted.
	for (const id of userIds.slice().reverse()) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	userIds.length = 0;
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	if (classIds.length) {
		const { error: hwError } = await service
			.from('homework_assignments')
			.delete()
			.in('class_id', classIds);
		if (hwError) problems.push(`delete homework: ${hwError.message}`);
		const { error } = await service.from('classes').delete().in('id', classIds);
		if (error) problems.push(`delete classes: ${error.message}`);
		classIds.length = 0;
	}
	if (problems.length) throw new Error(problems.join('; '));
}

test.beforeAll(async () => {
	try {
		teacher = await createUser('teacher');
		const language = await createClass('language');
		const dance = await createClass('dance');
		danceClassId = dance;
		parent = await createUser('parent');
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);
		student = await createUser('student');
		check(
			await service
				.from('profiles')
				.update({
					class_id: language,
					status: 'approved',
					registration_name: `E2E BD3 Student ${tag}`,
					display_name: `E2E BD3 Student ${tag}`,
					team_id: await team.id()
				})
				.eq('id', student.id),
			'approve student'
		);
		await linkParent(student.id, parent.id);
		for (const cls of [language, dance]) {
			const enrolled = check(
				await service
					.from('class_enrollments')
					.select('class_id')
					.eq('student_id', student.id)
					.eq('class_id', cls),
				'read enrollment'
			);
			if (!enrolled?.length) {
				check(
					await service.from('class_enrollments').insert({ student_id: student.id, class_id: cls }),
					'enroll student'
				);
			}
		}
		await homeworkDone(language);
		await homeworkDone(dance);
	} catch (error) {
		await cleanup().catch(() => undefined);
		throw error;
	}
});

test.afterAll(async () => {
	await cleanup();
});

/** The student page's new-UI root is hydrated (mobile-first story 4). */
async function ready(page: Page) {
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
}

async function openDashboard(page: Page) {
	await page.goto('/student');
	await ready(page);
	await page.waitForLoadState('networkidle');
}

/** The student's badges_earned rows and whether each was seen, by badge key. */
async function seenState(): Promise<Record<string, boolean>> {
	const rows = check(
		await service
			.from('badges_earned')
			.select('badge_subject, badge_type, milestone, seen_at')
			.eq('student_id', student.id),
		'read seen_at'
	);
	return Object.fromEntries(
		rows.map((r) => [`${r.badge_subject}-${r.badge_type}-${r.milestone}`, r.seen_at !== null])
	);
}

const newBadgeDialog = (page: Page) => page.getByRole('dialog', { name: /^New badges?!$/ });

/**
 * Before asserting that no dialog opened: the page is hydrated (its
 * breadcrumb or new-UI root says so), the network is quiet, and a short
 * pause gives a dialog that would open time to do so.
 */
async function settle(page: Page) {
	await page.locator('[data-ui="new"][data-hydrated]').first().waitFor();
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(750);
}

// Story 5 (CAP-9): the parent and teacher come first, while both badges are
// still new: their views never show or consume the celebration.
test("the parent's and teacher's views never show or consume the celebration", async ({ page }) => {
	await signIn(page, parent);
	await page.goto(`/parent/children/${student.id}/badges`);
	await expect(page.locator('li[data-state="earned"]')).toHaveCount(2);
	await settle(page);
	await expect(newBadgeDialog(page)).toHaveCount(0);

	await page.context().clearCookies();
	await signIn(page, teacher);
	await page.goto(`/teacher/classes/${danceClassId}/students/${student.id}/badges`);
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await expect(page.locator('li[data-state="earned"]')).toHaveCount(2);
	await settle(page);
	await expect(newBadgeDialog(page)).toHaveCount(0);

	expect(await seenState()).toEqual({ 'language-homework-1': false, 'dance-homework-1': false });
});

test('new badges are celebrated once: keyboard, Escape marks them seen, on any device', async ({
	page,
	browser
}) => {
	await signIn(page, student);
	await ready(page);
	const dialog = page.getByRole('dialog', { name: 'New badges!' });
	await expect(dialog).toBeVisible();

	// Both new badges in one dialog, in tile order (language before dance).
	const shown = page.locator('[data-testid="new-badge-dialog"] [data-testid="new-badge"]');
	await expect(shown).toHaveCount(2);
	await expect(shown.nth(0)).toContainText('1 Language homework done');
	await expect(shown.nth(0).locator('img')).toHaveAttribute(
		'src',
		'/badges/language-homework-1.svg'
	);
	await expect(shown.nth(1)).toContainText('1 Dance & song homework done');

	// Focus is inside the dialog; showing it marked nothing.
	await expect
		.poll(() =>
			page.evaluate(
				() => document.activeElement?.closest('[data-testid="new-badge-dialog"]') != null
			)
		)
		.toBe(true);
	expect(await seenState()).toEqual({ 'language-homework-1': false, 'dance-homework-1': false });

	// Escape closes it and marks both seen. Focus opened on the body (the
	// sign-in redirect), so it goes to the page heading.
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(page.locator('h1').first()).toBeFocused();
	await expect.poll(seenState).toEqual({ 'language-homework-1': true, 'dance-homework-1': true });

	// A reload shows no dialog.
	await page.reload();
	await ready(page);
	await page.waitForLoadState('networkidle');
	await expect(page.locator('li[data-state="earned"]')).toHaveCount(2);
	await expect(newBadgeDialog(page)).toHaveCount(0);

	// Another device (a fresh browser context): no dialog either.
	const other = await browser.newContext();
	try {
		const otherPage = await other.newPage();
		await signIn(otherPage, student);
		await ready(otherPage);
		await otherPage.waitForLoadState('networkidle');
		await expect(otherPage.locator('li[data-state="earned"]')).toHaveCount(2);
		await expect(newBadgeDialog(otherPage)).toHaveCount(0);
	} finally {
		await other.close();
	}
});

test("the dialog's link opens the badge page and marks the badge seen", async ({ page }) => {
	// Make the dance badge new again (as if just earned).
	check(
		await service
			.from('badges_earned')
			.update({ seen_at: null })
			.eq('student_id', student.id)
			.eq('badge_subject', 'dance'),
		'reset seen_at'
	);
	await signIn(page, student);
	const dialog = newBadgeDialog(page);
	await expect(dialog).toBeVisible();
	await expect(
		page.locator('[data-testid="new-badge-dialog"] [data-testid="new-badge"]')
	).toHaveCount(1);

	await page.getByTestId('new-badge-see-all').click();
	await expect(page).toHaveURL(/\/student\/badges$/);
	await expect(dialog).toBeHidden();
	await page.waitForLoadState('networkidle');
	await expect(page.locator('li[data-badge]')).toHaveCount(24);
	await expect.poll(seenState).toEqual({ 'language-homework-1': true, 'dance-homework-1': true });
});

test('when marking fails the dialog still closes and shows again next visit', async ({ page }) => {
	check(
		await service
			.from('badges_earned')
			.update({ seen_at: null })
			.eq('student_id', student.id)
			.eq('badge_subject', 'language'),
		'reset seen_at'
	);
	await page.route('**/api/badges/seen', (route) => route.fulfill({ status: 500, body: '{}' }));
	await signIn(page, student);
	const dialog = newBadgeDialog(page);
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(dialog).toBeHidden();
	expect(await seenState()).toEqual({ 'language-homework-1': false, 'dance-homework-1': true });

	// Next visit, saving works again: shown once more, then gone.
	await page.unroute('**/api/badges/seen');
	await page.reload();
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect.poll(seenState).toEqual({ 'language-homework-1': true, 'dance-homework-1': true });
});

test('the tile shows earned badges and greyed next badges, with no inner controls', async ({
	page
}) => {
	await signIn(page, student);
	await openDashboard(page);

	// Two subjects at the same milestone both show, most recently earned
	// first (story 4): dance was finished after language.
	const icons = page.locator('li[data-state="earned"]');
	await expect(icons).toHaveCount(2);
	await expect(icons.nth(0)).toHaveAttribute('data-badge', 'dance-homework-1');
	await expect(icons.nth(1)).toHaveAttribute('data-badge', 'language-homework-1');
	await expect(icons.nth(1).locator('img')).toHaveAttribute(
		'src',
		'/badges/language-homework-1.svg'
	);
	await expect(page.getByRole('img', { name: 'Dance & song Homework badge 1' })).toBeVisible();
	await expect(icons.nth(0)).toHaveAttribute('title', 'Dance & song Homework badge 1');

	// Each track's next badge, greyed: 2 subjects x 2 tracks.
	const next = page.locator('li[data-state="next"]');
	await expect(next).toHaveCount(4);
	await expect(page.locator('li[data-badge="dance-homework-5"] img')).toHaveAttribute(
		'src',
		'/badges/dance-homework-5.svg'
	);
	expect(
		await page.getByTestId('badge-next').evaluate((el) => getComputedStyle(el).filter)
	).toContain('grayscale');

	await expect(
		page.getByRole('img', { name: 'Dance & song Homework badge 5 (Locked)' })
	).toBeVisible();

	// Icons only: no "See all" and no progress text.
	const tile = page.getByTestId('badges-tile');
	await expect(tile).not.toContainText('See all');
	await expect(tile.locator('[data-progress]')).toHaveCount(0);

	// The whole card is the one link; nothing inside it is a control.
	await expect(tile).toHaveAttribute('href', '/student/badges');
	await expect(tile.locator('button, a')).toHaveCount(0);

	// Clicking a badge icon follows the card's link.
	await icons.nth(0).click();
	await expect(page).toHaveURL(/\/student\/badges$/);
});

/** The badge page's grid: 2 subjects x 2 tracks x 6 milestones, 2 of them earned. */
async function expectBadgePage(page: Page) {
	const badges = page.locator('li[data-badge]');
	await expect(badges).toHaveCount(24);
	await expect(page.locator('li[data-state="earned"]')).toHaveCount(2);
	await expect(page.locator('li[data-state="locked"]')).toHaveCount(22);
	await expect(page.locator('section[data-subject]')).toHaveCount(2);
	await expect(page.locator('section[data-subject="instrument"]')).toHaveCount(0);
	await expect(page.locator('section[data-subject]').nth(0)).toHaveAttribute(
		'data-subject',
		'language'
	);

	// The next locked dance homework badge: requirement and progress.
	const next = page.locator('li[data-badge="dance-homework-5"]');
	await expect(next).toHaveAttribute('data-state', 'locked');
	await expect(next).toContainText('Locked');
	await expect(next).toContainText('Finish 5 Dance & song homework');
	await expect(next.locator('[data-progress]')).toHaveText('1 / 5');
	// Later ones: the requirement only.
	const later = page.locator('li[data-badge="dance-homework-25"]');
	await expect(later).toContainText('Finish 25 Dance & song homework');
	await expect(later.locator('[data-progress]')).toHaveCount(0);
	await expect(page.locator('li[data-badge="dance-attendance-1"]')).toContainText(
		'Attend 1 Dance & song class'
	);
	// Locked: the real icon, greyed, not a button.
	const lockedIcon = later.locator('img');
	await expect(lockedIcon).toHaveAttribute('src', '/badges/dance-homework-25.svg');
	await expect(later.locator('button')).toHaveCount(0);
	expect(
		await later.locator('[data-visual]').evaluate((el) => getComputedStyle(el).filter)
	).toContain('grayscale');

	// Earned: dated, and a tap opens the detail.
	const earned = page.locator('li[data-badge="dance-homework-1"]');
	await expect(earned).toContainText(/Earned on /);
	await page.locator('[data-testid="page-breadcrumb"][data-hydrated]').waitFor();
	const opener = earned.getByRole('button', { name: 'Dance & song Homework badge 1' });
	await opener.click();
	// Titled with the subject (as the old dialog header was); the reward is in the body.
	const dialog = page.getByRole('dialog', { name: 'Dance & song' });
	await expect(dialog).toContainText('1 Dance & song homework done');
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute('data-testid', 'badge-detail');
	await expect(dialog.getByText('Next: 5')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	// Focus goes back to the badge that opened the detail.
	await expect(opener).toBeFocused();
}

test('the tile links to the badge page, which lists every badge earned and locked', async ({
	page
}) => {
	await signIn(page, student);
	await openDashboard(page);

	await page.getByTestId('badges-tile').click();
	await expect(page).toHaveURL(/\/student\/badges$/);
	await page.waitForLoadState('networkidle');
	await expectBadgePage(page);
});

test("a teacher of the student's class opens the badge page from the roster", async ({ page }) => {
	await signIn(page, teacher);
	await page.goto(`/teacher/classes/${danceClassId}`);
	// The class page is on the new UI (mobile-first story 7): its root marks itself hydrated.
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');

	await page.locator(`button.student-toggle[data-student-id="${student.id}"]`).click();
	await page.getByRole('link', { name: `Badges of E2E BD3 Student ${tag}` }).click();
	await expect(page).toHaveURL(
		new RegExp(`/teacher/classes/${danceClassId}/students/${student.id}/badges$`)
	);
	await page.waitForLoadState('networkidle');
	await expectBadgePage(page);

	// A student who is not in the class: 404.
	const response = await page.goto(
		`/teacher/classes/${danceClassId}/students/${crypto.randomUUID()}/badges`
	);
	expect(response?.status()).toBe(404);
});

test("the linked parent sees their child's badge page; another child is a 404", async ({
	page
}) => {
	await signIn(page, parent);
	await page.goto(`/parent/children/${student.id}`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('badges-tile').click();
	await expect(page).toHaveURL(new RegExp(`/parent/children/${student.id}/badges$`));
	await page.waitForLoadState('networkidle');
	await expectBadgePage(page);

	const response = await page.goto(`/parent/children/${crypto.randomUUID()}/badges`);
	expect(response?.status()).toBe(404);
});

// Last, as it adds a Done homework (the earlier tests count 1 per subject).
test('a badge dismissed in this session stays gone when the layout reloads its data', async ({
	page
}) => {
	// The language badge is new again, and one dance homework is open.
	check(
		await service
			.from('badges_earned')
			.update({ seen_at: null })
			.eq('student_id', student.id)
			.eq('badge_subject', 'language'),
		'reset seen_at'
	);
	const assignment = check(
		await service
			.from('homework_assignments')
			.insert({
				class_id: danceClassId,
				title: `E2E BD5 HW ${tag}`,
				skill_area: 'language',
				whole_class: false,
				created_by: teacher.id
			})
			.select('id')
			.single(),
		'create assignment'
	).id;
	const instance = check(
		await service
			.from('homework_instances')
			.insert({
				assignment_id: assignment,
				class_id: danceClassId,
				period_start: '1890-01-13',
				due_date: '1890-01-13'
			})
			.select('id')
			.single(),
		'create instance'
	).id;
	check(
		await service.from('homework_status_history').insert({
			instance_id: instance,
			class_id: danceClassId,
			student_id: student.id,
			status: 'assigned',
			recorded_by: teacher.id
		}),
		'assign homework'
	);

	// Saving "seen" fails, so the row stays unseen in the database.
	await page.route('**/api/badges/seen', (route) => route.fulfill({ status: 500, body: '{}' }));
	await signIn(page, student);
	const dialog = newBadgeDialog(page);
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();

	// A client-side navigation (no reload) to the homework, then Done: the
	// form action re-runs the root layout load, which still returns the badge.
	await page.evaluate((href) => {
		const link = document.createElement('a');
		link.href = href;
		document.body.append(link);
		link.click();
	}, `/student/homework/${instance}`);
	await expect(page).toHaveURL(new RegExp(`/student/homework/${instance}$`));
	await ready(page);
	await page.getByRole('button', { name: 'Mark done' }).click();
	await page
		.getByRole('alertdialog', { name: 'Are you sure?' })
		.getByRole('button', { name: 'Mark done' })
		.click();
	await expect(page.locator('[data-sonner-toast]').getByText('Marked done.')).toBeVisible();

	// 2 dance homework earns no badge; the dismissed language badge stays gone.
	await settle(page);
	await expect(dialog).toHaveCount(0);
	expect(await seenState()).toEqual({ 'language-homework-1': false, 'dance-homework-1': true });

	check(
		await service
			.from('badges_earned')
			.update({ seen_at: new Date().toISOString() })
			.eq('student_id', student.id),
		'mark seen'
	);
});
