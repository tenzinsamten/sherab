import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import type { Database } from '../src/lib/supabase/database.types';
import {
	berlinToday,
	env,
	fixtureTeam,
	isoWeekday,
	service,
	signIn,
	type TestUser
} from './fixtures';

/**
 * Teacher class page (#66 B8b; native fields on the new UI since mobile-first
 * story 7) and the homework forms as iX fields: the attendance session
 * picker, collapsible per-student skill rows, and the homework create / edit
 * forms. Its own fixture: one class taught by one teacher,
 * with 40 approved students and two past sessions (attendance can only be
 * marked for sessions today or earlier) in a random past year, so nothing
 * collides with other runs' class days. Leave can only be answered, by the
 * student's parent, before a session starts: the class days are created in
 * a random future year, answered, and then moved into the past.
 */

test.describe.configure({ mode: 'serial' });

const STUDENT_COUNT = 40;
const tag = crypto.randomUUID().slice(0, 8);
// class_days.day is unique school-wide: random years no one else uses.
// 1100-1699 only: src/lib/server/rls.spec.ts leaves marked sessions in
// 1700-1899, and cleanup() deletes this year's class days, which a session
// with marks refuses.
const year = 1100 + Math.floor(Math.random() * 600);
const futureYear = 3000 + Math.floor(Math.random() * 6000);
// Two class days a week apart, created in the future and moved to the past.
const days = [`${year}-03-08`, `${year}-03-15`];
const futureDays = [`${futureYear}-03-08`, `${futureYear}-03-15`];

let teacher: TestUser;
let classId: string;
const students: { id: string; name: string; user: TestUser }[] = [];
/** Session ids by day. */
const sessions: Record<string, string> = {};
const userIds: string[] = [];
const team = fixtureTeam(tag);
let parentId: string | undefined;

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(
	role: 'teacher' | 'student' | 'parent',
	suffix: string
): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-66t-${role}-${suffix}-${tag}@${domain}`;
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

async function addStudent(index: number) {
	const name = `E2E66T S${String(index).padStart(2, '0')} ${tag}`;
	const user = await createUser('student', String(index));
	check(
		await service
			.from('profiles')
			.update({
				class_id: classId,
				status: 'approved',
				registration_name: name,
				display_name: name,
				team_id: await team.id()
			})
			.eq('id', user.id),
		`approve student ${index}`
	);
	const enrolled = check(
		await service
			.from('class_enrollments')
			.select('class_id')
			.eq('student_id', user.id)
			.eq('class_id', classId),
		'read enrollment'
	);
	if (!enrolled?.length) {
		check(
			await service.from('class_enrollments').insert({ student_id: user.id, class_id: classId }),
			`enroll student ${index}`
		);
	}
	students[index] = { id: user.id, name, user };
}

async function cleanup() {
	const problems: string[] = [];
	// Students before the class (a class with students cannot be deleted)
	// and before their parent (a parent with children cannot be deleted).
	const ids = userIds.splice(0).reverse();
	const parentIndex = parentId ? ids.indexOf(parentId) : -1;
	if (parentIndex !== -1) ids.push(...ids.splice(parentIndex, 1));
	for (const id of ids) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	if (classId) {
		const { error } = await service.from('classes').delete().eq('id', classId);
		if (error) problems.push(`delete class: ${error.message}`);
	}
	for (const y of [year, futureYear]) {
		const { error: dayError } = await service
			.from('class_days')
			.delete()
			.gte('day', `${y}-01-01`)
			.lte('day', `${y}-12-31`);
		if (dayError) problems.push(`delete class days: ${dayError.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
}

