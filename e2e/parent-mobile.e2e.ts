import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { berlinToday, fixtureTeam, service, signIn, type TestUser } from './fixtures';

/**
 * Mobile-first redesign, story 3 (parent pages pilot): the parent
 * dashboard, a child's page (Overview, Sessions, the leave period, the
 * deletion request), the child's badge page and the parents' homework list
 * on the new component system. One test per row of the story's I/O matrix,
 * at 375px (phone) and 820px (iPad portrait), plus the fit check (no
 * sideways scroll, every button at least 44×44px) in en, de and bo.
 *
 * Its own fixture: an approved parent with two approved children (Anna and
 * Ben) and one still waiting (Cleo); one class (10:00, schedule in the
 * past, so it only has the sessions made here) with sessions today and 10,
 * 15, 22 and 29 days ahead; Anna has an overdue homework and a Done one
 * (which earns her first language badge), Ben an open one and eleven Done
 * ones (two pages). A third approved child (Dawa) is the tablet runs'
 * child for the deletion request and the session answers.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const anna = `PM Anna ${tag}`;
const ben = `PM Ben ${tag}`;
const cleo = `PM Cleo ${tag}`;
const dawa = `PM Dawa ${tag}`;
const className = `PM class ${tag}`;
const overdueTitle = `PM overdue ${tag}`;
const benTitle = `PM open ${tag}`;

const VIEWPORTS = [
	{ name: 'phone', width: 375, height: 740 },
	{ name: 'tablet', width: 820, height: 1180 }
] as const;

let teacher: TestUser;
let parent: TestUser;
let childA: TestUser;
let childB: TestUser;
/** The tablet runs' child for the deletion request and session answers. */
let childD: TestUser;
let classId: string;
/** Deletion order: students first (a class with students cannot be deleted). */
const userIds: string[] = [];
const team = fixtureTeam(tag);
const createdDays: string[] = [];

function plusDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

