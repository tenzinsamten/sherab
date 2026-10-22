import { createClient } from '@supabase/supabase-js';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Database } from '../src/lib/supabase/database.types';
import { currentSchoolYear, formatSchoolYear } from '../src/lib/school-year';
import {
	berlinToday,
	env,
	fixtureTeam,
	postedFields,
	service,
	signIn,
	type TestUser
} from './fixtures';

/**
 * Mobile-first redesign, story 7 (teacher class pages): the teacher
 * dashboard, the class page (session picker, attendance, upcoming leave,
 * skills) and a student's badges on the new component system. One test
 * per row of the story's I/O matrix at 375px (phone) and 820px (iPad
 * portrait), the dashboard also at 1440px, the tours at all three, plus
 * the fit check (no sideways scroll, ≥44px targets, no cut labels) in en,
 * de and bo.
 * Story 7b adds the class's homework list, story 7c the homework create
 * and review pages, story 8 the syllabus pages and the class members
 * (their own blocks at the end).
 *
 * Its own fixture: a teacher of class A (eight approved students, one
 * parent of students 0 and 1) and class B (student 0, no session); a
 * second teacher without a class. Class A has sessions today and a week
 * ago (both markable) and in a week (upcoming). Student 0 is sick today,
 * student 1 on leave next week; student 4 was present a week ago.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const STUDENT_COUNT = 8;

const VIEWPORTS = [
	{ name: 'phone', width: 375, height: 740 },
	{ name: 'tablet', width: 820, height: 1180 }
] as const;
const DESKTOP = { name: 'desktop', width: 1440, height: 900 } as const;

function plusDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}
const today = berlinToday();
const lastWeek = plusDays(today, -7);
const nextWeek = plusDays(today, 7);

const names = { a: `TM class A ${tag}`, b: `TM class B ${tag}` };
const classes = {} as Record<'a' | 'b', { id: string; code: string }>;
/** Session ids of class A by day. */
const sessions: Record<string, string> = {};
const students: { id: string; name: string }[] = [];

