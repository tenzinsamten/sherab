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

/** The ix-modal hosts: session dialog first, day dialog second. */
const sessionModal = (page: Page) => page.locator('ix-modal').nth(0);
const dayModal = (page: Page) => page.locator('ix-modal').nth(1);
const isOpen = (modal: Locator) => modal.locator('dialog[open]');

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
		await expect(highlighted.locator('.today-mark')).toBeVisible();
		await expect(highlighted).toContainText('Today');
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
		// iX fields (#66): the host's `value` is what the form posts; typing
		// goes into the native <input> in its shadow DOM.
		const start = modal.locator('#session-start');
		const duration = modal.locator('#session-duration');
		const startInput = start.locator('input').first();
		const durationInput = duration.locator('input').first();

		await chipFor(page, 'A', date).click();
		await expect(isOpen(modal)).toBeVisible();
		await expect(start).toBeVisible();
		await expect(modal).toContainText('Leave empty to use the class default (10:00, 90 min).');
		// No overrides: both empty, not iX's defaults (current time, 0).
		await expect(start).toHaveJSProperty('value', '');
		await expect(duration).toHaveJSProperty('value', null);
		// The hint describes the fields at all times.
		const hint = 'Leave empty to use the class default (10:00, 90 min).';
		const description = (input: Locator) =>
			input.evaluate((el) =>
				(el.ariaDescribedByElements ?? []).map((d) => d.textContent?.trim()).join(' ')
			);
		await expect.poll(() => description(startInput)).toBe(hint);
		await expect.poll(() => description(durationInput)).toBe(hint);

		// Invalid duration: the error shows under the fields, both are marked
		// invalid and their native inputs are described by the message.
		await durationInput.fill('5');
		await expect(duration).toHaveJSProperty('value', 5);
		await modal.getByRole('button', { name: 'Save' }).click();
		const error = modal.locator('#session-error');
		await expect(error).toHaveText('Enter a duration between 15 and 480 minutes.');
		await expect(isOpen(modal)).toBeVisible();
		expect(posts.at(-1)?.get('startTime')).toBe('');
		expect(posts.at(-1)?.get('durationMinutes')).toBe('5');
		for (const [host, input] of [
			[start, startInput],
			[duration, durationInput]
		] as const) {
			await expect(host).toHaveClass(/\bix-invalid\b/);
			await expect(input).toHaveAttribute('aria-invalid', 'true');
			await expect
				.poll(() => description(input))
				.toBe(`${hint} Enter a duration between 15 and 480 minutes.`);
		}

		// Valid: 11:00, default duration.
		await durationInput.fill('');
		// Cleared by the user, iX reports `undefined` (it loaded with `null`).
		await expect
			.poll(() =>
				duration.evaluate((el) => (el as HTMLElement & { value?: unknown }).value ?? null)
			)
			.toBeNull();
		await startInput.fill('11:00');
		await expect(start).toHaveJSProperty('value', '11:00');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(isOpen(modal)).toHaveCount(0);
		expect(posts.at(-1)?.get('startTime')).toBe('11:00');
		expect(posts.at(-1)?.get('durationMinutes')).toBe('');
		await expect(chipFor(page, 'A', date)).toHaveText(`11:00 ${fx.classA.name}`);
		// Only that session changed.
		await expect(chipFor(page, 'A', fx.days[2])).toHaveText(`10:00 ${fx.classA.name}`);

		// Reopened: the override is shown, without the old error.
		await chipFor(page, 'A', date).click();
		await expect(isOpen(modal)).toBeVisible();
		await expect(start).toHaveJSProperty('value', '11:00');
		await expect(duration).toHaveJSProperty('value', null);
		await expect(error).toHaveCount(0);
		await expect(start).not.toHaveClass(/\bix-invalid\b/);
		await expect(startInput).not.toHaveAttribute('aria-invalid');
		await expect.poll(() => description(startInput)).toBe(hint);

		// Override 11:00 / 60 moves the chip and posts both.
		await durationInput.fill('60');
		await expect(duration).toHaveJSProperty('value', 60);
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(isOpen(modal)).toHaveCount(0);
		expect(posts.at(-1)?.get('startTime')).toBe('11:00');
		expect(posts.at(-1)?.get('durationMinutes')).toBe('60');
		await chipFor(page, 'A', date).click();
		await expect(isOpen(modal)).toBeVisible();
		await expect(modal).toContainText('11:00–12:00');

		// Reset to the default: clear both, both post empty, the class default is back.
		await startInput.fill('');
		await expect(start).toHaveJSProperty('value', '');
		await durationInput.fill('');
		// Cleared by the user, iX reports `undefined` (it loaded with `null`).
		await expect
			.poll(() =>
				duration.evaluate((el) => (el as HTMLElement & { value?: unknown }).value ?? null)
			)
			.toBeNull();
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(isOpen(modal)).toHaveCount(0);
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
		await expect(isOpen(modal)).toBeVisible();
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

		await expect(isOpen(modal)).toBeVisible();
		await expect(modal.locator('#add-start')).toHaveJSProperty('value', fx.emptyDate);
		const end = modal.locator('#add-end');
		await end.locator('input').first().fill(`${fx.month}-01`);
		await expect(end).toHaveJSProperty('value', `${fx.month}-01`);
		await modal.getByRole('button', { name: 'Add class days' }).click();
		await expect(modal.locator('#add-days-error')).toHaveText(
			'The end date must be on or after the start date.'
		);
		await expect(isOpen(modal)).toBeVisible();
		await expect(end).toHaveClass(/\bix-invalid\b/);
		await expect(end.locator('input').first()).toHaveAttribute('aria-invalid', 'true');
	});

	test('admin clicks an existing class day: cancel / restore dialog', async ({ page }) => {
		await signIn(page, fx.admin);
		await openCalendar(page, fx.month);
		const modal = dayModal(page);
		const date = fx.days[2];

		await page.locator(`button.day-button[data-date="${date}"]`).click();
		await expect(isOpen(modal)).toBeVisible();
		await expect(modal.getByRole('button', { name: 'Cancel day' })).toBeVisible();
		await expect(modal.locator('#add-start')).toHaveCount(0);

		// Cancel the day (confirming the iX warning), then restore it.
		await modal.getByRole('button', { name: 'Cancel day' }).click();
		await page.locator('ix-modal').getByRole('button', { name: 'Cancel day' }).last().click();
		await expect(isOpen(modal)).toHaveCount(0);
		await expect(chipFor(page, 'A', date)).toHaveClass(/chip-cancelled/);

		await page.locator(`button.day-button[data-date="${date}"]`).click();
		await expect(isOpen(modal)).toBeVisible();
		await modal.getByRole('button', { name: 'Restore day' }).click();
		await expect(isOpen(modal)).toHaveCount(0);
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
		await expect(isOpen(modal)).toBeVisible();
		await expect(modal).toContainText(fx.classA.name);

		await page.keyboard.press('Escape');
		await expect(isOpen(modal)).toHaveCount(0);
		await expect(chip).toBeFocused();
	});

	test('session without a start time: chip and dialog say "Time not set"', async ({ page }) => {
		await signIn(page, fx.admin);
		await openCalendar(page, fx.month);
		const chip = chipFor(page, 'C', fx.days[1]);
		await expect(chip).toHaveText(`Time not set ${fx.classC.name}`);

		await chip.click();
		const modal = sessionModal(page);
		await expect(isOpen(modal)).toBeVisible();
		await expect(modal).toContainText(fx.classC.name);
		await expect(modal.locator('.details')).toContainText('Time not set');
	});

	test('student: clicking an empty grid cell opens no dialog', async ({ page }) => {
		await signIn(page, fx.student);
		await openCalendar(page, fx.month);
		await gridCell(page, fx.emptyDate).click({ position: { x: 60, y: 60 } });
		// Give a (wrongly) opening dialog time to appear.
		await page.waitForTimeout(500);
		await expect(page.locator('ix-modal dialog[open]')).toHaveCount(0);
		await expect(page.locator('button.day-button')).toHaveCount(0);
	});

	test('teacher cancels a session from its dialog and restores it', async ({ page }) => {
		await signIn(page, fx.teacher);
		await openCalendar(page, fx.month);
		const date = fx.days[2];
		const modal = sessionModal(page);

		await chipFor(page, 'B', date).click();
		await expect(isOpen(modal)).toBeVisible();
		await modal.getByRole('button', { name: 'Cancel session' }).click();
		await expect(isOpen(modal)).toHaveCount(0);
		const chip = chipFor(page, 'B', date);
		await expect(chip).toHaveClass(/chip-cancelled/);
		await expect(chip).toHaveAccessibleName(/Cancelled/);
		await expect(chip.locator('.chip-text')).toHaveCSS('text-decoration-line', 'line-through');
		// Only that session.
		await expect(chipFor(page, 'A', date)).not.toHaveClass(/chip-cancelled/);

		await chip.click();
		await expect(isOpen(modal)).toBeVisible();
		await modal.getByRole('button', { name: 'Restore session' }).click();
		await expect(isOpen(modal)).toHaveCount(0);
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

			await page.locator('ix-button.add-days-button').click();
			await expect(isOpen(modal)).toBeVisible();
			await expect(modal.locator('#add-start')).toHaveJSProperty('value', first);
			await expect(modal.getByRole('button', { name: 'Cancel day' })).toHaveCount(0);
			await page.keyboard.press('Escape');
			await expect(isOpen(modal)).toHaveCount(0);

			// A day click on that class day still opens cancel / restore.
			await page.locator(`button.day-button[data-date="${first}"]`).click();
			await expect(isOpen(modal)).toBeVisible();
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
				// iX fields: their value (as posted) is a property of the host.
				const until = form.locator(`#schedule-${cls.id}-until`);
				const interval = form.locator(`#schedule-${cls.id}-interval`);
				const duration = form.locator(`#schedule-${cls.id}-duration`);
				await expect(until).toHaveJSProperty('value', `${fx.year}-12-20`);
				await expect(interval).toHaveJSProperty('value', '2');
				await expect(duration).toHaveJSProperty('value', 45);

				// No weekday: inline error, nothing saved.
				// <ix-checkbox> updates aria-checked on its next render, after
				// check()/uncheck() would already have read it: click, then wait.
				await current.click();
				await expect(current).not.toBeChecked();
				await form.getByRole('button', { name: 'Save' }).click();
				await expect(form.locator('.field-error')).toHaveText('Pick at least one weekday.');
				await expect(current).toHaveAttribute('aria-invalid', 'true');
				await expect(current).toHaveAccessibleDescription('Pick at least one weekday.');
				// The failed save keeps what was entered, and the row stays open.
				await expect(toggle).toHaveAttribute('aria-expanded', 'true');
				await expect(current).not.toBeChecked();
				await expect(until).toHaveJSProperty('value', `${fx.year}-12-20`);
				await expect(chipsOfD).toHaveCount(2);

				// "Until" before "From": the date field is marked invalid and
				// its native input is described by the message.
				await next.click();
				await expect(next).toBeChecked();
				await until.locator('input').first().fill(`${fx.year}-09-01`);
				await expect(until).toHaveJSProperty('value', `${fx.year}-09-01`);
				await form.getByRole('button', { name: 'Save' }).click();
				const untilError = form.locator(`#schedule-${cls.id}-endsOn-error`);
				await expect(untilError).toHaveText('“Until” must be on or after “From”.');
				await expect(until).toHaveClass(/\bix-invalid\b/);
				const untilInput = until.locator('input').first();
				await expect(untilInput).toHaveAttribute('aria-invalid', 'true');
				await expect
					.poll(() =>
						untilInput.evaluate((el) =>
							(el.ariaDescribedByElements ?? []).map((d) => d.textContent?.trim()).join(' ')
						)
					)
					.toBe('“Until” must be on or after “From”.');
				await expect(next).not.toHaveAttribute('aria-invalid');
				await expect(chipsOfD).toHaveCount(2);

				await until.locator('input').first().fill(`${fx.year}-12-20`);
				await expect(until).toHaveJSProperty('value', `${fx.year}-12-20`);
				await expect(current).not.toBeChecked();
				await expect(next).toBeChecked();
				await form.getByRole('button', { name: 'Save' }).click();
				await expect(page.locator('ix-toast').getByText('Schedule saved.')).toBeVisible();

				// Future sessions follow the new schedule.
				await expect(chipsOfD).toHaveCount(1);
				expect(await inside(chipsOfD.first(), gridCell(page, date))).toBe(true);
				await expect(chipsOfD.first()).toHaveText(`09:00 ${name}`);
				await expect(form.locator('.field-error')).toHaveCount(0);
				await expect(until).not.toHaveClass(/\bix-invalid\b/);
				await expect(untilInput).not.toHaveAttribute('aria-invalid');
				await expect(next).toBeChecked();
				await expect(current).not.toBeChecked();
				await expect(next).not.toHaveAttribute('aria-invalid');
				// Until, interval and duration survive a save that only changed
				// the weekdays: in the form and in the database.
				await expect(until).toHaveJSProperty('value', `${fx.year}-12-20`);
				await expect(interval).toHaveJSProperty('value', '2');
				await expect(duration).toHaveJSProperty('value', 45);
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
		await expect(durationB).toHaveJSProperty('value', 60);

		// Unsaved edit in B, then save A unchanged.
		await durationB.locator('input').first().fill('75');
		await expect(durationB).toHaveJSProperty('value', 75);
		await formA.getByRole('button', { name: 'Save' }).click();
		await expect(page.locator('ix-toast').getByText('Schedule saved.')).toBeVisible();

		await expect(durationB).toHaveJSProperty('value', 75);

		// Collapsing keeps the form (hidden) and its unsaved edit.
		await rowB.click();
		await expect(rowB).toHaveAttribute('aria-expanded', 'false');
		await expect(formB).toBeHidden();
		await rowB.click();
		await expect(formB).toBeVisible();
		await expect(durationB).toHaveJSProperty('value', 75);
		const { data } = await service
			.from('classes')
			.select('default_duration_minutes')
			.eq('id', fx.classB.id)
			.single();
		expect(data?.default_duration_minutes).toBe(60);
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
			await expect(isOpen(modal)).toBeVisible();
			await expect(modal.getByRole('heading', { name: 'Add extra session' })).toBeVisible();
			// iX fields (#66): time and duration start empty, not iX's defaults.
			const extraClass = modal.locator('#extra-class');
			await expect(modal.locator('#extra-start')).toHaveJSProperty('value', '');
			await expect(modal.locator('#extra-duration')).toHaveJSProperty('value', null);
			await extraClass.locator('input').first().click();
			await extraClass.locator(`ix-select-item[label="${fx.classA.name}"]`).click();
			await expect(extraClass).toHaveJSProperty('value', fx.classA.id);
			await modal.locator('#extra-start input').first().fill('14:00');
			await modal.locator('#extra-duration input').first().fill('60');
			await modal.getByRole('button', { name: 'Add extra session' }).click();
			await expect(isOpen(modal)).toHaveCount(0);
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
			await expect(isOpen(sessionDialog)).toBeVisible();
			await expect(sessionDialog.locator('.extra-pill')).toHaveText('Extra');
			await expect(sessionDialog).toContainText('14:00–15:00');
			await page.keyboard.press('Escape');
			await expect(isOpen(sessionDialog)).toHaveCount(0);

			await page.locator(`button.day-button[data-date="${date}"]`).click();
			await expect(isOpen(modal)).toBeVisible();
			await expect(
				modal.locator(`#extra-class ix-select-item[label="${fx.classA.name}"]`)
			).toHaveCount(0);
			// The select posts a class it actually lists.
			const offered = await modal
				.locator('#extra-class ix-select-item')
				.evaluateAll((items) => items.map((i) => i.getAttribute('value')));
			expect(offered.length).toBeGreaterThan(0);
			await expect
				.poll(() => extraClass.evaluate((el) => (el as HTMLElement & { value?: unknown }).value))
				.toBe(offered[0]);
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
		await expect(isOpen(modal)).toBeVisible();
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
			// iX fields (#66): the host's `value` is what the form posts; typing
			// goes into the native <input> in its shadow DOM.
			await expect(page.locator('#new-class-from')).toHaveJSProperty('value', berlinToday());
			await expect(page.locator('#new-class-until')).toHaveJSProperty('value', '');
			// Time and duration unset: not iX's defaults (current time, 0).
			await expect(page.locator('#new-class-start')).toHaveJSProperty('value', '');
			await expect(page.locator('#new-class-duration')).toHaveJSProperty('value', null);

			await page.locator('#name input').first().fill(name);
			// <ix-checkbox>: click and wait (see the schedule-edit test).
			await page.getByRole('checkbox', { name: 'Wed', exact: true }).click();
			await expect(page.getByRole('checkbox', { name: 'Wed', exact: true })).toBeChecked();
			await page.locator('#new-class-start input').first().fill('10:00');
			await page.locator('#new-class-duration input').first().fill('90');
			await page.locator('#new-class-until input').first().fill(`${fx.year}-12-20`);
			await page.getByRole('button', { name: 'Create class' }).click();

			await expect(page.locator('ix-toast').getByText(`Class "${name}" created`)).toBeVisible();
			await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
			const { data } = await service
				.from('classes')
				.select(
					'schedule_weekdays, schedule_starts_on, schedule_ends_on, default_start_time, default_duration_minutes'
				)
				.eq('name', name)
				.single();
			expect(data).toEqual({
				schedule_weekdays: [3, 7],
				schedule_starts_on: berlinToday(),
				schedule_ends_on: `${fx.year}-12-20`,
				default_start_time: '10:00:00',
				default_duration_minutes: 90
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
			await page.waitForFunction(() => customElements.get('ix-number-input') !== undefined);
			await page.waitForLoadState('networkidle');
			await expect(page.locator('#new-class-start')).toHaveJSProperty('value', '');
			await expect(page.locator('#new-class-duration')).toHaveJSProperty('value', null);

			await page.locator('#name input').first().fill(name);
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
			await expect(page.locator('form.schedule-form ix-checkbox')).toHaveCount(7);
		} finally {
			await service.from('classes').delete().like('name', `${prefix} %`);
		}
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