test.beforeAll(async () => {
	test.setTimeout(120_000);
	try {
		teacher = await createUser('teacher', 't');
		classId = check(
			await service
				.from('classes')
				.insert({
					name: `E2E66T ${tag}`,
					code: `T${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
					default_start_time: '10:00',
					default_duration_minutes: 60,
					schedule_weekdays: [isoWeekday(futureDays[0])],
					// Only the fixture's own year: a schedule reaching back to today
					// would also give the class a session on every other class day
					// in the database, and the newest of those is selected first.
					schedule_starts_on: `${futureYear}-01-01`,
					schedule_ends_on: `${futureYear}-12-31`
				})
				.select('id')
				.single(),
			'create class'
		).id;
		check(
			await service.from('class_teachers').insert({ class_id: classId, teacher_id: teacher.id }),
			'assign teacher'
		);
		for (let start = 0; start < STUDENT_COUNT; start += 10) {
			await Promise.all(
				Array.from({ length: Math.min(10, STUDENT_COUNT - start) }, (_, i) => addStudent(start + i))
			);
		}
		check(await service.from('class_days').insert(futureDays.map((day) => ({ day }))), 'add days');
		const rows = check(
			await service
				.from('class_sessions_effective')
				.select('id, day')
				.eq('class_id', classId)
				.in('day', futureDays),
			'read sessions'
		);
		for (const row of rows ?? []) sessions[days[futureDays.indexOf(row.day!)]] = row.id!;
		if (Object.keys(sessions).length !== 2) {
			throw new Error(`expected 2 sessions, got ${Object.keys(sessions).length}`);
		}

		// Student 0's parent: on leave for the first session, coming to the second.
		const parent = await createUser('parent', 'p');
		parentId = parent.id;
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);
		check(
			await service.from('profiles').update({ parent_id: parent.id }).eq('id', students[0].id),
			'link parent'
		);
		const asParent = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		const { error: signInError } = await asParent.auth.signInWithPassword({
			email: parent.email,
			password: parent.password
		});
		if (signInError) throw new Error(`parent sign-in: ${signInError.message}`);
		check(
			await asParent.from('session_leave_history').insert([
				{ class_session_id: sessions[days[0]], student_id: students[0].id, answer: 'on_leave' },
				{ class_session_id: sessions[days[1]], student_id: students[0].id, answer: 'coming' }
			]),
			'add leave answers'
		);
		await asParent.auth.signOut();

		// Into the past, where attendance can be marked.
		for (const [i, day] of futureDays.entries()) {
			check(
				await service.from('class_days').update({ day: days[i] }).eq('day', day),
				'move class day'
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

/**
 * Waits for hydration: a page on the new UI (the class page) marks its root
 * hydrated; on an iX page (the homework forms) the iX form components are
 * defined.
 */
async function open(page: Page, path: string) {
	await page.goto(path);
	await page.waitForFunction(() => {
		const root = document.querySelector('main > [data-ui="new"]');
		return root
			? root.hasAttribute('data-hydrated')
			: customElements.get('ix-select') !== undefined;
	});
	await page.waitForLoadState('networkidle');
}

/** Picks `value` in a native select (the class page). */
async function choose(page: Page, selectId: string, value: string) {
	const select = page.locator(`#${selectId}`);
	await select.selectOption(value);
	await expect(select).toHaveValue(value);
}

/** A student's attendance checkbox on the class page. */
const attendanceBox = (page: Page, student: { id: string }) =>
	page.locator(`.attendance-row[data-student-id="${student.id}"] input[type="checkbox"]`);
/** The leave badge inside a student's attendance row. */
const leaveBadge = (page: Page, student: { id: string }) =>
	page.locator(`.attendance-row[data-student-id="${student.id}"] [data-testid="leave-badge"]`);

/** Opens an <ix-select>'s list and picks the item with `value`. */
async function pick(page: Page, selectId: string, value: string) {
	const select = page.locator(`#${selectId}`);
	await select.locator('input').first().click();
	await select.locator(`ix-select-item[value="${value}"]`).click();
	await expect(select).toHaveJSProperty('value', value);
}

function capturePosts(page: Page, action: string): URLSearchParams[] {
	const posts: URLSearchParams[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes(`?/${action}`)) {
			posts.push(new URLSearchParams(r.postData() ?? ''));
		}
	});
	return posts;
}

/**
 * The homework content editor's editable area (#72-#74). Tiptap loads after
 * the page, so wait until it can be typed in.
 */
async function contentEditor(page: Page, id: string) {
	const area = page.locator(`#${id}`);
	await expect(area).toHaveAttribute('contenteditable', 'true');
	return area;
}

/** A homework content document of one plain paragraph. */
const textDoc = (text: string) => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
});

test('attendance: picking a session updates the leave pills, and the save keeps it selected', async ({
	page
}) => {
	const posts = capturePosts(page, 'markAttendance');
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}`);

	const select = page.locator('#sessionId');
	const pill = leaveBadge(page, students[0]);
	// Newest session first.
	await expect(select).toHaveValue(sessions[days[1]]);
	await expect(pill).toHaveText('Coming');

	await choose(page, 'sessionId', sessions[days[0]]);
	await expect(pill).toHaveText('On leave');
	// #102: not marked yet, so no note in the picker.
	const pickedItem = page.locator(`#sessionId option[value="${sessions[days[0]]}"]`);
	await expect(pickedItem).toHaveText(`${days[0]} · 10:00`);

	await attendanceBox(page, students[0]).click();
	await page.getByRole('button', { name: 'Save attendance' }).click();
	await expect(
		page.locator('ix-toast').getByText(`Attendance recorded for ${days[0]}.`)
	).toBeVisible();
	expect(posts).toHaveLength(1);
	expect(posts[0].get('sessionId')).toBe(sessions[days[0]]);
	await expect(select).toHaveValue(sessions[days[0]]);
	await expect(pill).toHaveText('On leave');
	// #102: the save happened on this page, and the picker now shows the
	// session as marked, in its list and as the picked value.
	await expect(pickedItem).toHaveText(`${days[0]} · 10:00 · marked`);
	await expect(select.locator('option:checked')).toHaveText(`${days[0]} · 10:00 · marked`);

	// After the save, picking another session is not reverted to the saved one.
	await choose(page, 'sessionId', sessions[days[1]]);
	await expect(pill).toHaveText('Coming');
	await page.waitForTimeout(500);
	await expect(select).toHaveValue(sessions[days[1]]);
	await expect(pill).toHaveText('Coming');

	const { data } = await service
		.from('attendance_records')
		.select('student_id, present')
		.eq('class_id', classId)
		.eq('student_id', students[0].id);
	expect(data).toEqual([{ student_id: students[0].id, present: true }]);
});

