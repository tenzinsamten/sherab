import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	berlinToday,
	createCalendarFixture,
	isoWeekday,
	openCalendar,
	service,
	signIn,
	type CalendarFixture,
	type TestUser
} from './fixtures';

/**
 * /calendar month grid (spec-47): the I/O & Edge-Case Matrix rows and the
 * acceptance criteria that need a browser. Fixtures: two classes (A 10:00,
 * B 12:00) taught by one teacher, a student enrolled in both, class days on
 * the 4th, 11th and 18th of October in a random far-future year, and class
 * B's session on the 4th cancelled.
 */

test.describe.configure({ mode: 'serial' });

let fx: CalendarFixture;

test.beforeAll(async () => {
	fx = await createCalendarFixture();
});

test.afterAll(async () => {
	await fx?.cleanup();
});

const WIDE = { width: 1280, height: 900 };
const PHONE = { width: 375, height: 800 };

const monthName = (month: string) =>
	new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
		new Date(`${month}-01T00:00:00Z`)
	);

/** Chips of the fixture's two classes. */
function fixtureChips(page: Page): Locator {
	return page.locator('.ec-event.chip').filter({ hasText: new RegExp(`E2E47 ${fx.tag} [AB]`) });
}

function chipFor(page: Page, key: 'A' | 'B' | 'C', date: string): Locator {
	const id = fx.sessions[`${key}:${date}`];
	return page.locator(`.ec-event.ev-${id}`);
}

/**
 * The session and day dialogs (mobile-first story 5b): a dialog from 48rem,
 * a bottom sheet below; either is in the page only while open.
 */
const sessionModal = (page: Page) => page.getByTestId('session-dialog');
const dayModal = (page: Page) => page.getByTestId('day-dialog');
/** The "Are you sure?" alert dialog. */
const confirmDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Are you sure?' });

/** Grid cell of `date` (the library puts chips in the same grid, not inside it). */
function gridCell(page: Page, date: string): Locator {
	return page
		.locator('.ec-day-grid .ec-day')
		.filter({ has: page.locator(`time[datetime="${date}"]`) });
}

async function inside(inner: Locator, outer: Locator): Promise<boolean> {
	const a = await inner.boundingBox();
	const b = await outer.boundingBox();
	if (!a || !b) return false;
	const cx = a.x + a.width / 2;
	const cy = a.y + a.height / 2;
	return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height;
}

async function expectMondayFirstGrid(page: Page) {
	await expect(page.locator('.ec-day-grid')).toBeVisible();
	await expect(page.locator('.ec-col-head').first()).toHaveText(/^Mon/);
	const first = await page.locator('.ec-day-grid .ec-day time').first().getAttribute('datetime');
	expect(new Date(`${first}T00:00:00Z`).getUTCDay()).toBe(1);
}