let teacher: TestUser;
let loneTeacher: TestUser;
let admin: TestUser;
let parentId: string | undefined;
const userIds: string[] = [];
const createdDays: string[] = [];
const team = fixtureTeam(tag);

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'admin' | 'teacher' | 'student' | 'parent', key: string) {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-tm-${key}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

async function enroll(studentId: string, classId: string) {
	const enrolled = check(
		await service
			.from('class_enrollments')
			.select('class_id')
			.eq('student_id', studentId)
			.eq('class_id', classId),
		'read enrollment'
	);
	if (!enrolled?.length) {
		check(
			await service.from('class_enrollments').insert({ student_id: studentId, class_id: classId }),
			'enroll'
		);
	}
}

async function cleanup() {
	const problems: string[] = [];
	// Students before the classes, the parent last (a parent with children
	// cannot be deleted).
	const ids = userIds.splice(0).reverse();
	const parentIndex = parentId ? ids.indexOf(parentId) : -1;
	if (parentIndex !== -1) ids.push(...ids.splice(parentIndex, 1));
	for (const id of ids) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	const classIds = Object.values(classes).map((c) => c.id);
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
	test.setTimeout(120_000);
	try {
		teacher = await createUser('teacher', 'teacher');
		loneTeacher = await createUser('teacher', 'lone');
		admin = await createUser('admin', 'admin');
		for (const key of ['a', 'b'] as const) {
			const code = `M${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
			const row = check(
				await service
					.from('classes')
					.insert({
						name: names[key],
						code,
						badge_subject: 'language',
						default_start_time: '10:00',
						default_duration_minutes: 60,
						// A schedule in the past: the class only has the sessions made here.
						schedule_starts_on: '2000-01-02',
						schedule_ends_on: '2000-01-02'
					})
					.select('id')
					.single(),
				`create class ${key}`
			);
			classes[key] = { id: row.id, code };
			check(
				await service.from('class_teachers').insert({ class_id: row.id, teacher_id: teacher.id }),
				`assign teacher ${key}`
			);
		}

		for (let i = 0; i < STUDENT_COUNT; i += 1) {
			const name = `TM Student ${i} ${tag}`;
			const user = await createUser('student', `s${i}`);
			check(
				await service
					.from('profiles')
					.update({
						class_id: classes.a.id,
						status: 'approved',
						registration_name: name,
						display_name: name,
						team_id: await team.id()
					})
					.eq('id', user.id),
				`approve student ${i}`
			);
			await enroll(user.id, classes.a.id);
			students.push({ id: user.id, name });
		}
		await enroll(students[0].id, classes.b.id);

		const days = [lastWeek, today, nextWeek];
		const existing = check(
			await service.from('class_days').select('day').in('day', days),
			'read class days'
		);
		const had = new Set((existing ?? []).map((d) => d.day));
		createdDays.push(...days.filter((d) => !had.has(d)));
		for (const day of days) {
			check(
				await service.rpc('attendance_backfill_session', { p_class_id: classes.a.id, p_day: day }),
				`session on ${day}`
			);
		}
		const rows = check(
			await service
				.from('class_sessions_effective')
				.select('id, day')
				.eq('class_id', classes.a.id)
				.in('day', days),
			'read sessions'
		);
		for (const row of rows ?? []) sessions[row.day!] = row.id!;
		if (Object.keys(sessions).length !== 3) {
			throw new Error(`expected 3 sessions, got ${Object.keys(sessions).length}`);
		}

		// Student 4 was present a week ago (the picker loads that mark).
		check(
			await service.from('attendance_records').insert({
				student_id: students[4].id,
				class_id: classes.a.id,
				class_session_id: sessions[lastWeek],
				present: true,
				recorded_by: teacher.id
			}),
			'seed mark'
		);

		// The parent of students 0 and 1: sick today, on leave next week.
		const parent = await createUser('parent', 'parent');
		parentId = parent.id;
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);
		check(
			await service
				.from('profiles')
				.update({ parent_id: parent.id })
				.in('id', [students[0].id, students[1].id]),
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
				{ class_session_id: sessions[today], student_id: students[0].id, answer: 'sick' },
				{ class_session_id: sessions[nextWeek], student_id: students[1].id, answer: 'on_leave' }
			]),
			'add leave answers'
		);
		await asParent.auth.signOut();
	} catch (error) {
		await cleanup().catch(() => undefined);
		throw error;
	}
});

test.afterAll(async () => {
	await cleanup();
});

/** The migrated page's root marks itself hydrated (its controls work from then on). */
async function ready(page: Page) {
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

async function openPage(page: Page, path: string) {
	await page.goto(path);
	await ready(page);
}

/** A signed-in page at a viewport (a context of its own). */
async function teacherPage(browser: Browser, width: number, height: number, who = teacher) {
	const context = await browser.newContext({ viewport: { width, height } });
	const page = await context.newPage();
	await signIn(page, who);
	await ready(page);
	return page;
}

/**
 * No sideways scroll; every visible button, link and attendance row in the
 * page's new-UI root (or in each root `rootSelector` matches) is at least 44×44px; no link, button, row or select
 * label is cut (its text overflows nowhere).
 */
async function expectFits(page: Page, rootSelector = 'main > [data-ui="new"]') {
	const result = await page.evaluate((rootSelector) => {
		const doc = document.documentElement;
		const roots = [...document.querySelectorAll(rootSelector)];
		if (roots.length === 0) throw new Error(`no ${rootSelector}`);
		const shown = (selector: string) =>
			roots
				.flatMap((root) => [...root.querySelectorAll<HTMLElement>(selector)])
				.filter((el) => el.getClientRects().length > 0);
		const label = (el: HTMLElement) => el.textContent?.trim() || el.getAttribute('aria-label');
		const small = shown(
			'button, [data-slot="button"], [data-slot="breadcrumb-link"], a, .attendance-row'
		)
			.map((el) => ({ el, box: el.getBoundingClientRect() }))
			.filter(({ box }) => box.width < 43.5 || box.height < 43.5)
			.map(({ el, box }) => `${label(el)}: ${Math.round(box.width)}×${Math.round(box.height)}`);
		const cut = shown('a, button, [data-slot="button"], .attendance-row, select')
			.filter((el) => el.scrollWidth > el.clientWidth + 1)
			.map((el) => `${label(el)}: ${el.scrollWidth} > ${el.clientWidth}`);
		return { scrollWidth: doc.scrollWidth, width: doc.clientWidth, small, cut };
	}, rootSelector);
	expect(result.scrollWidth).toBeLessThanOrEqual(result.width);
	expect(result.small).toEqual([]);
	expect(result.cut).toEqual([]);
}

const toast = (page: Page, text: string | RegExp) =>
	page.locator('[data-sonner-toast]').getByText(text).first();
const classPath = (key: 'a' | 'b' = 'a') => `/teacher/classes/${classes[key].id}`;
const row = (page: Page, student: { id: string }) =>
	page.locator(`.attendance-row[data-student-id="${student.id}"]`);
const box = (page: Page, student: { id: string }) =>
	row(page, student).locator('input[type="checkbox"]');
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save attendance' });
const toggle = (page: Page, student: { id: string }) =>
	page.locator(`button.student-toggle[data-student-id="${student.id}"]`);

async function currentMark(sessionId: string, studentId: string) {
	const rows = check(
		await service
			.from('attendance_current')
			.select('present')
			.eq('class_session_id', sessionId)
			.eq('student_id', studentId),
		'read mark'
	);
	return rows?.[0]?.present ?? null;
}

async function skillRows(studentId: string) {
	return (
		check(
			await service
				.from('skill_status_history')
				.select('skill_area, level, notes')
				.eq('class_id', classes.a.id)
				.eq('student_id', studentId),
			'read skills'
		) ?? []
	);
}

for (const viewport of [...VIEWPORTS, DESKTOP]) {
	const wide = viewport.width >= 768;
	test(`dashboard (${viewport.name}): tiles, class cards with code and open link, one column / a grid`, async ({
		browser
	}) => {
		const page = await teacherPage(browser, viewport.width, viewport.height);
		try {
			await expect(page).toHaveURL(/\/teacher$/);
			await expect(page.getByTestId('dashboard-tiles').locator('li')).toHaveCount(6);
			const cards = page.getByTestId('class-cards').locator('[data-tour="teacher-class-card"]');
			await expect(cards).toHaveCount(2);
			const a = cards.filter({ hasText: names.a });
			await expect(a.locator('[data-tour="teacher-class-code"]')).toContainText(classes.a.code);
			const [first, second] = await Promise.all([
				cards.nth(0).boundingBox(),
				cards.nth(1).boundingBox()
			]);
			if (wide) expect(Math.round(second!.y)).toBe(Math.round(first!.y));
			else expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
			for (const target of ['teacher-class-card', 'teacher-class-code', 'teacher-class-open']) {
				await expect(page.locator(`[data-tour="${target}"]`).first()).toBeVisible();
			}
			await expectFits(page);

			await a.getByRole('link', { name: 'View roster' }).click();
			await expect(page).toHaveURL(new RegExp(`${classPath()}$`));
			await ready(page);
			await expect(page.getByRole('heading', { level: 1, name: names.a })).toBeVisible();
		} finally {
			await page.context().close();
		}
	});
}

test('dashboard without a class: the empty state', async ({ browser }) => {
	const page = await teacherPage(browser, 375, 740, loneTeacher);
	try {
		await expect(page.getByTestId('empty-state')).toContainText(
			"You haven't been assigned to any classes yet."
		);
		await expect(page.getByTestId('class-cards')).toHaveCount(0);
		await expectFits(page);
	} finally {
		await page.context().close();
	}
});

for (const viewport of VIEWPORTS) {
	const wide = viewport.width >= 768;
	// Students each viewport marks on its own.
	let [tick, failing, unsaved, skilled] = [] as { id: string; name: string }[];

	test.describe(`class page at ${viewport.width}px`, () => {
		// After the fixture's beforeAll has made the students.
		test.beforeAll(() => {
			[tick, failing, unsaved, skilled] = (wide ? [3, 5, 7, 6] : [2, 5, 6, 7]).map(
				(i) => students[i]
			);
		});

		test(`pick a session (${viewport.name}): its saved marks and leave load; no session, the hint`, async ({
			browser
		}) => {
			const page = await teacherPage(browser, viewport.width, viewport.height);
			try {
				await openPage(page, classPath());
				const select = page.locator('#sessionId');
				// Newest first: today.
				await expect(select).toHaveValue(sessions[today]);
				await expect(box(page, students[4])).not.toBeChecked();
				await expect(row(page, students[0]).getByTestId('leave-badge')).toHaveText('Sick');

				await select.selectOption(sessions[lastWeek]);
				await expect(box(page, students[4])).toBeChecked();
				await expect(row(page, students[0]).getByTestId('leave-badge')).toHaveCount(0);
				await expect(select.locator('option:checked')).toHaveText(`${lastWeek} · 10:00 · marked`);
				await expectFits(page);

				// Class B has no session to mark.
				await openPage(page, classPath('b'));
				await expect(page.locator('#sessionId')).toHaveCount(0);
				await expect(page.getByText('No session to mark yet.')).toBeVisible();
				await expect(page.getByRole('button', { name: 'Save attendance' })).toBeDisabled();
			} finally {
				await page.context().close();
			}
		});

		test(`mark attendance (${viewport.name}): a row is one tap, save reachable, toast and marks kept; a failed save keeps the ticks`, async ({
			browser
		}) => {
			const page = await teacherPage(browser, viewport.width, viewport.height);
			try {
				await openPage(page, classPath());
				await expect(page.locator('#sessionId')).toHaveValue(sessions[today]);

				// One-handed: the whole row toggles, and it is a big target.
				const target = row(page, tick);
				const rowBox = (await target.boundingBox())!;
				expect(rowBox.height).toBeGreaterThanOrEqual(43.5);
				await target.getByText(tick.name).click();
				await expect(box(page, tick)).toBeChecked();
				await target.getByText(tick.name).click();
				await expect(box(page, tick)).not.toBeChecked();
				await target.click();
				await expect(box(page, tick)).toBeChecked();

				// The save button is on screen with the list in view, above the
				// bottom bar, and needs no sideways scroll.
				await row(page, students[0]).evaluate((el) => el.scrollIntoView({ block: 'center' }));
				const save = (await saveButton(page).boundingBox())!;
				expect(save.height).toBeGreaterThanOrEqual(43.5);
				expect(save.x).toBeGreaterThanOrEqual(0);
				expect(save.x + save.width).toBeLessThanOrEqual(viewport.width);
				expect(save.y).toBeGreaterThanOrEqual(0);
				const bar = await page.getByRole('navigation', { name: 'Main menu' }).boundingBox();
				expect(save.y + save.height).toBeLessThanOrEqual(bar ? bar.y + 1 : viewport.height);

				await saveButton(page).click();
				await expect(toast(page, `Attendance recorded for ${today}.`)).toBeVisible();
				await expect.poll(() => currentMark(sessions[today], tick.id)).toBe(true);
				await expect(saveButton(page)).toBeEnabled();
				await expect(box(page, tick)).toBeChecked();
				await expect(page.locator(`#sessionId option[value="${sessions[today]}"]`)).toHaveText(
					`${today} · 10:00 · marked`
				);

				// A save the server refuses: the toast, and the tick stays.
				await page.route(/\?\/markAttendance/, (route) => {
					const body = new URLSearchParams(route.request().postData() ?? '');
					body.set('sessionId', crypto.randomUUID());
					return route.continue({ postData: body.toString() });
				});
				await row(page, failing).click();
				await expect(box(page, failing)).toBeChecked();
				await saveButton(page).click();
				await expect(toast(page, "This session can't be marked")).toBeVisible();
				await expect(saveButton(page)).toBeEnabled();
				await expect(box(page, failing)).toBeChecked();
				await expect(box(page, tick)).toBeChecked();
				// Absent since the first save (a save marks every student), not present.
				expect(await currentMark(sessions[today], failing.id)).toBe(false);
				await page.unroute(/\?\/markAttendance/);
				// Unticked again: nothing for the next viewport to find.
				await row(page, failing).click();
				await expect(box(page, failing)).not.toBeChecked();
			} finally {
				await page.context().close();
			}
		});

		test(`unsaved ticks (${viewport.name}): kept when a skill save reloads the page`, async ({
			browser
		}) => {
			const page = await teacherPage(browser, viewport.width, viewport.height);
			try {
				await openPage(page, classPath());
				await row(page, unsaved).click();
				await expect(box(page, unsaved)).toBeChecked();

				const area = wide ? 'song' : 'language';
				await toggle(page, students[1]).click();
				const form = page.locator(
					`#skills-panel-${students[1].id} form[data-skill-area="${area}"]`
				);
				await form.getByLabel(wide ? 'Song' : 'Language').selectOption('learning');
				await form.getByRole('button', { name: 'Save' }).click();
				await expect(toast(page, 'Status saved.')).toBeVisible();
				await expect(toggle(page, students[1])).toContainText(
					`${wide ? 'Song' : 'Language'}: Learning`
				);
				await expect(box(page, unsaved)).toBeChecked();
				expect(await currentMark(sessions[today], unsaved.id)).not.toBe(true);
			} finally {
				await page.context().close();
			}
		});

		test(`student on leave (${viewport.name}): the badge in the row, the upcoming leave listed`, async ({
			browser
		}) => {
			const page = await teacherPage(browser, viewport.width, viewport.height);
			try {
				await openPage(page, classPath());
				const badge = row(page, students[0]).getByTestId('leave-badge');
				await expect(badge).toHaveText('Sick');
				// Inside the row's box.
				const [rowBox, badgeBox] = await Promise.all([
					row(page, students[0]).boundingBox(),
					badge.boundingBox()
				]);
				expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);
				expect(badgeBox!.y).toBeGreaterThanOrEqual(rowBox!.y);
				// The checkbox is named by the student alone, described by the leave.
				await expect(box(page, students[0])).toHaveAccessibleName(students[0].name);
				await expect(box(page, students[0])).toHaveAccessibleDescription(
					'Leave answer for this session: Sick'
				);

				const upcoming = page.getByRole('region', { name: 'Upcoming leave' });
				const entry = upcoming
					.getByTestId('upcoming-leave-entry')
					.filter({ hasText: students[1].name });
				await expect(entry).toContainText('On leave');
				// Today's session is still upcoming (leave is answered before it starts).
				await expect(
					upcoming.getByTestId('upcoming-leave-entry').filter({ hasText: students[0].name })
				).toContainText('Sick');
				await expect(upcoming.getByTestId('upcoming-leave-entry')).toHaveCount(2);
			} finally {
				await page.context().close();
			}
		});

		test(`skill level (${viewport.name}): empty level refused under the field, a save posts, toasts and empties the form`, async ({
			browser
		}) => {
			const page = await teacherPage(browser, viewport.width, viewport.height);
			const area = wide ? 'dance' : 'language';
			const label = wide ? 'Dance' : 'Language';
			try {
				await openPage(page, classPath());
				await toggle(page, skilled).click();
				await expect(toggle(page, skilled)).toHaveAttribute('aria-expanded', 'true');
				const form = page.locator(`#skills-panel-${skilled.id} form[data-skill-area="${area}"]`);
				const level = form.getByLabel(label);
				const notes = form.getByLabel('Notes (optional)');
				await expect(notes).toHaveAccessibleDescription("Visible to the student's parent");

				await form.getByRole('button', { name: 'Save' }).click();
				const error = page.locator(`#level-${skilled.id}-${area}-error`);
				await expect(error).toHaveText('Choose a valid level.');
				await expect(level).toHaveAttribute('aria-invalid', 'true');
				await expect(level).toHaveAttribute(
					'aria-describedby',
					`level-${skilled.id}-${area}-error`
				);
				await expect(level).toBeFocused();
				const [fieldBox, errorBox] = await Promise.all([level.boundingBox(), error.boundingBox()]);
				expect(errorBox!.y).toBeGreaterThanOrEqual(fieldBox!.y + fieldBox!.height - 1);
				expect(await skillRows(skilled.id)).toEqual([]);

				await level.selectOption('confident');
				await expect(level).not.toHaveAttribute('aria-invalid');
				await expect(error).toHaveCount(0);
				await notes.fill(`Notes ${viewport.name}`);
				await form.getByRole('button', { name: 'Save' }).click();
				await expect(toast(page, 'Status saved.')).toBeVisible();
				await expect(toggle(page, skilled)).toContainText(`${label}: Confident`);
				await expect(level).toHaveValue('');
				await expect(level).toBeFocused();
				await expect(notes).toHaveValue('');
				await expect(page.locator(`#skills-panel-${skilled.id}`)).toContainText(
					`Notes ${viewport.name}`
				);
				expect(await skillRows(skilled.id)).toContainEqual({
					skill_area: area,
					level: 'confident',
					notes: `Notes ${viewport.name}`
				});
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`badges page (${viewport.name}): opened from the skill row, in the new root`, async ({
			browser
		}) => {
			const page = await teacherPage(browser, viewport.width, viewport.height);
			try {
				await openPage(page, classPath());
				await toggle(page, students[2]).click();
				await page.getByRole('link', { name: `Badges of ${students[2].name}` }).click();
				await expect(page).toHaveURL(
					new RegExp(`${classPath()}/students/${students[2].id}/badges$`)
				);
				await ready(page);
				const root = page.locator('main > [data-ui="new"]');
				await expect(
					root.getByRole('heading', { level: 1, name: `Badges of ${students[2].name}` })
				).toBeVisible();
				await expect(root.locator('li[data-badge]').first()).toBeVisible();
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});
	});
}

/** A browser a person uses: tours start by themselves in it. */
async function personContext(
	browser: Browser,
	viewport: { width: number; height: number }
): Promise<BrowserContext> {
	const context = await browser.newContext({ viewport });
	await context.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
	});
	return context;
}

/**
 * Walks a started tour: each step highlights its target, settled on screen
 * at this viewport, then Next; Done at the end.
 */
