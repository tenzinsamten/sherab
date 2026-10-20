import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import {
	createCalendarFixture,
	fixtureTeam,
	openCalendar,
	service,
	signIn,
	type CalendarFixture,
	type TestUser
} from './fixtures';

/**
 * Mobile-first redesign, story 5b (calendar): /calendar on the new
 * component system. One test per row of the story's I/O matrix at 375px
 * (phone) and 820px (iPad portrait) -- the admin's rows at 1440px instead
 * of 820 -- plus the fit check (no sideways scroll, every button at least
 * 44×44px, the open sheet's actions in view) in en, de and bo for every
 * role. The load-error row is a vitest render spec (page.render.spec.ts).
 *
 * Fixture: the calendar fixture (classes A 10:00 and B 12:00 taught by one
 * teacher, a student enrolled in both, class days on the 4th, 11th and
 * 18th of October in a random far-future year, B's session on the 4th
 * cancelled), plus a parent of that student and of a second child, who is
 * enrolled in class B only.
 */

test.describe.configure({ mode: 'serial' });

let fx: CalendarFixture;
let parent: TestUser;
let child2: TestUser;
const child2Name = () => `E2E5b Child ${fx.tag}`;
const studentName = () => `E2E47 Student ${fx.tag}`;
const extraUsers: string[] = [];
const team = fixtureTeam(`5b-${crypto.randomUUID().slice(0, 6)}`);

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'parent' | 'student', key: string): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-5b-${key}-${fx.tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	// Students first on cleanup (a parent with children, a team with students).
	if (role === 'student') extraUsers.unshift(data.user.id);
	else extraUsers.push(data.user.id);
	return { id: data.user.id, email, password };
}

test.beforeAll(async () => {
	fx = await createCalendarFixture();
	try {
		parent = await createUser('parent', 'parent');
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);
		check(
			await service.from('profiles').update({ parent_id: parent.id }).eq('id', fx.student.id),
			'link student'
		);
		child2 = await createUser('student', 'child2');
		check(
			await service
				.from('profiles')
				.update({
					class_id: fx.classB.id,
					status: 'approved',
					registration_name: child2Name(),
					display_name: child2Name(),
					parent_id: parent.id,
					team_id: await team.id()
				})
				.eq('id', child2.id),
			'set up child 2'
		);
		const enrolled = check(
			await service
				.from('class_enrollments')
				.select('class_id')
				.eq('student_id', child2.id)
				.eq('class_id', fx.classB.id),
			'read enrollment'
		);
		if (!enrolled?.length) {
			check(
				await service
					.from('class_enrollments')
					.insert({ student_id: child2.id, class_id: fx.classB.id }),
				'enroll child 2'
			);
		}
	} catch (error) {
		await cleanup().catch(() => undefined);
		throw error;
	}
});

async function cleanup() {
	const problems: string[] = [];
	if (fx) {
		await service.from('profiles').update({ parent_id: null }).eq('id', fx.student.id);
	}
	for (const id of extraUsers.slice()) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
		else extraUsers.splice(extraUsers.indexOf(id), 1);
	}
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	try {
		await fx?.cleanup();
	} catch (error) {
		problems.push(String(error));
	}
	if (problems.length) throw new Error(problems.join('; '));
}

test.afterAll(async () => {
	await cleanup();
});

const VIEWPORTS = [
	{ name: 'phone', width: 375, height: 740 },
	{ name: 'tablet', width: 820, height: 1180 }
] as const;
/** The admin works on a laptop: phone and desktop. */
const ADMIN_VIEWPORTS = [
	{ name: 'phone', width: 375, height: 740 },
	{ name: 'desktop', width: 1440, height: 900 }
] as const;

async function signedIn(browser: Browser, width: number, height: number, who: TestUser) {
	const context = await browser.newContext({ viewport: { width, height } });
	const page = await context.newPage();
	await signIn(page, who);
	return page;
}

function chipFor(page: Page, key: 'A' | 'B' | 'C', date: string): Locator {
	return page.locator(`.ec-event.ev-${fx.sessions[`${key}:${date}`]}`);
}
const dayButton = (page: Page, date: string) =>
	page.locator(`button.day-button[data-date="${date}"]`);
