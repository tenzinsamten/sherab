import { expect, test, type Page } from '@playwright/test';
import { berlinToday, service, signIn, type TestUser } from './fixtures';

/**
 * B11 (#57): a parent sets a two-week leave period on the child page's
 * Sessions tab, checks the preview's counts, saves, sees On leave in the
 * Sessions list, then undoes it with Coming. Its own fixture: one class
 * (10:00, schedule in the past so it only has the sessions made here), an
 * approved student enrolled in it with an approved parent, and sessions
 * 10, 15 and 22 days ahead (Short-notice, Planned, Planned with the
 * default two-week notice). A second class the student is also in has one
 * session in the period, to prove a picked class reaches the save.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const className = `E2E57 ${tag}`;
const studentName = `E2E57 Student ${tag}`;

let parent: TestUser;
let student: TestUser;
let classId: string;
let otherClassId: string;
let otherSessionId: string;
const sessionIds: string[] = [];
/** Deletion order: the student first (a class with students cannot be deleted). */
const userIds: string[] = [];
/** Class days this fixture created (deleted again in cleanup). */
const createdDays: string[] = [];

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

function plusDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

const today = berlinToday();
const from = plusDays(today, 10);
const to = plusDays(today, 24);
const sessionDays = [plusDays(today, 10), plusDays(today, 15), plusDays(today, 22)];
const otherDay = plusDays(today, 12);

async function createUser(role: 'student' | 'parent'): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-57-${role}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${role}: ${error?.message}`);
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
	const classIds = [classId, otherClassId].filter(Boolean);
	if (classIds.length) {
		const { error } = await service.from('classes').delete().in('id', classIds);
		if (error) problems.push(`delete classes: ${error.message}`);
	}
	if (createdDays.length) {
		const { error } = await service.from('class_days').delete().in('day', createdDays);
		if (error) problems.push(`delete class days: ${error.message}`);
		else createdDays.length = 0;
	}
	if (problems.length) throw new Error(problems.join('; '));
}

test.beforeAll(async () => {
	try {
		parent = await createUser('parent');
		const createClass = async (name: string) =>
			check(
				await service
					.from('classes')
					.insert({
						name,
						code: `L${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
						default_start_time: '10:00',
						default_duration_minutes: 60,
						schedule_starts_on: '2000-01-02',
						schedule_ends_on: '2000-01-02'
					})
					.select('id')
					.single(),
				`create class ${name}`
			).id;
		classId = await createClass(className);
		otherClassId = await createClass(`${className} other`);

		student = await createUser('student');
		check(
			await service
				.from('profiles')
				.update({
					class_id: classId,
					status: 'approved',
					registration_name: studentName,
					display_name: studentName
				})
				.eq('id', student.id),
			'approve student'
		);
		const enrolled = check(
			await service
				.from('class_enrollments')
				.select('class_id')
				.eq('student_id', student.id)
				.eq('class_id', classId),
			'read enrollment'
		);
		if (!enrolled?.length) {
			check(
				await service
					.from('class_enrollments')
					.insert({ student_id: student.id, class_id: classId }),
				'enroll student'
			);
		}
		check(
			await service
				.from('class_enrollments')
				.insert({ student_id: student.id, class_id: otherClassId }),
			'enroll student in the other class'
		);
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);
		check(
			await service.from('profiles').update({ parent_id: parent.id }).eq('id', student.id),
			'link parent'
		);

		// Sessions of this class only: a new class day keeps only this class's
		// session (attendance_backfill_session), an existing one gets an extra.
		const existing = check(
			await service
				.from('class_days')
				.select('day')
				.in('day', [...sessionDays, otherDay]),
			'read class days'
		);
		const had = new Set((existing ?? []).map((d) => d.day));
		createdDays.push(...[...sessionDays, otherDay].filter((d) => !had.has(d)));
		for (const day of sessionDays) {
			sessionIds.push(
				check(
					await service.rpc('attendance_backfill_session', { p_class_id: classId, p_day: day }),
					`session on ${day}`
				)
			);
		}
		otherSessionId = check(
			await service.rpc('attendance_backfill_session', {
				p_class_id: otherClassId,
				p_day: otherDay
			}),
			'other class session'
		);
	} catch (error) {
		await cleanup().catch(() => undefined);
		throw error;
	}
});

test.afterAll(async () => {
	await cleanup();
});

async function openSessions(page: Page) {
	await page.goto(`/parent/children/${student.id}?tab=sessions`);
	await page.waitForFunction(
		() =>
			customElements.get('ix-date-input') !== undefined &&
			customElements.get('ix-modal') !== undefined
	);
	await page.waitForLoadState('networkidle');
}

