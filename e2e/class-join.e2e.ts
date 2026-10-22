import { expect, test, type Page } from '@playwright/test';
import { fixtureTeam, navLink, service, signIn, type TestUser } from './fixtures';

/**
 * B12a (#67): on their dashboard an approved student sends another class's
 * code and sees the request as Pending; a rejected request (set here with
 * the service role) shows as Rejected and can be dismissed.
 * B12b (#67): the class's teacher sees the request on /requests and in the
 * nav count, approves it (the class appears in the student's My classes)
 * and rejects another (the dashboard shows Rejected); a teacher of the
 * class who is the student's parent sees the row without buttons.
 * #98: the public form /join refuses a second account for the approved
 * student's name and parent email with another class's code, and points to
 * "Join another class".
 * Its own fixture: a home class the student is in, three classes to ask
 * for, a teacher of target + second, and a teacher of target who is the
 * student's parent.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const homeName = `E2E67 ${tag} Home`;
const targetName = `E2E67 ${tag} Target`;
const rejectName = `E2E67 ${tag} Reject`;
const secondName = `E2E67 ${tag} Second`;
const studentName = `E2E67 Student ${tag}`;

let student: TestUser;
let teacher: TestUser;
let teacherParent: TestUser;
const classes: Record<'home' | 'target' | 'reject' | 'second', { id: string; code: string }> = {
	home: { id: '', code: '' },
	target: { id: '', code: '' },
	reject: { id: '', code: '' },
	second: { id: '', code: '' }
};
let studentId = '';
const teacherIds: string[] = [];
const team = fixtureTeam(tag);

async function createTeacher(key: string): Promise<TestUser> {
	const email = `e2e-67-${key}-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role: 'teacher' }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	teacherIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function cleanup() {
	const problems: string[] = [];
	// Unlink the parent first (profiles.parent_id is ON DELETE RESTRICT), so
	// a failed student delete can't block deleting teacherParent too.
	if (studentId) {
		const { error } = await service
			.from('profiles')
			.update({ parent_id: null })
			.eq('id', studentId);
		if (error) problems.push(`unlink parent: ${error.message}`);
	}
	// The student first: a class with students cannot be deleted.
	if (studentId) {
		const { error } = await service.auth.admin.deleteUser(studentId);
		if (error) problems.push(`delete student: ${error.message}`);
		else studentId = '';
	}
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	for (const id of teacherIds.splice(0)) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete teacher: ${error.message}`);
	}
	const ids = Object.values(classes)
		.map((c) => c.id)
		.filter(Boolean);
	if (ids.length) {
		const { error } = await service.from('classes').delete().in('id', ids);
		if (error) problems.push(`delete classes: ${error.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
}

test.beforeAll(async () => {
	try {
		for (const [key, name] of [
			['home', homeName],
			['target', targetName],
			['reject', rejectName],
			['second', secondName]
		] as const) {
			const code = `G${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
			const row = check(
				await service.from('classes').insert({ name, code }).select('id').single(),
				`create class ${name}`
			);
			classes[key] = { id: row.id, code };
		}

		const email = `e2e-67-student-${tag}@students.internal.invalid`;
		const password = crypto.randomUUID();
		const { data, error } = await service.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
			app_metadata: { role: 'student' }
		});
		if (error || !data.user) throw new Error(`create student: ${error?.message}`);
		studentId = data.user.id;
		student = { id: studentId, email, password };

		check(
			await service
				.from('profiles')
				.update({
					class_id: classes.home.id,
					status: 'approved',
					registration_name: studentName,
					display_name: studentName,
					team_id: await team.id()
				})
				.eq('id', studentId),
			'approve student'
		);
		const enrolled = check(
			await service
				.from('class_enrollments')
				.select('class_id')
				.eq('student_id', studentId)
				.eq('class_id', classes.home.id),
			'read enrollment'
		);
		if (!enrolled?.length) {
			check(
				await service
					.from('class_enrollments')
					.insert({ student_id: studentId, class_id: classes.home.id }),
				'enroll student'
			);
		}

		teacher = await createTeacher('teacher');
		teacherParent = await createTeacher('teacher-parent');
		for (const [who, key] of [
			[teacher, 'target'],
			[teacher, 'second'],
			[teacherParent, 'target']
		] as const) {
			check(
				await service
					.from('class_teachers')
					.insert({ class_id: classes[key].id, teacher_id: who.id }),
				`assign teacher to ${key}`
			);
		}
		// AD-4: teacherParent is also the student's (approved) parent.
		check(
			await service.from('parents').insert({ id: teacherParent.id, status: 'approved' }),
			'make teacher a parent'
		);
		check(
			await service.from('profiles').update({ parent_id: teacherParent.id }).eq('id', studentId),
			'link parent'
		);
	} catch (error) {
		await cleanup().catch(() => undefined);
		throw error;
	}
});

test.afterAll(async () => {
	await cleanup();
});

/** The dashboard, once its new-UI root is hydrated (mobile-first story 4). */
async function openDashboard(page: Page) {
	await page.goto('/student');
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

function joinCard(page: Page) {
	return page.getByTestId('join-card');
}

const codeField = (page: Page) => joinCard(page).getByLabel('Class code');

async function sendCode(page: Page, code: string) {
	await codeField(page).fill(code);
	await expect(codeField(page)).toHaveValue(code.toUpperCase());
	await joinCard(page).getByRole('button', { name: 'Send request' }).click();
}

test('a student sends a class code and sees the request as Pending', async ({ page }) => {
	await signIn(page, student);
	await openDashboard(page);

	// An unknown code: refused under the field, nothing listed.
	await sendCode(page, 'zzzzzzzz');
	const error = page.locator('#joinCode-error');
	await expect(error).toHaveText("That code doesn't open a class you can join. Check the code.");
	await expect(codeField(page)).toHaveAttribute('aria-invalid', 'true');
	await expect(codeField(page)).toHaveAttribute('aria-describedby', 'joinCode-error');
	await expect(codeField(page)).toBeFocused();

	await sendCode(page, classes.target.code.toLowerCase());
	await expect(
		page.getByText(`Request sent for ${targetName}. You'll see here once it's decided.`)
	).toBeVisible();
	const row = joinCard(page).locator('li', { hasText: targetName });
	await expect(row.getByTestId('join-status')).toHaveText('Pending');
	await expect(row.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
	await expect(codeField(page)).toHaveValue('');
	await expect(codeField(page)).not.toHaveAttribute('aria-invalid');
	await expect(error).toHaveCount(0);

	// The same class again: already requested.
	await sendCode(page, classes.target.code);
	await expect(error).toHaveText("You've already requested this class. Wait for a decision.");

	const rows = check(
		await service
			.from('class_join_requests')
			.select('class_id, status')
			.eq('student_id', student.id),
		'read requests'
	);
	expect(rows).toEqual([{ class_id: classes.target.id, status: 'pending' }]);
});

test('a rejected request shows as Rejected and can be dismissed', async ({ page }) => {
	check(
		await service.from('class_join_requests').insert({
			student_id: student.id,
			class_id: classes.reject.id,
			status: 'rejected',
			reviewed_at: new Date().toISOString()
		}),
		'insert rejected request'
	);

	await signIn(page, student);
	await openDashboard(page);

	const card = joinCard(page);
	const rejected = card.locator('li', { hasText: rejectName });
	await expect(rejected.getByTestId('join-status')).toHaveText('Rejected');
	await expect(card.locator('li', { hasText: targetName }).getByTestId('join-status')).toHaveText(
		'Pending'
	);

	await rejected.getByRole('button', { name: 'Dismiss' }).click();
	await expect(page.getByText('Request dismissed.')).toBeVisible();
	await expect(card.locator('li', { hasText: rejectName })).toHaveCount(0);
	await expect(card.locator('li', { hasText: targetName })).toHaveCount(1);

	const row = check(
		await service
			.from('class_join_requests')
			.select('dismissed_at')
			.eq('student_id', student.id)
			.eq('class_id', classes.reject.id)
			.single(),
		'read dismissed request'
	);
	expect(row.dismissed_at).not.toBeNull();
});

async function openRequests(page: Page) {
	await page.goto('/requests');
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

function joinSection(page: Page) {
	return page.getByRole('region', { name: 'Class join requests' });
}

function requestsNavItem(page: Page) {
	return navLink(page, /^Requests/);
}

/** The /requests header count pill (its accessible text, e.g. "1 pending"). */
function headerPill(page: Page) {
	return page.getByTestId('requests-count');
}

/** The layout's load-error toast: shown when the nav count query failed. */
function loadErrorToast(page: Page) {
	return page
		.locator('[data-sonner-toast]')
		.getByText(/Something went wrong loading this page's data/);
}

async function decide(page: Page, className: string, button: 'Approve' | 'Reject') {
	await joinSection(page)
		.getByTestId('request-row')
		.filter({ hasText: className })
		.getByRole('button', { name: button })
		.click();
	await page
		.getByRole('alertdialog', { name: 'Are you sure?' })
		.getByRole('button', { name: button })
		.click();
}

// The teacher tests below depend on the first test's pending request for
// the target class (the file runs serially).
test("a teacher who is the student's parent sees the request without buttons, uncounted", async ({
	page
}) => {
	await signIn(page, teacherParent);
	await openRequests(page);

	const row = joinSection(page).getByTestId('request-row').filter({ hasText: studentName });
	await expect(row).toContainText(`Asks to join ${targetName}`);
	await expect(row).toContainText('Your child. Another teacher or the admin decides.');
	await expect(row.getByRole('button')).toHaveCount(0);
	// Known state: the count loaded without error (no load-error toast), and
	// the only pending item is their own child's, so nothing is counted.
	await expect(loadErrorToast(page)).toHaveCount(0);
	await expect(requestsNavItem(page)).not.toHaveAttribute('data-count');
	await expect(headerPill(page)).toHaveCount(0);
});

test('the class teacher approves a request; the class appears in My classes', async ({
	page,
	browser
}) => {
	await signIn(page, teacher);
	await openRequests(page);

	const row = joinSection(page).getByTestId('request-row').filter({ hasText: studentName });
	await expect(row).toContainText(`Asks to join ${targetName}`);
	await expect(row).toContainText(`Current classes: ${homeName}`);
	await expect(loadErrorToast(page)).toHaveCount(0);
	await expect(requestsNavItem(page)).toHaveAttribute('data-count', '1');
	await expect(headerPill(page).locator('.sr-only')).toHaveText('1 pending');

	await decide(page, targetName, 'Approve');
	await expect(
		page.locator('[data-sonner-toast]').getByText(`${studentName} now belongs to ${targetName}.`)
	).toBeVisible();
	// The last request is gone, so the section is hidden like other empty ones.
	await expect(joinSection(page)).toHaveCount(0);
	await expect(requestsNavItem(page)).not.toHaveAttribute('data-count');
	await expect(headerPill(page)).toHaveCount(0);

	const context = await browser.newContext();
	const studentPage = await context.newPage();
	try {
		await signIn(studentPage, student);
		await studentPage.goto('/student/classes');
		await expect(studentPage.getByText(targetName).first()).toBeVisible();
	} finally {
		await context.close();
	}
});

test("the class teacher rejects a request; the student's dashboard shows Rejected", async ({
	page,
	browser
}) => {
	await signIn(page, student);
	await openDashboard(page);
	await sendCode(page, classes.second.code);
	const card = joinCard(page);
	await expect(card.locator('li', { hasText: secondName }).getByTestId('join-status')).toHaveText(
		'Pending'
	);

	const context = await browser.newContext();
	const teacherPage = await context.newPage();
	try {
		await signIn(teacherPage, teacher);
		await openRequests(teacherPage);
		await expect(requestsNavItem(teacherPage)).toHaveAttribute('data-count', '1');
		await decide(teacherPage, secondName, 'Reject');
		await expect(
			teacherPage
				.locator('[data-sonner-toast]')
				.getByText(`${studentName}'s request to join ${secondName} was rejected.`)
		).toBeVisible();
		await expect(joinSection(teacherPage)).toHaveCount(0);
	} finally {
		await context.close();
	}

	await openDashboard(page);
	await expect(card.locator('li', { hasText: secondName }).getByTestId('join-status')).toHaveText(
		'Rejected'
	);
	const rows = check(
		await service
			.from('class_join_requests')
			.select('class_id, status')
			.eq('student_id', student.id)
			.in('class_id', [classes.target.id, classes.second.id])
			.order('requested_at'),
		'read decided requests'
	);
	expect(rows).toEqual([
		{ class_id: classes.target.id, status: 'approved' },
		{ class_id: classes.second.id, status: 'rejected' }
	]);
});

// #98: one student account per parent and name. The student is approved and
// linked to teacherParent (an approved parent); /join with the same name and
// that parent's email is refused whatever the class, and nothing is created.
test('/join with an approved student\'s name, parent email and another class\'s code points to "Join another class"', async ({
	page
}) => {
	const studentsOfParent = async () =>
		check(
			await service
				.from('profiles')
				.select('id')
				.eq('role', 'student')
				.eq('parent_id', teacherParent.id),
			"read the parent's students"
		);
	expect(await studentsOfParent()).toEqual([{ id: studentId }]);

	await page.goto('/join');
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');

	// A class the student is not in: the request for it was rejected in the
	// test above (the file runs serially).
	await page.getByLabel('What is your class code?').fill(classes.second.code);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.getByText(`${secondName} · ${classes.second.code}`)).toBeVisible();

	// Another case and extra spaces: still the same child.
	await page.getByLabel('Full name').fill(`  ${studentName.toUpperCase()} `);
	await page.getByRole('button', { name: 'Continue' }).click();

	await page.getByLabel("Guardian's email").fill(teacherParent.email.toUpperCase());
	await page.getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Submit' }).click();

	await expect(
		page
			.locator('[data-sonner-toast]')
			.getByText(
				'This parent already has a student account with this name. Sign in with that account and use “Join another class” to add this class.'
			)
	).toBeVisible();
	await expect(page).toHaveURL(/\/join$/);
	expect(await studentsOfParent()).toEqual([{ id: studentId }]);
});
