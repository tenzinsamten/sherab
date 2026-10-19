import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { currentSchoolYear } from '../src/lib/school-year';
import { berlinToday, fixtureTeam, service, signIn, type TestUser } from './fixtures';

/**
 * Mobile-first redesign, story 4 (student pages): the dashboard, My
 * classes, a class, My homework, a homework, the badge page and the
 * pending page on the new component system. One test per row of the
 * story's I/O matrix, at 375px (phone) and 820px (iPad portrait), plus the
 * fit check (no sideways scroll, every button at least 44×44px) in en, de
 * and bo.
 *
 * Its own fixture: an approved student (with a team) in class A (language
 * badges, a syllabus section with text, a link and a PDF, one classmate)
 * and class B; class A has an overdue homework, open ones for the Mark
 * done rows and eleven Done ones (two pages, and the student's first
 * language badges, seen); class B has one open homework. Classes C and D
 * take join requests (one per viewport) and E and F have a rejected one
 * each. A second approved student has no class; a pending and a rejected
 * student see the pending page.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const BUCKET = 'syllabus-files';

const VIEWPORTS = [
	{ name: 'phone', width: 375, height: 740 },
	{ name: 'tablet', width: 820, height: 1180 }
] as const;

const names = {
	a: `SM class A ${tag}`,
	b: `SM class B ${tag}`,
	c: `SM class C ${tag}`,
	d: `SM class D ${tag}`,
	e: `SM class E ${tag}`,
	f: `SM class F ${tag}`
};
type ClassKey = keyof typeof names;
const classes = {} as Record<ClassKey, { id: string; code: string }>;

let teacher: TestUser;
let student: TestUser;
let classmate: TestUser;
let loner: TestUser;
let pendingStudent: TestUser;
let rejectedStudent: TestUser;
const classmateName = `SM Classmate ${tag}`;
const studentName = `SM Student ${tag}`;
/** Deletion order: students first (a class with students cannot be deleted). */
const userIds: string[] = [];
const team = fixtureTeam(tag);
const objectPaths: string[] = [];

/** Open homework (class A) by use: Mark done on a row / the detail page, per viewport, and without JavaScript. */
const open: Record<string, string> = {};
let overdueId = '';
let fileName = '';

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