async function fillRange(page: Page) {
	await page.locator('#range-from input').first().fill(from);
	await expect(page.locator('#range-from')).toHaveJSProperty('value', from);
	await page.locator('#range-to input').first().fill(to);
	await expect(page.locator('#range-to')).toHaveJSProperty('value', to);
}

async function latestAnswers(ids = sessionIds) {
	const { data, error } = await service
		.from('session_leave_history')
		.select('class_session_id, answer, classification')
		.eq('student_id', student.id)
		.order('answered_at', { ascending: false })
		.order('id', { ascending: false });
	if (error) throw new Error(`read leave history: ${error.message}`);
	const latest = new Map<string, { answer: string; classification: string | null }>();
	for (const row of data ?? []) {
		if (!latest.has(row.class_session_id)) {
			latest.set(row.class_session_id, { answer: row.answer, classification: row.classification });
		}
	}
	return ids.map((id) => latest.get(id) ?? null);
}

const modal = (page: Page) => page.locator('ix-modal');
const openDialog = (page: Page) => modal(page).locator('dialog[open]');

/** Opens an <ix-select>'s list and picks the item with `value`. */
async function pick(page: Page, selectId: string, value: string) {
	const select = page.locator(`#${selectId}`);
	await select.locator('input').first().click();
	await select.locator(`ix-select-item[value="${value}"]`).click();
	await expect(select).toHaveJSProperty('value', value);
}

test('a two-week leave for one class: preview counts, save, the Sessions list shows On leave', async ({
	page
}) => {
	await signIn(page, parent);
	await openSessions(page);
	await expect(page.getByRole('heading', { name: 'Plan a leave period' })).toBeVisible();

	await fillRange(page);
	await pick(page, 'range-class', classId);
	await page.getByRole('button', { name: 'Preview' }).click();

	await expect(openDialog(page)).toHaveCount(1);
	await expect(modal(page)).toContainText(
		'Sessions: 3 · Planned: 2 · Short-notice: 1 · Left unchanged: 0'
	);
	await expect(modal(page).locator('.range-list li')).toHaveCount(3);
	// Nothing is written by the preview.
	expect(await latestAnswers()).toEqual([null, null, null]);

	await modal(page).getByRole('button', { name: 'Save' }).click();
	await expect(openDialog(page)).toHaveCount(0);
	await expect(page.locator('ix-toast')).toContainText('Changed: 3 · Unchanged or skipped: 0');

	expect(await latestAnswers()).toEqual([
		{ answer: 'on_leave', classification: 'short_notice' },
		{ answer: 'on_leave', classification: 'planned' },
		{ answer: 'on_leave', classification: 'planned' }
	]);
	// The other class was not picked: its session in the period is untouched.
	expect(await latestAnswers([otherSessionId])).toEqual([null]);
	const list = page.locator('ul.sessions');
	await expect(list.getByText('On leave · Short-notice')).toHaveCount(1);
	await expect(list.getByText('On leave · Planned')).toHaveCount(2);
});

test('undo: the same range with Coming (all classes) puts the On leave sessions back to Coming', async ({
	page
}) => {
	await signIn(page, parent);
	await openSessions(page);

	await fillRange(page);
	await page.getByRole('radio', { name: 'Coming' }).click();
	await expect(page.getByRole('radio', { name: 'Coming' })).toBeChecked();
	await page.getByRole('button', { name: 'Preview' }).click();

	await expect(openDialog(page)).toHaveCount(1);
	// All classes: the other class's never-answered session stays as it is.
	await expect(modal(page)).toContainText('Sessions: 4 · Back to Coming: 3 · Left unchanged: 1');
	await modal(page).getByRole('button', { name: 'Save' }).click();
	await expect(openDialog(page)).toHaveCount(0);

	expect(await latestAnswers()).toEqual([
		{ answer: 'coming', classification: null },
		{ answer: 'coming', classification: null },
		{ answer: 'coming', classification: null }
	]);
	expect(await latestAnswers([otherSessionId])).toEqual([null]);
	await expect(page.locator('ul.sessions').getByText('On leave ·')).toHaveCount(0);
});

test('an end before the start: an inline error on the dates, nothing opens', async ({ page }) => {
	await signIn(page, parent);
	await openSessions(page);

	await page.locator('#range-from input').first().fill(to);
	await page.locator('#range-to input').first().fill(from);
	await expect(page.locator('#range-to')).toHaveJSProperty('value', from);
	await page.getByRole('button', { name: 'Preview' }).click();

	await expect(page.locator('#range-dates-error')).toContainText('starts today or later');
	await expect(openDialog(page)).toHaveCount(0);
	await expect(page.locator('#range-from')).toHaveClass(/ix-invalid/);
});