test('attendance: a marked session opens ticked, a re-save changes no current mark, a correction is one history line', async ({
	page
}) => {
	// #102. The second session; students 2 and 3, which no other test marks.
	const day = days[1];
	const sessionId = sessions[day];
	const [present, absent, unmarked] = [students[2], students[3], students[4]];
	const box = (student: { id: string }) => attendanceBox(page, student);
	const item = (id: string) => page.locator(`#sessionId option[value="${id}"]`);
	/** The current mark per student of the session (attendance_current). */
	const currentMarks = async () => {
		const rows = check(
			await service
				.from('attendance_current')
				.select('student_id, present')
				.eq('class_session_id', sessionId),
			'read current marks'
		);
		return new Map((rows ?? []).map((r) => [r.student_id, r.present]));
	};
	/** Every row of the `present` student for the session, oldest first. */
	const rawMarks = async () =>
		(
			check(
				await service
					.from('attendance_records')
					.select('present')
					.eq('class_session_id', sessionId)
					.eq('student_id', present.id)
					.order('recorded_at'),
				'read raw marks'
			) ?? []
		).map((r) => r.present);
	const save = async () => {
		const response = page.waitForResponse(
			(r) => r.request().method() === 'POST' && r.url().includes('?/markAttendance')
		);
		await page.getByRole('button', { name: 'Save attendance' }).click();
		expect((await response).ok()).toBe(true);
		// A save shows the list again as saved: the button is busy until the
		// reload after it has arrived.
		await expect(page.getByRole('button', { name: 'Save attendance' })).toBeEnabled();
	};

	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}`);

	// Not marked yet: no note in the picker, nothing ticked.
	await expect(page.locator('#sessionId')).toHaveValue(sessionId);
	await expect(item(sessionId)).toHaveText(`${day} · 10:00`);
	await expect(box(present)).toHaveJSProperty('checked', false);

	// Marked earlier, for two students only (the others have no mark).
	check(
		await service.from('attendance_records').insert(
			[present, absent].map((student) => ({
				student_id: student.id,
				class_id: classId,
				class_session_id: sessionId,
				present: student === present,
				recorded_by: teacher.id
			}))
		),
		'seed marks'
	);
	await open(page, `/teacher/classes/${classId}`);
	await expect(page.locator('#sessionId')).toHaveValue(sessionId);
	await expect(item(sessionId)).toHaveText(`${day} · 10:00 · marked`);
	await expect(box(present)).toHaveJSProperty('checked', true);
	await expect(box(absent)).toHaveJSProperty('checked', false);
	await expect(box(unmarked)).toHaveJSProperty('checked', false);

	// Ticks not saved are dropped when another session is picked.
	await box(unmarked).click();
	await expect(box(unmarked)).toHaveJSProperty('checked', true);
	await choose(page, 'sessionId', sessions[days[0]]);
	await expect(box(present)).toHaveJSProperty('checked', false);
	await choose(page, 'sessionId', sessionId);
	await expect(box(present)).toHaveJSProperty('checked', true);
	await expect(box(unmarked)).toHaveJSProperty('checked', false);

	// Saved again unchanged: no row is written, also not for the students
	// without a mark.
	await save();
	let marks = await currentMarks();
	expect([...marks]).toHaveLength(2);
	expect(marks.get(present.id)).toBe(true);
	expect(marks.get(absent.id)).toBe(false);
	expect(await rawMarks()).toEqual([true]);
	await expect(page.locator('#sessionId')).toHaveValue(sessionId);
	await expect(box(present)).toHaveJSProperty('checked', true);
	await expect(box(absent)).toHaveJSProperty('checked', false);

	// A correction: one student unticked, every other mark as it was.
	await box(present).click();
	await expect(box(present)).toHaveJSProperty('checked', false);
	await save();
	await expect.poll(async () => (await currentMarks()).get(present.id)).toBe(false);
	marks = await currentMarks();
	expect([...marks]).toHaveLength(2);
	expect(marks.get(absent.id)).toBe(false);
	await expect(page.locator('#sessionId')).toHaveValue(sessionId);
	await expect(box(present)).toHaveJSProperty('checked', false);

	// Append-only: the earlier mark is still there, the correction is a new row...
	expect(await rawMarks()).toEqual([true, false]);

	// ...and the history shows the session once, with the current mark.
	await page.locator(`button.student-toggle[data-student-id="${present.id}"]`).click();
	const lines = page
		.locator(`#skills-panel-${present.id} .history-list li`)
		.filter({ hasText: day });
	await expect(lines).toHaveCount(1);
	await expect(lines).toContainText('Absent');
});

test('attendance: a tick not saved yet survives a skill save on the same page', async ({
	page
}) => {
	// #102. Students no other test ticks or gives a skill status.
	const ticked = students[30];
	const skilled = students[31];
	const box = attendanceBox(page, ticked);

	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}`);
	await expect(box).toHaveJSProperty('checked', false);
	await box.click();
	await expect(box).toHaveJSProperty('checked', true);

	await page.locator(`button.student-toggle[data-student-id="${skilled.id}"]`).click();
	const panel = page.locator(`#skills-panel-${skilled.id}`);
	await choose(page, `level-${skilled.id}-dance`, 'learning');
	await panel
		.locator('form[data-skill-area="dance"]')
		.getByRole('button', { name: 'Save' })
		.click();
	await expect(page.locator('ix-toast').getByText('Status saved.')).toBeVisible();
	// The reload after the save has arrived: the summary shows the new level.
	await expect(
		page.locator(`button.student-toggle[data-student-id="${skilled.id}"]`)
	).toContainText('Dance: Learning');

	await expect(box).toHaveJSProperty('checked', true);
});

test('attendance: a form opened before another correction changes one other student and does not undo it', async ({
	page
}) => {
	// #102. The second session; students 8 and 9, which no other test marks.
	const sessionId = sessions[days[1]];
	const [corrected, changed] = [students[8], students[9]];
	const box = (student: { id: string }) => attendanceBox(page, student);
	const insert = async (student: { id: string }, present: boolean) =>
		check(
			await service.from('attendance_records').insert({
				student_id: student.id,
				class_id: classId,
				class_session_id: sessionId,
				present,
				recorded_by: teacher.id
			}),
			'insert mark'
		);
	const rows = async (student: { id: string }) =>
		(
			check(
				await service
					.from('attendance_records')
					.select('present')
					.eq('class_session_id', sessionId)
					.eq('student_id', student.id)
					.order('recorded_at'),
				'read marks'
			) ?? []
		).map((r) => r.present);

	await insert(corrected, true);
	await insert(changed, false);

	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}`);
	await expect(page.locator('#sessionId')).toHaveValue(sessionId);
	await expect(box(corrected)).toHaveJSProperty('checked', true);
	await expect(box(changed)).toHaveJSProperty('checked', false);

	// Someone else corrects the first student; this page still shows the old mark.
	await insert(corrected, false);

	await box(changed).click();
	await expect(box(changed)).toHaveJSProperty('checked', true);
	const response = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('?/markAttendance')
	);
	await page.getByRole('button', { name: 'Save attendance' }).click();
	expect((await response).ok()).toBe(true);
	// The button is busy until the reload after the save has arrived.
	await expect(page.getByRole('button', { name: 'Save attendance' })).toBeEnabled();

	// Only the changed student got a row; the correction stands and now shows.
	expect(await rows(changed)).toEqual([false, true]);
	expect(await rows(corrected)).toEqual([true, false]);
	await expect(box(corrected)).toHaveJSProperty('checked', false);
	await expect(box(changed)).toHaveJSProperty('checked', true);
});

test('skills: ~40 students render as collapsed rows', async ({ page }) => {
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}`);
	const toggles = page.locator('button.student-toggle');
	await expect(toggles).toHaveCount(STUDENT_COUNT);
	await expect(page.locator('button.student-toggle[aria-expanded="true"]')).toHaveCount(0);
	await expect(page.locator('form.skill-form')).toHaveCount(0);
	await expect(toggles.first()).toContainText(
		'Language: No entry yet · Song: No entry yet · Dance: No entry yet'
	);
});