async function expectNoHorizontalScroll(page: Page) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('wide screen (1280px)', () => {
	test.use({ viewport: WIDE });

	test('teacher: Monday-first grid, 6 chips in 3 cells, cancelled chip marked', async ({
		page
	}) => {
		await signIn(page, fx.teacher);
		await openCalendar(page, fx.month);

		await expect(page.getByRole('heading', { level: 1 })).toHaveText(monthName(fx.month));
		await expectMondayFirstGrid(page);
		await expect(fixtureChips(page)).toHaveCount(6);
		for (const date of fx.days) {
			for (const key of ['A', 'B'] as const) {
				const chip = chipFor(page, key, date);
				await expect(chip).toBeVisible();
				expect(await inside(chip, gridCell(page, date))).toBe(true);
			}
		}
		// Chip = start time + class name.
		await expect(chipFor(page, 'A', fx.days[1])).toHaveText(`10:00 ${fx.classA.name}`);
		await expectNoHorizontalScroll(page);

		// Matrix "Cancelled": greyed / struck and labelled for screen readers.
		const cancelled = chipFor(page, 'B', fx.days[0]);
		await expect(cancelled).toHaveClass(/chip-cancelled/);
		await expect(cancelled).toHaveAccessibleName(/Cancelled/);
		await expect(cancelled.locator('.chip-text')).toHaveCSS('text-decoration-line', 'line-through');
		await expect(chipFor(page, 'A', fx.days[0])).not.toHaveClass(/chip-cancelled/);
	});

	for (const role of ['admin', 'student'] as const) {
		test(`${role}: Monday-first grid with the role's sessions as chips`, async ({ page }) => {
			await signIn(page, fx[role] as TestUser);
			await openCalendar(page, fx.month);
			await expectMondayFirstGrid(page);
			await expect(fixtureChips(page)).toHaveCount(6);
			for (const date of fx.days) {
				expect(await inside(chipFor(page, 'A', date), gridCell(page, date))).toBe(true);
			}
			await expectNoHorizontalScroll(page);
		});
	}

	test('today (Berlin) is highlighted in the current month', async ({ page }) => {
		await signIn(page, fx.teacher);
		await openCalendar(page);
		const today = berlinToday();
		const highlighted = page.locator('.ec-day-grid .ec-day.ec-highlight');
		await expect(highlighted).toHaveCount(1);
		await expect(highlighted.locator('time')).toHaveAttribute('datetime', today);
		const mark = highlighted.locator('.today-mark');
		await expect(mark).toBeVisible();
		// On a class day the teacher's day number is a button, marked as the
		// current date; otherwise "Today" is in the cell's text.
		if (await mark.evaluate((element) => element.tagName === 'BUTTON')) {
			await expect(mark).toHaveAttribute('aria-current', 'date');
		} else {
			await expect(highlighted).toContainText('Today');
		}
	});

	test('navigate: next month changes ?month= and shows that month', async ({ page }) => {
		await signIn(page, fx.teacher);
		await openCalendar(page, fx.month);
		await page.getByRole('button', { name: 'Next month' }).click();

		const next = `${fx.year}-11`;
		await expect(page).toHaveURL(new RegExp(`[?&]month=${next}$`));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(monthName(next));
		await expect(
			page.locator('.ec-day-grid .ec-day:not(.ec-other-month) time').first()
		).toHaveAttribute('datetime', `${next}-01`);
		// October's class days are not in November's cells.
		await expect(fixtureChips(page)).toHaveCount(0);
	});

	test('teacher edits a session: 11:00 saves and closes; invalid input errors in the dialog; empty resets to the default', async ({
		page
	}) => {
		const posts: URLSearchParams[] = [];
		page.on('request', (r) => {
			if (r.method() === 'POST' && r.url().includes('?/updateSession')) {
				posts.push(new URLSearchParams(r.postData() ?? ''));
			}
		});
		await signIn(page, fx.teacher);
		await openCalendar(page, fx.month);
		const date = fx.days[1];
		const modal = sessionModal(page);
		// Native fields (story 5b): empty means "use the class default" (#66).
		const start = modal.locator('#session-start');
		const duration = modal.locator('#session-duration');

		await chipFor(page, 'A', date).click();
		await expect(modal).toBeVisible();
		await expect(start).toBeVisible();
		await expect(modal).toContainText('Leave empty to use the class default (10:00, 90 min).');
		// No overrides: both empty.
		await expect(start).toHaveValue('');
		await expect(duration).toHaveValue('');
		// The hint describes the fields at all times.
		const hint = 'Leave empty to use the class default (10:00, 90 min).';
		await expect(start).toHaveAccessibleDescription(hint);
		await expect(duration).toHaveAccessibleDescription(hint);

		// Invalid duration: the error shows under the fields, both are marked
		// invalid and described by the message.
		await duration.fill('5');
		await modal.getByRole('button', { name: 'Save' }).click();
		const error = modal.locator('#session-error');
		await expect(error).toHaveText('Enter a duration between 15 and 480 minutes.');
		await expect(modal).toBeVisible();
		expect(posts.at(-1)?.get('startTime')).toBe('');
		expect(posts.at(-1)?.get('durationMinutes')).toBe('5');
		for (const field of [start, duration]) {
			await expect(field).toHaveAttribute('aria-invalid', 'true');
			await expect(field).toHaveAccessibleDescription(
				`${hint} Enter a duration between 15 and 480 minutes.`
			);
		}

		// Valid: 11:00, default duration.
		await duration.fill('');
		await start.fill('11:00');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(modal).toHaveCount(0);
		expect(posts.at(-1)?.get('startTime')).toBe('11:00');
		expect(posts.at(-1)?.get('durationMinutes')).toBe('');
		await expect(chipFor(page, 'A', date)).toHaveText(`11:00 ${fx.classA.name}`);
		// Focus is back on the (re-rendered) chip.
		await expect(chipFor(page, 'A', date)).toBeFocused();
		// Only that session changed.
		await expect(chipFor(page, 'A', fx.days[2])).toHaveText(`10:00 ${fx.classA.name}`);

		// Reopened: the override is shown, without the old error.
		await chipFor(page, 'A', date).click();
		await expect(modal).toBeVisible();
		await expect(start).toHaveValue('11:00');
		await expect(duration).toHaveValue('');
		await expect(error).toHaveCount(0);
		await expect(start).not.toHaveAttribute('aria-invalid');
		await expect(start).toHaveAccessibleDescription(hint);

		// Override 11:00 / 60 moves the chip and posts both.
		await duration.fill('60');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(modal).toHaveCount(0);
		expect(posts.at(-1)?.get('startTime')).toBe('11:00');
		expect(posts.at(-1)?.get('durationMinutes')).toBe('60');
		await chipFor(page, 'A', date).click();
		await expect(modal).toBeVisible();
		await expect(modal).toContainText('11:00–12:00');

		// Reset to the default: clear both, both post empty, the class default is back.
		await start.fill('');
		await duration.fill('');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(modal).toHaveCount(0);
		expect(posts.at(-1)?.get('startTime')).toBe('');
		expect(posts.at(-1)?.get('durationMinutes')).toBe('');
		await expect(chipFor(page, 'A', date)).toHaveText(`10:00 ${fx.classA.name}`);
		const { data: row } = await service
			.from('class_sessions')
			.select('start_time_override, duration_minutes_override')
			.eq('id', fx.sessions[`A:${date}`])
			.single();
		expect(row).toEqual({ start_time_override: null, duration_minutes_override: null });
	});

	test('student: chip opens read-only details without edit controls', async ({ page }) => {
		await signIn(page, fx.student);
		await openCalendar(page, fx.month);
		const modal = sessionModal(page);

		await chipFor(page, 'B', fx.days[2]).click();
		await expect(modal).toBeVisible();
		await expect(modal).toContainText(fx.classB.name);
		await expect(modal).toContainText('12:00–13:00');
		await expect(modal.locator('input:not([type="hidden"])')).toHaveCount(0);
		await expect(modal.locator('form')).toHaveCount(0);
		await expect(modal.getByRole('button', { name: 'Save' })).toHaveCount(0);
		await expect(modal.getByRole('button', { name: /Cancel session|Restore session/ })).toHaveCount(
			0
		);
	});

	test('admin clicks an empty date: add-class-days dialog, prefilled; end before start errors', async ({
		page
	}) => {
		await signIn(page, fx.admin);
		await openCalendar(page, fx.month);
		const modal = dayModal(page);

		// Click the empty part of the day cell, below the day-number button.
		// (Admin rows are tall: every class in the database has a chip on
		// the class days, so position the click from the cell's top.)
		await gridCell(page, fx.emptyDate).click({ position: { x: 60, y: 60 } });

		await expect(modal).toBeVisible();
		await expect(modal.locator('#add-start')).toHaveValue(fx.emptyDate);
		const end = modal.locator('#add-end');
		await end.fill(`${fx.month}-01`);
		await modal.getByRole('button', { name: 'Add class days' }).click();
		await expect(modal.locator('#add-days-error')).toHaveText(
			'The end date must be on or after the start date.'
		);
		await expect(modal).toBeVisible();
		await expect(end).toHaveAttribute('aria-invalid', 'true');
		await expect(end).toHaveAccessibleDescription(
			'The end date must be on or after the start date.'
		);
	});

	test('admin clicks an existing class day: cancel / restore dialog', async ({ page }) => {
		await signIn(page, fx.admin);
		await openCalendar(page, fx.month);
		const modal = dayModal(page);
		const date = fx.days[2];

		await page.locator(`button.day-button[data-date="${date}"]`).click();
		await expect(modal).toBeVisible();
		await expect(modal.getByRole('button', { name: 'Cancel day' })).toBeVisible();
		await expect(modal.locator('#add-start')).toHaveCount(0);

		// Cancel the day (confirming the alert dialog), then restore it.
		await modal.getByRole('button', { name: 'Cancel day' }).click();
		await confirmDialog(page).getByRole('button', { name: 'Cancel day' }).click();
		await expect(modal).toHaveCount(0);
		await expect(page.locator(`button.day-button[data-date="${date}"]`)).toBeFocused();
		await expect(chipFor(page, 'A', date)).toHaveClass(/chip-cancelled/);

		await page.locator(`button.day-button[data-date="${date}"]`).click();
		await expect(modal).toBeVisible();
		await modal.getByRole('button', { name: 'Restore day' }).click();
		await expect(modal).toHaveCount(0);
		await expect(chipFor(page, 'A', date)).not.toHaveClass(/chip-cancelled/);
	});

	test('keyboard: Tab to a chip, Enter opens its dialog, Escape returns focus', async ({
		page
	}) => {
		await signIn(page, fx.student);
		await openCalendar(page, fx.month);
		const chip = chipFor(page, 'A', fx.days[0]);
		const chipClass = `ev-${fx.sessions[`A:${fx.days[0]}`]}`;

		await page.locator('body').click({ position: { x: 1, y: 1 } });
		let reached = false;
		for (let i = 0; i < 150 && !reached; i++) {
			await page.keyboard.press('Tab');
			reached = await page.evaluate(
				(cls) => document.activeElement?.classList.contains(cls) ?? false,
				chipClass
			);
		}
		expect(reached).toBe(true);

		await page.keyboard.press('Enter');
		const modal = sessionModal(page);
		await expect(modal).toBeVisible();
		await expect(modal).toContainText(fx.classA.name);

		await page.keyboard.press('Escape');
		await expect(modal).toHaveCount(0);
		await expect(chip).toBeFocused();
	});

	test('session without a start time: chip and dialog say "Time not set"', async ({ page }) => {
		await signIn(page, fx.admin);
		await openCalendar(page, fx.month);
		const chip = chipFor(page, 'C', fx.days[1]);
		await expect(chip).toHaveText(`Time not set ${fx.classC.name}`);

		await chip.click();
		const modal = sessionModal(page);
		await expect(modal).toBeVisible();
		await expect(modal).toContainText(fx.classC.name);
		await expect(modal.locator('.details')).toContainText('Time not set');
	});

	test('student: clicking an empty grid cell opens no dialog', async ({ page }) => {
		await signIn(page, fx.student);
		await openCalendar(page, fx.month);
		await gridCell(page, fx.emptyDate).click({ position: { x: 60, y: 60 } });
		// Give a (wrongly) opening dialog time to appear.
		await page.waitForTimeout(500);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.locator('button.day-button')).toHaveCount(0);
	});

	test('teacher cancels a session from its dialog and restores it', async ({ page }) => {
		await signIn(page, fx.teacher);
		await openCalendar(page, fx.month);
		const date = fx.days[2];
		const modal = sessionModal(page);

		await chipFor(page, 'B', date).click();
		await expect(modal).toBeVisible();
		await modal.getByRole('button', { name: 'Cancel session' }).click();
		await expect(modal).toHaveCount(0);
		const chip = chipFor(page, 'B', date);
		await expect(chip).toHaveClass(/chip-cancelled/);
		await expect(chip).toHaveAccessibleName(/Cancelled/);
		await expect(chip.locator('.chip-text')).toHaveCSS('text-decoration-line', 'line-through');
		// Only that session.
		await expect(chipFor(page, 'A', date)).not.toHaveClass(/chip-cancelled/);

		await chip.click();
		await expect(modal).toBeVisible();
		await modal.getByRole('button', { name: 'Restore session' }).click();
		await expect(modal).toHaveCount(0);
		await expect(chipFor(page, 'B', date)).not.toHaveClass(/chip-cancelled/);
		await expect(chipFor(page, 'B', date)).not.toHaveAccessibleName(/Cancelled/);
	});

	test('admin header "Add class days" opens the add form even when the default date is a class day', async ({
		page
	}) => {
		// Outside the current month the default start date is the 1st.
		const first = `${fx.month}-01`;
		const { error } = await service.from('class_days').insert({ day: first });
		if (error) throw new Error(`add class day: ${error.message}`);
		try {
			await signIn(page, fx.admin);
			await openCalendar(page, fx.month);
			const modal = dayModal(page);

			await page.getByTestId('add-days-button').click();
			await expect(modal).toBeVisible();
			await expect(modal.locator('#add-start')).toHaveValue(first);
			await expect(modal.getByRole('button', { name: 'Cancel day' })).toHaveCount(0);
			await page.keyboard.press('Escape');
			await expect(modal).toHaveCount(0);

			// A day click on that class day still opens cancel / restore.
			await page.locator(`button.day-button[data-date="${first}"]`).click();
			await expect(modal).toBeVisible();
			await expect(modal.getByRole('button', { name: 'Cancel day' })).toBeVisible();
			await expect(modal.locator('#add-start')).toHaveCount(0);
		} finally {
			// Remove it again (its sessions cascade) so later tests see 3 days.
			await service.from('class_days').delete().eq('day', first);
		}
	});
});