async function walkTour(
	page: Page,
	viewport: { width: number; height: number },
	targets: string[]
) {
	const popover = page.locator('.driver-popover');
	const highlighted = page.locator('.driver-active-element');
	for (const [index, target] of targets.entries()) {
		if (index > 0) await popover.getByRole('button', { name: 'Next' }).click();
		await expect(highlighted).toHaveAttribute('data-tour', target);
		await expect(popover).toContainText(`${index + 1} of ${targets.length}`);
		// The target settles on screen after the page has scrolled to it.
		await expect(async () => {
			const b = await highlighted.boundingBox();
			expect(b).not.toBeNull();
			expect(b!.width).toBeGreaterThan(0);
			expect(b!.x).toBeGreaterThanOrEqual(0);
			expect(b!.y).toBeGreaterThanOrEqual(0);
			expect(b!.x + b!.width).toBeLessThanOrEqual(viewport.width);
			expect(b!.y + b!.height).toBeLessThanOrEqual(viewport.height);
		}).toPass({ timeout: 5000 });
	}
	await popover.getByRole('button', { name: 'Done' }).click();
	await expect(popover).toHaveCount(0);
}

for (const viewport of [...VIEWPORTS, DESKTOP]) {
	test(`tours at ${viewport.width}px: every step of the dashboard and class tours is on screen`, async ({
		browser
	}) => {
		check(
			await service.from('profiles').update({ tours_seen: [] }).eq('id', teacher.id),
			'reset tours'
		);
		const context = await personContext(browser, viewport);
		const page = await context.newPage();
		const popover = page.locator('.driver-popover');
		try {
			await signIn(page, teacher);
			await expect(page).toHaveURL(/\/teacher$/);
			await expect(popover).toBeVisible();
			await walkTour(page, viewport, [
				'teacher-class-card',
				'teacher-class-code',
				'teacher-class-open'
			]);

			await page.goto(classPath());
			await expect(popover).toBeVisible();
			await walkTour(page, viewport, [
				'class-session',
				'class-attendance-save',
				'class-skills',
				'class-skill-student',
				'class-homework'
			]);
		} finally {
			await context.close();
		}
	});
}

for (const locale of ['en', 'de', 'bo']) {
	test(`every teacher class page at 375px in ${locale}: no sideways scroll, ≥44px targets, no cut labels`, async ({
		browser
	}) => {
		const page = await teacherPage(browser, 375, 740);
		try {
			await page
				.context()
				.addCookies([{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }]);
			const paths = [
				'/teacher',
				classPath(),
				classPath('b'),
				`${classPath()}/students/${students[0].id}/badges`
			];
			for (const path of paths) {
				await openPage(page, path);
				await expect(page.locator('html')).toHaveAttribute('lang', locale);
				await expectFits(page);
			}
			// A skill row open: its fields and buttons fit too.
			await openPage(page, classPath());
			await toggle(page, students[0]).click();
			await expect(page.locator(`#skills-panel-${students[0].id}`)).toBeVisible();
			await expectFits(page);
		} finally {
			await page.context().close();
		}
	});
}

/*
 * Story 7b: the class's homework list. Class B gets 12 open one-off
 * homeworks (the newest overdue, one titled in Tibetan, one long), a weekly
 * one and two archived ones (overdue before archiving), so Open has two
 * pages; class A has none (the empty texts).
 */
