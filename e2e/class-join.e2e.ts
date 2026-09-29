import { expect, test, type Page } from '@playwright/test';
import { service, signIn, type TestUser } from './fixtures';

/**
 * B12a (#67): on their dashboard an approved student sends another class's
 * code and sees the request as Pending; a rejected request (set here with
 * the service role) shows as Rejected and can be dismissed.
 * B12b (#67): the class's teacher sees the request on /requests and in the
 * nav count, approves it (the class appears in the student's My classes)
 * and rejects another (the dashboard shows Rejected); a teacher of the
 * class who is the student's parent sees the row without buttons.
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
					display_name: studentName
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

async function openDashboard(page: Page) {
	await page.goto('/student');
	await page.waitForFunction(
		() =>
			customElements.get('ix-input') !== undefined && customElements.get('ix-pill') !== undefined
	);
	await page.waitForLoadState('networkidle');
}

function joinCard(page: Page) {
	return page.locator('section.card', {
		has: page.getByRole('heading', { name: 'Join another class' })
	});
}

async function sendCode(page: Page, code: string) {
	await page.locator('#joinCode input').first().fill(code);
	await expect(page.locator('#joinCode')).toHaveJSProperty('value', code.toUpperCase());
	await joinCard(page).getByRole('button', { name: 'Send request' }).click();
}

test('a student sends a class code and sees the request as Pending', async ({ page }) => {
	await signIn(page, student);
	await openDashboard(page);

	// An unknown code: refused under the field, nothing listed.
	await sendCode(page, 'zzzzzzzz');
	const error = page.locator('#joinCode-error');
	await expect(error).toHaveText("That code doesn't open a class you can join. Check the code.");
	await expect(page.locator('#joinCode')).toHaveClass(/\bix-invalid\b/);

	await sendCode(page, classes.target.code.toLowerCase());
	await expect(
		page.getByText(`Request sent for ${targetName}. You'll see here once it's decided.`)
	).toBeVisible();
	const row = joinCard(page).locator('li', { hasText: targetName });
	await expect(row.locator('ix-pill')).toHaveText('Pending');
	await expect(row.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
	await expect(page.locator('#joinCode')).toHaveJSProperty('value', '');
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
	await expect(rejected.locator('ix-pill')).toHaveText('Rejected');
	await expect(card.locator('li', { hasText: targetName }).locator('ix-pill')).toHaveText(
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
	await page.waitForFunction(
		() =>
			customElements.get('ix-button') !== undefined &&
			customElements.get('ix-menu-item') !== undefined
	);
	await page.waitForLoadState('networkidle');
}

function joinSection(page: Page) {
	return page.locator('section.card', {
		has: page.getByRole('heading', { name: 'Class join requests' })
	});
}

function requestsNavItem(page: Page) {
	return page.locator('ix-menu-item', { hasText: 'Requests' });
}

/** The /requests header count pill (its accessible text, e.g. "1 pending"). */
function headerPill(page: Page) {
	return page.locator('.page-header ix-pill');
}

/** The layout's load-error toast: shown when the nav count query failed. */
function loadErrorToast(page: Page) {
	return page.locator('ix-toast').getByText(/Something went wrong loading this page's data/);
}

async function decide(page: Page, className: string, button: 'Approve' | 'Reject') {
	await joinSection(page)
		.locator('tr', { hasText: className })
		.getByRole('button', { name: button })
		.click();
	await page.locator('ix-modal').getByRole('button', { name: button }).last().click();
}

// The teacher tests below depend on the first test's pending request for
// the target class (the file runs serially).
test("a teacher who is the student's parent sees the request without buttons, uncounted", async ({
	page
}) => {
	await signIn(page, teacherParent);
	await openRequests(page);

	const row = joinSection(page).locator('tr', { hasText: studentName });
	await expect(row).toContainText(`Asks to join ${targetName}`);
	await expect(row).toContainText('Your child. Another teacher or the admin decides.');
	await expect(row.getByRole('button')).toHaveCount(0);
	// Known state: the count loaded without error (no load-error toast), and
	// the only pending item is their own child's, so nothing is counted.
	await expect(loadErrorToast(page)).toHaveCount(0);
	await expect(requestsNavItem(page)).toHaveJSProperty('notifications', undefined);
	await expect(headerPill(page)).toHaveCount(0);
});

test('the class teacher approves a request; the class appears in My classes', async ({
	page,
	browser
}) => {
	await signIn(page, teacher);
	await openRequests(page);

	const row = joinSection(page).locator('tr', { hasText: studentName });
	await expect(row).toContainText(`Asks to join ${targetName}`);
	await expect(row).toContainText(`Current classes: ${homeName}`);
	await expect(loadErrorToast(page)).toHaveCount(0);
	await expect(requestsNavItem(page)).toHaveJSProperty('notifications', 1);
	await expect(headerPill(page).locator('.sr-only')).toHaveText('1 pending');

	await decide(page, targetName, 'Approve');
	await expect(
		page.locator('ix-toast').getByText(`${studentName} now belongs to ${targetName}.`)
	).toBeVisible();
	// The last request is gone, so the section is hidden like other empty ones.
	await expect(joinSection(page)).toHaveCount(0);
	await expect(requestsNavItem(page)).toHaveJSProperty('notifications', undefined);
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
	await expect(card.locator('li', { hasText: secondName }).locator('ix-pill')).toHaveText(
		'Pending'
	);

	const context = await browser.newContext();
	const teacherPage = await context.newPage();
	try {
		await signIn(teacherPage, teacher);
		await openRequests(teacherPage);
		await expect(requestsNavItem(teacherPage)).toHaveJSProperty('notifications', 1);
		await decide(teacherPage, secondName, 'Reject');
		await expect(
			teacherPage
				.locator('ix-toast')
				.getByText(`${studentName}'s request to join ${secondName} was rejected.`)
		).toBeVisible();
		await expect(joinSection(teacherPage)).toHaveCount(0);
	} finally {
		await context.close();
	}

	await openDashboard(page);
	await expect(card.locator('li', { hasText: secondName }).locator('ix-pill')).toHaveText(
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