test('skills: an empty level is blocked; a save posts, updates the summary and clears only that form', async ({
	page
}) => {
	const student = students[1];
	let allowSave = false;
	const blocked: string[] = [];
	const posts: URLSearchParams[] = [];
	await page.route(/\?\/setSkillStatus/, async (route) => {
		if (!allowSave) {
			blocked.push(route.request().url());
			return route.abort();
		}
		posts.push(new URLSearchParams(route.request().postData() ?? ''));
		return route.continue();
	});
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}`);

	const toggle = page.locator(`button.student-toggle[data-student-id="${student.id}"]`);
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	const panel = page.locator(`#skills-panel-${student.id}`);
	await expect(panel).toBeVisible();
	await expect(toggle).toHaveAttribute('aria-controls', `skills-panel-${student.id}`);
	await expect(panel.locator('form.skill-form')).toHaveCount(3);

	const form = (area: string) => panel.locator(`form[data-skill-area="${area}"]`);

	// The notes field is described by the parent hint.
	const notesInput = page.locator(`#notes-${student.id}-song`);
	await expect(notesInput).toHaveAccessibleDescription("Visible to the student's parent");

	// No level: nothing sent, the select is invalid with an announced message.
	await form('language').getByRole('button', { name: 'Save' }).click();
	const languageSelect = page.locator(`#level-${student.id}-language`);
	await expect(languageSelect).toHaveAttribute('aria-invalid', 'true');
	const error = page.locator(`#level-${student.id}-language-error`);
	await expect(error).toHaveText('Choose a valid level.');
	await expect(error).toHaveAttribute('role', 'alert');
	await expect(languageSelect).toHaveAttribute(
		'aria-describedby',
		`level-${student.id}-language-error`
	);
	// The error sits under the field.
	const [selectBox, errorBox] = await Promise.all([
		languageSelect.boundingBox(),
		error.boundingBox()
	]);
	expect(errorBox!.y).toBeGreaterThanOrEqual(selectBox!.y + selectBox!.height - 1);
	expect(blocked).toEqual([]);

	// Unsaved dance notes, then a Song save.
	allowSave = true;
	await page.locator(`#notes-${student.id}-dance`).fill('Keep me');
	await choose(page, `level-${student.id}-song`, 'confident');
	await notesInput.fill('Great progress');
	await form('song').getByRole('button', { name: 'Save' }).click();
	await expect(page.locator('ix-toast').getByText('Status saved.')).toBeVisible();

	expect(posts).toHaveLength(1);
	expect(posts[0].get('studentId')).toBe(student.id);
	expect(posts[0].get('skillArea')).toBe('song');
	expect(posts[0].get('level')).toBe('confident');
	expect(posts[0].get('notes')).toBe('Great progress');

	await expect(toggle).toContainText(
		'Language: No entry yet · Song: Confident · Dance: No entry yet'
	);
	// The saved form is empty again; the others keep what was typed.
	await expect(page.locator(`#level-${student.id}-song`)).toHaveValue('');
	await expect(page.locator(`#notes-${student.id}-song`)).toHaveValue('');
	await expect(page.locator(`#notes-${student.id}-dance`)).toHaveValue('Keep me');
	await expect(languageSelect).toHaveAttribute('aria-invalid', 'true');
	// Picking a level clears the error.
	await choose(page, `level-${student.id}-language`, 'learning');
	await expect(languageSelect).not.toHaveAttribute('aria-invalid');
	await expect(error).toHaveCount(0);
	await expect(panel).toContainText('Great progress');

	// Collapsing keeps the forms mounted, hidden.
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(panel).toBeHidden();
	await toggle.click();
	await expect(page.locator(`#notes-${student.id}-dance`)).toHaveValue('Keep me');

	const { data } = await service
		.from('skill_status_history')
		.select('skill_area, level, notes')
		.eq('class_id', classId)
		.eq('student_id', student.id);
	expect(data).toEqual([{ skill_area: 'song', level: 'confident', notes: 'Great progress' }]);
});