const today = berlinToday();
const day = (offset: number) => plusDays(today, offset);
/** Session days: today (Sick), +10 and +15 (leave periods), +22 (answers), +29 (no JavaScript). */
const sessionOffsets = [0, 10, 15, 22, 29];
const sessionIds = new Map<number, string>();

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'teacher' | 'student' | 'parent', key: string) {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-pm-${key}-${tag}@${domain}`;
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
	if (classId) {
		const { error: hwError } = await service
			.from('homework_assignments')
			.delete()
			.eq('class_id', classId);
		if (hwError) problems.push(`delete homework: ${hwError.message}`);
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

/** One homework for `student` in the class, with the given status. */
async function homework(
	student: TestUser,
	title: string,
	due: string,
	status: 'assigned' | 'done'
) {
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
}

test.beforeAll(async () => {
	try {
		teacher = await createUser('teacher', 'teacher');
		parent = await createUser('parent', 'parent');
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);
		classId = check(
			await service
				.from('classes')
				.insert({
					name: className,
					code: `P${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
					badge_subject: 'language',
					default_start_time: '10:00',
					default_duration_minutes: 60,
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

		const child = async (key: string, name: string, status: 'approved' | 'pending') => {
			const user = await createUser('student', key);
			check(
				await service
					.from('profiles')
					.update({
						class_id: status === 'approved' ? classId : null,
						status,
						registration_name: name,
						display_name: name,
						parent_id: parent.id,
						team_id: status === 'approved' ? await team.id() : null
					})
					.eq('id', user.id),
				`set up ${key}`
			);
			if (status === 'approved') {
				const enrolled = check(
					await service
						.from('class_enrollments')
						.select('class_id')
						.eq('student_id', user.id)
						.eq('class_id', classId),
					`read enrollment ${key}`
				);
				if (!enrolled?.length) {
					check(
						await service
							.from('class_enrollments')
							.insert({ student_id: user.id, class_id: classId }),
						`enroll ${key}`
					);
				}
			}
			return user;
		};
		childA = await child('anna', anna, 'approved');
		childB = await child('ben', ben, 'approved');
		childD = await child('dawa', dawa, 'approved');
		await child('cleo', cleo, 'pending');

		await homework(childA, overdueTitle, '1890-01-13', 'assigned');
		await homework(childA, `PM done ${tag}`, '1890-01-06', 'done');
		await homework(childB, benTitle, day(5), 'assigned');
		// More Done homework than one page holds (10): Ben's Homework tab has a pager.
		for (let i = 1; i <= 11; i += 1) {
			await homework(childB, `PM done B${i} ${tag}`, plusDays('1890-02-01', i), 'done');
		}

		const days = sessionOffsets.map(day);
		const existing = check(
			await service.from('class_days').select('day').in('day', days),
			'read class days'
		);
		const had = new Set((existing ?? []).map((d) => d.day));
		createdDays.push(...days.filter((d) => !had.has(d)));
		for (const offset of sessionOffsets) {
			sessionIds.set(
				offset,
				check(
					await service.rpc('attendance_backfill_session', {
						p_class_id: classId,
						p_day: day(offset)
					}),
					`session on ${day(offset)}`
				)
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

/** The latest leave answer of a child's (Anna's) session `offset` days ahead (null: none). */
async function latestAnswer(offset: number, child: TestUser = childA) {
	const { data, error } = await service
		.from('session_leave_history')
		.select('answer, classification')
		.eq('student_id', child.id)
		.eq('class_session_id', sessionIds.get(offset)!)
		.order('answered_at', { ascending: false })
		.order('id', { ascending: false })
		.limit(1);
	if (error) throw new Error(`read leave history: ${error.message}`);
	return data?.[0] ?? null;
}

/** The migrated page's root marks itself hydrated (its controls work from then on). */
async function ready(page: Page) {
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

async function open(page: Page, path: string) {
	await page.goto(path);
	await ready(page);
}

const childPath = (child: TestUser, tab?: string) =>
	`/parent/children/${child.id}${tab ? `?tab=${tab}` : ''}`;

/** A signed-in parent page at a viewport (a context of its own). */
async function parentPage(browser: Browser, width: number, height: number, person = false) {
	const context = await browser.newContext({ viewport: { width, height } });
	if (person) {
		// A browser a person uses: tours start by themselves in it.
		await context.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
		});
	}
	const page = await context.newPage();
	await signIn(page, parent);
	await ready(page);
	return page;
}

/**
 * No sideways scroll, and every visible button, breadcrumb link and
 * navigation link (tabs, child picker) in the page is at least 44×44px.
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

const rangeSheet = (page: Page) => page.getByRole('dialog', { name: 'Leave period' });
const sessionRow = (page: Page, offset: number) =>
	page.locator(`li[data-session="${sessionIds.get(offset)}"]`);

for (const viewport of VIEWPORTS) {
	test.describe(`at ${viewport.width}px`, () => {
		test(`dashboard (${viewport.name}): one card per child, the waiting one not a link`, async ({
			browser
		}) => {
			const page = await parentPage(browser, viewport.width, viewport.height);
			try {
				await expect(page).toHaveURL(/\/parent$/);
				const cards = page.getByRole('list', { name: 'Linked children' }).getByTestId('child-card');
				await expect(cards).toHaveCount(4);
				const annaCard = page.getByRole('link', { name: new RegExp(anna) });
				await expect(annaCard).toHaveAttribute('href', childPath(childA));
				await expect(page.getByRole('link', { name: new RegExp(ben) })).toHaveCount(1);
				// Cleo is still waiting: her card is not a link.
				const cleoCard = cards.filter({ hasText: cleo });
				await expect(cleoCard).toContainText('Waiting');
				await expect(page.getByRole('link', { name: new RegExp(cleo) })).toHaveCount(0);
				await expect(cleoCard.locator('xpath=ancestor-or-self::a')).toHaveCount(0);

				const [first, second] = await Promise.all([
					cards.nth(0).boundingBox(),
					cards.nth(1).boundingBox()
				]);
				if (viewport.width >= 768) {
					// Tablet: two columns.
					expect(Math.round(first!.y)).toBe(Math.round(second!.y));
					expect(second!.x).toBeGreaterThan(first!.x + first!.width - 1);
				} else {
					expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
				}
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`overview (${viewport.name}): sections stack on a phone, two columns on a tablet`, async ({
			browser
		}) => {
			const page = await parentPage(browser, viewport.width, viewport.height);
			try {
				await open(page, childPath(childA));
				const team = page.getByRole('region', { name: 'Team Leaderboard' });
				const teachers = page.getByRole('region', { name: 'Teachers' });
				await expect(team).toBeVisible();
				const [a, b] = await Promise.all([team.boundingBox(), teachers.boundingBox()]);
				if (viewport.width >= 768) {
					expect(Math.round(a!.y)).toBe(Math.round(b!.y));
				} else {
					expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
				}
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`leave period (${viewport.name}): the preview lists the sessions, Save sets them`, async ({
			browser
		}) => {
			const page = await parentPage(browser, viewport.width, viewport.height);
			// Phone: the session 10 days ahead; tablet: the one 15 days ahead.
			const offset = viewport.width < 768 ? 10 : 15;
			try {
				await open(page, childPath(childA, 'sessions'));
				await page.getByLabel('From').fill(day(offset - 1));
				await page.getByLabel('To', { exact: true }).fill(day(offset + 1));
				await page.getByRole('button', { name: 'Preview' }).click();

				const sheet = rangeSheet(page);
				await expect(sheet).toBeVisible();
				// A bottom sheet below 48rem, a dialog from it.
				await expect(sheet).toHaveAttribute(
					'data-testid',
					viewport.width < 768 ? 'range-sheet' : 'range-dialog'
				);
				await expect(sheet.getByTestId('range-list').getByRole('listitem')).toHaveCount(1);
				await expect(sheet).toContainText('Sessions: 1');
				// The sheet fits the screen; its actions are in view.
				const box = (await sheet.boundingBox())!;
				expect(box.y).toBeGreaterThanOrEqual(0);
				expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
				const save = sheet.getByRole('button', { name: 'Save' });
				await expect(save).toBeInViewport();
				expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
				expect(await latestAnswer(offset)).toBeNull();

				await save.click();
				await expect(sheet).toHaveCount(0);
				await expect(page.locator('[data-sonner-toast]')).toContainText(
					'Leave period saved. Changed: 1'
				);
				expect(await latestAnswer(offset)).toMatchObject({ answer: 'on_leave' });
				await expect(sessionRow(page, offset)).toContainText('On leave ·');
				// Focus is back on the Preview button.
				await expect(page.getByRole('button', { name: 'Preview' })).toBeFocused();
			} finally {
				await page.context().close();
			}
		});

		test(`leave period errors (${viewport.name}): on the fields, aria-invalid, focus on the first`, async ({
			browser
		}) => {
			const page = await parentPage(browser, viewport.width, viewport.height);
			try {
				await open(page, childPath(childA, 'sessions'));
				// No dates.
				await page.getByRole('button', { name: 'Preview' }).click();
				await expect(page.locator('#range-dates-error')).toContainText('starts today or later');
				await expect(page.getByLabel('From')).toHaveAttribute('aria-invalid', 'true');
				await expect(page.getByLabel('To', { exact: true })).toHaveAttribute(
					'aria-invalid',
					'true'
				);
				await expect(page.getByLabel('From')).toBeFocused();
				await expect(rangeSheet(page)).toHaveCount(0);

				// A class that is not the child's (the list only offers the child's).
				await page.getByLabel('From').fill(day(9));
				await page.getByLabel('To', { exact: true }).fill(day(11));
				await page.getByLabel('Class').evaluate((select: HTMLSelectElement) => {
					select.add(new Option('Not hers', crypto.randomUUID()));
				});
				await page.getByLabel('Class').selectOption({ label: 'Not hers' });
				await page.getByRole('button', { name: 'Preview' }).click();
				await expect(page.locator('#range-class-error')).toContainText(
					"one of your child's classes"
				);
				await expect(page.getByLabel('Class')).toHaveAttribute('aria-invalid', 'true');
				await expect(page.getByLabel('Class')).toBeFocused();
				await expect(page.getByLabel('From')).not.toHaveAttribute('aria-invalid', 'true');
				await expect(rangeSheet(page)).toHaveCount(0);
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`leave period, error after the preview (${viewport.name}): it closes, the error stays on the dates`, async ({
			browser
		}) => {
			const page = await parentPage(browser, viewport.width, viewport.height);
			try {
				await open(page, childPath(childA, 'sessions'));
				await page.getByLabel('From').fill(day(20));
				await page.getByLabel('To', { exact: true }).fill(day(24));
				await page.getByRole('button', { name: 'Preview' }).click();
				const sheet = rangeSheet(page);
				await expect(sheet).toBeVisible();
				// The period no longer holds by the time it is saved (here: its
				// start has moved into the past).
				await sheet
					.locator('input[name="from"]')
					.evaluate((input: HTMLInputElement, past) => (input.value = past), day(-1));
				await sheet.getByRole('button', { name: 'Save' }).click();

				await expect(sheet).toHaveCount(0);
				await expect(page.locator('#range-dates-error')).toContainText('starts today or later');
				await expect(page.getByLabel('From')).toHaveAttribute('aria-invalid', 'true');
				await expect(page.getByLabel('From')).toBeFocused();
				expect(await latestAnswer(22)).toBeNull();
			} finally {
				await page.context().close();
			}
		});
	});
}

for (const viewport of VIEWPORTS) {
	test(`session answers (${viewport.name}): buttons at least 44px, Coming, On leave, Sick`, async ({
		browser
	}) => {
		// Each size answers for its own child.
		const child = viewport.width < 768 ? childA : childD;
		const page = await parentPage(browser, viewport.width, viewport.height);
		try {
			await open(page, childPath(child, 'sessions'));
			const row = sessionRow(page, 22);
			const coming = row.getByRole('button', { name: 'Coming' });
			const onLeave = row.getByRole('button', { name: 'On leave' });
			const info = row.locator('time').first();

			const [rowBox, infoBox, comingBox, leaveBox] = await Promise.all([
				row.boundingBox(),
				info.boundingBox(),
				coming.boundingBox(),
				onLeave.boundingBox()
			]);
			expect(comingBox!.height).toBeGreaterThanOrEqual(44);
			expect(comingBox!.width).toBeGreaterThanOrEqual(44);
			if (viewport.width < 768) {
				// Phone: stacked under the row's text, the row's full width.
				expect(comingBox!.y).toBeGreaterThan(infoBox!.y + infoBox!.height);
				expect(leaveBox!.y).toBeGreaterThanOrEqual(comingBox!.y + comingBox!.height);
				expect(comingBox!.width).toBeGreaterThanOrEqual(rowBox!.width - 1);
			} else {
				// Tablet: side by side.
				expect(Math.round(leaveBox!.y)).toBe(Math.round(comingBox!.y));
			}
			await expectFits(page);

			await coming.click();
			await expect(page.locator('[data-sonner-toast]')).toContainText('Answer saved.');
			await expect(row).toContainText('Coming');
			expect(await latestAnswer(22, child)).toMatchObject({ answer: 'coming' });

			// On leave asks first, then saves on Confirm.
			await onLeave.click();
			await expect(row.getByRole('status')).toBeVisible();
			await row.getByRole('button', { name: 'Confirm On leave' }).click();
			await expect(row).toContainText('On leave ·');
			expect(await latestAnswer(22, child)).toMatchObject({ answer: 'on_leave' });

			// Today's session offers Sick.
			const todayRow = sessionRow(page, 0);
			await todayRow.getByRole('button', { name: 'Sick' }).click();
			await expect(todayRow).toContainText('Sick ·');
			expect(await latestAnswer(0, child)).toMatchObject({ answer: 'sick' });
		} finally {
			await page.context().close();
		}
	});
}

test('session answer error at 820px: the toast says it was not saved', async ({ browser }) => {
	const page = await parentPage(browser, 820, 1180);
	try {
		await open(page, childPath(childA, 'sessions'));
		const row = sessionRow(page, 29);
		// A session that is not the child's: the database refuses the answer.
		await row
			.locator('form:has(button:text-is("Coming")) input[name="sessionId"]')
			.evaluate((input: HTMLInputElement, id) => (input.value = id), crypto.randomUUID());
		await row.getByRole('button', { name: 'Coming' }).click();
		await expect(page.locator('[data-sonner-toast]')).toBeVisible();
		await expect(page.locator('[data-sonner-toast]')).not.toContainText('Answer saved.');
		expect(await latestAnswer(29)).toBeNull();
	} finally {
		await page.context().close();
	}
});

for (const viewport of VIEWPORTS) {
	test(`deletion request (${viewport.name}): an alert dialog, Cancel does nothing, Confirm posts`, async ({
		browser
	}) => {
		// Each size asks for its own child.
		const [child, name] = viewport.width < 768 ? [childB, ben] : [childD, dawa];
		const page = await parentPage(browser, viewport.width, viewport.height);
		const requests = async () =>
			check(
				await service.from('deletion_requests').select('status').eq('student_id', child.id),
				'read deletion requests'
			);
		try {
			await open(page, childPath(child));
			const request = page.getByRole('button', { name: 'Request deletion' });
			expect((await request.boundingBox())!.height).toBeGreaterThanOrEqual(44);
			await request.click();
			const confirm = page.getByRole('alertdialog', { name: 'Are you sure?' });
			await expect(confirm).toBeVisible();
			await expect(confirm).toContainText(name);
			await confirm.getByRole('button', { name: 'Cancel' }).click();
			await expect(confirm).toHaveCount(0);
			await page.waitForTimeout(300);
			expect(await requests()).toEqual([]);

			await request.click();
			await expect(confirm).toBeVisible();
			await confirm.getByRole('button', { name: 'Request deletion' }).click();
			await expect(confirm).toHaveCount(0);
			await expect(page.locator('[data-sonner-toast]')).toContainText('Deletion requested');
			await expect.poll(requests).toEqual([{ status: 'pending' }]);
			await expect(request).toHaveCount(0);
			// Focus moves to the pending status that replaced the button.
			await expect(page.locator('#deletion-status')).toContainText('Pending');
			await expect(page.locator('#deletion-status')).toBeFocused();
		} finally {
			await page.context().close();
		}
	});

	test(`badges (${viewport.name}): a tap opens the detail, Escape closes it`, async ({
		browser
	}) => {
		const page = await parentPage(browser, viewport.width, viewport.height);
		try {
			await open(page, `${childPath(childA)}/badges`);
			await expect(page.locator('li[data-state="earned"]')).toHaveCount(1);
			await expect(page.locator('li[data-state="locked"]').first()).toBeVisible();
			const badge = page.getByRole('button', { name: 'Language Homework badge 1' });
			await badge.click();
			const detail = page.getByRole('dialog', { name: 'Language' });
			await expect(detail).toBeVisible();
			await expect(detail).toContainText('1 Language homework done');
			const box = (await detail.boundingBox())!;
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
			await page.keyboard.press('Escape');
			await expect(detail).toHaveCount(0);
			await expect(badge).toBeFocused();
			await expectFits(page);
		} finally {
			await page.context().close();
		}
	});

	test(`homework (${viewport.name}): both children's rows stacked, with the overdue pill`, async ({
		browser
	}) => {
		const page = await parentPage(browser, viewport.width, viewport.height);
		try {
			await open(page, '/parent/homework');
			await expect(page.getByRole('navigation', { name: 'Show homework for' })).toBeVisible();
			const rows = page
				.getByTestId('homework-list')
				.getByRole('listitem')
				.filter({
					has: page.getByRole('link', { name: /PM (overdue|open)/ })
				});
			await expect(rows).toHaveCount(2);
			const overdue = rows.filter({ hasText: overdueTitle });
			await expect(overdue).toContainText(anna);
			await expect(overdue).toContainText('Overdue');
			await expect(overdue.getByRole('link', { name: `Sheet ${tag}` })).toBeVisible();
			await expect(rows.filter({ hasText: benTitle })).toContainText(ben);
			await expect(rows.filter({ hasText: benTitle })).not.toContainText('Overdue');
			// Stacked: the child's name above the title.
			const name = (await overdue.getByText(anna).boundingBox())!;
			const title = (await overdue.getByRole('link', { name: /PM overdue/ }).boundingBox())!;
			expect(title.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
			await expectFits(page);
		} finally {
			await page.context().close();
		}
	});
}

test('no JavaScript: the leave period previews and saves through the form actions', async ({
	browser
}) => {
	const signedIn = await parentPage(browser, 375, 740);
	const state = await signedIn.context().storageState();
	await signedIn.context().close();
	const context: BrowserContext = await browser.newContext({
		storageState: state,
		javaScriptEnabled: false,
		viewport: { width: 375, height: 740 }
	});
	const page = await context.newPage();
	try {
		await page.goto(childPath(childA, 'sessions'));
		await page.getByLabel('From').fill(day(28));
		await page.getByLabel('To', { exact: true }).fill(day(30));
		await page.getByRole('radio', { name: 'On leave' }).check();
		await page.getByRole('button', { name: 'Preview' }).click();

		const preview = page.getByTestId('range-preview-page');
		await expect(preview).toBeVisible();
		await expect(preview).toContainText('Sessions: 1');
		// The fields keep what was posted.
		await expect(page.getByLabel('From')).toHaveValue(day(28));
		expect(await latestAnswer(29)).toBeNull();

		await preview.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Leave period saved' })).toBeVisible();
		await expect(sessionRow(page, 29)).toContainText('On leave ·');
		expect(await latestAnswer(29)).toMatchObject({ answer: 'on_leave' });

		// The deletion request posts directly (the confirm step needs JavaScript).
		await page.goto(childPath(childA));
		await page.getByRole('button', { name: 'Request deletion' }).click();
		await expect(page.locator('#deletion-status')).toContainText('Pending');
		expect(
			check(
				await service.from('deletion_requests').select('status').eq('student_id', childA.id),
				'read deletion requests'
			)
		).toEqual([{ status: 'pending' }]);
	} finally {
		await context.close();
	}
});

test('pager at 375px: Previous disabled on page 1, Next shows page 2, both at least 44px', async ({
	browser
}) => {
	const page = await parentPage(browser, 375, 740);
	try {
		await open(page, childPath(childB, 'homework'));
		const pager = page.getByRole('navigation', { name: 'Page 1 of 2' });
		const previous = pager.getByRole('button', { name: 'Previous' });
		const next = pager.getByRole('link', { name: 'Next' });
		await expect(previous).toBeDisabled();
		await expect(next).toHaveAttribute('href', `${childPath(childB, 'homework')}&done=2`);
		for (const control of [previous, next]) {
			const box = (await control.boundingBox())!;
			expect(box.height).toBeGreaterThanOrEqual(44);
			expect(box.width).toBeGreaterThanOrEqual(44);
		}
		await expectFits(page);

		await next.click();
		await expect(page).toHaveURL(/done=2/);
		const second = page.getByRole('navigation', { name: 'Page 2 of 2' });
		await expect(second.getByRole('link', { name: 'Previous' })).toBeVisible();
		await expect(second.getByRole('button', { name: 'Next' })).toBeDisabled();
		// Page 2 holds the eleventh Done homework only.
		await expect(
			page.getByRole('region', { name: 'Done and Reviewed' }).getByText(/PM done B\d+/)
		).toHaveCount(1);
	} finally {
		await page.context().close();
	}
});

for (const viewport of VIEWPORTS) {
	test(`tours (${viewport.name}): the dashboard and Sessions tours highlight the same steps`, async ({
		browser
	}) => {
		check(
			await service.from('profiles').update({ tours_seen: [] }).eq('id', parent.id),
			'reset tours'
		);
		const page = await parentPage(browser, viewport.width, viewport.height, true);
		const popover = page.locator('.driver-popover');
		const highlighted = page.locator('.driver-active-element');
		try {
			for (const [index, target] of ['parent-child-card', 'parent-child-name'].entries()) {
				if (index > 0) await popover.getByRole('button', { name: 'Next' }).click();
				await expect(highlighted).toHaveAttribute('data-tour', target);
			}
			await popover.getByRole('button', { name: 'Done' }).click();
			await expect(popover).toHaveCount(0);

			await page.goto(childPath(childA, 'sessions'));
			const targets = ['session-row', 'session-controls', 'session-answer', 'leave-range'];
			for (const [index, target] of targets.entries()) {
				if (index > 0) await popover.getByRole('button', { name: 'Next' }).click();
				await expect(highlighted).toHaveAttribute('data-tour', target);
				await expect(highlighted).toBeInViewport();
			}
			await popover.getByRole('button', { name: 'Done' }).click();
			await expect(popover).toHaveCount(0);
		} finally {
			await page.context().close();
		}
	});
}

for (const locale of ['en', 'de', 'bo']) {
	test(`every parent page at 375px in ${locale}: no sideways scroll, buttons at least 44×44px`, async ({
		browser
	}) => {
		const page = await parentPage(browser, 375, 740);
		try {
			await page
				.context()
				.addCookies([{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }]);
			const paths = [
				'/parent',
				childPath(childA),
				childPath(childA, 'homework'),
				childPath(childA, 'sessions'),
				childPath(childA, 'record'),
				`${childPath(childA)}/badges`,
				'/parent/homework'
			];
			for (const path of paths) {
				await open(page, path);
				await expect(page.locator('html')).toHaveAttribute('lang', locale);
				await expectFits(page);
				// #86, #129: a crumb's one-line label is not clipped (Tibetan letters'
				// feet and vowels): it is cut only sideways.
				const clipped = await page
					.getByTestId('page-breadcrumb')
					.locator('[data-crumb-text]')
					.evaluateAll((spans) =>
						spans
							.filter((el) => el.getClientRects().length > 0)
							.filter(
								(el) =>
									el.scrollHeight > el.clientHeight || getComputedStyle(el).overflowY !== 'visible'
							)
							.map((el) => el.textContent?.trim())
					);
				expect(clipped).toEqual([]);
			}
		} finally {
			await page.context().close();
		}
	});
}