const sessionDialog = (page: Page) => page.getByTestId('session-dialog');
const dayDialog = (page: Page) => page.getByTestId('day-dialog');
const confirmDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Are you sure?' });
const toast = (page: Page, text: string | RegExp) =>
	page.locator('ix-toast').getByText(text).first();

/** A sheet below 48rem, a dialog from 48rem (shadcn's slots). */
async function expectSheetOrDialog(dialog: Locator, width: number) {
	await expect(dialog).toHaveAttribute(
		'data-slot',
		width < 768 ? 'sheet-content' : 'dialog-content'
	);
}

/**
 * No sideways scroll; every visible button in the page and in an open
 * dialog at least 44×44px; an open dialog fits the viewport with its Close
 * button in view.
 */
async function expectFits(page: Page) {
	const result = await page.evaluate(() => {
		const doc = document.documentElement;
		const small = [
			...document.querySelectorAll(
				'main button, main [role="button"], main nav a, [role="dialog"] button, [role="alertdialog"] button'
			)
		]
			.filter((el) => el.getClientRects().length > 0)
			// Month-grid chips render only from 48rem; the 44px rule is a phone rule (CAP-3).
			.filter((el) => !el.matches('.ec-day-grid .ec-event'))
			.map((el) => ({ el, box: el.getBoundingClientRect() }))
			.filter(({ box }) => box.width < 43.5 || box.height < 43.5)
			.map(
				({ el, box }) =>
					`${el.textContent?.trim() || el.getAttribute('aria-label')}: ${Math.round(box.width)}×${Math.round(box.height)}`
			);
		const dialog = document.querySelector('[role="dialog"]');
		const box = dialog?.getBoundingClientRect();
		return {
			scrollWidth: doc.scrollWidth,
			width: doc.clientWidth,
			small,
			dialogFits: box
				? box.top >= -1 && box.bottom <= innerHeight + 1 && box.right <= innerWidth + 1
				: true
		};
	});
	expect(result.scrollWidth).toBeLessThanOrEqual(result.width);
	expect(result.small).toEqual([]);
	expect(result.dialogFits).toBe(true);
}