test('homework create: one-off for a subset of two students', async ({ page }) => {
	const title = `E2E66T once ${tag}`;
	const posts = capturePosts(page, 'createAssignment');
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}/homework/new`);

	await page.locator('#title input').first().fill(title);
	await expect(page.locator('#skillArea')).toHaveJSProperty('value', 'language');
	await pick(page, 'skillArea', 'song');
	// The content language starts as the interface language.
	await expect(page.locator('#contentLanguage')).toHaveJSProperty('value', 'en');
	await (await contentEditor(page, 'content')).fill('Practise the song');
	await page.locator('#dueDate input').first().fill(`${year}-04-01`);
	await expect(page.locator('#dueDate')).toHaveJSProperty('value', `${year}-04-01`);

	await page.getByRole('radio', { name: 'Specific students' }).click();
	const box = (i: number) => page.getByRole('checkbox', { name: students[i].name });
	await box(2).click();
	await expect(box(2)).toBeChecked();
	await box(3).click();
	await expect(box(3)).toBeChecked();

	await page.getByRole('button', { name: 'Create assignment' }).click();
	await page.waitForURL(/\/homework(\?|$)/);

	expect(posts).toHaveLength(1);
	const posted = posts[0];
	expect(posted.get('mode')).toBe('once');
	expect(posted.get('title')).toBe(title);
	expect(posted.get('skillArea')).toBe('song');
	expect(posted.get('contentLanguage')).toBe('en');
	expect(JSON.parse(posted.get('content') ?? 'null')).toEqual(textDoc('Practise the song'));
	expect(posted.has('description')).toBe(false);
	expect(posted.get('dueDate')).toBe(`${year}-04-01`);
	expect(posted.get('targetMode')).toBe('subset');
	expect(posted.getAll('studentIds').sort()).toEqual([students[2].id, students[3].id].sort());
	expect(posted.has('startDate')).toBe(false);
	expect(posted.has('dueOffsetDays')).toBe(false);

	const { data } = await service
		.from('homework_assignments')
		.select('skill_area, whole_class, content, content_language')
		.eq('class_id', classId)
		.eq('title', title)
		.single();
	expect(data).toEqual({
		skill_area: 'song',
		whole_class: false,
		content: textDoc('Practise the song'),
		content_language: 'en'
	});
});

/** `date` plus `days`, as `YYYY-MM-DD`. */
function plusDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** A date as the English interface writes it in a sentence (formatDay). */
function longDate(date: string): string {
	return new Intl.DateTimeFormat('en', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(`${date}T00:00:00Z`));
}

test('homework create: weekly via the keyboard, students see the first week at once (#96), then edit title and offset', async ({
	page,
	browser
}) => {
	const title = `E2E66T weekly ${tag}`;
	const today = berlinToday();
	const posts = capturePosts(page, 'createAssignment');
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}/homework/new`);

	await page.locator('#title input').first().fill(title);
	await (await contentEditor(page, 'content')).fill('Sing it every week');
	// Arrow keys move the mode choice and swap the fields.
	const once = page.getByRole('radio', { name: 'One-off' });
	await expect(once).toBeChecked();
	await once.focus();
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('radio', { name: 'Weekly, recurring' })).toBeChecked();
	await expect(page.locator('#startDate')).toBeVisible();
	await expect(page.locator('#dueDate')).toHaveCount(0);
	await expect(page.locator('#dueOffsetDays')).toHaveJSProperty('value', 7);

	// #96: the note at the start date says when students see the homework.
	const note = page.locator('#startDate');
	await expect(note).toContainText(
		'Students see the homework from the start date. If that is today or earlier, they see it as soon as you create it.'
	);
	await page.locator('#startDate input').first().fill(today);
	await expect(page.locator('#startDate')).toHaveJSProperty('value', today);
	await expect(note).toContainText('Students will see this homework as soon as you create it.');
	await page.getByRole('button', { name: 'Create assignment' }).click();
	await page.waitForURL(/\/homework\?created=weekly&visible=now/);
	await expect(
		page.locator('ix-toast').getByText('Weekly homework created. Students can see it now.')
	).toBeVisible();

	expect(posts).toHaveLength(1);
	const posted = posts[0];
	expect(posted.get('mode')).toBe('weekly');
	expect(posted.get('startDate')).toBe(today);
	expect(posted.get('dueOffsetDays')).toBe('7');
	expect(posted.has('dueDate')).toBe(false);
	expect(posted.has('targetMode')).toBe(false);

	const { data: created } = await service
		.from('homework_assignments')
		.select('id, recurrence_start_date, due_offset_days')
		.eq('class_id', classId)
		.eq('title', title)
		.single();
	expect(created).toMatchObject({ recurrence_start_date: today, due_offset_days: 7 });

	// #96: this week's copy exists already, for every student of the class.
	const { data: instances } = await service
		.from('homework_instances')
		.select('id, period_start, due_date')
		.eq('assignment_id', created!.id);
	expect(instances).toHaveLength(1);
	expect(instances![0]).toMatchObject({ period_start: today, due_date: plusDays(today, 7) });
	const { data: assigned } = await service
		.from('homework_status_history')
		.select('student_id')
		.eq('instance_id', instances![0].id)
		.eq('status', 'assigned');
	expect((assigned ?? []).map((r) => r.student_id).sort()).toEqual(
		students.map((s) => s.id).sort()
	);

	// And it is on a student's page straight away.
	const context = await browser.newContext();
	try {
		const studentPage = await context.newPage();
		await signIn(studentPage, students[0].user);
		await studentPage.goto('/student');
		await expect(studentPage.getByText(title).first()).toBeVisible();
	} finally {
		await context.close();
	}

	// Edit: change title and offset.
	const edits = capturePosts(page, 'editAssignment');
	await open(page, `/teacher/classes/${classId}/homework/${created!.id}`);
	await page.getByText('Edit', { exact: true }).click();
	const titleField = page.locator(`#edit-title-${created!.id}`);
	const offsetField = page.locator(`#edit-offset-${created!.id}`);
	await expect(titleField).toHaveJSProperty('value', title);
	await expect(offsetField).toHaveJSProperty('value', 7);
	const newTitle = `${title} edited`;
	await titleField.locator('input').first().fill(newTitle);
	await offsetField.locator('input').first().fill('3');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.locator('ix-toast').getByText('Assignment updated.')).toBeVisible();

	expect(edits).toHaveLength(1);
	expect(edits[0].get('title')).toBe(newTitle);
	expect(edits[0].get('dueOffsetDays')).toBe('3');
	await expect(page.locator('h1')).toContainText(newTitle);
	await expect(titleField).toHaveJSProperty('value', newTitle);
	await expect(offsetField).toHaveJSProperty('value', 3);

	const { data: saved } = await service
		.from('homework_assignments')
		.select('title, due_offset_days')
		.eq('id', created!.id)
		.single();
	expect(saved).toEqual({ title: newTitle, due_offset_days: 3 });
});

