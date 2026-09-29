import { expect, test, type Page } from '@playwright/test';
import { service, signIn, type TestUser } from './fixtures';

/**
 * B12a (#67): on their dashboard an approved student sends another class's
 * code and sees the request as Pending; a rejected request (decided here
 * with the service role, since the teacher side is B12b) shows as Rejected
 * and can be dismissed. Its own fixture: a home class the student is in and
 * two classes to ask for.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const homeName = `E2E67 ${tag} Home`;
const targetName = `E2E67 ${tag} Target`;
const rejectName = `E2E67 ${tag} Reject`;
const studentName = `E2E67 Student ${tag}`;

let student: TestUser;
const classes: Record<'home' | 'target' | 'reject', { id: string; code: string }> = {
	home: { id: '', code: '' },
	target: { id: '', code: '' },
	reject: { id: '', code: '' }
};
let studentId = '';

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function cleanup() {
	const problems: string[] = [];
	// The student first: a class with students cannot be deleted.
	if (studentId) {
		const { error } = await service.auth.admin.deleteUser(studentId);
		if (error) problems.push(`delete student: ${error.message}`);
		else studentId = '';
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
			['reject', rejectName]
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
