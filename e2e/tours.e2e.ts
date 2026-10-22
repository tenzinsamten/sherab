import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
	berlinToday,
	fixtureTeam,
	helpSheet,
	openCalendar,
	openAccountMenu,
	openHelp,
	service,
	signIn,
	type TestUser
} from './fixtures';

/**
 * #101: guided page tours. A tour starts by itself the first time a teacher
 * or parent opens a key page, is remembered per account, runs again from
 * Help, and fits a phone.
 *
 * Tours never start by themselves in an automated browser
 * (`navigator.webdriver`), which is what keeps them out of every other e2e
 * test. Here the flag is switched off, except in the last test, which proves
 * the switch.
 *
 * Its own fixture: one class with a teacher, an approved student in it with
 * an approved parent, a session today (markable by the teacher) and one in
 * ten days (still open for the parent's answer), one homework, one
 * registration still waiting, and a second approved parent without a child.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const className = `E2E101 ${tag}`;
const studentName = `E2E101 Student ${tag}`;

let teacher: TestUser;
let parent: TestUser;
let student: TestUser;
/** A registration still waiting, for the Requests tour. */
let waiting: TestUser;
/** An approved parent with no child: nothing on /parent to point at. */
let childless: TestUser;
let classId: string;
/** Deletion order: the student first (a class with students cannot be deleted). */
const userIds: string[] = [];
const team = fixtureTeam(tag);
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
const sessionDays = [today, plusDays(today, 10)];

