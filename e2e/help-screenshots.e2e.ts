import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { berlinToday, isoWeekday, service, signIn, type TestUser } from './fixtures';

/**
 * Not a test: takes the screenshots shown on /help (#87) into
 * static/help/<language>/. Skipped in a normal run; `npm run help:screenshots`
 * sets HELP_SCREENSHOTS. It seeds a small demo school with made-up names,
 * photographs each page in en, de and bo at phone size, and removes the demo
 * data again. Run it on a freshly reset local database, so no other test's
 * rows show up in the pictures.
 */
test.skip(!process.env.HELP_SCREENSHOTS, 'only with HELP_SCREENSHOTS=1');
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 390, height: 640 }, deviceScaleFactor: 1.5 });

const LOCALES = ['en', 'de', 'bo'] as const;
const OUT = 'static/help';

const userIds: string[] = [];
let parentId: string | undefined;
let classId: string | undefined;
let teamId: string | undefined;
const classDays: string[] = [];

let teacher: TestUser;
let parent: TestUser;
let child: TestUser;
let childId: string;

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

/** `YYYY-MM-DD` shifted by whole days. */
function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

async function createUser(
	role: 'teacher' | 'student' | 'parent',
	email: string,
	displayName: string
): Promise<TestUser> {
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role },
		user_metadata: { display_name: displayName }
	});
	if (error || !data.user) throw new Error(`create ${role}: ${error?.message}`);
	userIds.push(data.user.id);
	check(
		await service.from('profiles').update({ display_name: displayName }).eq('id', data.user.id),
		`name ${role}`
	);
	return { id: data.user.id, email, password };
}

async function addStudent(name: string, approved = true): Promise<TestUser> {
	const user = await createUser(
		'student',
		// The part before the @ is the username the student sees on /account.
		`${name.toLowerCase().replace(' ', '.')}@students.internal.invalid`,
		name
	);
	check(
		await service
			.from('profiles')
			.update({
				class_id: classId,
				status: approved ? 'approved' : 'pending',
				registration_name: name,
				display_name: name,
				team_id: approved ? teamId : null
			})
			.eq('id', user.id),
		`set up student ${name}`
	);
	if (approved) {
		const enrolled = check(
			await service
				.from('class_enrollments')
				.select('class_id')
				.eq('student_id', user.id)
				.eq('class_id', classId!),
			'read enrollment'
		);
		if (!enrolled?.length) {
			check(
				await service.from('class_enrollments').insert({ student_id: user.id, class_id: classId! }),
				`enroll ${name}`
			);
		}
	}
	return user;
}