test('homework create: weekly starting in the future says from when students see it, and creates no copy yet (#96)', async ({
	page
}) => {
	const title = `E2E66T weekly later ${tag}`;
	const start = plusDays(berlinToday(), 6);
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}/homework/new`);

	await page.locator('#title input').first().fill(title);
	await (await contentEditor(page, 'content')).fill('Starts next week');
	const once = page.getByRole('radio', { name: 'One-off' });
	await once.focus();
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('radio', { name: 'Weekly, recurring' })).toBeChecked();

	await page.locator('#startDate input').first().fill(start);
	await expect(page.locator('#startDate')).toHaveJSProperty('value', start);
	await expect(page.locator('#startDate')).toContainText(
		`Students will see this homework from ${longDate(start)}, not before.`
	);
	// The note is the description of the real input (inside the shadow root).
	expect(
		await page.locator('#startDate').evaluate(async (host) => {
			const input = await (
				host as HTMLElement & { getNativeInputElement: () => Promise<HTMLElement> }
			).getNativeInputElement();
			return (input.ariaDescribedByElements ?? []).map((el) => el.textContent?.trim());
		})
	).toEqual([`Students will see this homework from ${longDate(start)}, not before.`]);

	// One-off and back: the start date field comes back empty, and so does the note.
	const weekly = page.getByRole('radio', { name: 'Weekly, recurring' });
	await weekly.focus();
	await page.keyboard.press('ArrowUp');
	await expect(once).toBeChecked();
	await once.focus();
	await page.keyboard.press('ArrowDown');
	await expect(weekly).toBeChecked();
	await expect(page.locator('#startDate')).not.toHaveJSProperty('value', start);
	await expect(page.locator('#startDate')).toContainText(
		'Students see the homework from the start date. If that is today or earlier, they see it as soon as you create it.'
	);
	await page.locator('#startDate input').first().fill(start);
	await expect(page.locator('#startDate')).toHaveJSProperty('value', start);
	await expect(page.locator('#startDate')).toContainText(
		`Students will see this homework from ${longDate(start)}, not before.`
	);
	await page.getByRole('button', { name: 'Create assignment' }).click();
	await page.waitForURL(new RegExp(`/homework\\?created=weekly&visible=${start}`));
	await expect(
		page
			.locator('ix-toast')
			.getByText(`Weekly homework created. Students will see it from ${longDate(start)}.`)
	).toBeVisible();

	const { data: created } = await service
		.from('homework_assignments')
		.select('id')
		.eq('class_id', classId)
		.eq('title', title)
		.single();
	const { data: instances } = await service
		.from('homework_instances')
		.select('id')
		.eq('assignment_id', created!.id);
	expect(instances).toEqual([]);
});

test('homework list: the weekly "from tomorrow morning" and neutral messages, and the address loses its parameters (#96)', async ({
	page
}) => {
	const list = `/teacher/classes/${classId}/homework`;
	await signIn(page, teacher);

	// Arrives as the create page's redirect does: an in-app navigation (a
	// link added to the page and clicked), not a fresh page load.
	const arrive = async (query: string) => {
		await open(page, list);
		await page.evaluate((href) => {
			const link = document.createElement('a');
			link.href = href;
			link.textContent = 'e2e arrive';
			document.body.append(link);
		}, `${list}${query}`);
		await page.getByRole('link', { name: 'e2e arrive' }).click();
	};

	// What the create page redirects to when the first copies could not be made.
	await arrive('?created=weekly&visible=tomorrow');
	await expect(
		page
			.locator('ix-toast')
			.getByText('Weekly homework created. Students will see it from tomorrow morning.')
	).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`${list}$`));

	// Without a recognised `visible`: no claim about when.
	await arrive('?created=weekly');
	const neutral = page
		.locator('ix-toast')
		.filter({ hasText: 'Weekly homework created.' })
		.filter({ hasNotText: 'Students' });
	await expect(neutral).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`${list}$`));
});

test('homework create: an empty subset shows the server error and keeps the typed title', async ({
	page
}) => {
	const title = `E2E66T empty subset ${tag}`;
	const posts = capturePosts(page, 'createAssignment');
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}/homework/new`);

	await page.locator('#title input').first().fill(title);
	await (await contentEditor(page, 'content')).fill('Kept content');
	await page.locator('#dueDate input').first().fill(`${year}-04-02`);
	await expect(page.locator('#dueDate')).toHaveJSProperty('value', `${year}-04-02`);
	await page.getByRole('radio', { name: 'Specific students' }).click();
	await expect(page.getByRole('checkbox', { name: students[0].name })).not.toBeChecked();

	await page.getByRole('button', { name: 'Create assignment' }).click();
	await expect(page.locator('ix-toast').getByText('No students to assign this to.')).toBeVisible();

	expect(posts).toHaveLength(1);
	expect(posts[0].get('targetMode')).toBe('subset');
	expect(posts[0].getAll('studentIds')).toEqual([]);
	await expect(page).toHaveURL(/\/homework\/new$/);
	await expect(page.locator('#title')).toHaveJSProperty('value', title);
	await expect(page.locator('#content')).toHaveText('Kept content');
	await expect(page.getByRole('radio', { name: 'Specific students' })).toBeChecked();

	const { data } = await service
		.from('homework_assignments')
		.select('id')
		.eq('class_id', classId)
		.eq('title', title);
	expect(data).toEqual([]);
});

test('homework edit: a server error shows the toast and keeps the typed values', async ({
	page
}) => {
	const title = `E2E66T edit error ${tag}`;
	const { data: created, error } = await service
		.from('homework_assignments')
		.insert({
			class_id: classId,
			title,
			skill_area: 'dance',
			content: textDoc('Original content'),
			whole_class: true,
			created_by: teacher.id,
			recurrence_rule: { frequency: 'weekly' },
			recurrence_start_date: `${year}-06-07`,
			due_offset_days: 5
		})
		.select('id')
		.single();
	if (error || !created) throw new Error(`create assignment: ${error?.message}`);

	const edits = capturePosts(page, 'editAssignment');
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}/homework/${created.id}`);
	await page.getByText('Edit', { exact: true }).click();
	const titleField = page.locator(`#edit-title-${created.id}`);
	const contentField = await contentEditor(page, `edit-content-${created.id}`);
	const offsetField = page.locator(`#edit-offset-${created.id}`);
	await expect(titleField).toHaveJSProperty('value', title);
	await expect(contentField).toHaveText('Original content');
	await expect(offsetField).toHaveJSProperty('value', 5);

	// An offset over 365 is rejected by the server's editAssignment validation.
	const typedTitle = `${title} typed`;
	await titleField.locator('input').first().fill(typedTitle);
	await contentField.fill('Typed content');
	await offsetField.locator('input').first().fill('400');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(
		page.locator('ix-toast').getByText('Enter a valid due-date offset (0 to 365 days).')
	).toBeVisible();

	expect(edits).toHaveLength(1);
	expect(edits[0].get('title')).toBe(typedTitle);
	expect(JSON.parse(edits[0].get('content') ?? 'null')).toEqual(textDoc('Typed content'));
	expect(edits[0].get('dueOffsetDays')).toBe('400');
	await expect(titleField).toHaveJSProperty('value', typedTitle);
	await expect(contentField).toHaveText('Typed content');
	await expect(offsetField).toHaveJSProperty('value', 400);

	const { data: saved } = await service
		.from('homework_assignments')
		.select('title, content, due_offset_days')
		.eq('id', created.id)
		.single();
	expect(saved).toEqual({ title, content: textDoc('Original content'), due_offset_days: 5 });
});