test.describe('homework list', () => {
	const hw = {
		overdue: `TM hw overdue ${tag}`,
		weekly: `TM hw weekly ${tag}`,
		bo: `ཁ་ཏོན། ${tag}`,
		long: `TM hw Hausaufgabenwiederholungsübungsblatt mit sehr langem Titel ${tag}`,
		archived: [`TM hw archived 1 ${tag}`, `TM hw archived 2 ${tag}`]
	};
	const listPath = (key: 'a' | 'b' = 'b') => `${classPath(key)}/homework`;
	const rows = (page: Page) => page.getByTestId('homework-row');
	const rowFor = (page: Page, title: string) => rows(page).filter({ hasText: title });
	const filterLink = (page: Page, name: RegExp) =>
		page.getByRole('navigation', { name: 'Show' }).getByRole('link', { name });

	async function oneOff(
		title: string,
		due: string,
		opts: { archived?: boolean; language?: 'en' | 'bo' } = {}
	) {
		const classId = classes.b.id;
		const assignment = check(
			await service
				.from('homework_assignments')
				.insert({
					class_id: classId,
					title,
					skill_area: 'language',
					whole_class: false,
					created_by: teacher.id,
					content_language: opts.language ?? 'en'
				})
				.select('id')
				.single(),
			`create homework ${title}`
		).id;
		const instance = check(
			await service
				.from('homework_instances')
				.insert({
					assignment_id: assignment,
					class_id: classId,
					period_start: due,
					due_date: due,
					archived_at: opts.archived ? new Date().toISOString() : null
				})
				.select('id')
				.single(),
			`create instance ${title}`
		).id;
		check(
			await service.from('homework_status_history').insert({
				instance_id: instance,
				class_id: classId,
				student_id: students[0].id,
				status: 'assigned',
				recorded_by: teacher.id
			}),
			`assign ${title}`
		);
	}

	test.beforeAll(async () => {
		test.setTimeout(120_000);
		// Oldest first (the list is newest first): the archived ones, the
		// fillers (page 2), then the rows page 1 checks.
		for (const title of hw.archived) await oneOff(title, lastWeek, { archived: true });
		for (let i = 0; i < 8; i += 1) await oneOff(`TM hw filler ${i} ${tag}`, nextWeek);
		await oneOff(hw.long, nextWeek);
		await oneOff(hw.bo, nextWeek, { language: 'bo' });
		check(
			await service.from('homework_assignments').insert({
				class_id: classes.b.id,
				title: hw.weekly,
				skill_area: 'song',
				whole_class: true,
				created_by: teacher.id,
				recurrence_rule: { frequency: 'weekly' },
				recurrence_start_date: today,
				due_offset_days: 3
			}),
			'create weekly homework'
		);
		await oneOff(`TM hw open 11 ${tag}`, nextWeek);
		await oneOff(hw.overdue, lastWeek);
	});

	for (const viewport of [...VIEWPORTS, DESKTOP]) {
		test(`list (${viewport.name}): stacked rows, badges, meta, a row opens the homework`, async ({
			browser
		}) => {
			const page = await teacherPage(browser, viewport.width, viewport.height);
			try {
				await openPage(page, listPath());
				await expect(page.getByRole('heading', { level: 1, name: 'Homework' })).toBeVisible();
				await expect(filterLink(page, /^Open \(13\)$/)).toHaveAttribute('aria-current', 'page');
				await expect(rows(page)).toHaveCount(10);

				const [first, second] = await Promise.all([
					rows(page).nth(0).boundingBox(),
					rows(page).nth(1).boundingBox()
				]);
				expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height - 1);
				const link = (await rows(page).nth(0).getByRole('link').boundingBox())!;
				expect(link.height).toBeGreaterThanOrEqual(43.5);

				const overdue = rowFor(page, hw.overdue);
				await expect(overdue.getByText('Overdue', { exact: true })).toBeVisible();
				await expect(overdue).toContainText(`Language · Due ${lastWeek} · Done 0 / 1`);
				const weekly = rowFor(page, hw.weekly);
				await expect(weekly.getByText('Weekly', { exact: true })).toBeVisible();
				await expect(weekly.getByText('Overdue', { exact: true })).toHaveCount(0);
				await expect(
					page
						.getByTestId('homework-row-title')
						.and(page.locator('[lang="bo"]'))
						.filter({ hasText: hw.bo })
				).toBeVisible();
				await expect(rowFor(page, hw.long)).toBeVisible();
				for (const target of ['homework-create', 'homework-filter', 'homework-row']) {
					await expect(page.locator(`[data-tour="${target}"]`).first()).toBeVisible();
				}
				await expect(page.locator('[data-tour="homework-row"]')).toHaveCount(1);
				const create = (await page.getByRole('link', { name: 'Create homework' }).boundingBox())!;
				expect(create.height).toBeGreaterThanOrEqual(43.5);
				// Full width on a phone, its own width on a desktop.
				const header = (await page.locator('main > [data-ui="new"] > header').boundingBox())!;
				if (viewport.width < 640) expect(create.width).toBeGreaterThanOrEqual(header.width - 1);
				if (viewport.width >= 1280) expect(create.width).toBeLessThan(header.width / 2);
				await expectFits(page);

				await overdue.getByRole('link').click();
				await expect(page).toHaveURL(new RegExp(`${listPath()}/[0-9a-f-]{36}$`));
			} finally {
				await page.context().close();
			}
		});
	}

	for (const viewport of VIEWPORTS) {
		test(`filters and pager (${viewport.name}): Archived, All, Next / Previous, the empty texts`, async ({
			browser
		}) => {
			const page = await teacherPage(browser, viewport.width, viewport.height);
			try {
				await openPage(page, listPath());
				// The pager: page 1 of 2, Previous a disabled button, Next a link.
				const pager = page.getByRole('navigation', { name: 'Page 1 of 2' });
				await expect(pager.getByRole('button', { name: 'Previous' })).toBeDisabled();
				await expect(pager.getByRole('link', { name: 'Previous' })).toHaveCount(0);
				const next = pager.getByRole('link', { name: 'Next' });
				expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
				await next.click();
				await expect(page).toHaveURL(new RegExp(`${listPath()}\\?page=2$`));
				await ready(page);
				await expect(rows(page)).toHaveCount(3);
				const pager2 = page.getByRole('navigation', { name: 'Page 2 of 2' });
				await expect(pager2.getByRole('button', { name: 'Next' })).toBeDisabled();
				await expectFits(page);
				await pager2.getByRole('link', { name: 'Previous' }).click();
				await expect(page).toHaveURL(new RegExp(`${listPath()}$`));
				await ready(page);

				await filterLink(page, /^Archived \(2\)$/).click();
				await expect(page).toHaveURL(new RegExp(`${listPath()}\\?filter=archived$`));
				await ready(page);
				await expect(filterLink(page, /^Archived \(2\)$/)).toHaveAttribute('aria-current', 'page');
				await expect(filterLink(page, /^Open \(13\)$/)).not.toHaveAttribute('aria-current');
				await expect(rows(page)).toHaveCount(2);
				for (const title of hw.archived) {
					const archived = rowFor(page, title);
					await expect(archived.getByText('Archived', { exact: true })).toBeVisible();
					// Archived wins over overdue.
					await expect(archived.getByText('Overdue', { exact: true })).toHaveCount(0);
				}
				// One page: no pager.
				await expect(page.getByRole('navigation', { name: /^Page / })).toHaveCount(0);
				await expectFits(page);

				await filterLink(page, /^All \(15\)$/).click();
				await expect(page).toHaveURL(new RegExp(`${listPath()}\\?filter=all$`));
				await ready(page);
				await expect(page.getByRole('navigation', { name: 'Page 1 of 2' })).toBeVisible();
				await page
					.getByRole('navigation', { name: 'Page 1 of 2' })
					.getByRole('link', { name: 'Next' })
					.click();
				await expect(page).toHaveURL(new RegExp(`${listPath()}\\?filter=all&page=2$`));

				// Class A has no homework: each filter's empty text.
				for (const [query, text] of [
					['', 'No open homework.'],
					['?filter=archived', 'No archived homework.'],
					['?filter=all', 'No homework assigned yet.']
				] as const) {
					await openPage(page, `${listPath('a')}${query}`);
					await expect(page.getByText(text, { exact: true })).toBeVisible();
					await expect(rows(page)).toHaveCount(0);
				}
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`created toasts (${viewport.name}): once, and the address loses its parameters`, async ({
			browser
		}) => {
			const page = await teacherPage(browser, viewport.width, viewport.height);
			try {
				// Arrives as the create page's redirect does: an in-app navigation.
				const arrive = async (query: string) => {
					await openPage(page, listPath());
					await page.evaluate((href) => {
						const link = document.createElement('a');
						link.href = href;
						link.textContent = 'e2e arrive';
						document.body.append(link);
					}, `${listPath()}${query}`);
					await page.getByRole('link', { name: 'e2e arrive' }).click();
				};
				await arrive('?created=weekly&visible=tomorrow');
				const tomorrow = page.locator('[data-sonner-toast]').filter({
					hasText: 'Weekly homework created. Students will see it from tomorrow morning.'
				});
				await expect(tomorrow).toBeVisible();
				await expect(tomorrow).toHaveCount(1);
				await expect(page).toHaveURL(new RegExp(`${listPath()}$`));

				await arrive('?created=weekly&visible=someday');
				await expect(
					page
						.locator('[data-sonner-toast]')
						.filter({ hasText: 'Weekly homework created.' })
						.filter({ hasNotText: 'Students' })
				).toBeVisible();
				await expect(page).toHaveURL(new RegExp(`${listPath()}$`));
			} finally {
				await page.context().close();
			}
		});
	}

	for (const viewport of [...VIEWPORTS, DESKTOP]) {
		test(`homework tour at ${viewport.width}px: all three steps on screen`, async ({ browser }) => {
			check(
				await service
					.from('profiles')
					.update({ tours_seen: ['teacher-home', 'teacher-class'] })
					.eq('id', teacher.id),
				'reset tours'
			);
			const context = await personContext(browser, viewport);
			const page = await context.newPage();
			try {
				await signIn(page, teacher);
				await page.goto(listPath());
				await expect(page.locator('.driver-popover')).toBeVisible();
				await walkTour(page, viewport, ['homework-create', 'homework-filter', 'homework-row']);
			} finally {
				await context.close();
			}
		});
	}

	for (const locale of ['en', 'de', 'bo']) {
		test(`homework list at 375px in ${locale}: no sideways scroll, ≥44px targets, no cut labels`, async ({
			browser
		}) => {
			const page = await teacherPage(browser, 375, 740);
			try {
				await page
					.context()
					.addCookies([
						{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }
					]);
				for (const query of ['', '?page=2', '?filter=archived']) {
					await openPage(page, `${listPath()}${query}`);
					await expect(page.locator('html')).toHaveAttribute('lang', locale);
					await expectFits(page);
				}
				await openPage(page, `${listPath('a')}?filter=all`);
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});
	}
});

/*
 * Story 7c: homework create and review, in class A (after the list block,
 * which needs class A without homework). The create tests post through the
 * page; the review tests seed one copy due last week for students 0-2
 * (student 1 done, so student 0 is overdue) and a weekly series.
 */
test.describe('homework create and review', () => {
	const newPath = () => `${classPath()}/homework/new`;
	const dialog = (page: Page) => page.getByTestId('confirm-dialog');

	function capturePosts(page: Page, action: string): URLSearchParams[] {
		const posts: URLSearchParams[] = [];
		page.on('request', (r) => {
			if (r.method() === 'POST' && r.url().includes(`?/${action}`)) {
				posts.push(postedFields(r));
			}
		});
		return posts;
	}

	/** The content editor, once Tiptap has made it editable. */
	async function editor(page: Page, id = 'content') {
		const area = page.locator(`#${id}`);
		await expect(area).toHaveAttribute('contenteditable', 'true');
		return area;
	}

	/** A date as the English interface writes it in a sentence. */
	const longDate = (date: string) =>
		new Intl.DateTimeFormat('en', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(`${date}T00:00:00Z`));

	/** A copy of a new homework, due last week, for students 0-2; student 1 done. */
	async function seedReview(title: string, opts: { weekly?: boolean } = {}) {
		const classId = classes.a.id;
		const assignment = check(
			await service
				.from('homework_assignments')
				.insert({
					class_id: classId,
					title,
					skill_area: 'song',
					content: {
						type: 'doc',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sing it' }] }]
					},
					whole_class: Boolean(opts.weekly),
					created_by: teacher.id,
					...(opts.weekly
						? {
								recurrence_rule: { frequency: 'weekly' },
								recurrence_start_date: lastWeek,
								due_offset_days: 3
							}
						: {})
				})
				.select('id')
				.single(),
			`create homework ${title}`
		).id;
		const instance = check(
			await service
				.from('homework_instances')
				.insert({
					assignment_id: assignment,
					class_id: classId,
					period_start: lastWeek,
					due_date: lastWeek
				})
				.select('id')
				.single(),
			`create instance ${title}`
		).id;
		for (const student of students.slice(0, 3)) {
			check(
				await service.from('homework_status_history').insert({
					instance_id: instance,
					class_id: classId,
					student_id: student.id,
					status: 'assigned',
					recorded_by: teacher.id
				}),
				`assign ${title}`
			);
		}
		check(
			await service.from('homework_status_history').insert({
				instance_id: instance,
				class_id: classId,
				student_id: students[1].id,
				status: 'done',
				recorded_by: teacher.id
			}),
			`done ${title}`
		);
		return { assignment, instance, path: `${classPath()}/homework/${assignment}` };
	}

	for (const viewport of VIEWPORTS) {
		test(`create one-off (${viewport.name}): fields fit, links post in order, two students`, async ({
			browser
		}) => {
			const title = `TM create once ${viewport.name} ${tag}`;
			const page = await teacherPage(browser, viewport.width, viewport.height);
			const created = capturePosts(page, 'createAssignment');
			try {
				await openPage(page, newPath());
				await expect(
					page.getByRole('heading', { level: 1, name: 'Create assignment' })
				).toBeVisible();
				for (const target of [
					'homework-language',
					'homework-schedule',
					'homework-due',
					'homework-target'
				]) {
					await expect(page.locator(`[data-tour="${target}"]`)).toBeVisible();
				}
				await expectFits(page);

				await page.locator('#title').fill(title);
				await expect(page.locator('#skillArea')).toHaveValue('language');
				await page.locator('#skillArea').selectOption('dance');
				await expect(page.locator('#contentLanguage')).toHaveValue('en');
				await (await editor(page)).fill('Practise the steps');

				// Links: three rows, the middle URL left empty.
				const add = page.getByRole('button', { name: 'Add link' });
				await add.click();
				await add.click();
				const urls = page.locator('input[name="linkUrl"]');
				const labels = page.locator('input[name="linkLabel"]');
				await expect(urls).toHaveCount(3);
				await urls.nth(0).fill('https://a.example');
				await labels.nth(0).fill('Alphabet');
				await urls.nth(2).fill('https://c.example');
				await expectFits(page);

				await page.locator('#dueDate').fill(nextWeek);
				await page.getByRole('radio', { name: 'Specific students' }).check();
				await page.getByRole('checkbox', { name: students[2].name }).check();
				await page.getByRole('checkbox', { name: students[3].name }).check();
				const studentBox = (await page
					.locator('label')
					.filter({ has: page.getByRole('checkbox', { name: students[2].name }) })
					.boundingBox())!;
				expect(studentBox.height).toBeGreaterThanOrEqual(43.5);
				await expectFits(page);

				const submit = page.getByRole('button', { name: 'Create assignment' });
				expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
				await submit.click();
				await page.waitForURL(/\/homework(\?|$)/);
				await expect(toast(page, 'Homework created for 2 student(s).')).toBeVisible();

				expect(created).toHaveLength(1);
				const posted = created[0];
				expect(posted.get('title')).toBe(title);
				expect(posted.get('skillArea')).toBe('dance');
				expect(posted.get('contentLanguage')).toBe('en');
				expect(posted.get('mode')).toBe('once');
				expect(posted.get('dueDate')).toBe(nextWeek);
				expect(posted.get('targetMode')).toBe('subset');
				expect(posted.getAll('studentIds').sort()).toEqual([students[2].id, students[3].id].sort());
				expect(posted.getAll('linkUrl')).toEqual(['https://a.example', '', 'https://c.example']);
				expect(posted.getAll('linkLabel')).toEqual(['Alphabet', '', '']);
				expect(posted.has('startDate')).toBe(false);
				expect(posted.has('dueOffsetDays')).toBe(false);
			} finally {
				await page.context().close();
			}
		});

		test(`create weekly (${viewport.name}): the start-date note, a mode switch empties it`, async ({
			browser
		}) => {
			const title = `TM create weekly ${viewport.name} ${tag}`;
			const start = plusDays(today, 6);
			const page = await teacherPage(browser, viewport.width, viewport.height);
			const created = capturePosts(page, 'createAssignment');
			try {
				await openPage(page, newPath());
				await page.locator('#title').fill(title);
				await (await editor(page)).fill('Every week');
				await page.getByRole('radio', { name: 'Weekly, recurring' }).check();
				await expect(page.locator('#dueDate')).toHaveCount(0);
				await expect(page.locator('#dueOffsetDays')).toHaveValue('7');
				const note = page.locator('#startDate-note');
				await expect(note).toHaveText(
					'Students see the homework from the start date. If that is today or earlier, they see it as soon as you create it.'
				);
				await page.locator('#startDate').fill(start);
				const from = `Students will see this homework from ${longDate(start)}, not before.`;
				await expect(note).toHaveText(from);
				await expect(page.locator('#startDate')).toHaveAccessibleDescription(from);
				await expectFits(page);

				// One-off and back: the start date is empty again, and so is the note.
				await page.getByRole('radio', { name: 'One-off' }).check();
				await page.getByRole('radio', { name: 'Weekly, recurring' }).check();
				await expect(page.locator('#startDate')).toHaveValue('');
				await expect(note).toHaveText(/^Students see the homework from the start date\./);
				await page.locator('#startDate').fill(start);
				await expect(note).toHaveText(from);

				await page.getByRole('button', { name: 'Create assignment' }).click();
				await page.waitForURL(/\/homework(\?|$)/);
				await expect(
					toast(page, `Weekly homework created. Students will see it from ${longDate(start)}.`)
				).toBeVisible();
				expect(created).toHaveLength(1);
				expect(created[0].get('mode')).toBe('weekly');
				expect(created[0].get('startDate')).toBe(start);
				expect(created[0].get('dueOffsetDays')).toBe('7');
				expect(created[0].has('dueDate')).toBe(false);
			} finally {
				await page.context().close();
			}
		});
	}

	test('create: an empty subset shows the server error and keeps what was typed', async ({
		browser
	}) => {
		const title = `TM create empty ${tag}`;
		const page = await teacherPage(browser, 375, 740);
		try {
			await openPage(page, newPath());
			await page.locator('#title').fill(title);
			await page.locator('#skillArea').selectOption('song');
			await (await editor(page)).fill('Kept');
			await page.locator('input[name="linkUrl"]').first().fill('https://kept.example');
			await page.locator('#dueDate').fill(nextWeek);
			await page.getByRole('radio', { name: 'Specific students' }).check();
			await page.getByRole('button', { name: 'Create assignment' }).click();
			await expect(toast(page, 'No students to assign this to.')).toBeVisible();
			await expect(page).toHaveURL(/\/homework\/new$/);
			await expect(page.locator('#title')).toHaveValue(title);
			await expect(page.locator('#skillArea')).toHaveValue('song');
			await expect(page.locator('#content')).toHaveText('Kept');
			await expect(page.locator('input[name="linkUrl"]').first()).toHaveValue(
				'https://kept.example'
			);
			await expect(page.locator('#dueDate')).toHaveValue(nextWeek);
			await expect(page.getByRole('radio', { name: 'Specific students' })).toBeChecked();
		} finally {
			await page.context().close();
		}
	});

	test('links: removing the last row leaves one blank row; at 10 rows Add is gone', async ({
		browser
	}) => {
		const page = await teacherPage(browser, 375, 740);
		try {
			await openPage(page, newPath());
			const urls = page.locator('input[name="linkUrl"]');
			await urls.nth(0).fill('https://gone.example');
			await page.getByRole('button', { name: 'Remove link 1' }).click();
			await expect(urls).toHaveCount(1);
			await expect(urls.nth(0)).toHaveValue('');
			const add = page.getByRole('button', { name: 'Add link' });
			for (let i = 1; i < 10; i += 1) await add.click();
			await expect(urls).toHaveCount(10);
			await expect(add).toHaveCount(0);
		} finally {
			await page.context().close();
		}
	});

	for (const viewport of [...VIEWPORTS, DESKTOP]) {
		test(`review (${viewport.name}): cards below 80em, a table above, every column there`, async ({
			browser
		}) => {
			const { path } = await seedReview(`TM review ${viewport.name} ${tag}`);
			const page = await teacherPage(browser, viewport.width, viewport.height);
			try {
				await openPage(page, path);
				const copy = page.getByTestId('homework-instance');
				await expect(copy).toHaveCount(1);
				await expect(copy).toContainText(lastWeek);
				await expect(copy).toContainText('1 / 3');
				await expect(copy).toContainText('0 / 3');
				await expect(copy.getByText('Overdue', { exact: true }).first()).toBeVisible();
				const header = page.getByRole('columnheader', { name: 'Due' });
				if (viewport.width < 1280) {
					await expect(header).toBeHidden();
					// The column names sit in front of the values on a card.
					await expect(copy.getByText('Reviewed', { exact: true })).toBeVisible();
				} else {
					await expect(header).toBeVisible();
				}
				await page.getByText('Edit', { exact: true }).click();
				await copy.getByText('Student status', { exact: true }).click();
				await expect(page.getByTestId('homework-student')).toHaveCount(3);
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});
	}

	for (const viewport of VIEWPORTS) {
		test(`review actions (${viewport.name}): ask first, Cancel posts nothing, only the pressed button waits`, async ({
			browser
		}) => {
			const { path } = await seedReview(`TM actions ${viewport.name} ${tag}`);
			const page = await teacherPage(browser, viewport.width, viewport.height);
			const done = capturePosts(page, 'markDone');
			try {
				await openPage(page, path);
				await page.getByText('Student status', { exact: true }).click();
				const markDone = page.getByRole('button', { name: `Mark done for ${students[0].name}` });
				const other = page.getByRole('button', { name: `Mark done for ${students[2].name}` });

				await markDone.click();
				await expect(dialog(page)).toContainText(students[0].name);
				await dialog(page).getByRole('button', { name: 'Cancel' }).click();
				await expect(dialog(page)).toHaveCount(0);
				expect(done).toHaveLength(0);

				// Held at the network: the pressed button spins, the others wait.
				let release!: () => void;
				const held = new Promise<void>((resolve) => (release = resolve));
				await page.route(/\?\/markDone/, async (route) => {
					await held;
					await route.continue();
				});
				await markDone.click();
				await dialog(page).getByRole('button', { name: 'Mark done' }).click();
				await expect(markDone).toHaveAttribute('aria-busy', 'true');
				await expect(other).toBeDisabled();
				await expect(other).not.toHaveAttribute('aria-busy');
				release();
				await expect(toast(page, 'Marked done.')).toBeVisible();
				await expect(markDone).toHaveCount(0);
				expect(done).toHaveLength(1);
				expect(done[0].get('studentId')).toBe(students[0].id);
				await page.unroute(/\?\/markDone/);

				// Student 1 is done: Mark reviewed, then archive the copy (a red confirm).
				await page.getByRole('button', { name: `Mark reviewed for ${students[1].name}` }).click();
				await dialog(page).getByRole('button', { name: 'Mark reviewed' }).click();
				await expect(toast(page, 'Marked reviewed.')).toBeVisible();
				await page.getByRole('button', { name: 'Archive', exact: true }).click();
				await expect(dialog(page)).toContainText(`Archive the homework due ${lastWeek}?`);
				await dialog(page).getByRole('button', { name: 'Archive' }).click();
				await expect(toast(page, 'Assignment archived.')).toBeVisible();
				await expect(page.getByText('Archived', { exact: true }).first()).toBeVisible();
			} finally {
				await page.context().close();
			}
		});
	}

	test('end series with "archive copies" ticked: the archive question, then archiveCopies=on', async ({
		browser
	}) => {
		const { path } = await seedReview(`TM series ${tag}`, { weekly: true });
		const page = await teacherPage(browser, 375, 740);
		const ends = capturePosts(page, 'endSeries');
		try {
			await openPage(page, path);
			await page.getByText('Edit', { exact: true }).click();
			const tick = page.getByRole('checkbox', {
				name: 'When ending, also archive the homework students already have from this series'
			});
			await tick.check();
			await expectFits(page);
			await page.getByRole('button', { name: 'End series' }).click();
			await expect(dialog(page)).toContainText('End this series and archive its homework?');
			await dialog(page).getByRole('button', { name: 'End series' }).click();
			await expect(toast(page, 'Series ended and its homework archived.')).toBeVisible();
			expect(ends).toHaveLength(1);
			expect(ends[0].get('archiveCopies')).toBe('on');
		} finally {
			await page.context().close();
		}
	});

	test('review without copies: the empty text', async ({ browser }) => {
		const title = `TM no copies ${tag}`;
		const id = check(
			await service
				.from('homework_assignments')
				.insert({
					class_id: classes.a.id,
					title,
					skill_area: 'dance',
					whole_class: true,
					created_by: teacher.id,
					recurrence_rule: { frequency: 'weekly' },
					recurrence_start_date: nextWeek,
					due_offset_days: 3
				})
				.select('id')
				.single(),
			`create homework ${title}`
		).id;
		const page = await teacherPage(browser, 375, 740);
		try {
			await openPage(page, `${classPath()}/homework/${id}`);
			await expect(
				page.getByText(
					'No instances generated yet — the schedule creates the first one automatically.'
				)
			).toBeVisible();
			await expect(page.getByTestId('homework-instance')).toHaveCount(0);
			await expectFits(page);
		} finally {
			await page.context().close();
		}
	});

	test('end series when its copies cannot be archived: the warning toast', async ({ browser }) => {
		const { path } = await seedReview(`TM series fail ${tag}`, { weekly: true });
		const page = await teacherPage(browser, 375, 740);
		try {
			// The answer endSeries gives when archiving the copies fails
			// (page.server.ts; its server side is in page.server.spec.ts):
			// { success, action, archived: false, archiveFailed: true }, devalue-encoded.
			await page.route(/\?\/endSeries/, (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						type: 'success',
						status: 200,
						data: JSON.stringify([
							{ success: 1, action: 2, archived: 3, archiveFailed: 4 },
							true,
							'endSeries',
							false,
							true
						])
					})
				})
			);
			await openPage(page, path);
			await page.getByText('Edit', { exact: true }).click();
			await page.getByRole('button', { name: 'End series' }).click();
			await dialog(page).getByRole('button', { name: 'End series' }).click();
			await expect(
				toast(
					page,
					'The series was ended, but its homework could not be archived. Archive it below.'
				)
			).toBeVisible();
		} finally {
			await page.context().close();
		}
	});

	for (const viewport of [...VIEWPORTS, DESKTOP]) {
		test(`new-homework tour at ${viewport.width}px: all four steps on screen`, async ({
			browser
		}) => {
			check(
				await service
					.from('profiles')
					.update({ tours_seen: ['teacher-home', 'teacher-class', 'teacher-homework'] })
					.eq('id', teacher.id),
				'reset tours'
			);
			const context = await personContext(browser, viewport);
			const page = await context.newPage();
			try {
				await signIn(page, teacher);
				await page.goto(newPath());
				await expect(page.locator('.driver-popover')).toBeVisible();
				await walkTour(page, viewport, [
					'homework-language',
					'homework-schedule',
					'homework-due',
					'homework-target'
				]);
			} finally {
				await context.close();
			}
		});
	}

	for (const locale of ['en', 'de', 'bo']) {
		test(`homework create and review at 375px in ${locale}: no sideways scroll, ≥44px targets, no cut labels`, async ({
			browser
		}) => {
			const { path } = await seedReview(`TM fit ${locale} ${tag}`, { weekly: true });
			const page = await teacherPage(browser, 375, 740);
			try {
				await page
					.context()
					.addCookies([
						{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }
					]);
				await openPage(page, newPath());
				await expect(page.locator('html')).toHaveAttribute('lang', locale);
				await expectFits(page);
				await page.locator('input[name="mode"][value="weekly"]').check();
				await expectFits(page);
				await openPage(page, path);
				await page.locator('summary').first().click();
				await page.locator('[data-testid="homework-instance"] summary').click();
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});
	}
});

/**
 * Story 8: the syllabus pages (list and one syllabus, with sections and
 * files) and the class members on the new UI, on class B (student 0 only,
 * no syllabus). One test per matrix row at 375 and 820px, the admin hosts
 * at 1440px (on the new UI since story 9), and the fit check in en, de and bo.
 */
test.describe('syllabus and class members', () => {
	const BUCKET = 'syllabus-files';
	const MB = 1_048_576;
	const year = currentSchoolYear();
	const syllabusList = () => `${classPath('b')}/syllabus`;
	const dialog = (page: Page) => page.getByTestId('confirm-dialog');
	const confirmButton = (page: Page, name: string) =>
		dialog(page).getByRole('button', { name, exact: true });
	const titles = (page: Page) => page.getByTestId('section-title');
	const card = (page: Page, title: string) =>
		page
			.locator('section[data-section-id]')
			.filter({ has: page.getByText(title, { exact: true }) });
	const members = (page: Page) => page.getByTestId('member-list');
	const memberRow = (page: Page, student: { name: string }) =>
		members(page).locator('li').filter({ hasText: student.name });

	/** A file whose content starts like a PDF, `size` bytes long. */
	function pdf(name: string, size = 2048) {
		const buffer = Buffer.alloc(size);
		buffer.write('%PDF-1.7\n');
		return { name, mimeType: 'application/pdf', buffer };
	}

	function capturePosts(page: Page, action: string): URLSearchParams[] {
		const posts: URLSearchParams[] = [];
		page.on('request', (r) => {
			if (r.method() === 'POST' && r.url().endsWith(`?/${action}`)) {
				posts.push(new URLSearchParams(r.postData() ?? ''));
			}
		});
		return posts;
	}

	/** Every stored object of class B, then its syllabi (sections and file rows cascade). */
	async function clearSyllabi() {
		const folders = check(await service.storage.from(BUCKET).list(classes.b.id), 'list folders');
		for (const folder of folders ?? []) {
			const listed = check(
				await service.storage.from(BUCKET).list(`${classes.b.id}/${folder.name}`),
				'list objects'
			);
			const paths = (listed ?? []).map((o) => `${classes.b.id}/${folder.name}/${o.name}`);
			if (paths.length) await service.storage.from(BUCKET).remove(paths);
		}
		check(
			await service.from('class_syllabi').delete().eq('class_id', classes.b.id),
			'delete syllabi'
		);
	}

	/** A current-year syllabus for class B with one section holding one PDF. */
	async function seedSyllabus(sectionTitle: string, fileName = 'Lyrics and notes.pdf') {
		await clearSyllabi();
		const syllabusId = check(
			await service
				.from('class_syllabi')
				.insert({ class_id: classes.b.id, school_year: year })
				.select('id')
				.single(),
			'create syllabus'
		).id;
		const sectionId = check(
			await service
				.from('class_syllabus_sections')
				.insert({ syllabus_id: syllabusId, position: 1, title: sectionTitle })
				.select('id')
				.single(),
			'create section'
		).id;
		const path = `${classes.b.id}/${sectionId}/${crypto.randomUUID()}.pdf`;
		check(
			await service.storage
				.from(BUCKET)
				.upload(path, pdf('x').buffer, { contentType: 'application/pdf' }),
			'store object'
		);
		check(
			await service.from('class_syllabus_section_files').insert({
				section_id: sectionId,
				object_path: path,
				file_name: fileName,
				size_bytes: 2048
			}),
			'record file'
		);
		return `${syllabusList()}/${syllabusId}`;
	}

	test.afterAll(async () => {
		await clearSyllabi();
	});

	for (const viewport of VIEWPORTS) {
		test(`syllabus (${viewport.name}): add a syllabus, its sections and files, then delete it`, async ({
			browser
		}) => {
			test.setTimeout(120_000);
			await clearSyllabi();
			const page = await teacherPage(browser, viewport.width, viewport.height);
			const creates = capturePosts(page, 'create');
			const moves = capturePosts(page, 'moveSection');
			const uploads = capturePosts(page, 'uploadFile');
			const replaces = capturePosts(page, 'replaceFile');
			try {
				// Add syllabus: the current year preselected, lands on its page.
				await openPage(page, syllabusList());
				await expect(page.locator('#schoolYear')).toHaveValue(String(year));
				await expectFits(page);
				await page.getByRole('button', { name: 'Add syllabus' }).click();
				await page.waitForURL(/\/syllabus\/[0-9a-f-]{36}$/);
				await ready(page);
				expect(creates.map((p) => p.get('schoolYear'))).toEqual([String(year)]);
				await expect(page.getByRole('heading', { level: 1 })).toContainText(
					`Syllabus ${formatSchoolYear(year)}`
				);
				await expect(page.getByRole('heading', { level: 1 })).toContainText('Current');
				await expect(page.getByText('No sections yet.')).toBeVisible();
				await expectFits(page);

				// Sections: an empty title is refused under its field.
				const addField = page.locator('#section-title-new');
				await page.getByRole('button', { name: 'Add section' }).click();
				await expect(page.locator('#section-title-new-error')).toHaveText(
					'Enter a title of up to 200 characters.'
				);
				await expect(addField).toHaveAttribute('aria-invalid', 'true');
				await expect(titles(page)).toHaveCount(0);

				// Add opens its form and clears the add field; Save closes it.
				await addField.fill('Song 1');
				await page.getByRole('button', { name: 'Add section' }).click();
				await expect(toast(page, 'Section added.')).toBeVisible();
				const title = page.locator('form[action="?/updateSection"] input[name="title"]');
				await expect(title).toHaveValue('Song 1');
				await expect(addField).toHaveValue('');
				await expect(page.locator('#section-title-new-error')).toHaveCount(0);
				await expectFits(page);
				await page.getByRole('button', { name: 'Save section' }).click();
				await expect(toast(page, 'Section saved.')).toBeVisible();
				await expect(title).toHaveCount(0);
				await expect(titles(page)).toHaveText(['Song 1']);

				await addField.fill('Song 2');
				await page.getByRole('button', { name: 'Add section' }).click();
				await expect(title).toHaveValue('Song 2');
				await page.getByRole('button', { name: 'Cancel' }).click();
				await expect(titles(page)).toHaveText(['Song 1', 'Song 2']);

				// Edit opens the form; Cancel closes it unsaved.
				await card(page, 'Song 1').getByRole('button', { name: 'Edit section' }).click();
				await expect(title).toHaveValue('Song 1');
				await page.getByRole('button', { name: 'Cancel' }).click();
				await expect(title).toHaveCount(0);

				// Move posts its direction.
				await page.getByRole('button', { name: 'Move “Song 1” down', exact: true }).click();
				await expect(titles(page)).toHaveText(['Song 2', 'Song 1']);
				expect(moves.map((p) => p.get('direction'))).toEqual(['down']);

				// Files: upload lists it; a long name wraps without sideways scroll.
				const song1 = card(page, 'Song 1');
				const fileInput = song1.locator('form[action="?/uploadFile"] input[type="file"]');
				const longName = `${'Tashi_delek_'.repeat(8)}.pdf`;
				await fileInput.setInputFiles(pdf(longName));
				await song1.getByRole('button', { name: 'Upload' }).click();
				await expect(toast(page, 'File uploaded.')).toBeVisible();
				await expect(song1.getByTestId('file-name')).toHaveText([longName]);
				await expectFits(page);

				// Over 1 MB: refused before sending.
				await fileInput.setInputFiles(pdf('big.pdf', MB + 1));
				await song1.getByRole('button', { name: 'Upload' }).click();
				await expect(song1.getByRole('alert')).toHaveText(
					'The file is too large. A PDF can be up to 1.0 MB.'
				);
				expect(uploads).toHaveLength(1);

				// Replace posts when a file is chosen.
				await song1
					.locator('form[action="?/replaceFile"] input[type="file"]')
					.setInputFiles(pdf('Lyrics v2.pdf', 4096));
				await expect(toast(page, 'File replaced.')).toBeVisible();
				await expect(song1.getByTestId('file-name')).toHaveText(['Lyrics v2.pdf']);
				expect(replaces).toHaveLength(1);

				// Remove asks (red); Cancel keeps the file.
				const remove = song1.getByRole('button', { name: 'Remove “Lyrics v2.pdf”' });
				await remove.click();
				await expect(dialog(page)).toContainText('Remove the file “Lyrics v2.pdf”?');
				await expect(confirmButton(page, 'Remove')).toHaveClass(/text-destructive/);
				await dialog(page).getByRole('button', { name: 'Cancel' }).click();
				await expect(dialog(page)).toHaveCount(0);
				await expect(song1.getByTestId('file-name')).toHaveCount(1);
				await remove.click();
				await confirmButton(page, 'Remove').click();
				await expect(toast(page, 'File removed.')).toBeVisible();
				await expect(song1.getByTestId('file-name')).toHaveCount(0);

				// Delete section asks (red).
				await card(page, 'Song 2').getByRole('button', { name: 'Delete section' }).click();
				await expect(dialog(page)).toContainText('Delete the section “Song 2”?');
				await expect(confirmButton(page, 'Delete')).toHaveClass(/text-destructive/);
				await dialog(page).getByRole('button', { name: 'Cancel' }).click();
				await expect(titles(page)).toHaveText(['Song 2', 'Song 1']);
				await card(page, 'Song 2').getByRole('button', { name: 'Delete section' }).click();
				await confirmButton(page, 'Delete').click();
				await expect(toast(page, 'Section deleted.')).toBeVisible();
				await expect(titles(page)).toHaveText(['Song 1']);

				// Delete syllabus: Cancel does nothing; confirmed, the list shows the toast once.
				const deletes = capturePosts(page, 'delete');
				await page.getByRole('button', { name: 'Delete syllabus' }).click();
				await expect(dialog(page)).toContainText(
					`Delete the ${formatSchoolYear(year)} syllabus and all its sections?`
				);
				await expect(confirmButton(page, 'Delete')).toHaveClass(/text-destructive/);
				await dialog(page).getByRole('button', { name: 'Cancel' }).click();
				await expect(dialog(page)).toHaveCount(0);
				expect(deletes).toHaveLength(0);
				await page.getByRole('button', { name: 'Delete syllabus' }).click();
				await confirmButton(page, 'Delete').click();
				await expect(page).toHaveURL(new RegExp(`${syllabusList()}$`));
				await expect(toast(page, `Syllabus ${formatSchoolYear(year)} deleted.`)).toBeVisible();
				await expect(
					page
						.locator('[data-sonner-toast]')
						.getByText(`Syllabus ${formatSchoolYear(year)} deleted.`)
				).toHaveCount(1);
				expect(deletes).toHaveLength(1);
				await expect(page.getByTestId('syllabus-row')).toHaveCount(0);
			} finally {
				await page.context().close();
			}
		});

		test(`class members (${viewport.name}): enrol, remove and Reset PIN`, async ({ browser }) => {
			const student = viewport.name === 'phone' ? students[5] : students[6];
			const page = await teacherPage(browser, viewport.width, viewport.height);
			const enrolls = capturePosts(page, 'enroll');
			const unenrolls = capturePosts(page, 'unenroll');
			const pins = capturePosts(page, 'resetPin');
			try {
				await openPage(page, classPath('b'));
				await expect(memberRow(page, students[0])).toHaveCount(1);
				await expectFits(page);

				// Nothing picked: the error under the select, nothing posted.
				const select = page.locator('#enroll-student');
				await page.getByRole('button', { name: 'Add to class' }).click();
				await expect(page.locator('#enroll-student-error')).toHaveText('Choose a student to add.');
				await expect(select).toHaveAttribute('aria-invalid', 'true');
				expect(enrolls).toHaveLength(0);

				// Picked and added: toast, the select cleared and focused.
				await select.selectOption(student.id);
				await expect(page.locator('#enroll-student-error')).toHaveCount(0);
				await page.getByRole('button', { name: 'Add to class' }).click();
				await expect(toast(page, 'Student added to the class.')).toBeVisible();
				expect(enrolls.map((p) => p.get('studentId'))).toEqual([student.id]);
				await expect(memberRow(page, student)).toHaveCount(1);
				await expect(select).toHaveValue('');
				await expect(select).toBeFocused();
				await expectFits(page);

				// Remove asks (red); Cancel sends nothing.
				const removeButton = memberRow(page, student).getByRole('button', {
					name: 'Remove from class'
				});
				await removeButton.click();
				await expect(dialog(page)).toContainText(`Remove ${student.name} from ${names.b}?`);
				await expect(confirmButton(page, 'Remove from class')).toHaveClass(/text-destructive/);
				await dialog(page).getByRole('button', { name: 'Cancel' }).click();
				await expect(dialog(page)).toHaveCount(0);
				expect(unenrolls).toHaveLength(0);
				await removeButton.click();
				await confirmButton(page, 'Remove from class').click();
				await expect(toast(page, 'Student removed from the class.')).toBeVisible();
				expect(unenrolls.map((p) => p.get('studentId'))).toEqual([student.id]);
				await expect(memberRow(page, student)).toHaveCount(0);

				// Reset PIN: Cancel sends nothing; confirmed, the PIN box scrolls into view.
				const pinButton = memberRow(page, students[0]).getByRole('button', { name: 'Reset PIN' });
				await pinButton.click();
				await expect(dialog(page)).toContainText(`Give ${students[0].name} a new PIN?`);
				await dialog(page).getByRole('button', { name: 'Cancel' }).click();
				await expect(dialog(page)).toHaveCount(0);
				expect(pins).toHaveLength(0);
				await page.mouse.wheel(0, 2000);
				await pinButton.click();
				await confirmButton(page, 'Reset PIN').click();
				const box = page.getByTestId('pin-credential');
				await expect(box).toContainText(`New PIN for ${students[0].name}`);
				await expect(box).toBeInViewport();
				await expect(box.getByRole('button', { name: 'Copy PIN' })).toBeVisible();
				expect(pins.map((p) => p.get('studentId'))).toEqual([students[0].id]);
				await expectFits(page);
			} finally {
				await page.context().close();
				// A failure between enrol and remove must not leave the student in class B.
				check(
					await service
						.from('class_enrollments')
						.delete()
						.eq('class_id', classes.b.id)
						.eq('student_id', student.id),
					'unenroll student'
				);
			}
		});
	}

	test('admin hosts (desktop): sections, a file and enrolment work as before', async ({
		browser
	}) => {
		test.setTimeout(120_000);
		const teacherPath = await seedSyllabus('Admin song');
		const adminPath = teacherPath.replace(/^\/teacher\//, '/admin/');
		const context = await browser.newContext({ viewport: DESKTOP });
		const page = await context.newPage();
		try {
			await signIn(page, admin);
			await openPage(page, adminPath);
			await expect(titles(page)).toHaveText(['Admin song']);

			// Add, save and delete a section.
			await page.locator('#section-title-new').fill('Admin extra');
			await page.getByRole('button', { name: 'Add section' }).click();
			await expect(toast(page, 'Section added.')).toBeVisible();
			await expect(page.locator('#section-title-new')).toHaveValue('');
			await page.getByRole('button', { name: 'Save section' }).click();
			await expect(toast(page, 'Section saved.')).toBeVisible();
			await expect(titles(page)).toHaveText(['Admin song', 'Admin extra']);
			await card(page, 'Admin extra').getByRole('button', { name: 'Delete section' }).click();
			await confirmButton(page, 'Delete').click();
			await expect(toast(page, 'Section deleted.')).toBeVisible();
			await expect(titles(page)).toHaveText(['Admin song']);

			// Upload a file.
			const section = card(page, 'Admin song');
			await section
				.locator('form[action="?/uploadFile"] input[type="file"]')
				.setInputFiles(pdf('Admin.pdf'));
			await section.getByRole('button', { name: 'Upload' }).click();
			await expect(toast(page, 'File uploaded.')).toBeVisible();
			await expect(section.getByTestId('file-name')).toHaveText([
				'Lyrics and notes.pdf',
				'Admin.pdf'
			]);

			// Enrol a student and remove them again.
			await openPage(page, `/admin/classes/${classes.b.id}/students`);
			await page.locator('#enroll-student').selectOption(students[7].id);
			await page.getByRole('button', { name: 'Add to class' }).click();
			await expect(toast(page, 'Student added to the class.')).toBeVisible();
			await expect(memberRow(page, students[7])).toHaveCount(1);
			await memberRow(page, students[7]).getByRole('button', { name: 'Remove from class' }).click();
			await confirmButton(page, 'Remove from class').click();
			await expect(toast(page, 'Student removed from the class.')).toBeVisible();
			await expect(memberRow(page, students[7])).toHaveCount(0);
		} finally {
			await context.close();
			await clearSyllabi();
		}
	});

	for (const locale of ['en', 'de', 'bo']) {
		test(`syllabus and members at 375px in ${locale}: no sideways scroll, ≥44px targets, no cut labels`, async ({
			browser
		}) => {
			const path = await seedSyllabus(
				// Words, then a long run without spaces (the heading breaks it anywhere).
				`Fit ${locale} Lied Lied ${'Liederbuch'.repeat(10)}`
			);
			const page = await teacherPage(browser, 375, 740);
			try {
				await page
					.context()
					.addCookies([
						{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }
					]);
				await openPage(page, syllabusList());
				await expect(page.locator('html')).toHaveAttribute('lang', locale);
				await expectFits(page);
				await openPage(page, path);
				await expectFits(page);
				await page.getByTestId('section-edit').click();
				await expect(page.locator('form[action="?/updateSection"]')).toBeVisible();
				await expectFits(page);
				await openPage(page, classPath('b'));
				await expectFits(page);
			} finally {
				await page.context().close();
				await clearSyllabi();
			}
		});
	}
	for (const viewport of VIEWPORTS) {
		test(`admin hosts (${viewport.name}): the syllabus list and page and the members fit`, async ({
			browser
		}) => {
			const longName = `${'Tashi_delek_'.repeat(10)}.pdf`;
			const teacherPath = await seedSyllabus(`Admin ${'Liederbuch'.repeat(10)}`, longName);
			const adminPath = teacherPath.replace(/^\/teacher\//, '/admin/');
			const context = await browser.newContext({ viewport });
			const page = await context.newPage();
			try {
				await signIn(page, admin);
				await openPage(page, `/admin/classes/${classes.b.id}/syllabus`);
				await expect(page.getByTestId('syllabus-row')).toHaveCount(1);
				await expectFits(page);

				await openPage(page, adminPath);
				await expect(page.getByTestId('file-name')).toHaveText([longName]);
				await expectFits(page);
				await page.getByTestId('section-edit').click();
				await expect(page.locator('form[action="?/updateSection"]')).toBeVisible();
				await expectFits(page);

				await openPage(page, `/admin/classes/${classes.b.id}/students`);
				await expect(memberRow(page, students[0])).toHaveCount(1);
				await expectFits(page);
			} finally {
				await context.close();
				await clearSyllabi();
			}
		});
	}
});

/**
 * Story 9: the admin pages (dashboard, classes, teams, parents) on the new
 * UI. Rows are cards below 80em and a full table with the side nav from
 * 80em; every row action is reachable; the fit check
 * (no sideways scroll, ≥44px targets, no cut labels) at 375, 820 and
 * 1440px in en, de and bo. A class and a team without members
 * are made here, to be edited and deleted.
 */
test.describe('admin pages', () => {
	const ADMIN_PAGES = [
		'/admin',
		'/admin/classes',
		'/admin/teams',
		'/admin/parents',
		'/admin/teachers'
	];
	const dialog = (page: Page) => page.getByTestId('confirm-dialog');

	function capturePosts(page: Page, action: string): URLSearchParams[] {
		const posts: URLSearchParams[] = [];
		page.on('request', (r) => {
			if (r.method() === 'POST' && r.url().endsWith(`?/${action}`)) {
				posts.push(new URLSearchParams(r.postData() ?? ''));
			}
		});
		return posts;
	}

	async function makeClass(name: string) {
		return check(
			await service
				.from('classes')
				.insert({
					name,
					name_bo: `${name} bo`,
					code: `A${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
					badge_subject: 'dance'
				})
				.select('id')
				.single(),
			'create class'
		);
	}

	async function makeTeam(name: string) {
		return check(
			await service
				.from('teams')
				.insert({ name, name_bo: `${name} bo` })
				.select('id')
				.single(),
			'create team'
		);
	}

	for (const viewport of [...VIEWPORTS, DESKTOP]) {
		test(`admin pages at ${viewport.width}px: ${viewport === DESKTOP ? 'tables and side nav' : 'cards'}, everything fits`, async ({
			browser
		}) => {
			const page = await teacherPage(browser, viewport.width, viewport.height, admin);
			try {
				for (const path of ADMIN_PAGES) {
					await openPage(page, path);
					await expect(page.getByTestId('side-nav')).toBeVisible({
						visible: viewport === DESKTOP
					});
					if (path !== '/admin') {
						const head = page.locator('main thead').first();
						await expect(head).toBeVisible({ visible: viewport === DESKTOP });
					}
					await expectFits(page);
				}
			} finally {
				await page.context().close();
			}
		});
	}

	for (const locale of ['de', 'bo']) {
		for (const viewport of [...VIEWPORTS, DESKTOP]) {
			test(`admin pages at ${viewport.width}px in ${locale}: no sideways scroll, ≥44px targets, no cut labels`, async ({
				browser
			}) => {
				const page = await teacherPage(browser, viewport.width, viewport.height, admin);
				try {
					await page
						.context()
						.addCookies([
							{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }
						]);
					for (const path of ADMIN_PAGES) {
						await openPage(page, path);
						await expect(page.locator('html')).toHaveAttribute('lang', locale);
						if (path !== '/admin') {
							await expect(page.locator('main thead').first()).toBeVisible({
								visible: viewport === DESKTOP
							});
						}
						await expectFits(page);
					}
				} finally {
					await page.context().close();
				}
			});
		}
	}

	test('classes at 820px: a card keeps every action; edit, cancel, save, and delete in the red dialog', async ({
		browser
	}) => {
		const name = `TM admin class ${tag}`;
		const renamed = `TM admin class renamed ${tag}`;
		const cls = await makeClass(name);
		const page = await teacherPage(browser, 820, 1180, admin);
		const renames = capturePosts(page, 'rename');
		const deletes = capturePosts(page, 'delete');
		try {
			await openPage(page, '/admin/classes');
			const card = page.locator(`[data-testid="class-row"][data-class-id="${cls.id}"]`);
			await expect(card).toBeVisible();
			await expect(card.getByRole('button', { name: 'Edit class' })).toBeVisible();
			await expect(card.getByRole('button', { name: 'Delete' })).toBeVisible();
			await expect(card.getByRole('link', { name: '0 enrolled' })).toBeVisible();
			await expect(card.getByRole('button', { name: /^Copy/ })).toBeVisible();
			// A class with students has no Delete (class A has eight).
			const withStudents = page.locator(
				`[data-testid="class-row"][data-class-id="${classes.a.id}"]`
			);
			await expect(withStudents.getByRole('button', { name: 'Edit class' })).toBeVisible();
			await expect(withStudents.getByRole('button', { name: 'Delete' })).toHaveCount(0);

			// Cancel: nothing posted, the form closes.
			await card.getByRole('button', { name: 'Edit class' }).click();
			const form = page.locator('form[action="?/rename"]');
			await expect(form.locator('input[name="name"]')).toHaveValue(name);
			await expect(form.locator(`#edit-${cls.id}-subject`)).toHaveValue('dance');
			await form.getByRole('button', { name: 'Cancel' }).click();
			await expect(form).toHaveCount(0);
			expect(renames).toHaveLength(0);

			// No subject ("Not set"): the error is under the field, the form stays open.
			await card.getByRole('button', { name: 'Edit class' }).click();
			const subject = form.locator(`#edit-${cls.id}-subject`);
			await subject.selectOption('');
			await form.getByRole('button', { name: 'Save', exact: true }).click();
			const subjectError = form.locator(`#edit-${cls.id}-subject-error`);
			await expect(subjectError).toHaveText('Choose the badge subject.');
			await expect(subject).toHaveAttribute('aria-invalid', 'true');
			await expect(subject).toHaveAttribute('aria-describedby', `edit-${cls.id}-subject-error`);
			expect(renames).toHaveLength(1);

			// Save: the row shows the new name.
			await subject.selectOption('dance');
			await form.locator('input[name="name"]').fill(renamed);
			await expectFits(page);
			await form.getByRole('button', { name: 'Save', exact: true }).click();
			await expect(toast(page, `“${renamed}” saved.`)).toBeVisible();
			await expect(form).toHaveCount(0);
			await expect(card).toContainText(renamed);
			expect(renames).toHaveLength(2);

			// Delete: Cancel posts nothing; Delete (red) removes the row. The
			// question names the class as renamed above, not its old name.
			await card.getByRole('button', { name: 'Delete' }).click();
			await expect(dialog(page)).toContainText(`Delete class “${renamed}”?`);
			const confirmDelete = dialog(page).getByRole('button', { name: 'Delete', exact: true });
			await expect(confirmDelete).toHaveClass(/text-destructive/);
			await dialog(page).getByRole('button', { name: 'Cancel' }).click();
			await expect(dialog(page)).toHaveCount(0);
			expect(deletes).toHaveLength(0);
			await card.getByRole('button', { name: 'Delete' }).click();
			await confirmDelete.click();
			await expect(toast(page, `Class “${renamed}” deleted.`)).toBeVisible();
			await expect(card).toHaveCount(0);
			expect(deletes).toHaveLength(1);
			expect(deletes[0].get('classId')).toBe(cls.id);
		} finally {
			await page.context().close();
			await service.from('classes').delete().eq('id', cls.id);
		}
	});

	test('teachers at 820px: a card keeps every action; edit classes (cancel, save), then remove names the teacher', async ({
		browser
	}) => {
		const name = `TM admin teacher ${tag}`;
		const extra = await createUser('teacher', 'admin-teacher');
		check(
			await service.from('profiles').update({ display_name: name }).eq('id', extra.id).select('id'),
			'name teacher'
		);
		check(
			await service
				.from('class_teachers')
				.insert({ class_id: classes.a.id, teacher_id: extra.id })
				.select('class_id'),
			'assign teacher'
		);
		const page = await teacherPage(browser, 820, 1180, admin);
		const updates = capturePosts(page, 'updateClasses');
		const removes = capturePosts(page, 'remove');
		try {
			await openPage(page, '/admin/teachers');
			const card = page.locator(`[data-testid="teacher-row"][data-teacher-id="${extra.id}"]`);
			await expect(card).toBeVisible();
			await expect(page.locator('main thead').first()).toBeHidden();
			await expect(card).toContainText(name);
			await expect(card).toContainText(names.a);
			await expect(card.getByRole('button', { name: 'Edit classes' })).toBeVisible();
			await expect(card.getByRole('button', { name: 'Reset password' })).toBeVisible();
			await expect(card.getByRole('button', { name: 'Remove' })).toBeVisible();
			await expectFits(page);

			// Cancel: nothing posted, the form closes.
			const form = page.locator('form[action="?/updateClasses"]');
			const boxFor = (id: string) => form.locator(`input[type="checkbox"][value="${id}"]`);
			await card.getByRole('button', { name: 'Edit classes' }).click();
			await expect(form.getByText(`Classes for ${name}`)).toBeVisible();
			await expect(boxFor(classes.a.id)).toBeChecked();
			await expect(boxFor(classes.b.id)).not.toBeChecked();
			await boxFor(classes.b.id).check();
			await form.getByRole('button', { name: 'Cancel' }).click();
			await expect(form).toHaveCount(0);
			expect(updates).toHaveLength(0);

			// Save: the card shows both classes, the form closes.
			await card.getByRole('button', { name: 'Edit classes' }).click();
			await expect(boxFor(classes.b.id)).not.toBeChecked();
			await boxFor(classes.b.id).check();
			await expectFits(page);
			await form.getByRole('button', { name: 'Save classes' }).click();
			await expect(toast(page, `Classes updated for ${name}.`)).toBeVisible();
			await expect(form).toHaveCount(0);
			await expect(card).toContainText(names.b);
			expect(updates).toHaveLength(1);
			expect(updates[0].get('teacherId')).toBe(extra.id);
			expect(updates[0].getAll('classIds').sort()).toEqual([classes.a.id, classes.b.id].sort());

			// Reset password: the one-time password box scrolls into view.
			const resets = capturePosts(page, 'resetPassword');
			await card.getByRole('button', { name: 'Reset password' }).click();
			await dialog(page).getByRole('button', { name: 'Reset password', exact: true }).click();
			const outcome = page.getByTestId('teachers-outcome');
			await expect(outcome).toContainText(`New temporary password for ${extra.email}`);
			await expect(outcome).toBeInViewport();
			expect(resets).toHaveLength(1);
			expect(resets[0].get('teacherId')).toBe(extra.id);

			// Remove after another result: the question names this teacher and
			// posts this teacherId. Cancel posts nothing; Remove (red) removes the card.
			await card.getByRole('button', { name: 'Remove' }).click();
			await expect(dialog(page)).toContainText(`Remove ${name}?`);
			const confirmRemove = dialog(page).getByRole('button', { name: 'Remove', exact: true });
			await expect(confirmRemove).toHaveClass(/text-destructive/);
			await dialog(page).getByRole('button', { name: 'Cancel' }).click();
			await expect(dialog(page)).toHaveCount(0);
			expect(removes).toHaveLength(0);
			await card.getByRole('button', { name: 'Remove' }).click();
			await confirmRemove.click();
			await expect(toast(page, `${name} removed.`)).toBeVisible();
			await expect(card).toHaveCount(0);
			expect(removes).toHaveLength(1);
			expect(removes[0].get('teacherId')).toBe(extra.id);
		} finally {
			await page.context().close();
			// Removed here: cleanup() must not delete the login a second time.
			const { data: left } = await service.from('profiles').select('id').eq('id', extra.id);
			if (!left?.length) userIds.splice(userIds.indexOf(extra.id), 1);
		}
	});

	test('teams at 375px: create clears the form; a card keeps every action; rename and delete', async ({
		browser
	}) => {
		const name = `TM admin team ${tag}`;
		const created = `TM admin new team ${tag}`;
		const existing = await makeTeam(name);
		const page = await teacherPage(browser, 375, 740, admin);
		const renames = capturePosts(page, 'rename');
		const deletes = capturePosts(page, 'delete');
		try {
			await openPage(page, '/admin/teams');
			// Create: toast, the row appears, the fields are empty again.
			await page.locator('#name').fill(created);
			await page.locator('#name-bo').fill(`${created} bo`);
			await page.getByRole('button', { name: 'Create team' }).click();
			await expect(toast(page, `Team "${created}" created.`)).toBeVisible();
			await expect(page.getByTestId('team-row').filter({ hasText: created })).toHaveCount(1);
			await expect(page.locator('#name')).toHaveValue('');
			await expect(page.locator('#name-bo')).toHaveValue('');

			const card = page.locator(`[data-testid="team-row"][data-team-id="${existing.id}"]`);
			const link = card.getByRole('link', { name, exact: true });
			await expect(link).toHaveAttribute('title', `Students of team ${name}`);
			await expect(card.getByRole('button', { name: 'Edit names' })).toBeVisible();
			await expect(card.getByRole('button', { name: 'Delete' })).toBeVisible();
			await expectFits(page);
			// A team with members (the fixture's team) has no Delete.
			const withMembers = page.locator(
				`[data-testid="team-row"][data-team-id="${await team.id()}"]`
			);
			await expect(withMembers.getByRole('button', { name: 'Edit names' })).toBeVisible();
			await expect(withMembers.getByRole('button', { name: 'Delete' })).toHaveCount(0);

			// Cancel: nothing posted, the form closes.
			await card.getByRole('button', { name: 'Edit names' }).click();
			const form = page.locator('form[action="?/rename"]');
			await expect(form.locator('input[name="name"]')).toHaveValue(name);
			await form.getByRole('button', { name: 'Cancel' }).click();
			await expect(form).toHaveCount(0);
			expect(renames).toHaveLength(0);

			await card.getByRole('button', { name: 'Edit names' }).click();
			await form.locator('input[name="nameDe"]').fill(`${name} de`);
			await form.getByRole('button', { name: 'Save names' }).click();
			await expect(toast(page, `Names of “${name}” saved.`)).toBeVisible();
			await expect(form).toHaveCount(0);
			await expect(card.locator('[lang="de"]')).toHaveText(`${name} de`);
			expect(renames).toHaveLength(1);

			// Delete: Cancel posts nothing; Delete (red) removes the row.
			await card.getByRole('button', { name: 'Delete' }).click();
			const confirmDelete = dialog(page).getByRole('button', { name: 'Delete', exact: true });
			await expect(confirmDelete).toHaveClass(/text-destructive/);
			await dialog(page).getByRole('button', { name: 'Cancel' }).click();
			await expect(dialog(page)).toHaveCount(0);
			expect(deletes).toHaveLength(0);
			await expect(card).toHaveCount(1);
			await card.getByRole('button', { name: 'Delete' }).click();
			await confirmDelete.click();
			await expect(toast(page, `Team “${name}” deleted.`)).toBeVisible();
			await expect(card).toHaveCount(0);
			expect(deletes).toHaveLength(1);
			expect(deletes[0].get('teamId')).toBe(existing.id);
		} finally {
			await page.context().close();
			await service.from('teams').delete().in('name', [name, created]);
		}
	});
});