test.describe('every role, phone and tablet', () => {
	for (const viewport of VIEWPORTS) {
		test(`list view on a phone, month grid on a tablet (${viewport.name})`, async ({ browser }) => {
			for (const who of [fx.teacher, fx.student, parent]) {
				const page = await signedIn(browser, viewport.width, viewport.height, who);
				try {
					await openCalendar(page, fx.month);
					if (viewport.name === 'phone') {
						await expect(page.locator('.ec-list')).toBeVisible();
						await expect(page.locator('.ec-day-grid')).toHaveCount(0);
					} else {
						await expect(page.locator('.ec-day-grid')).toBeVisible();
						// Weekday names readable: not clipped.
						const head = page.locator('.ec-col-head').first();
						await expect(head).toHaveText(/^Mon/);
						expect(await head.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
					}
					// Chips in class colours, readable (not clipped to nothing).
					const chip = chipFor(page, 'B', fx.days[1]);
					await expect(chip).toBeVisible();
					await expect(chip).toHaveClass(/chip-c[0-5]/);
					await expect(chip).toContainText(fx.classB.name);
					await expectFits(page);
				} finally {
					await page.context().close();
				}
			}
		});

		test(`open a session: sheet on a phone, dialog on a tablet; Escape returns focus (${viewport.name})`, async ({
			browser
		}) => {
			const page = await signedIn(browser, viewport.width, viewport.height, fx.teacher);
			try {
				await openCalendar(page, fx.month);
				const chip = chipFor(page, 'A', fx.days[2]);
				await chip.click();
				const dialog = sessionDialog(page);
				await expect(dialog).toBeVisible();
				await expectSheetOrDialog(dialog, viewport.width);
				await expect(page.getByRole('dialog', { name: fx.classA.name })).toBeVisible();
				// Actions in view without scrolling the page.
				await expect(dialog.getByRole('button', { name: 'Save' })).toBeInViewport();
				await expect(dialog.getByRole('button', { name: 'Close' }).last()).toBeInViewport();
				await expectFits(page);

				// Keyboard: Escape closes, focus goes back to the chip.
				await page.keyboard.press('Escape');
				await expect(dialog).toHaveCount(0);
				await expect(chip).toBeFocused();

				// Enter on the focused chip opens it again; one dialog at a time.
				await page.keyboard.press('Enter');
				await expect(dialog).toBeVisible();
				await expect(page.getByRole('dialog')).toHaveCount(1);
				await page.keyboard.press('Escape');
				await expect(chip).toBeFocused();
			} finally {
				await page.context().close();
			}
		});

		test(`teacher edits a session: error under the field, then saves (${viewport.name})`, async ({
			browser
		}) => {
			const date = viewport.name === 'phone' ? fx.days[1] : fx.days[2];
			const page = await signedIn(browser, viewport.width, viewport.height, fx.teacher);
			try {
				await openCalendar(page, fx.month);
				const dialog = sessionDialog(page);
				const start = dialog.getByLabel('Start time');
				const duration = dialog.getByLabel('Duration (minutes)');

				await chipFor(page, 'A', date).click();
				await expect(dialog).toBeVisible();
				await duration.fill('5');
				await dialog.getByRole('button', { name: 'Save' }).click();
				const error = dialog.locator('#session-error');
				await expect(error).toHaveText('Enter a duration between 15 and 480 minutes.');
				await expect(dialog).toBeVisible();
				await expect(duration).toHaveAttribute('aria-invalid', 'true');
				await expect(duration).toHaveAccessibleDescription(/Enter a duration between 15 and 480/);

				// Closed and reopened: the stale error is gone.
				await page.keyboard.press('Escape');
				await expect(dialog).toHaveCount(0);
				await chipFor(page, 'A', date).click();
				await expect(dialog).toBeVisible();
				await expect(error).toHaveCount(0);
				await expect(duration).not.toHaveAttribute('aria-invalid');

				await start.fill('11:30');
				await duration.fill('45');
				await dialog.getByRole('button', { name: 'Save' }).click();
				await expect(toast(page, 'Session saved.')).toBeVisible();
				await expect(dialog).toHaveCount(0);
				await expect(chipFor(page, 'A', date)).toContainText('11:30');
				await expect(chipFor(page, 'A', date)).toBeFocused();

				// Back to the class default.
				await chipFor(page, 'A', date).click();
				await expect(start).toHaveValue('11:30');
				await expect(duration).toHaveValue('45');
				await start.fill('');
				await duration.fill('');
				await dialog.getByRole('button', { name: 'Save' }).click();
				await expect(dialog).toHaveCount(0);
				await expect(chipFor(page, 'A', date)).toContainText('10:00');
			} finally {
				await page.context().close();
			}
		});

		test(`teacher adds an extra session; an invalid duration errors under the field (${viewport.name})`, async ({
			browser
		}) => {
			// A class day on another weekday: no fixture class has a session there.
			const date = `${fx.month}-${viewport.name === 'phone' ? '07' : '08'}`;
			check(await service.from('class_days').insert({ day: date }), 'add class day');
			const page = await signedIn(browser, viewport.width, viewport.height, fx.teacher);
			try {
				await openCalendar(page, fx.month);
				const dialog = dayDialog(page);
				// In the list too: the class day shows (a day chip) with its day button.
				await dayButton(page, date).click();
				await expect(dialog).toBeVisible();
				await expectSheetOrDialog(dialog, viewport.width);
				await expect(dialog.getByRole('heading', { name: 'Add extra session' })).toBeVisible();
				await dialog.getByLabel('Class').selectOption(fx.classA.id);
				await dialog.getByLabel('Start time').fill('15:00');
				await dialog.getByLabel('Duration (minutes)').fill('5');
				await dialog.getByRole('button', { name: 'Add extra session' }).click();
				await expect(dialog.locator('#extra-error')).toBeVisible();
				await expect(dialog.getByLabel('Duration (minutes)')).toHaveAttribute(
					'aria-invalid',
					'true'
				);

				await dialog.getByLabel('Duration (minutes)').fill('60');
				await dialog.getByRole('button', { name: 'Add extra session' }).click();
				await expect(toast(page, 'Extra session added.')).toBeVisible();
				await expect(dialog).toHaveCount(0);
				await expect(
					page.locator('.ec-event.chip').filter({ hasText: fx.classA.name }).filter({
						hasText: 'Extra'
					})
				).toHaveCount(1);
			} finally {
				await page.context().close();
				await service.from('class_days').delete().eq('day', date);
			}
		});

		test(`parent with two children: the picked child's answers (${viewport.name})`, async ({
			browser
		}) => {
			const page = await signedIn(browser, viewport.width, viewport.height, parent);
			try {
				await openCalendar(page, fx.month);
				const picker = page.getByRole('navigation', { name: 'Show sessions for' });
				await expect(picker.getByRole('link', { name: 'All children' })).toHaveAttribute(
					'aria-current',
					'page'
				);
				// Class B: both children's answers.
				await chipFor(page, 'B', fx.days[1]).click();
				const dialog = sessionDialog(page);
				await expect(dialog).toBeVisible();
				const answers = dialog.getByTestId('child-answers');
				await expect(answers).toContainText(studentName());
				await expect(answers).toContainText(child2Name());
				await expect(answers).toContainText('Not answered');
				await page.keyboard.press('Escape');

				await picker.getByRole('link', { name: child2Name() }).click();
				await expect(page).toHaveURL(new RegExp(`child=${child2.id}`));
				await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
				await expect(picker.getByRole('link', { name: child2Name() })).toHaveAttribute(
					'aria-current',
					'page'
				);
				await chipFor(page, 'B', fx.days[1]).click();
				await expect(dialog).toBeVisible();
				await expect(dialog.getByTestId('child-answers')).toContainText(child2Name());
				await expect(dialog.getByTestId('child-answers')).not.toContainText(studentName());
				// Child 2 is not in class A.
				await page.keyboard.press('Escape');
				await expect(chipFor(page, 'A', fx.days[1])).toHaveCount(0);
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`student: own answer, read-only (${viewport.name})`, async ({ browser }) => {
			const page = await signedIn(browser, viewport.width, viewport.height, fx.student);
			try {
				await openCalendar(page, fx.month);
				await chipFor(page, 'A', fx.days[1]).click();
				const dialog = sessionDialog(page);
				await expect(dialog).toBeVisible();
				await expectSheetOrDialog(dialog, viewport.width);
				await expect(dialog.getByTestId('own-answer')).toHaveText('Not answered');
				await expect(dialog.locator('input:not([type="hidden"]), select')).toHaveCount(0);
				await expect(dialog.locator('form')).toHaveCount(0);
				await expect(dialog.getByRole('button', { name: 'Close' }).last()).toBeInViewport();
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});
	}
});

test.describe('admin, phone and desktop', () => {
	for (const viewport of ADMIN_VIEWPORTS) {
		test(`cancel, move and delete a day with alert dialogs (${viewport.name})`, async ({
			browser
		}) => {
			// A future class day on the fixture weekday, so it has chips in the list.
			const from = `${fx.month}-25`;
			const to = `${fx.month}-26`;
			const day = check(
				await service.from('class_days').insert({ day: from }).select('id').single(),
				'add class day'
			);
			const page = await signedIn(browser, viewport.width, viewport.height, fx.admin);
			try {
				await openCalendar(page, fx.month);
				if (viewport.name === 'desktop') await expect(page.locator('.ec-day-grid')).toBeVisible();
				else await expect(page.locator('.ec-list')).toBeVisible();
				const dialog = dayDialog(page);

				await dayButton(page, from).click();
				await expect(dialog).toBeVisible();
				await expectSheetOrDialog(dialog, viewport.width);
				await expectFits(page);

				// Cancel day: the alert dialog's Cancel does nothing.
				await dialog.getByRole('button', { name: 'Cancel day' }).click();
				await expect(confirmDialog(page)).toBeVisible();
				await confirmDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
				await expect(confirmDialog(page)).toHaveCount(0);
				await expect(dialog).toBeVisible();
				await expect(dialog.getByRole('button', { name: 'Cancel day' })).toBeFocused();
				const { data: still } = await service
					.from('class_days')
					.select('cancelled')
					.eq('id', day.id)
					.single();
				expect(still?.cancelled).toBe(false);

				// Confirm: saved with a toast, focus back on the day.
				await dialog.getByRole('button', { name: 'Cancel day' }).click();
				await confirmDialog(page).getByRole('button', { name: 'Cancel day' }).click();
				await expect(toast(page, 'Class day cancelled.')).toBeVisible();
				await expect(dialog).toHaveCount(0);
				await expect(dayButton(page, from)).toBeFocused();

				// Restore it.
				await dayButton(page, from).click();
				await dialog.getByRole('button', { name: 'Restore day' }).click();
				await expect(toast(page, 'Class day restored.')).toBeVisible();
				await expect(dialog).toHaveCount(0);

				// An action error is a toast: moving a day to its own date.
				await dayButton(page, from).click();
				await dialog.getByLabel('New date').fill(from);
				await dialog.getByRole('button', { name: 'Move day' }).click();
				await expect(toast(page, 'That day is already on this date.')).toBeVisible();
				await expect(dialog).toBeVisible();

				// Move it, then delete it.
				await dialog.getByLabel('New date').fill(to);
				await dialog.getByRole('button', { name: 'Move day' }).click();
				await expect(toast(page, 'Class day moved.')).toBeVisible();
				await expect(dialog).toHaveCount(0);

				await dayButton(page, to).click();
				await expect(dialog).toBeVisible();
				await dialog.getByRole('button', { name: 'Delete day' }).click();
				await confirmDialog(page).getByRole('button', { name: 'Delete day' }).click();
				await expect(toast(page, 'Class day deleted.')).toBeVisible();
				await expect(dialog).toHaveCount(0);
				const { data: left } = await service.from('class_days').select('id').eq('id', day.id);
				expect(left).toEqual([]);
			} finally {
				await page.context().close();
				await service.from('class_days').delete().eq('id', day.id);
			}
		});

		test(`add class days: invalid range errors under the field, then saves (${viewport.name})`, async ({
			browser
		}) => {
			const page = await signedIn(browser, viewport.width, viewport.height, fx.admin);
			const first = `${fx.month}-29`;
			try {
				await openCalendar(page, fx.month);
				const add = page.getByTestId('add-days-button');
				await add.click();
				const dialog = dayDialog(page);
				await expect(dialog).toBeVisible();
				await expectSheetOrDialog(dialog, viewport.width);
				await expect(page.getByRole('dialog', { name: 'Add class days' })).toBeVisible();
				await dialog.locator('#add-start').fill(first);
				await dialog.locator('#add-end').fill(`${fx.month}-02`);
				await dialog.getByRole('button', { name: 'Add class days' }).click();
				await expect(dialog.locator('#add-days-error')).toHaveText(
					'The end date must be on or after the start date.'
				);
				await expect(dialog.locator('#add-end')).toHaveAttribute('aria-invalid', 'true');
				await expectFits(page);

				await dialog.locator('#add-end').fill(first);
				await dialog.getByRole('button', { name: 'Add class days' }).click();
				await expect(toast(page, /1 added/)).toBeVisible();
				await expect(dialog).toHaveCount(0);
				await expect(add).toBeFocused();
			} finally {
				await page.context().close();
				await service.from('class_days').delete().eq('day', first);
			}
		});
	}
});

for (const locale of ['en', 'de', 'bo']) {
	test(`calendar at 375px in ${locale}: fits for every role, with a sheet open`, async ({
		browser
	}) => {
		for (const who of [fx.teacher, fx.student, parent, fx.admin]) {
			const page = await signedIn(browser, 375, 740, who);
			try {
				await page
					.context()
					.addCookies([
						{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }
					]);
				await openCalendar(page, fx.month);
				await expect(page.locator('html')).toHaveAttribute('lang', locale);
				await page.waitForLoadState('networkidle');
				await expectFits(page);

				// A schedule row opened (teacher and admin).
				const toggle = page.locator(`button.schedule-toggle[data-class-id="${fx.classA.id}"]`);
				if ((await toggle.count()) > 0) {
					await toggle.click();
					await expect(
						page.locator(`form.schedule-form[data-class-id="${fx.classA.id}"]`)
					).toBeVisible();
					await expectFits(page);
				}

				await chipFor(page, 'B', fx.days[1]).click();
				const dialog = sessionDialog(page);
				await expect(dialog).toBeVisible();
				await expect(dialog).toHaveAttribute('data-slot', 'sheet-content');
				await expectFits(page);
				await page.keyboard.press('Escape');
				await expect(dialog).toHaveCount(0);

				if (who === fx.admin) {
					await dayButton(page, fx.days[1]).click();
					await expect(dayDialog(page)).toBeVisible();
					await expectFits(page);
				}
			} finally {
				await page.context().close();
			}
		}
	});
}