test('skills: a server error shows the toast, keeps the level and notes, and Save works again', async ({
	page
}) => {
	const student = students[4];
	const posts: URLSearchParams[] = [];
	// The first save reaches the server with an invalid level, so it fails there.
	let breakLevel = true;
	await page.route(/\?\/setSkillStatus/, async (route) => {
		const body = new URLSearchParams(route.request().postData() ?? '');
		posts.push(new URLSearchParams(body));
		if (breakLevel) {
			body.set('level', 'bogus');
			return route.continue({ postData: body.toString() });
		}
		return route.continue();
	});
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}`);

	await page.locator(`button.student-toggle[data-student-id="${student.id}"]`).click();
	const form = page.locator(`#skills-panel-${student.id} form[data-skill-area="dance"]`);
	await choose(page, `level-${student.id}-dance`, 'learning');
	const notes = page.locator(`#notes-${student.id}-dance`);
	await notes.fill('Needs practice');
	await form.getByRole('button', { name: 'Save' }).click();
	await expect(page.locator('ix-toast').getByText('Choose a valid level.')).toBeVisible();

	expect(posts).toHaveLength(1);
	await expect(page.locator(`#level-${student.id}-dance`)).toHaveValue('learning');
	await expect(notes).toHaveValue('Needs practice');
	const { data: none } = await service
		.from('skill_status_history')
		.select('id')
		.eq('class_id', classId)
		.eq('student_id', student.id);
	expect(none).toEqual([]);

	// Save again, unchanged: it goes through.
	breakLevel = false;
	await form.getByRole('button', { name: 'Save' }).click();
	await expect(page.locator('ix-toast').getByText('Status saved.')).toBeVisible();
	expect(posts).toHaveLength(2);
	expect(posts[1].get('level')).toBe('learning');
	expect(posts[1].get('notes')).toBe('Needs practice');
	await expect(
		page.locator(`button.student-toggle[data-student-id="${student.id}"]`)
	).toContainText('Dance: Learning');
	const { data: saved } = await service
		.from('skill_status_history')
		.select('skill_area, level, notes')
		.eq('class_id', classId)
		.eq('student_id', student.id);
	expect(saved).toEqual([{ skill_area: 'dance', level: 'learning', notes: 'Needs practice' }]);
});

test('homework edit: unsaved edits survive marking a student done on the same page', async ({
	page
}) => {
	// The one-off assignment created above, for students 2 and 3.
	const { data: assignment } = await service
		.from('homework_assignments')
		.select('id, title')
		.eq('class_id', classId)
		.eq('title', `E2E66T once ${tag}`)
		.single();
	expect(assignment).not.toBeNull();
	const id = assignment!.id;

	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}/homework/${id}`);
	await page.getByText('Edit', { exact: true }).click();
	const titleField = page.locator(`#edit-title-${id}`);
	const contentField = await contentEditor(page, `edit-content-${id}`);
	await expect(titleField).toHaveJSProperty('value', assignment!.title);
	await expect(contentField).toHaveText('Practise the song');
	await titleField.locator('input').first().fill('Unsaved title');
	await contentField.fill('Unsaved content');

	await page.getByText('Student status', { exact: true }).first().click();
	// #91: marking done cannot be undone, so it asks first; Cancel posts nothing.
	const markDone = page.getByRole('button', { name: `Mark done for ${students[2].name}` });
	const modal = page.locator('ix-modal');
	await markDone.click();
	await expect(modal).toContainText(students[2].name);
	await modal.getByRole('button', { name: 'Cancel' }).click();
	await expect(modal).toHaveCount(0);
	await expect(markDone).toHaveCount(1);
	await markDone.click();
	await modal.getByRole('button', { name: 'Mark done' }).click();
	await expect(page.locator('ix-toast').getByText('Marked done.')).toBeVisible();
	await expect(page.getByRole('button', { name: `Mark done for ${students[2].name}` })).toHaveCount(
		0
	);

	await expect(titleField).toHaveJSProperty('value', 'Unsaved title');
	await expect(contentField).toHaveText('Unsaved content');
	const { data: stored } = await service
		.from('homework_assignments')
		.select('title')
		.eq('id', id)
		.single();
	expect(stored).toEqual({ title: assignment!.title });
});