test.describe('class schedules & extra sessions (Story 6-4)', () => {
	test.use({ viewport: WIDE });

	const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const weekdayLabel = (isoDay: number) => WEEKDAY_LABELS[isoDay - 1];

	/**
	 * An extra class day three days after the first fixture day: another
	 * weekday, so no fixture class is scheduled on it. Removed again (its
	 * sessions cascade) so the phone test still sees six chips.
	 */
	async function withOtherWeekdayClassDay(
		run: (date: string) => Promise<void>,
		date = `${fx.month}-07`
	) {
		const { error } = await service.from('class_days').insert({ day: date });
		if (error) throw new Error(`add class day: ${error.message}`);
		try {
			await run(date);
		} finally {
			await service.from('class_days').delete().eq('day', date);
		}
	}

	test('teacher edits a schedule: sessions move to the new weekday, the form keeps it', async ({
		page
	}) => {
		// Its own class (taught by the fixture teacher), so the other tests'
		// sessions and ids stay as they are. Every 2 weeks from the first
		// fixture day's ISO week (starting on its Monday, which may be in
		// September): sessions on the 4th and 18th, not the 11th.
		const name = `E2E47 ${fx.tag} D`;
		const weekStart = new Date(`${fx.days[0]}T00:00:00Z`);
		weekStart.setUTCDate(weekStart.getUTCDate() - (fx.weekday - 1));
		const { data: cls, error } = await service
			.from('classes')
			.insert({
				name,
				code: `E${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
				default_start_time: '09:00',
				default_duration_minutes: 45,
				schedule_weekdays: [fx.weekday],
				schedule_starts_on: weekStart.toISOString().slice(0, 10),
				schedule_ends_on: `${fx.year}-12-20`,
				schedule_interval_weeks: 2
			})
			.select('id')
			.single();
		if (error || !cls) throw new Error(`create class D: ${error?.message}`);
		// Another weekday in the same ISO week as the 4th (Mon-Sun), so the
		// every-2-weeks schedule still has a session there after the move.
		const sameWeekDay = `${fx.month}-${fx.weekday === 7 ? '03' : '05'}`;
		try {
			const { error: assignError } = await service
				.from('class_teachers')
				.insert({ class_id: cls.id, teacher_id: fx.teacher.id });
			if (assignError) throw new Error(`assign D: ${assignError.message}`);

			await withOtherWeekdayClassDay(async (date) => {
				const other = isoWeekday(date);
				await signIn(page, fx.teacher);
				await openCalendar(page, fx.month);
				const chipsOfD = page.locator('.ec-event.chip').filter({ hasText: name });
				await expect(chipsOfD).toHaveCount(2);

				// Collapsed row (#66): a summary, no form until expanded.
				const toggle = page.locator(`button.schedule-toggle[data-class-id="${cls.id}"]`);
				const form = page.locator(`form.schedule-form[data-class-id="${cls.id}"]`);
				await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
				await expect(toggle).toHaveAttribute('aria-expanded', 'false');
				await expect(toggle).toContainText(
					`${weekdayLabel(fx.weekday)} · 09:00 · 45 min · Every 2 weeks`
				);
				await expect(form).toHaveCount(0);
				await toggle.click();
				await expect(toggle).toHaveAttribute('aria-expanded', 'true');
				await expect(form).toBeVisible();

				const current = form.getByRole('checkbox', { name: weekdayLabel(fx.weekday) });
				const next = form.getByRole('checkbox', { name: weekdayLabel(other) });
				await expect(current).toBeChecked();
				await expect(next).not.toBeChecked();
				// Native fields (story 5b).
				const until = form.locator(`#schedule-${cls.id}-until`);
				const interval = form.locator(`#schedule-${cls.id}-interval`);
				const duration = form.locator(`#schedule-${cls.id}-duration`);
				await expect(until).toHaveValue(`${fx.year}-12-20`);
				await expect(interval).toHaveValue('2');
				await expect(duration).toHaveValue('45');

				// No weekday: inline error, nothing saved.
				await current.uncheck();
				await form.getByRole('button', { name: 'Save' }).click();
				await expect(form.getByRole('alert')).toHaveText('Pick at least one weekday.');
				await expect(current).toHaveAttribute('aria-invalid', 'true');
				// The fieldset carries the message, once; each box is marked invalid.
				await expect(form.getByRole('group', { name: 'Weekdays' })).toHaveAccessibleDescription(
					'Pick at least one weekday.'
				);
				// The failed save keeps what was entered, and the row stays open.
				await expect(toggle).toHaveAttribute('aria-expanded', 'true');
				await expect(current).not.toBeChecked();
				await expect(until).toHaveValue(`${fx.year}-12-20`);
				await expect(chipsOfD).toHaveCount(2);

				// "Until" before "From": the date field is marked invalid and
				// described by the message.
				await next.check();
				await until.fill(`${fx.year}-09-01`);
				await form.getByRole('button', { name: 'Save' }).click();
				const untilError = form.locator(`#schedule-${cls.id}-endsOn-error`);
				await expect(untilError).toHaveText('“Until” must be on or after “From”.');
				await expect(until).toHaveAttribute('aria-invalid', 'true');
				await expect(until).toHaveAccessibleDescription('“Until” must be on or after “From”.');
				await expect(next).not.toHaveAttribute('aria-invalid');
				await expect(chipsOfD).toHaveCount(2);

				await until.fill(`${fx.year}-12-20`);
				await expect(current).not.toBeChecked();
				await expect(next).toBeChecked();
				await form.getByRole('button', { name: 'Save' }).click();
				await expect(page.locator('ix-toast').getByText('Schedule saved.')).toBeVisible();

				// Future sessions follow the new schedule.
				await expect(chipsOfD).toHaveCount(1);
				expect(await inside(chipsOfD.first(), gridCell(page, date))).toBe(true);
				await expect(chipsOfD.first()).toHaveText(`09:00 ${name}`);
				await expect(form.getByRole('alert')).toHaveCount(0);
				await expect(until).not.toHaveAttribute('aria-invalid');
				await expect(next).toBeChecked();
				await expect(current).not.toBeChecked();
				await expect(next).not.toHaveAttribute('aria-invalid');
				// Until, interval and duration survive a save that only changed
				// the weekdays: in the form and in the database.
				await expect(until).toHaveValue(`${fx.year}-12-20`);
				await expect(interval).toHaveValue('2');
				await expect(duration).toHaveValue('45');
				const { data: saved } = await service
					.from('classes')
					.select(
						'schedule_weekdays, schedule_ends_on, schedule_interval_weeks, default_duration_minutes, default_start_time'
					)
					.eq('id', cls.id)
					.single();
				expect(saved).toEqual({
					schedule_weekdays: [other],
					schedule_ends_on: `${fx.year}-12-20`,
					schedule_interval_weeks: 2,
					default_duration_minutes: 45,
					default_start_time: '09:00:00'
				});
				// Other classes are untouched.
				await expect(fixtureChips(page)).toHaveCount(6);
			}, sameWeekDay);
		} finally {
			await service.from('classes').delete().eq('id', cls.id);
		}
	});

	test('two expanded schedule rows: saving one keeps the unsaved edit in the other', async ({
		page
	}) => {
		await signIn(page, fx.admin);
		await openCalendar(page, fx.month);
		const rowA = page.locator(`button.schedule-toggle[data-class-id="${fx.classA.id}"]`);
		const rowB = page.locator(`button.schedule-toggle[data-class-id="${fx.classB.id}"]`);
		const rowC = page.locator(`button.schedule-toggle[data-class-id="${fx.classC.id}"]`);
		// Summaries: a weekly class has no interval suffix; no start time
		// reads "Time not set" (class C has neither time nor duration).
		const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][fx.weekday - 1];
		await expect(rowA).toContainText(fx.classA.name);
		await expect(rowA.locator('.schedule-summary')).toHaveText(`${day} · 10:00 · 90 min`);
		await expect(rowC).toContainText(fx.classC.name);
		await expect(rowC.locator('.schedule-summary')).toHaveText(`${day} · Time not set`);
		await rowA.click();
		await rowB.click();
		const formA = page.locator(`form.schedule-form[data-class-id="${fx.classA.id}"]`);
		const formB = page.locator(`form.schedule-form[data-class-id="${fx.classB.id}"]`);
		const durationB = formB.locator(`#schedule-${fx.classB.id}-duration`);
		const intervalB = formB.locator(`#schedule-${fx.classB.id}-interval`);
		const startB = formB.locator(`#schedule-${fx.classB.id}-start`);
		const untilB = formB.locator(`#schedule-${fx.classB.id}-until`);
		const otherDay = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][fx.weekday % 7];
		const otherBoxB = formB.getByRole('checkbox', { name: otherDay, exact: true });
		await expect(durationB).toHaveValue('60');
		await expect(intervalB).toHaveValue('1');
		await expect(startB).toHaveValue('12:00');
		await expect(untilB).toHaveValue(`${fx.year}-12-31`);
		await expect(otherBoxB).not.toBeChecked();

		// Unsaved edits in B (every kind of field), then save A unchanged.
		await durationB.fill('75');
		await intervalB.selectOption('3');
		await otherBoxB.check();
		await startB.fill('13:15');
		await untilB.fill(`${fx.year}-11-30`);
		const expectEditsKept = async () => {
			await expect(durationB).toHaveValue('75');
			await expect(intervalB).toHaveValue('3');
			await expect(otherBoxB).toBeChecked();
			await expect(startB).toHaveValue('13:15');
			await expect(untilB).toHaveValue(`${fx.year}-11-30`);
		};
		await formA.getByRole('button', { name: 'Save' }).click();
		await expect(page.locator('ix-toast').getByText('Schedule saved.')).toBeVisible();

		await expectEditsKept();

		// Collapsing keeps the form (hidden) and its unsaved edits.
		await rowB.click();
		await expect(rowB).toHaveAttribute('aria-expanded', 'false');
		await expect(formB).toBeHidden();
		await rowB.click();
		await expect(formB).toBeVisible();
		await expectEditsKept();
		const { data } = await service
			.from('classes')
			.select(
				'default_duration_minutes, schedule_interval_weeks, schedule_weekdays, default_start_time, schedule_ends_on'
			)
			.eq('id', fx.classB.id)
			.single();
		expect(data).toEqual({
			default_duration_minutes: 60,
			schedule_interval_weeks: 1,
			schedule_weekdays: [fx.weekday],
			default_start_time: '12:00:00',
			schedule_ends_on: `${fx.year}-12-31`
		});
	});

	test('admin adds an extra session from the day dialog: chip on that day, marked Extra', async ({
		page
	}) => {
		const posts: URLSearchParams[] = [];
		page.on('request', (r) => {
			if (r.method() === 'POST' && r.url().includes('?/addExtraSession')) {
				posts.push(new URLSearchParams(r.postData() ?? ''));
			}
		});
		await withOtherWeekdayClassDay(async (date) => {
			await signIn(page, fx.admin);
			await openCalendar(page, fx.month);
			const modal = dayModal(page);
			const chipOfA = page
				.locator('.ec-event.chip')
				.filter({ hasText: fx.classA.name })
				.filter({ hasText: 'Extra' });
			await expect(chipOfA).toHaveCount(0);

			await page.locator(`button.day-button[data-date="${date}"]`).click();
			await expect(modal).toBeVisible();
			await expect(modal.getByRole('heading', { name: 'Add extra session' })).toBeVisible();
			// Native fields (story 5b): time and duration start empty.
			const extraClass = modal.locator('#extra-class');
			await expect(modal.locator('#extra-start')).toHaveValue('');
			await expect(modal.locator('#extra-duration')).toHaveValue('');
			await extraClass.selectOption(fx.classA.id);
			await expect(extraClass).toHaveValue(fx.classA.id);
			await modal.locator('#extra-start').fill('14:00');
			await modal.locator('#extra-duration').fill('60');
			await modal.getByRole('button', { name: 'Add extra session' }).click();
			await expect(modal).toHaveCount(0);
			expect(posts).toHaveLength(1);
			expect(posts[0].get('classId')).toBe(fx.classA.id);
			expect(posts[0].get('startTime')).toBe('14:00');
			expect(posts[0].get('durationMinutes')).toBe('60');

			await expect(chipOfA).toHaveCount(1);
			await expect(chipOfA).toHaveText(`14:00 ${fx.classA.name} Extra`);
			expect(await inside(chipOfA, gridCell(page, date))).toBe(true);

			// The session dialog says Extra too; the class is no longer offered.
			await chipOfA.click();
			const sessionDialog = sessionModal(page);
			await expect(sessionDialog).toBeVisible();
			await expect(sessionDialog.getByTestId('extra-badge')).toHaveText('Extra');
			await expect(sessionDialog).toContainText('14:00–15:00');
			await page.keyboard.press('Escape');
			await expect(sessionDialog).toHaveCount(0);

			await page.locator(`button.day-button[data-date="${date}"]`).click();
			await expect(modal).toBeVisible();
			await expect(modal.locator(`#extra-class option[value="${fx.classA.id}"]`)).toHaveCount(0);
			// The select posts a class it actually lists.
			const offered = await modal
				.locator('#extra-class option')
				.evaluateAll((items) => items.map((i) => i.getAttribute('value')));
			expect(offered.length).toBeGreaterThan(0);
			await expect(extraClass).toHaveValue(offered[0]!);
			const posted = await modal
				.locator('form[action="?/addExtraSession"]')
				.evaluate((f) => new FormData(f as HTMLFormElement).get('classId'));
			expect(offered).toContain(posted);
			expect(posted).not.toBe(fx.classA.id);
		});
	});

	test('teacher opens a class day: extra-session form lists only their classes without a session', async ({
		page
	}) => {
		await signIn(page, fx.teacher);
		await openCalendar(page, fx.month);
		const modal = dayModal(page);

		// A class day where both of the teacher's classes already have a session.
		await page.locator(`button.day-button[data-date="${fx.days[2]}"]`).click();
		await expect(modal).toBeVisible();
		await expect(modal).toContainText(
			'Every class you can edit already has a session on this day.'
		);
		await expect(modal.getByRole('button', { name: 'Cancel day' })).toHaveCount(0);
		await page.keyboard.press('Escape');

		// Not a class day: no dialog for teachers.
		await expect(page.locator(`button.day-button[data-date="${fx.emptyDate}"]`)).toHaveCount(0);
	});
});

