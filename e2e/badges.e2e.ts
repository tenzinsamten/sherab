import { expect, test, type Page } from '@playwright/test';
import { fixtureTeam, service, signIn, type TestUser } from './fixtures';

/**
 * Badge detail story 3: the Badges tile on /student shows each earned badge
 * as its icon, two subjects at the same milestone both show (the deferred
 * each-key item from story 2), the detail dialog opens from the keyboard,
 * closes with Escape and returns focus, and per-subject progress shows.
 *
 * Its own fixture: a teacher, a language and a dance class, and an approved
 * student enrolled in both with one Done homework in each (badges are
 * trigger-written: language-homework-1 and dance-homework-1).
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
let teacher: TestUser;
let student: TestUser;
const userIds: string[] = [];
const classIds: string[] = [];
const team = fixtureTeam(tag);

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'teacher' | 'student'): Promise<TestUser> {
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

async function openDashboard(page: Page) {
	await page.goto('/student');
	await page.waitForFunction(() => customElements.get('ix-modal') !== undefined);
	await page.waitForLoadState('networkidle');
}

test('earned badges show as icons, open their detail by keyboard and return focus', async ({
	page
}) => {
	await signIn(page, student);
	await openDashboard(page);

	// Two subjects at the same milestone both show, language first.
	const icons = page.locator('button[data-badge]');
	await expect(icons).toHaveCount(2);
	await expect(icons.nth(0)).toHaveAttribute('data-badge', 'language-homework-1');
	await expect(icons.nth(1)).toHaveAttribute('data-badge', 'dance-homework-1');
	await expect(icons.nth(0).locator('img')).toHaveAttribute(
		'src',
		'/badges/language-homework-1.svg'
	);
	await expect(page.getByRole('button', { name: 'Dance & song Homework badge 1' })).toBeVisible();
	await expect(icons.nth(1)).toHaveAttribute('title', 'Dance & song Homework badge 1');

	// Progress per subject, both tracks.
	await expect(page.locator('[data-progress="language-homework"] dd')).toHaveText('1 / 5');
	await expect(page.locator('[data-progress="dance-homework"] dd')).toHaveText('1 / 5');
	await expect(page.locator('[data-progress="dance-attendance"] dd')).toHaveText('0 / 1');
	await expect(page.locator('[data-progress="language-attendance"] dd')).toHaveText('0 / 1');

	// Keyboard: focus the dance icon, Enter opens the detail.
	const danceIcon = icons.nth(1);
	await danceIcon.focus();
	await page.keyboard.press('Enter');
	const dialog = page.getByRole('dialog', { name: '1 Dance & song homework done' });
	await expect(dialog).toBeVisible();
	const detail = page.locator('ix-modal[data-testid="badge-detail"]');
	await expect(detail.getByText('1 Dance & song homework done')).toBeVisible();
	await expect(detail.getByText('Subject: Dance & song')).toBeVisible();
	await expect(detail.getByText(/^Earned on /)).toBeVisible();
	// The track's real next target, from the progress row (1 done -> 5).
	await expect(detail.getByText('Next: 5')).toBeVisible();

	// Escape closes it and focus returns to the icon.
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(danceIcon).toBeFocused();
});