test('homework create: content is required (#72)', async ({ page }) => {
	const title = `E2E66T no content ${tag}`;
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}/homework/new`);

	await page.locator('#title input').first().fill(title);
	await contentEditor(page, 'content');
	await page.locator('#dueDate input').first().fill(`${year}-04-03`);
	await expect(page.locator('#dueDate')).toHaveJSProperty('value', `${year}-04-03`);
	await page.getByRole('button', { name: 'Create assignment' }).click();
	await expect(page.locator('ix-toast').getByText('Content is required.')).toBeVisible();

	await expect(page).toHaveURL(/\/homework\/new$/);
	await expect(page.locator('#title')).toHaveJSProperty('value', title);
	const { data } = await service
		.from('homework_assignments')
		.select('id')
		.eq('class_id', classId)
		.eq('title', title);
	expect(data).toEqual([]);
});

test('homework create: Tibetan homework with formatting, longer than the old limit, shows in the Tibetan font for a student with an English interface (#73, #74)', async ({
	page,
	browser
}) => {
	const title = `བོད་ཡིག་སློབ་སྦྱོང་། ${tag}`;
	// Well over the old 2000-character limit.
	const long = 'ཀ་ཁ་ག་ང་། '.repeat(400).trim();
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}/homework/new`);

	await page.locator('#title input').first().fill(title);
	await pick(page, 'contentLanguage', 'bo');
	const area = await contentEditor(page, 'content');
	// The editing area follows the chosen language.
	await expect(page.locator('.rte-body')).toHaveAttribute('lang', 'bo');
	await area.click();
	const tool = (name: string) => page.getByRole('button', { name, exact: true });
	await tool('Bold').click();
	await expect(tool('Bold')).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.type('གལ་ཆེན།');
	await tool('Bold').click();
	await page.keyboard.press('Enter');
	await page.keyboard.insertText(long);
	await page.keyboard.press('Enter');
	await tool('Bullet list').click();
	await page.keyboard.type('དང་པོ།');
	await page.keyboard.press('Enter');
	await page.keyboard.type('གཉིས་པ།');
	await page.locator('#dueDate input').first().fill(`${year}-04-04`);
	await expect(page.locator('#dueDate')).toHaveJSProperty('value', `${year}-04-04`);

	await page.getByRole('button', { name: 'Create assignment' }).click();
	await page.waitForURL(/\/homework(\?|$)/);

	const { data: saved } = await service
		.from('homework_assignments')
		.select('id, content, content_language')
		.eq('class_id', classId)
		.eq('title', title)
		.single();
	const item = (text: string) => ({
		type: 'listItem',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
	});
	expect(saved).toMatchObject({
		content_language: 'bo',
		content: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'གལ་ཆེན།', marks: [{ type: 'bold' }] }]
				},
				{ type: 'paragraph', content: [{ type: 'text', text: long }] },
				{ type: 'bulletList', content: [item('དང་པོ།'), item('གཉིས་པ།')] }
			]
		}
	});

	// Teacher's list: the title carries the homework's language.
	await expect(
		page.locator('.homework-row-title span[lang="bo"]', { hasText: title })
	).toBeVisible();

	// A student of the class, in a fresh session with the English interface.
	const { data: instance } = await service
		.from('homework_instances')
		.select('id')
		.eq('assignment_id', saved!.id)
		.single();
	const context = await browser.newContext();
	try {
		const studentPage = await context.newPage();
		await signIn(studentPage, students[5].user);
		await open(studentPage, `/student/homework/${instance!.id}`);

		await expect(studentPage.locator('html')).toHaveAttribute('lang', 'en');
		const heading = studentPage.locator('h1 span[lang="bo"]');
		await expect(heading).toHaveText(title);
		await expect(heading).toHaveCSS('font-family', /Atisha/);

		const content = studentPage.locator('.rich-text');
		await expect(content).toHaveAttribute('lang', 'bo');
		await expect(content).toHaveCSS('font-family', /Atisha/);
		await expect(content.locator('p strong')).toHaveText('གལ་ཆེན།');
		await expect(content.locator('p').nth(1)).toHaveText(long);
		await expect(content.locator('ul > li')).toHaveText(['དང་པོ།', 'གཉིས་པ།']);
		// The page around it keeps the interface's font.
		await expect(studentPage.getByTestId('homework-meta')).not.toHaveCSS('font-family', /Atisha/);
		// ...but Tibetan characters anywhere still get Atisha, 1.36x (#78, #85): the
		// face is also registered under iX's family name.
		const faces = await studentPage.evaluate(async () => {
			await document.fonts.load("16px 'Siemens Sans'", 'བོད');
			return [...document.fonts]
				.filter((face) => face.status === 'loaded')
				.map((face) => `${face.family.replace(/["']/g, '')} ${face.sizeAdjust}`);
		});
		expect(faces).toEqual(expect.arrayContaining(['Atisha 136%', 'Siemens Sans 136%']));
	} finally {
		await context.close();
	}
});

test('class members: Reset PIN shows the new PIN once; the student signs in with it, not with the old one (#88)', async ({
	page,
	browser
}) => {
	// A student no other test uses, signed in on their own device.
	const student = students[STUDENT_COUNT - 1];
	const username = student.user.email.split('@')[0];
	const context = await browser.newContext();
	try {
		const studentPage = await context.newPage();
		await signIn(studentPage, student.user);

		const posts = capturePosts(page, 'resetPin');
		await signIn(page, teacher);
		await open(page, `/teacher/classes/${classId}`);
		const row = page.locator('.member-list li').filter({ hasText: student.name });

		// Cancelling the confirmation sends nothing.
		await row.getByRole('button', { name: 'Reset PIN' }).click();
		const dialog = page.locator('ix-modal');
		await expect(dialog).toContainText(`Give ${student.name} a new PIN?`);
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toHaveCount(0);
		expect(posts).toHaveLength(0);

		await row.getByRole('button', { name: 'Reset PIN' }).click();
		await page.locator('ix-modal').getByRole('button', { name: 'Reset PIN' }).click();

		// Shown once, with the username, each with its copy button.
		const bar = page.locator('ix-message-bar.pin-credential');
		await expect(bar).toContainText(`New PIN for ${student.name}`);
		await expect(bar).toBeInViewport();
		const fields = bar.locator('.copy-field');
		await expect(fields.nth(0)).toContainText('Username');
		await expect(fields.nth(0).locator('.credential')).toHaveText(username);
		await expect(fields.nth(1)).toContainText('PIN');
		const pin = (await fields.nth(1).locator('.credential').textContent()) ?? '';
		expect(pin).toMatch(/^\d{6}$/);
		await expect(bar.getByRole('button', { name: 'Copy PIN' })).toBeVisible();
		expect(posts).toHaveLength(1);
		expect(posts[0].get('studentId')).toBe(student.id);
		expect(page.url()).not.toContain(pin);
		await expect(page.locator('ix-toast')).toHaveCount(0);

		// Gone after a reload: it is not stored anywhere.
		await open(page, `/teacher/classes/${classId}`);
		await expect(page.locator('ix-message-bar.pin-credential')).toHaveCount(0);
		await expect(page.locator('body')).not.toContainText(pin);

		// The student's open session has ended.
		await studentPage.goto('/student');
		await expect(studentPage).toHaveURL(/\/login/);

		// The old PIN no longer works; the new one does.
		const login = async (password: string) => {
			await studentPage.goto('/login');
			await studentPage.locator('main > [data-ui="new"][data-hydrated]').waitFor();
			await studentPage.waitForLoadState('networkidle');
			await studentPage.locator('#email').fill(username);
			await studentPage.locator('#password').fill(password);
			await studentPage.getByRole('button', { name: 'Sign in' }).click();
		};
		await login(student.user.password);
		await expect(studentPage.getByText('Invalid email or password.')).toBeVisible();
		await expect(studentPage).toHaveURL(/\/login/);
		await login(pin);
		await expect(studentPage).not.toHaveURL(/\/login/);
		await studentPage.goto('/account');
		await expect(studentPage.locator('#username')).toHaveJSProperty('value', username);
	} finally {
		await context.close();
	}
});