test.describe('admin creates a class with a schedule (Story 6-4)', () => {
	test.use({ viewport: WIDE });

	test('form defaults to Sunday from today; the class is created with the chosen schedule', async ({
		page
	}) => {
		const name = `E2E47 ${fx.tag} New`;
		try {
			await signIn(page, fx.admin);
			await page.goto('/admin/classes');
			await page.waitForFunction(() => customElements.get('ix-button') !== undefined);
			await page.waitForLoadState('networkidle');

			// Defaults: Sunday only, From = today (Berlin), no Until.
			for (const [label, checked] of [
				['Mon', false],
				['Wed', false],
				['Sat', false],
				['Sun', true]
			] as const) {
				const box = page.getByRole('checkbox', { name: label, exact: true });
				if (checked) await expect(box).toBeChecked();
				else await expect(box).not.toBeChecked();
			}
			// ScheduleFields' native fields (story 5b) inside the iX page.
			await expect(page.locator('#new-class-from')).toHaveValue(berlinToday());
			await expect(page.locator('#new-class-until')).toHaveValue('');
			// Time and duration unset.
			await expect(page.locator('#new-class-start')).toHaveValue('');
			await expect(page.locator('#new-class-duration')).toHaveValue('');

			await page.locator('#name input').first().fill(name);
			// #76: the Tibetan name is required too.
			await page.locator('#name-bo input').first().fill(`${name} bo`);
			await page.getByRole('checkbox', { name: 'Wed', exact: true }).check();
			await page.locator('#new-class-start').fill('10:00');
			await page.locator('#new-class-duration').fill('90');
			await page.locator('#new-class-until').fill(`${fx.year}-12-20`);
			// Badge detail CAP-1: the subject is required.
			const subject = page.locator('#new-class-subject');
			await subject.locator('input').first().click();
			await subject.locator('ix-select-item[value="dance"]').click();
			await expect(subject).toHaveJSProperty('value', 'dance');
			await page.getByRole('button', { name: 'Create class' }).click();

			await expect(page.locator('ix-toast').getByText(`Class "${name}" created`)).toBeVisible();
			// #76: the cell shows the name and, under it, the names in the other languages.
			await expect(
				page.getByRole('cell', { name: `${name} ${name} bo`, exact: true })
			).toBeVisible();
			const { data } = await service
				.from('classes')
				.select(
					'schedule_weekdays, schedule_starts_on, schedule_ends_on, default_start_time, default_duration_minutes, badge_subject'
				)
				.eq('name', name)
				.single();
			expect(data).toEqual({
				schedule_weekdays: [3, 7],
				schedule_starts_on: berlinToday(),
				schedule_ends_on: `${fx.year}-12-20`,
				default_start_time: '10:00:00',
				default_duration_minutes: 90,
				badge_subject: 'dance'
			});
			// The form is back to the defaults for the next class.
			await expect(page.locator('#name')).toHaveJSProperty('value', '');
			await expect(page.getByRole('checkbox', { name: 'Wed', exact: true })).not.toBeChecked();
			await expect(page.getByRole('checkbox', { name: 'Sun', exact: true })).toBeChecked();
		} finally {
			await service.from('classes').delete().eq('name', name);
		}
	});
});

