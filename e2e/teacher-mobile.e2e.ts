import { createClient } from '@supabase/supabase-js';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Database } from '../src/lib/supabase/database.types';
import { berlinToday, env, fixtureTeam, service, signIn, type TestUser } from './fixtures';

/**
 * Mobile-first redesign, story 7 (teacher class pages): the teacher
 * dashboard, the class page (session picker, attendance, upcoming leave,
 * skills) and a student's badges on the new component system. One test
 * per row of the story's I/O matrix at 375px (phone) and 820px (iPad
 * portrait), the dashboard also at 1440px, the tours at all three, plus
 * the fit check (no sideways scroll, ≥44px targets, no cut labels) in en,
 * de and bo.
 * Story 7b adds the class's homework list (its own block at the end).
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
let parentId: string | undefined;
const userIds: string[] = [];
const createdDays: string[] = [];
const team = fixtureTeam(tag);

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'teacher' | 'student' | 'parent', key: string) {
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
 * page's new-UI root is at least 44×44px; no link, button, row or select
 * label is cut (its text overflows nowhere).
 */
async function expectFits(page: Page) {
	const result = await page.evaluate(() => {
		const doc = document.documentElement;
		const root = document.querySelector('main > [data-ui="new"]')!;
		const shown = (selector: string) =>
			[...root.querySelectorAll<HTMLElement>(selector)].filter(
				(el) => el.getClientRects().length > 0
			);
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
	});
	expect(result.scrollWidth).toBeLessThanOrEqual(result.width);
	expect(result.small).toEqual([]);
	expect(result.cut).toEqual([]);
}

const toast = (page: Page, text: string | RegExp) =>
	page.locator('ix-toast').getByText(text).first();
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
				const tomorrow = page.locator('ix-toast').filter({
					hasText: 'Weekly homework created. Students will see it from tomorrow morning.'
				});
				await expect(tomorrow).toBeVisible();
				await expect(tomorrow).toHaveCount(1);
				await expect(page).toHaveURL(new RegExp(`${listPath()}$`));

				await arrive('?created=weekly&visible=someday');
				await expect(
					page
						.locator('ix-toast')
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