async function createUser(
	role: 'teacher' | 'student' | 'parent',
	key: string = role
): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-101-${key}-${tag}@${domain}`;
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
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	if (classId) {
		const { error } = await service.from('classes').delete().eq('id', classId);
		if (error) problems.push(`delete class: ${error.message}`);
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
		teacher = await createUser('teacher');
		parent = await createUser('parent');
		classId = check(
			await service
				.from('classes')
				.insert({
					name: className,
					code: `T${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
					default_start_time: '10:00',
					default_duration_minutes: 60,
					// A schedule in the past: the class only has the sessions made here.
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

		student = await createUser('student');
		check(
			await service
				.from('profiles')
				.update({
					class_id: classId,
					status: 'approved',
					registration_name: studentName,
					display_name: studentName,
					team_id: await team.id()
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
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);
		check(
			await service.from('profiles').update({ parent_id: parent.id }).eq('id', student.id),
			'link parent'
		);

		childless = await createUser('parent', 'childless');
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', childless.id),
			'approve the childless parent'
		);

		waiting = await createUser('student', 'waiting');
		check(
			await service
				.from('profiles')
				.update({
					class_id: classId,
					status: 'pending',
					registration_name: `E2E101 Waiting ${tag}`,
					parent_id: parent.id
				})
				.eq('id', waiting.id),
			'waiting registration'
		);

		const due = plusDays(today, 5);
		const assignment = check(
			await service
				.from('homework_assignments')
				.insert({
					class_id: classId,
					title: `E2E101 Homework ${tag}`,
					skill_area: 'language',
					whole_class: true,
					created_by: teacher.id
				})
				.select('id')
				.single(),
			'create homework'
		).id;
		check(
			await service
				.from('homework_instances')
				.insert({ assignment_id: assignment, class_id: classId, period_start: due, due_date: due }),
			'create homework instance'
		);

		const existing = check(
			await service.from('class_days').select('day').in('day', sessionDays),
			'read class days'
		);
		const had = new Set((existing ?? []).map((d) => d.day));
		createdDays.push(...sessionDays.filter((d) => !had.has(d)));
		for (const day of sessionDays) {
			check(
				await service.rpc('attendance_backfill_session', { p_class_id: classId, p_day: day }),
				`session on ${day}`
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

/** A browser a person uses: tours start by themselves in it. */
async function personContext(
	browser: Browser,
	viewport?: { width: number; height: number }
): Promise<BrowserContext> {
	const context = await browser.newContext(viewport ? { viewport } : {});
	await context.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
	});
	return context;
}

const popover = (page: Page) => page.locator('.driver-popover');
const highlighted = (page: Page) => page.locator('.driver-active-element');

async function toursSeen(userId: string): Promise<string[]> {
	return check(
		await service.from('profiles').select('tours_seen').eq('id', userId).single(),
		'read tours_seen'
	).tours_seen;
}

/** Long enough for a tour to have started by itself, had there been one to start. */
async function expectNoTour(page: Page) {
	// Every page marks its new-UI root hydrated once mounted.
	await page.waitForSelector('main > [data-ui="new"][data-hydrated]');
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(2500);
	await expect(popover(page)).toHaveCount(0);
}

const classPath = () => `/teacher/classes/${classId}`;

test('teacher: a tour starts on the first visit, runs to Done, and does not come back', async ({
	browser
}) => {
	const context = await personContext(browser);
	const page = await context.newPage();
	try {
		// Signing in lands on the Dashboard, whose tour starts first.
		await signIn(page, teacher);
		await expect(page).toHaveURL(/\/teacher$/);
		await expect(popover(page)).toBeVisible();
		await expect(highlighted(page)).toHaveAttribute('data-tour', 'teacher-class-card');
		// Styled with the theme tokens (story 10): each popover value equals
		// the token resolved on a probe element.
		const styling = await popover(page).evaluate((el) => {
			const probe = document.createElement('div');
			probe.style.cssText =
				'border: 1px solid var(--border); border-radius: var(--radius); background-color: var(--popover); color: var(--popover-foreground)';
			document.body.append(probe);
			const pick = (style: CSSStyleDeclaration) => ({
				border: style.borderTopColor,
				radius: style.borderTopLeftRadius,
				background: style.backgroundColor,
				color: style.color
			});
			const result = { popover: pick(getComputedStyle(el)), tokens: pick(getComputedStyle(probe)) };
			probe.remove();
			return result;
		});
		expect(styling.tokens.radius).toBe('4px');
		expect(styling.popover).toEqual(styling.tokens);
		// Seen as it starts, not when it ends.
		await expect.poll(() => toursSeen(teacher.id)).toEqual(['teacher-home']);
		// Left with Esc, it never returns by itself.
		await page.keyboard.press('Escape');
		await expect(popover(page)).toHaveCount(0);
		await page.reload();
		await expectNoTour(page);

		await page.goto(classPath());
		await expect(popover(page)).toBeVisible();
		await expect(highlighted(page)).toHaveAttribute('data-tour', 'class-session');
		await expect(popover(page)).toContainText('Choose the session');
		await expect(popover(page)).toContainText('1 of 5');
		await expect(popover(page).getByRole('button', { name: 'Skip' })).toBeVisible();

		const targets = [
			'class-attendance-save',
			'class-skills',
			'class-skill-student',
			'class-homework'
		];
		const firstStudent = page.locator('[data-tour="class-skill-student"]').first();
		for (const [index, target] of targets.entries()) {
			await popover(page).getByRole('button', { name: 'Next' }).click();
			await expect(highlighted(page)).toHaveAttribute('data-tour', target);
			await expect(popover(page)).toContainText(`${index + 2} of 5`);

			// A tour fills in and submits nothing: the highlighted control
			// answers neither a click nor Enter.
			if (target === 'class-attendance-save' || target === 'class-skill-student') {
				await page.waitForTimeout(700);
				await highlighted(page).click({ force: true });
				await highlighted(page).evaluate((element) =>
					(element.shadowRoot?.querySelector('button') ?? (element as HTMLElement)).focus()
				);
				await page.keyboard.press('Enter');
				await page.keyboard.press(' ');
				await page.waitForTimeout(500);
				await expect(highlighted(page)).toHaveAttribute('data-tour', target);
				await expect(popover(page)).toContainText(`${index + 2} of 5`);
				await expect(page).toHaveURL(new RegExp(`${classPath()}$`));
				await expect(firstStudent).toHaveAttribute('aria-expanded', 'false');
				await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
			}
		}
		// Back works, by button and by keyboard.
		await popover(page).getByRole('button', { name: 'Back' }).click();
		await expect(highlighted(page)).toHaveAttribute('data-tour', 'class-skill-student');
		// (driver.js ignores a key pressed while the highlight is still moving.)
		await page.waitForTimeout(700);
		await page.keyboard.press('ArrowRight');
		await expect(highlighted(page)).toHaveAttribute('data-tour', 'class-homework');

		// The last step ends with Done; there is nothing left to skip.
		await expect(popover(page).getByRole('button', { name: 'Next' })).toHaveCount(0);
		await expect(popover(page).getByRole('button', { name: 'Skip' })).toBeHidden();
		await popover(page).getByRole('button', { name: 'Done' }).click();
		await expect(popover(page)).toHaveCount(0);
		// The tour changed nothing and went nowhere.
		await expect(page).toHaveURL(new RegExp(`${classPath()}$`));

		expect(await toursSeen(teacher.id)).toEqual(['teacher-home', 'teacher-class']);

		// Later visit, by a link inside the app and by a full load.
		await page.goto('/teacher');
		await expectNoTour(page);
		await page.locator('[data-tour="teacher-class-open"]').click();
		await expect(page).toHaveURL(new RegExp(`${classPath()}$`));
		await expectNoTour(page);
	} finally {
		await context.close();
	}
});

test('teacher: on another browser the same tours do not start again', async ({ browser }) => {
	const context = await personContext(browser);
	const page = await context.newPage();
	try {
		await signIn(page, teacher);
		await expectNoTour(page);
		await page.goto(classPath());
		await expectNoTour(page);
		expect(await toursSeen(teacher.id)).toEqual(['teacher-home', 'teacher-class']);
	} finally {
		await context.close();
	}
});

test('Help: "Show me around this page" runs a seen tour again; other pages say where tours are', async ({
	browser
}) => {
	const context = await personContext(browser);
	const page = await context.newPage();
	try {
		await signIn(page, teacher);
		await page.goto(classPath());
		await expectNoTour(page);

		const help = helpSheet(page);
		const replay = help.getByRole('button', { name: 'Show me around this page' });
		await openHelp(page);
		await expect(help.getByRole('heading', { name: 'Help' })).toBeVisible();
		await replay.filter({ visible: true }).click();

		// Help closes and the tour runs from its first step.
		await expect(help.getByRole('heading', { name: 'Help' })).toBeHidden();
		await expect(popover(page)).toBeVisible();
		await expect(highlighted(page)).toHaveAttribute('data-tour', 'class-session');
		await expect(popover(page)).toContainText('1 of 5');
		// Left with the close button.
		await popover(page).getByRole('button', { name: 'Close the tour' }).click();
		await expect(popover(page)).toHaveCount(0);
		expect(await toursSeen(teacher.id)).toEqual(['teacher-home', 'teacher-class']);

		// A page without a tour: no button, a line instead. (Help opens only
		// once the page has hydrated.)
		await openCalendar(page);
		await openHelp(page);
		await expect(help.getByRole('heading', { name: 'Help' })).toBeVisible();
		await expect(
			help.getByText('A short tour shows you around these pages').filter({ visible: true })
		).toBeVisible();
		await expect(replay).toHaveCount(0);
	} finally {
		await context.close();
	}
});

test('parent at phone width: every step of the Sessions tour and its text are on screen', async ({
	browser
}) => {
	const viewport = { width: 390, height: 780 };
	const context = await personContext(browser, viewport);
	const page = await context.newPage();
	try {
		await signIn(page, parent);
		// The Dashboard's tour starts first; Skip leaves it.
		await expect(popover(page)).toBeVisible();
		await expect(highlighted(page)).toHaveAttribute('data-tour', 'parent-child-card');
		await popover(page).getByRole('button', { name: 'Skip' }).click();
		await expect(popover(page)).toHaveCount(0);

		await page.goto(`/parent/children/${student.id}?tab=sessions`);
		await expect(popover(page)).toBeVisible();

		const targets = ['session-row', 'session-controls', 'session-answer', 'leave-range'];
		for (const [index, target] of targets.entries()) {
			if (index > 0) await popover(page).getByRole('button', { name: 'Next' }).click();
			await expect(highlighted(page)).toHaveAttribute('data-tour', target);
			await expect(popover(page)).toContainText(`${index + 1} of ${targets.length}`);
			// Both boxes settle after the page has scrolled to the control.
			await expect(async () => {
				for (const box of [
					await highlighted(page).boundingBox(),
					await popover(page).boundingBox()
				]) {
					expect(box).not.toBeNull();
					expect(box!.x).toBeGreaterThanOrEqual(0);
					expect(box!.y).toBeGreaterThanOrEqual(0);
					expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
					expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
				}
			}).toPass({ timeout: 5000 });
		}
		await popover(page).getByRole('button', { name: 'Done' }).click();
		await expect(popover(page)).toHaveCount(0);
		// Nothing was answered or saved by the tour.
		await expect(page.getByText('Not answered').first()).toBeVisible();

		expect(await toursSeen(parent.id)).toEqual(['parent-home', 'parent-child-sessions']);

		// The Overview tab is the same route with its own tour: the tabs, naming Sessions.
		await page
			.getByRole('navigation', { name: 'Child sections' })
			.getByRole('link', { name: 'Overview' })
			.click();
		await expect(popover(page)).toBeVisible();
		await expect(highlighted(page)).toHaveAttribute('data-tour', 'child-tabs');
		// Leaving the page mid-tour closes it; it stays seen.
		await page.goBack();
		await expect(page).toHaveURL(/tab=sessions/);
		// Back on Sessions without a new page load: its tour is remembered.
		await expectNoTour(page);
		await expect
			.poll(() => toursSeen(parent.id))
			.toEqual(['parent-home', 'parent-child-sessions', 'parent-child-overview']);
	} finally {
		await context.close();
	}
});

test('an automated browser gets no tour and marks nothing seen', async ({ page }) => {
	// `page` is Playwright's own: navigator.webdriver is true, as in every other e2e test.
	await signIn(page, teacher);
	await page.goto(`${classPath()}/homework`);
	await expectNoTour(page);
	expect(await toursSeen(teacher.id)).toEqual(['teacher-home', 'teacher-class']);
});

// After the test above: the homework list's tour is still unseen there.
test('teacher: the homework, new-homework and Requests tours; a failed save does not stop a tour', async ({
	browser
}) => {
	const context = await personContext(browser);
	const page = await context.newPage();
	try {
		await signIn(page, teacher);
		const seenBefore = ['teacher-home', 'teacher-class'];
		expect(await toursSeen(teacher.id)).toEqual(seenBefore);

		// Saving fails: the tour runs all the same, and nothing is stored.
		await page.route('**/api/tours/seen', (route) =>
			route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"failed"}' })
		);
		await page.goto(`${classPath()}/homework/new`);
		await expect(popover(page)).toBeVisible();
		await expect(highlighted(page)).toHaveAttribute('data-tour', 'homework-language');
		await page.keyboard.press('Escape');
		await expect(popover(page)).toHaveCount(0);
		expect(await toursSeen(teacher.id)).toEqual(seenBefore);
		await page.unroute('**/api/tours/seen');

		// The step counts are the registry's (src/lib/tours.ts) for the
		// controls on the page: all three on the list, all four on a one-off
		// form, and on Requests only the waiting registration.
		// The new-homework tour was not stored above, so it starts once more.
		for (const [path, first, total, seen] of [
			[`${classPath()}/homework`, 'homework-create', 3, 'teacher-homework'],
			[`${classPath()}/homework/new`, 'homework-language', 4, 'teacher-homework-new'],
			['/requests', 'requests-registrations', 1, 'teacher-requests']
		] as const) {
			await page.goto(path);
			await expect(popover(page)).toBeVisible();
			await expect(highlighted(page)).toHaveAttribute('data-tour', first);
			await expect(popover(page)).toContainText(`1 of ${total}`);
			await expect.poll(() => toursSeen(teacher.id)).toContain(seen);
			await page.keyboard.press('Escape');
			await expect(popover(page)).toHaveCount(0);
		}

		// The form's tour follows the form: due date before "Assign to".
		await page.goto(`${classPath()}/homework/new`);
		await expectNoTour(page);
		const help = await openHelp(page);
		await help
			.getByRole('button', { name: 'Show me around this page' })
			.filter({ visible: true })
			.click();
		for (const target of ['homework-language', 'homework-schedule', 'homework-due']) {
			await expect(highlighted(page)).toHaveAttribute('data-tour', target);
			await page.waitForTimeout(700);
			await popover(page).getByRole('button', { name: 'Next' }).click();
		}
		await expect(highlighted(page)).toHaveAttribute('data-tour', 'homework-target');
		await expect(popover(page)).toContainText('4 of 4');
	} finally {
		await context.close();
	}
});

test('a parent without a child: no tour, nothing marked seen, Help says there is nothing to show', async ({
	browser
}) => {
	const context = await personContext(browser);
	const page = await context.newPage();
	try {
		await signIn(page, childless);
		await expect(page).toHaveURL(/\/parent$/);
		await expectNoTour(page);
		expect(await toursSeen(childless.id)).toEqual([]);

		const help = await openHelp(page);
		await help
			.getByRole('button', { name: 'Show me around this page' })
			.filter({ visible: true })
			.click();
		await expect(
			page.locator('[data-sonner-toast]').getByText('There is nothing to show on this page yet.')
		).toBeVisible();
		await expect(popover(page)).toHaveCount(0);
		expect(await toursSeen(childless.id)).toEqual([]);
	} finally {
		await context.close();
	}
});

/**
 * Holds the tour's start back in `context`: it waits for the page root's
 * `data-hydrated` mark (up to 3 s), and the mark reads as absent to it for
 * 2.5 s from the first time it is asked on each path. The window re-arms
 * when the path changes, so it holds on /teacher after the client-side
 * navigation from /login, and Help or a menu is surely open by the time the
 * tour would start.
 */
async function holdTourStart(context: BrowserContext) {
	await context.addInitScript(() => {
		let path = '';
		let since = 0;
		const hasAttribute = Element.prototype.hasAttribute;
		Element.prototype.hasAttribute = function (name: string) {
			if (name === 'data-hydrated' && this.matches('main > [data-ui="new"]')) {
				if (location.pathname !== path) {
					path = location.pathname;
					since = performance.now();
				}
				if (performance.now() - since < 2500) return false;
			}
			return hasAttribute.call(this, name);
		};
	});
}

test('Help open before an unseen tour starts: the tour stays away and is not marked seen', async ({
	browser
}) => {
	const context = await personContext(browser);
	await holdTourStart(context);
	const page = await context.newPage();
	const before = await toursSeen(teacher.id);
	try {
		check(
			await service.from('profiles').update({ tours_seen: [] }).eq('id', teacher.id),
			'reset tours_seen'
		);
		await signIn(page, teacher);
		await expect(page).toHaveURL(/\/teacher$/);
		await openHelp(page);

		await page.waitForTimeout(4500);
		await expect(popover(page)).toHaveCount(0);
		expect(await toursSeen(teacher.id)).toEqual([]);
	} finally {
		await context.close();
		await service.from('profiles').update({ tours_seen: before }).eq('id', teacher.id);
	}
});

test('a menu open before an unseen tour starts: the tour stays away and is not marked seen', async ({
	browser
}) => {
	const context = await personContext(browser);
	await holdTourStart(context);
	const page = await context.newPage();
	const before = await toursSeen(teacher.id);
	try {
		check(
			await service.from('profiles').update({ tours_seen: [] }).eq('id', teacher.id),
			'reset tours_seen'
		);
		await signIn(page, teacher);
		await expect(page).toHaveURL(/\/teacher$/);
		// The avatar's account menu: a popup in the portal root, not Help.
		const menu = await openAccountMenu(page);

		await page.waitForTimeout(4500);
		await expect(menu).toBeVisible();
		await expect(popover(page)).toHaveCount(0);
		expect(await toursSeen(teacher.id)).toEqual([]);
	} finally {
		await context.close();
		await service.from('profiles').update({ tours_seen: before }).eq('id', teacher.id);
	}
});