test.describe('admin creates a class with blank time and duration (#66)', () => {
	test.use({ viewport: WIDE });

	test('blank start time and duration are stored as null, not iX defaults', async ({ page }) => {
		const name = `E2E47 ${fx.tag} Blank`;
		const posts: string[] = [];
		page.on('request', (r) => {
			if (r.method() === 'POST' && r.url().includes('?/create')) posts.push(r.postData() ?? '');
		});
		try {
			await signIn(page, fx.admin);
			await page.goto('/admin/classes');
			await page.waitForFunction(() => customElements.get('ix-button') !== undefined);
			await page.waitForLoadState('networkidle');
			await expect(page.locator('#new-class-start')).toHaveValue('');
			await expect(page.locator('#new-class-duration')).toHaveValue('');

			await page.locator('#name input').first().fill(name);
			// #76: the Tibetan name is required too.
			await page.locator('#name-bo input').first().fill(`${name} bo`);
			// Badge detail CAP-1: the subject is required.
			const subject = page.locator('#new-class-subject');
			await subject.locator('input').first().click();
			await subject.locator('ix-select-item[value="language"]').click();
			await expect(subject).toHaveJSProperty('value', 'language');
			await page.getByRole('button', { name: 'Create class' }).click();
			await expect(page.locator('ix-toast').getByText(`Class "${name}" created`)).toBeVisible();

			expect(posts).toHaveLength(1);
			const posted = new URLSearchParams(posts[0]);
			expect(posted.get('startTime')).toBe('');
			expect(posted.get('durationMinutes')).toBe('');
			expect(posted.getAll('weekday')).toEqual(['7']);
			expect(posted.get('intervalWeeks')).toBe('1');
			const { data } = await service
				.from('classes')
				.select('default_start_time, default_duration_minutes, schedule_interval_weeks')
				.eq('name', name)
				.single();
			expect(data).toEqual({
				default_start_time: null,
				default_duration_minutes: null,
				schedule_interval_weeks: 1
			});
		} finally {
			await service.from('classes').delete().eq('name', name);
		}
	});
});