async function createUser(role: 'teacher' | 'student', key: string) {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-sm-${key}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
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
	if (objectPaths.length) {
		const { error } = await service.storage.from(BUCKET).remove(objectPaths.splice(0));
		if (error) problems.push(`remove files: ${error.message}`);
	}
	const ids = Object.values(classes).map((c) => c.id);
	if (ids.length) {
		const { error: hwError } = await service
			.from('homework_assignments')
			.delete()
			.in('class_id', ids);
		if (hwError) problems.push(`delete homework: ${hwError.message}`);
		const { error } = await service.from('classes').delete().in('id', ids);
		if (error) problems.push(`delete classes: ${error.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
}

/** One homework for the student in `classKey`; returns its instance id. */
async function homework(
	classKey: ClassKey,
	title: string,
	due: string,
	status: 'assigned' | 'done'
): Promise<string> {
	const classId = classes[classKey].id;
	const assignment = check(
		await service
			.from('homework_assignments')
			.insert({
				class_id: classId,
				title,
				skill_area: 'language',
				whole_class: false,
				created_by: teacher.id,
				reference_links: [{ url: 'https://example.org/sheet', label: `Sheet ${tag}` }]
			})
			.select('id')
			.single(),
		`create homework ${title}`
	).id;
	const instance = check(
		await service
			.from('homework_instances')
			.insert({ assignment_id: assignment, class_id: classId, period_start: due, due_date: due })
			.select('id')
			.single(),
		`create instance ${title}`
	).id;
	check(
		// Done counts as finished only after it was assigned (splitProgress).
		await service.from('homework_status_history').insert(
			(status === 'done' ? (['assigned', 'done'] as const) : (['assigned'] as const)).map(
				(step) => ({
					instance_id: instance,
					class_id: classId,
					student_id: student.id,
					status: step,
					recorded_by: teacher.id
				})
			)
		),
		`homework status ${title}`
	);
	return instance;
}

async function setUpStudent(
	user: TestUser,
	name: string,
	status: 'approved' | 'pending' | 'rejected',
	classKeys: ClassKey[]
) {
	check(
		await service
			.from('profiles')
			.update({
				class_id: classKeys.length ? classes[classKeys[0]].id : null,
				status,
				registration_name: name,
				display_name: name,
				team_id: status === 'approved' ? await team.id() : null
			})
			.eq('id', user.id),
		`set up ${name}`
	);
	for (const key of classKeys) {
		const enrolled = check(
			await service
				.from('class_enrollments')
				.select('class_id')
				.eq('student_id', user.id)
				.eq('class_id', classes[key].id),
			`read enrollment ${name}`
		);
		if (!enrolled?.length) {
			check(
				await service
					.from('class_enrollments')
					.insert({ student_id: user.id, class_id: classes[key].id }),
				`enroll ${name}`
			);
		}
	}
}

/** Marks every badge of the student seen (no New badge dialog). */
async function markAllSeen() {
	check(
		await service
			.from('badges_earned')
			.update({ seen_at: new Date().toISOString() })
			.eq('student_id', student.id),
		'mark badges seen'
	);
}

/** The student's first language badge is new again (as if just earned). */
async function makeBadgeNew() {
	check(
		await service
			.from('badges_earned')
			.update({ seen_at: null })
			.eq('student_id', student.id)
			.eq('badge_subject', 'language')
			.eq('badge_type', 'homework')
			.eq('milestone', 1),
		'reset seen_at'
	);
}

async function badgeSeen(): Promise<boolean> {
	const row = check(
		await service
			.from('badges_earned')
			.select('seen_at')
			.eq('student_id', student.id)
			.eq('badge_subject', 'language')
			.eq('badge_type', 'homework')
			.eq('milestone', 1)
			.single(),
		'read seen_at'
	);
	return row.seen_at !== null;
}

/** The latest status of the student's homework instance. */
async function latestStatus(instance: string) {
	const rows = check(
		await service
			.from('homework_status_history')
			.select('status')
			.eq('instance_id', instance)
			.eq('student_id', student.id)
			.order('recorded_at', { ascending: false })
			.limit(1),
		'read status'
	);
	return rows?.[0]?.status ?? null;
}

test.beforeAll(async () => {
	try {
		teacher = await createUser('teacher', 'teacher');
		for (const [key, name] of Object.entries(names) as [ClassKey, string][]) {
			const code = `S${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
			const row = check(
				await service
					.from('classes')
					.insert({
						name,
						code,
						badge_subject: key === 'b' ? 'dance' : 'language'
					})
					.select('id')
					.single(),
				`create class ${name}`
			);
			classes[key] = { id: row.id, code };
			check(
				await service.from('class_teachers').insert({ class_id: row.id, teacher_id: teacher.id }),
				`assign teacher ${name}`
			);
		}

		student = await createUser('student', 'student');
		await setUpStudent(student, studentName, 'approved', ['a', 'b']);
		classmate = await createUser('student', 'classmate');
		await setUpStudent(classmate, classmateName, 'approved', ['a']);
		loner = await createUser('student', 'loner');
		await setUpStudent(loner, `SM Loner ${tag}`, 'approved', []);
		pendingStudent = await createUser('student', 'pending');
		await setUpStudent(pendingStudent, `SM Pending ${tag}`, 'pending', []);
		rejectedStudent = await createUser('student', 'rejected');
		await setUpStudent(rejectedStudent, `SM Rejected ${tag}`, 'rejected', []);

		overdueId = await homework('a', `SM overdue ${tag}`, '1890-01-13', 'assigned');
		// Due tomorrow: inside the To do look-ahead window.
		for (const key of [
			'row-phone',
			'row-tablet',
			'detail-phone',
			'detail-tablet',
			'nojs',
			'error'
		]) {
			open[key] = await homework('a', `SM ${key} ${tag}`, plusDays(today, 1), 'assigned');
		}
		await homework('b', `SM class B open ${tag}`, plusDays(today, 2), 'assigned');
		// More Done homework than one page holds (10): Done has a pager.
		for (let i = 1; i <= 11; i += 1) {
			await homework('a', `SM done ${i} ${tag}`, plusDays('1890-02-01', i), 'done');
		}
		await markAllSeen();

		// Class A's syllabus: one section with text, a link and a PDF.
		const syllabus = check(
			await service
				.from('class_syllabi')
				.insert({ class_id: classes.a.id, school_year: currentSchoolYear() })
				.select('id')
				.single(),
			'create syllabus'
		).id;
		const section = check(
			await service
				.from('class_syllabus_sections')
				.insert({
					syllabus_id: syllabus,
					position: 1,
					title: 'Song 1',
					content_doc: {
						type: 'doc',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The first song' }] }]
					},
					content_language: 'en',
					links: [{ url: 'https://one.example', label: 'Song 1 video' }]
				})
				.select('id')
				.single(),
			'create section'
		).id;
		fileName = `Lyrics ${tag}.pdf`;
		const path = `${classes.a.id}/${section}/${crypto.randomUUID()}.pdf`;
		const buffer = Buffer.alloc(2048);
		buffer.write('%PDF-1.7\n');
		check(
			await service.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf' }),
			'store file'
		);
		objectPaths.push(path);
		check(
			await service
				.from('class_syllabus_section_files')
				.insert({ section_id: section, object_path: path, file_name: fileName, size_bytes: 2048 }),
			'record file'
		);

		// A rejected join request per viewport (dismissed in the join tests).
		for (const key of ['e', 'f'] as const) {
			check(
				await service.from('class_join_requests').insert({
					student_id: student.id,
					class_id: classes[key].id,
					status: 'rejected',
					reviewed_at: new Date().toISOString()
				}),
				`rejected request ${key}`
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
async function studentPage(
	browser: Browser,
	width: number,
	height: number,
	options: { who?: TestUser; reducedMotion?: 'reduce' | 'no-preference' } = {}
) {
	const context = await browser.newContext({
		viewport: { width, height },
		reducedMotion: options.reducedMotion ?? 'no-preference'
	});
	const page = await context.newPage();
	await signIn(page, options.who ?? student);
	await ready(page);
	return page;
}

/**
 * No sideways scroll, and every visible button, breadcrumb link and
 * navigation link (the filters) in the page is at least 44×44px.
 */
async function expectFits(page: Page) {
	const result = await page.evaluate(() => {
		const doc = document.documentElement;
		const small = [
			...document.querySelectorAll(
				'main button, main [data-slot="button"], main [data-slot="breadcrumb-link"], main nav a'
			)
		]
			.filter((el) => el.getClientRects().length > 0)
			.map((el) => ({ el, box: el.getBoundingClientRect() }))
			.filter(({ box }) => box.width < 43.5 || box.height < 43.5)
			.map(
				({ el, box }) =>
					`${el.textContent?.trim() || el.getAttribute('aria-label')}: ${Math.round(box.width)}×${Math.round(box.height)}`
			);
		return { scrollWidth: doc.scrollWidth, width: doc.clientWidth, small };
	});
	expect(result.scrollWidth).toBeLessThanOrEqual(result.width);
	expect(result.small).toEqual([]);
}

async function expectTouchSize(locator: ReturnType<Page['locator']>) {
	const box = (await locator.boundingBox())!;
	expect(box.width).toBeGreaterThanOrEqual(43.5);
	expect(box.height).toBeGreaterThanOrEqual(43.5);
}

const toast = (page: Page, text: string | RegExp) =>
	page.locator('ix-toast').getByText(text).first();
const row = (page: Page | ReturnType<Page['locator']>, instance: string) =>
	page.locator(`[data-testid="homework-row"][data-instance="${instance}"]`);
const confirmDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Are you sure?' });
const newBadgeDialog = (page: Page) => page.getByRole('dialog', { name: /^New badges?!$/ });

for (const viewport of VIEWPORTS) {
	const wide = viewport.width >= 768;

	test.describe(`at ${viewport.width}px`, () => {
		test(`dashboard (${viewport.name}): tiles in a grid, progress, next due, classes, join`, async ({
			browser
		}) => {
			const page = await studentPage(browser, viewport.width, viewport.height);
			try {
				await expect(page).toHaveURL(/\/student$/);
				const tiles = page.getByTestId('dashboard-tiles').getByRole('link');
				await expect(tiles).toHaveCount(4);
				const boxes = await Promise.all([0, 1, 2, 3].map((i) => tiles.nth(i).boundingBox()));
				// Two columns on a phone, four in a row on a tablet.
				expect(Math.round(boxes[0]!.y)).toBe(Math.round(boxes[1]!.y));
				if (wide) {
					expect(Math.round(boxes[3]!.y)).toBe(Math.round(boxes[0]!.y));
				} else {
					expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
					expect(Math.round(boxes[2]!.x)).toBe(Math.round(boxes[0]!.x));
				}
				await expect(tiles.nth(0)).toContainText('To do');
				await expect(tiles.nth(1)).toContainText('Overdue');
				await expect(tiles.nth(1)).toContainText('1');
				await expect(page.getByTestId('streak-tile')).toBeVisible();
				await expect(page.getByTestId('badges-tile')).toBeVisible();
				// The look-ahead window holds only the overdue homework.
				await expect(row(page.getByRole('region', { name: 'Next due' }), overdueId)).toContainText(
					'Overdue'
				);

				const cards = page.getByTestId('class-cards').getByRole('link');
				await expect(cards).toHaveCount(2);
				const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
				if (wide) expect(Math.round(a!.y)).toBe(Math.round(b!.y));
				else expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
				await expect(page.getByTestId('join-card')).toBeVisible();
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`join a class (${viewport.name}): upper-cased, refused under the field, sent and listed, rejected dismissed`, async ({
			browser
		}) => {
			const page = await studentPage(browser, viewport.width, viewport.height);
			const target = wide ? 'd' : 'c';
			const rejected = wide ? 'f' : 'e';
			try {
				const card = page.getByTestId('join-card');
				const field = card.getByLabel('Class code');
				const send = card.getByRole('button', { name: 'Send request' });
				await expectTouchSize(send);

				await field.fill('zzzzzzzz');
				await expect(field).toHaveValue('ZZZZZZZZ');
				await send.click();
				const error = card.locator('#joinCode-error');
				await expect(error).toHaveText(
					"That code doesn't open a class you can join. Check the code."
				);
				await expect(field).toHaveAttribute('aria-invalid', 'true');
				await expect(field).toHaveAttribute('aria-describedby', 'joinCode-error');
				await expect(field).toBeFocused();
				// The error sits under the field.
				const [fieldBox, errorBox] = await Promise.all([field.boundingBox(), error.boundingBox()]);
				expect(errorBox!.y).toBeGreaterThanOrEqual(fieldBox!.y + fieldBox!.height - 1);

				await field.fill(classes[target].code.toLowerCase());
				await expect(field).not.toHaveAttribute('aria-invalid');
				await send.click();
				await expect(toast(page, `Request sent for ${names[target]}.`)).toBeVisible();
				await expect(field).toHaveValue('');
				const sent = card.getByTestId('join-request').filter({ hasText: names[target] });
				await expect(sent.getByTestId('join-status')).toHaveText('Pending');
				await expect(sent.getByRole('button')).toHaveCount(0);

				const refused = card.getByTestId('join-request').filter({ hasText: names[rejected] });
				await expect(refused.getByTestId('join-status')).toHaveText('Rejected');
				const dismiss = refused.getByRole('button', { name: 'Dismiss' });
				await expectTouchSize(dismiss);
				await dismiss.click();
				await expect(toast(page, 'Request dismissed.')).toBeVisible();
				await expect(refused).toHaveCount(0);
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`mark done on a row (${viewport.name}): an alert dialog, Cancel does nothing, Confirm saves`, async ({
			browser
		}) => {
			const page = await studentPage(browser, viewport.width, viewport.height);
			const instance = open[`row-${viewport.name}`];
			try {
				await openPage(page, '/student/homework');
				const item = row(page, instance);
				const button = item.getByRole('button', { name: 'Mark done' });
				await expectTouchSize(button);
				// Phone: the button is under the row's text; tablet: beside it.
				const [link, buttonBox] = await Promise.all([
					item.getByRole('link').boundingBox(),
					button.boundingBox()
				]);
				if (wide) expect(buttonBox!.x).toBeGreaterThan(link!.x + link!.width - 1);
				else expect(buttonBox!.y).toBeGreaterThan(link!.y + link!.height - 1);

				await button.click();
				const dialog = confirmDialog(page);
				await expect(dialog).toBeVisible();
				await expect(dialog).toContainText(`Mark “SM row-${viewport.name} ${tag}” as done?`);
				const box = (await dialog.boundingBox())!;
				expect(box.x).toBeGreaterThanOrEqual(0);
				expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
				await expectTouchSize(dialog.getByRole('button', { name: 'Cancel' }));
				await dialog.getByRole('button', { name: 'Cancel' }).click();
				await expect(dialog).toBeHidden();
				await expect(button).toBeFocused();
				expect(await latestStatus(instance)).toBe('assigned');

				await button.click();
				await dialog.getByRole('button', { name: 'Mark done' }).click();
				await expect(toast(page, 'Marked done.')).toBeVisible();
				// Done: it leaves To do (focus goes to the heading) and is listed under Done.
				await expect(item).toHaveCount(0);
				await expect(page.locator('main h1')).toBeFocused();
				expect(await latestStatus(instance)).toBe('done');
				await openPage(page, '/student/homework?filter=done');
				await expect(row(page, instance).getByTestId('homework-status')).toHaveText(
					'Done — waiting for review'
				);
			} finally {
				await page.context().close();
			}
		});

		test(`mark done on the detail page (${viewport.name}): asks, saves, shows Done`, async ({
			browser
		}) => {
			const page = await studentPage(browser, viewport.width, viewport.height);
			const instance = open[`detail-${viewport.name}`];
			try {
				await openPage(page, `/student/homework/${instance}`);
				await expect(page.getByTestId('homework-status')).toHaveText('Not done yet');
				const button = page.getByRole('button', { name: 'Mark done' });
				await expectTouchSize(button);
				await button.click();
				const dialog = confirmDialog(page);
				await expect(dialog).toBeVisible();
				await dialog.getByRole('button', { name: 'Mark done' }).click();
				await expect(toast(page, 'Marked done.')).toBeVisible();
				await expect(page.getByTestId('homework-status')).toHaveText('Done — waiting for review');
				await expect(page.getByRole('button', { name: 'Mark done' })).toHaveCount(0);
				await expect(page.getByTestId('homework-status')).toBeFocused();
				expect(await latestStatus(instance)).toBe('done');
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`homework list (${viewport.name}): filters, grouped by class, stacked rows, Done pager`, async ({
			browser
		}) => {
			const page = await studentPage(browser, viewport.width, viewport.height);
			try {
				await openPage(page, '/student/homework');
				const filters = page.getByRole('navigation', { name: 'My Homework' }).getByRole('link');
				await expect(filters).toHaveCount(2);
				await expect(filters.nth(0)).toHaveAttribute('aria-current', 'page');
				await expect(filters.nth(1)).not.toHaveAttribute('aria-current');
				for (const i of [0, 1]) await expectTouchSize(filters.nth(i));

				const groups = page.getByTestId('class-group');
				await expect(groups).toHaveCount(2);
				await expect(groups.filter({ hasText: names.a })).toBeVisible();
				await expect(groups.filter({ hasText: names.b })).toBeVisible();
				const overdue = row(page, overdueId);
				await expect(overdue).toContainText('Overdue');
				await expectFits(page);

				await filters.nth(1).click();
				await expect(page).toHaveURL(/filter=done/);
				await ready(page);
				await expect(
					page.getByRole('navigation', { name: 'My Homework' }).getByRole('link').nth(1)
				).toHaveAttribute('aria-current', 'page');
				const pager = page.getByRole('navigation', { name: 'Page 1 of 2' });
				await expect(pager).toBeVisible();
				await pager.getByRole('link', { name: 'Next' }).click();
				await expect(page).toHaveURL(/filter=done&page=2/);
				await expect(page.getByRole('navigation', { name: 'Page 2 of 2' })).toBeVisible();
				// What does not fit on page 1 (Mark done tests before this one add to Done).
				await expect(page.getByTestId('homework-row').first()).toBeVisible();
				expect(await page.getByTestId('homework-row').count()).toBeLessThan(10);
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`class detail (${viewport.name}): syllabus, file links, copy code, filters, classmates`, async ({
			browser
		}) => {
			const page = await studentPage(browser, viewport.width, viewport.height);
			try {
				await openPage(page, `/student/classes/${classes.a.id}`);
				await expect(page.locator('main h1')).toHaveText(names.a);
				const copy = page.getByRole('button', { name: 'Copy Class code' });
				await expectTouchSize(copy);
				await expect(page.locator('.credential')).toHaveText(classes.a.code);
				await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
					origin: new URL(page.url()).origin
				});
				await copy.click();
				await expect(toast(page, 'Copied')).toBeVisible();
				expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(classes.a.code);

				const section = page.getByTestId('syllabus-section');
				await expect(section).toHaveCount(1);
				await expect(section.locator('.rich-text')).toHaveText('The first song');
				await expect(section.getByRole('link', { name: 'Song 1 video' })).toHaveAttribute(
					'target',
					'_blank'
				);
				const files = section.getByRole('list', { name: 'Files' });
				await expect(files.getByTestId('file-name')).toHaveText(fileName);
				await expect(files.getByRole('link', { name: `Download “${fileName}”` })).toBeVisible();

				const homework = page.getByRole('region', { name: 'Homework', exact: true });
				const filters = homework.getByRole('navigation').getByRole('link');
				await expect(filters.nth(0)).toHaveAttribute('aria-current', 'page');
				await expect(homework.getByTestId('homework-row').first()).toBeVisible();
				await expect(page.getByTestId('classmates')).toContainText(classmateName);
				await expectFits(page);

				await filters.nth(1).click();
				await expect(page).toHaveURL(/filter=done/);
				await ready(page);
				const pager = page.getByRole('navigation', { name: 'Page 1 of 2' });
				await pager.getByRole('link', { name: 'Next' }).click();
				await expect(page).toHaveURL(/filter=done&page=2/);
				// What does not fit on page 1 (Mark done tests before this one add to Done).
				await expect(page.getByTestId('homework-row').first()).toBeVisible();
				expect(await page.getByTestId('homework-row').count()).toBeLessThan(10);
			} finally {
				await page.context().close();
			}
		});

		test(`new badge (${viewport.name}): opens with the flourish, Close focused, Close marks seen`, async ({
			browser
		}) => {
			await makeBadgeNew();
			const page = await studentPage(browser, viewport.width, viewport.height);
			try {
				const dialog = newBadgeDialog(page);
				await expect(dialog).toBeVisible();
				await expect(dialog).toHaveAttribute('data-testid', 'new-badge-dialog');
				await expect(dialog.getByTestId('new-badge')).toHaveCount(1);
				// The badge pops in over a pink burst.
				const icon = dialog.locator('[data-badge-icon]').first();
				expect(await icon.evaluate((el) => getComputedStyle(el).animationName)).toBe('badge-pop');
				await expect(dialog.locator('[data-flourish]').first()).toBeAttached();
				const close = dialog.getByRole('button', { name: 'Close' });
				await expect(close).toBeFocused();
				// A stray tap outside does not dismiss it (as iX's modal).
				await page.mouse.click(4, viewport.height - 4);
				await page.waitForTimeout(300);
				await expect(dialog).toBeVisible();
				expect(await badgeSeen()).toBe(false);
				await expectTouchSize(close);
				const box = (await dialog.boundingBox())!;
				expect(box.y).toBeGreaterThanOrEqual(0);
				expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
				expect(await badgeSeen()).toBe(false);

				await close.click();
				await expect(dialog).toBeHidden();
				await expect(page.locator('main h1')).toBeFocused();
				await expect.poll(badgeSeen).toBe(true);
			} finally {
				await page.context().close();
			}
		});

		test(`pending and rejected (${viewport.name}): status card, Check again, Sign out`, async ({
			browser
		}) => {
			const page = await studentPage(browser, viewport.width, viewport.height, {
				who: pendingStudent
			});
			try {
				await expect(page).toHaveURL(/\/student\/pending$/);
				const status = page.getByTestId('student-status');
				await expect(status).toHaveAttribute('data-state', 'pending');
				const again = status.getByRole('link', { name: 'Check again' });
				await expect(again).toHaveAttribute('href', '/student');
				await expectTouchSize(again);
				await expectTouchSize(status.getByRole('button', { name: 'Sign out' }));
				await expectFits(page);
			} finally {
				await page.context().close();
			}

			const other = await studentPage(browser, viewport.width, viewport.height, {
				who: rejectedStudent
			});
			try {
				const status = other.getByTestId('student-status');
				await expect(status).toHaveAttribute('data-state', 'rejected');
				await expect(status).toContainText('Your registration was not accepted.');
				await expect(status.getByRole('link', { name: 'Check again' })).toHaveCount(0);
				await status.getByRole('button', { name: 'Sign out' }).click();
				await expect(other).toHaveURL(/\/login$/);
			} finally {
				await other.context().close();
			}
		});
	});
}

test('mark done error at 375px: the iX toast says it failed, the row stays open', async ({
	browser
}) => {
	const page = await studentPage(browser, 375, 740);
	const instance = open.error;
	try {
		await openPage(page, '/student/homework');
		const item = row(page, instance);
		// A homework that is not there (as if removed meanwhile).
		await item
			.locator('input[name="instanceId"]')
			.evaluate((input: HTMLInputElement) => (input.value = crypto.randomUUID()));
		await item.getByRole('button', { name: 'Mark done' }).click();
		await confirmDialog(page).getByRole('button', { name: 'Mark done' }).click();
		await expect(toast(page, 'That homework item could not be found.')).toBeVisible();
		await expect(item.getByRole('button', { name: 'Mark done' })).toBeEnabled();
		// Not saved: the form stays, and focus goes back to its button.
		await expect(item.getByRole('button', { name: 'Mark done' })).toBeFocused();
		expect(await latestStatus(instance)).toBe('assigned');
	} finally {
		await page.context().close();
	}
});

test('homework list empty at 375px: a student with no class sees the empty state', async ({
	browser
}) => {
	const page = await studentPage(browser, 375, 740, { who: loner });
	try {
		await openPage(page, '/student/homework');
		await expect(page.getByTestId('empty-state')).toContainText("You're not in a class yet.");
		await openPage(page, '/student/classes');
		await expect(page.getByTestId('empty-state')).toBeVisible();
		await expectFits(page);
	} finally {
		await page.context().close();
	}
});

test('reduced motion: the New badge dialog opens still, with no animation', async ({ browser }) => {
	await makeBadgeNew();
	const page = await studentPage(browser, 375, 740, { reducedMotion: 'reduce' });
	try {
		const dialog = newBadgeDialog(page);
		await expect(dialog).toBeVisible();
		const animations = await dialog.evaluate(
			(el) =>
				[
					...el.getAnimations({ subtree: true }),
					...(document.querySelector('[data-slot="dialog-overlay"]')?.getAnimations() ?? [])
				].length
		);
		expect(animations).toBe(0);
		await expect(dialog.locator('[data-flourish]').first()).toBeHidden();
		await expect(dialog.getByTestId('new-badge').locator('img')).toBeVisible();
		expect(
			await dialog
				.locator('[data-badge-icon]')
				.first()
				.evaluate((el) => getComputedStyle(el).opacity)
		).toBe('1');
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect.poll(badgeSeen).toBe(true);
	} finally {
		await page.context().close();
	}
});

test('no JavaScript: Mark done posts directly and the page shows Done', async ({ browser }) => {
	const signedIn = await studentPage(browser, 375, 740);
	const state = await signedIn.context().storageState();
	await signedIn.context().close();
	const context: BrowserContext = await browser.newContext({
		storageState: state,
		javaScriptEnabled: false,
		viewport: { width: 375, height: 740 }
	});
	const page = await context.newPage();
	const instance = open.nojs;
	try {
		await page.goto(`/student/homework/${instance}`);
		await page.getByRole('button', { name: 'Mark done' }).click();
		await expect(page.getByTestId('homework-status')).toHaveText('Done — waiting for review');
		await expect(page.getByRole('button', { name: 'Mark done' })).toHaveCount(0);
		expect(await latestStatus(instance)).toBe('done');

		// The join form posts without JavaScript too; a refused code stays in the field.
		await page.goto('/student');
		await page.getByLabel('Class code').fill('QQQQQQ');
		// Enter sends it (the button sits at the page end, under the sticky
		// bottom bar, until the page scrolls on its own).
		await page.getByLabel('Class code').press('Enter');
		await expect(page.locator('#joinCode-error')).toBeVisible();
		await expect(page.getByLabel('Class code')).toHaveValue('QQQQQQ');
		await expect(page.getByLabel('Class code')).toHaveAttribute('aria-invalid', 'true');
	} finally {
		await context.close();
	}
});

for (const locale of ['en', 'de', 'bo']) {
	test(`every student page at 375px in ${locale}: no sideways scroll, buttons at least 44×44px`, async ({
		browser
	}) => {
		const page = await studentPage(browser, 375, 740);
		try {
			await page
				.context()
				.addCookies([{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }]);
			const paths = [
				'/student',
				'/student/classes',
				`/student/classes/${classes.a.id}`,
				`/student/classes/${classes.a.id}?filter=done`,
				'/student/homework',
				'/student/homework?filter=done',
				`/student/homework/${overdueId}`,
				'/student/badges'
			];
			for (const path of paths) {
				await openPage(page, path);
				await expect(page.locator('html')).toHaveAttribute('lang', locale);
				await expectFits(page);
			}
		} finally {
			await page.context().close();
		}

		const pending = await studentPage(browser, 375, 740, { who: pendingStudent });
		try {
			await pending
				.context()
				.addCookies([
					{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(pending.url()).origin }
				]);
			await openPage(pending, '/student/pending');
			await expect(pending.locator('html')).toHaveAttribute('lang', locale);
			await expectFits(pending);
		} finally {
			await pending.context().close();
		}
	});
}