async function cleanup() {
	const problems: string[] = [];
	// Students before their class and before their parent (see teacher.e2e.ts).
	const ids = userIds.splice(0).reverse();
	const parentIndex = parentId ? ids.indexOf(parentId) : -1;
	if (parentIndex !== -1) ids.push(...ids.splice(parentIndex, 1));
	for (const id of ids) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	if (classId) {
		const { error } = await service.from('classes').delete().eq('id', classId);
		if (error) problems.push(`delete class: ${error.message}`);
	}
	if (teamId) {
		const { error } = await service.from('teams').delete().eq('id', teamId);
		if (error) problems.push(`delete team: ${error.message}`);
	}
	if (classDays.length) {
		const { error } = await service.from('class_days').delete().in('day', classDays);
		if (error) problems.push(`delete class days: ${error.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
}

test.beforeAll(async () => {
	test.setTimeout(120_000);
	const today = berlinToday();
	// Sundays: the last one (attendance can be marked) and the next three.
	const lastSunday = addDays(today, -(isoWeekday(today) % 7 || 7));
	const upcoming = [7, 14, 21].map((n) => addDays(lastSunday, n));
	// Sessions are only generated from today on: the past day starts out as
	// a far-future Sunday and is moved (as teacher.e2e.ts does).
	let farDay = '4821-03-01';
	while (isoWeekday(farDay) !== 7) farDay = addDays(farDay, 1);
	try {
		teacher = await createUser('teacher', 'pema.lhamo@example.test', 'Pema Lhamo');
		parent = await createUser('parent', 'dolma.tsering@example.test', 'Dolma Tsering');
		parentId = parent.id;
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);

		teamId = check(
			await service
				.from('teams')
				.insert({ name: 'Snow Lions', name_bo: 'གངས་སེང་།', name_de: 'Schneelöwen' })
				.select('id')
				.single(),
			'create team'
		).id;
		classId = check(
			await service
				.from('classes')
				.insert({
					name: 'Class 2',
					name_bo: 'འཛིན་གྲྭ་གཉིས་པ།',
					name_de: 'Klasse 2',
					code: 'TIB2A7',
					default_start_time: '10:00',
					default_duration_minutes: 90,
					schedule_weekdays: [7],
					schedule_starts_on: addDays(lastSunday, -28),
					schedule_ends_on: '4821-12-31'
				})
				.select('id')
				.single(),
			'create class'
		).id;
		check(
			await service.from('class_teachers').insert({ class_id: classId, teacher_id: teacher.id }),
			'assign teacher'
		);

		child = await addStudent('Tenzin Dolma');
		childId = child.id;
		check(
			await service.from('profiles').update({ parent_id: parent.id }).eq('id', childId),
			'link child'
		);
		for (const name of ['Sonam Wangmo', 'Karma Dorjee', 'Dawa Yangzom']) {
			await addStudent(name);
		}
		await addStudent('Nyima Tashi', false);

		classDays.push(...upcoming, farDay);
		check(await service.from('class_days').insert(classDays.map((day) => ({ day }))), 'add days');
		check(
			await service.from('class_days').update({ day: lastSunday }).eq('day', farDay),
			'move day'
		);
		classDays[classDays.indexOf(farDay)] = lastSunday;

		const due = upcoming[0];
		const assignment = check(
			await service
				.from('homework_assignments')
				.insert({
					class_id: classId,
					title: 'ཀ་ཁ་སུམ་ཅུ་བྲིས།',
					skill_area: 'language',
					whole_class: false,
					created_by: teacher.id
				})
				.select('id')
				.single(),
			'create homework'
		).id;
		const instance = check(
			await service
				.from('homework_instances')
				.insert({ assignment_id: assignment, class_id: classId, period_start: due, due_date: due })
				.select('id')
				.single(),
			'create homework instance'
		).id;
		const assigned = check(
			await service
				.from('homework_status_history')
				.select('id')
				.eq('instance_id', instance)
				.eq('student_id', childId),
			'read homework status'
		);
		if (!assigned?.length) {
			check(
				await service.from('homework_status_history').insert({
					instance_id: instance,
					student_id: childId,
					class_id: classId,
					status: 'assigned',
					recorded_by: teacher.id
				}),
				'assign homework'
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

/** Opens `path` in `locale` and waits until iX has drawn the page. */
async function open(page: Page, locale: string, path: string) {
	// A /<locale>/... address sets the language cookie and redirects (#79).
	await page.goto(`/${locale}${path}`);
	await page.waitForFunction(() => customElements.get('ix-button') !== undefined);
	await page.waitForLoadState('networkidle');
	await page.evaluate(() => document.fonts.ready);
}

/** Saves the visible page, with `selector` (when given) scrolled to the top. */
async function shot(page: Page, locale: string, name: string, selector?: string) {
	if (selector) {
		const target = page.locator(selector).first();
		await expect(target).toBeVisible();
		await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
	}
	// Toasts and scroll settle.
	await page.waitForTimeout(400);
	mkdirSync(`${OUT}/${locale}`, { recursive: true });
	await page.screenshot({ path: `${OUT}/${locale}/${name}.png` });
}

test('signed-out pages', async ({ page }) => {
	for (const locale of LOCALES) {
		await open(page, locale, '/register');
		await shot(page, locale, 'parent-1');
		await open(page, locale, '/join');
		await shot(page, locale, 'parent-4');
		await shot(page, locale, 'student-1');
		await open(page, locale, '/login');
		await shot(page, locale, 'student-3');
	}
});

test('parent pages', async ({ page }) => {
	test.setTimeout(180_000);
	await signIn(page, parent);
	for (const locale of LOCALES) {
		await open(page, locale, '/parent');
		await shot(page, locale, 'parent-5');
		await open(page, locale, `/parent/children/${childId}?tab=sessions`);
		// The sessions list, below the leave-period form.
		await shot(page, locale, 'parent-6', 'section.card:not([aria-labelledby])');
		await open(page, locale, '/parent/homework');
		await shot(page, locale, 'parent-7');
		await open(page, locale, `/parent/children/${childId}?tab=overview`);
		await shot(page, locale, 'parent-8', '#deletion-heading');
	}
});

test('teacher pages', async ({ page }) => {
	test.setTimeout(180_000);
	await signIn(page, teacher);
	for (const locale of LOCALES) {
		await open(page, locale, '/account');
		await shot(page, locale, 'teacher-1');
		await shot(page, locale, 'teacher-9', '#parent-access-heading');
		await open(page, locale, '/teacher');
		// "My Classes" with the class code, below the tiles.
		await shot(page, locale, 'teacher-2', '.page h2');
		await open(page, locale, '/requests');
		await shot(page, locale, 'teacher-3');
		await open(page, locale, `/teacher/classes/${classId}`);
		await shot(
			page,
			locale,
			'teacher-4',
			'section.card:has(+ section[aria-labelledby="skills-heading"])'
		);
		await shot(page, locale, 'teacher-5', '#skills-heading');
		await open(page, locale, `/teacher/classes/${classId}/homework/new`);
		await shot(page, locale, 'teacher-6');
		await open(page, locale, '/calendar');
		await shot(page, locale, 'teacher-8');
	}
});

test('student pages', async ({ page }) => {
	test.setTimeout(180_000);
	// Before any language switch: signIn() looks for the English button.
	await signIn(page, child);
	for (const locale of LOCALES) {
		await open(page, locale, '/student/homework');
		await shot(page, locale, 'student-4');
		await open(page, locale, '/student');
		// Streak and badges: the second row of tiles on the Dashboard.
		await shot(page, locale, 'student-5', '.tile-grid ~ .tile-grid');
		await open(page, locale, '/account');
		await shot(page, locale, 'student-8');
		await open(page, locale, '/leaderboard');
		await shot(page, locale, 'student-6');
		await open(page, locale, '/student/classes');
		await shot(page, locale, 'student-7');
	}
});