test.describe('admin class form: schedule errors inside the iX page (story 5b)', () => {
	test.use({ viewport: WIDE });

	test('no weekday and "Until" before "From": errors under the fields, values kept, nothing created', async ({
		page
	}) => {
		const name = `E2E47 ${fx.tag} Errors`;
		try {
			await signIn(page, fx.admin);
			await page.goto('/admin/classes');
			await page.waitForFunction(() => customElements.get('ix-button') !== undefined);
			await page.waitForLoadState('networkidle');

			await page.locator('#name input').first().fill(name);
			await page.locator('#name-bo input').first().fill(`${name} bo`);
			const subject = page.locator('#new-class-subject');
			await subject.locator('input').first().click();
			await subject.locator('ix-select-item[value="language"]').click();
			await expect(subject).toHaveJSProperty('value', 'language');

			const sunday = page.getByRole('checkbox', { name: 'Sun', exact: true });
			await sunday.uncheck();
			await page.locator('#new-class-interval').selectOption('3');
			await page.locator('#new-class-duration').fill('50');
			await page.locator('#new-class-from').fill(`${fx.year}-10-10`);
			await page.locator('#new-class-until').fill(`${fx.year}-10-01`);
			await page.getByRole('button', { name: 'Create class' }).click();

			await expect(page.locator('#new-class-weekdays-error')).toHaveText(
				'Pick at least one weekday.'
			);
			await expect(sunday).toHaveAttribute('aria-invalid', 'true');
			await expect(page.getByRole('group', { name: 'Weekdays' })).toHaveAccessibleDescription(
				'Pick at least one weekday.'
			);
			await expect(page.locator('#new-class-endsOn-error')).toHaveText(
				'“Until” must be on or after “From”.'
			);
			await expect(page.locator('#new-class-until')).toHaveAttribute('aria-invalid', 'true');
			// The failed create keeps what was entered.
			await expect(sunday).not.toBeChecked();
			await expect(page.locator('#new-class-interval')).toHaveValue('3');
			await expect(page.locator('#new-class-duration')).toHaveValue('50');
			await expect(page.locator('#new-class-until')).toHaveValue(`${fx.year}-10-01`);
			const { data } = await service.from('classes').select('id').eq('name', name);
			expect(data).toEqual([]);
		} finally {
			await service.from('classes').delete().eq('name', name);
		}
	});
});

test.describe('many classes (#66)', () => {
	test.use({ viewport: WIDE });

	test('admin calendar with ~130 classes renders the grid with collapsed schedule rows', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const prefix = `E2E66 ${fx.tag} many`;
		// Unique codes: the run's tag plus the index.
		const rows = Array.from({ length: 130 }, (_, i) => ({
			name: `${prefix} ${String(i).padStart(3, '0')}`,
			code: `M${fx.tag.toUpperCase()}${String(i).padStart(3, '0')}`
		}));
		const { error } = await service.from('classes').insert(rows);
		if (error) throw new Error(`create many classes: ${error.message}`);
		try {
			await signIn(page, fx.admin);
			await openCalendar(page, fx.month);
			await expect(page.locator('.ec-day-grid')).toBeVisible({ timeout: 20_000 });
			await expect(fixtureChips(page)).toHaveCount(6);

			const toggles = page.locator('button.schedule-toggle');
			expect(await toggles.count()).toBeGreaterThanOrEqual(130);
			await expect(page.locator('button.schedule-toggle[aria-expanded="true"]')).toHaveCount(0);
			await expect(page.locator('form.schedule-form')).toHaveCount(0);

			const one = toggles.filter({ hasText: `${prefix} 042` });
			await one.click();
			await expect(one).toHaveAttribute('aria-expanded', 'true');
			await expect(page.locator('form.schedule-form')).toHaveCount(1);
			await expect(page.locator('form.schedule-form input[type="checkbox"]')).toHaveCount(7);
		} finally {
			await service.from('classes').delete().like('name', `${prefix} %`);
		}
	});
});

test.describe('admin moves and deletes a class day (#105)', () => {
	test.use({ viewport: WIDE });

	test('admin moves a future day with its sessions, then deletes the untouched day', async ({
		page
	}) => {
		// A fifth class day on the fixture weekday (so classes A and B get
		// sessions), moved to the next day and then deleted. Removed in any
		// case, so the phone test still sees six chips.
		const from = `${fx.month}-25`;
		const to = `${fx.month}-26`;
		const { data: day, error } = await service
			.from('class_days')
			.insert({ day: from })
			.select('id')
			.single();
		if (error || !day) throw new Error(`add class day: ${error?.message}`);
		try {
			const { data: session, error: sessionError } = await service
				.from('class_sessions')
				.select('id')
				.eq('class_day_id', day.id)
				.eq('class_id', fx.classA.id)
				.maybeSingle();
			if (sessionError || !session) {
				throw new Error(
					`class A has no session on the added day ${from}: ${sessionError?.message ?? 'none found'}`
				);
			}
			const chip = page.locator(`.ec-event.ev-${session.id}`);

			await signIn(page, fx.admin);
			await openCalendar(page, fx.month);
			const modal = dayModal(page);
			await expect(chip).toBeVisible();
			expect(await inside(chip, gridCell(page, from))).toBe(true);

			await page.locator(`button.day-button[data-date="${from}"]`).click();
			await expect(modal).toBeVisible();
			await modal.locator('#move-date').fill(to);
			await modal.getByRole('button', { name: 'Move day' }).click();
			await expect(page.locator('ix-toast').getByText('Class day moved.')).toBeVisible();
			await expect(modal).toHaveCount(0);

			// The same session, now on the new date; the old date is empty.
			await expect(chip).toBeVisible();
			await expect.poll(() => inside(chip, gridCell(page, to))).toBe(true);
			const { data: oldDate } = await service.from('class_days').select('id').eq('day', from);
			expect(oldDate).toEqual([]);

			// Delete it (confirming the alert dialog): the day and its sessions go.
			await page.locator(`button.day-button[data-date="${to}"]`).click();
			await expect(modal).toBeVisible();
			await modal.getByRole('button', { name: 'Delete day' }).click();
			await confirmDialog(page).getByRole('button', { name: 'Delete day' }).click();
			await expect(page.locator('ix-toast').getByText('Class day deleted.')).toBeVisible();
			await expect(modal).toHaveCount(0);
			await expect(chip).toHaveCount(0);
			const { data: left } = await service.from('class_days').select('id').eq('id', day.id);
			expect(left).toEqual([]);
		} finally {
			// Only the day this test added (whatever its date is by now).
			await service.from('class_days').delete().eq('id', day.id);
		}
	});

	/** Opens the admin day view of `day`: the existing class day, or one this test adds and removes. */
	async function withClassDay(page: Page, day: string, run: (modal: Locator) => Promise<void>) {
		const { data: existing } = await service
			.from('class_days')
			.select('id')
			.eq('day', day)
			.maybeSingle();
		let createdId: string | null = null;
		if (!existing) {
			const { data, error } = await service
				.from('class_days')
				.insert({ day })
				.select('id')
				.single();
			if (error || !data) throw new Error(`add class day ${day}: ${error?.message}`);
			createdId = data.id;
		}
		try {
			await openCalendar(page, day.slice(0, 7));
			const modal = dayModal(page);
			await page.locator(`button.day-button[data-date="${day}"]`).click();
			await expect(modal).toBeVisible();
			await run(modal);
		} finally {
			if (createdId) await service.from('class_days').delete().eq('id', createdId);
		}
	}

	async function expectNoMoveOrDelete(modal: Locator) {
		await expect(modal.getByRole('button', { name: /^(Cancel|Restore) day$/ })).toBeVisible();
		await expect(modal.getByRole('button', { name: 'Move day' })).toHaveCount(0);
		await expect(modal.getByRole('button', { name: 'Delete day' })).toHaveCount(0);
		await expect(modal.locator('#move-date')).toHaveCount(0);
	}

	test("today's day offers Cancel/Restore but no Move or Delete", async ({ page }) => {
		await signIn(page, fx.admin);
		await withClassDay(page, berlinToday(), expectNoMoveOrDelete);
	});

	test('a past day offers Cancel/Restore but no Move or Delete', async ({ page }) => {
		await signIn(page, fx.admin);
		// A random long-past date (years from 1900 are viewable).
		const year = 1901 + Math.floor(Math.random() * 80);
		const past = `${year}-03-${String(10 + Math.floor(Math.random() * 18))}`;
		await withClassDay(page, past, expectNoMoveOrDelete);
	});
});

test.describe('phone width (375px)', () => {
	test.use({ viewport: PHONE });

	test('list view grouped by date with the same chips', async ({ page }) => {
		await signIn(page, fx.teacher);
		await openCalendar(page, fx.month);

		await expect(page.locator('.ec-list')).toBeVisible();
		await expect(page.locator('.ec-day-grid')).toHaveCount(0);
		await expect(fixtureChips(page)).toHaveCount(6);
		for (const date of fx.days) {
			const group = page
				.locator('.ec-list [role="listitem"]')
				.filter({ has: page.locator(`time[datetime="${date}"]`) });
			await expect(group).toHaveCount(1);
			await expect(group.locator('.ec-event.chip')).toHaveCount(2);
			await expect(group).toContainText(fx.classA.name);
			await expect(group).toContainText(fx.classB.name);
		}
		await expectNoHorizontalScroll(page);
	});
});
