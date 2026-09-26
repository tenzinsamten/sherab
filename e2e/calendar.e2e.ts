import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	berlinToday,
	createCalendarFixture,
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

	test('teacher edits a session: 11:00 saves and closes; invalid input errors in the dialog', async ({
		page
	}) => {
		await signIn(page, fx.teacher);
		await openCalendar(page, fx.month);
		const date = fx.days[1];
		const modal = sessionModal(page);

		await chipFor(page, 'A', date).click();
		await expect(isOpen(modal)).toBeVisible();
		await expect(modal.locator('#session-start')).toBeVisible();
		await expect(modal).toContainText('Leave empty to use the class default (10:00, 90 min).');

		// Invalid time. A type=time input cannot hold one, so turn it into a
		// text field first (as in a browser without a time picker).
		await modal.locator('#session-start').evaluate((el) => el.setAttribute('type', 'text'));
		await modal.locator('#session-start').fill('25:00');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(modal.locator('#session-error')).toHaveText('Enter a time as HH:MM.');
		await expect(isOpen(modal)).toBeVisible();

		// Invalid duration.
		await modal.locator('#session-start').fill('');
		await modal.locator('#session-duration').fill('5');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(modal.locator('#session-error')).toHaveText(
			'Enter a duration between 15 and 480 minutes.'
		);
		await expect(isOpen(modal)).toBeVisible();

		// Valid: 11:00.
		await modal.locator('#session-duration').fill('');
		await modal.locator('#session-start').fill('11:00');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(isOpen(modal)).toHaveCount(0);
		await expect(chipFor(page, 'A', date)).toHaveText(`11:00 ${fx.classA.name}`);
		// Only that session changed.
		await expect(chipFor(page, 'A', fx.days[2])).toHaveText(`10:00 ${fx.classA.name}`);
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
		await expect(modal.locator('#add-start')).toHaveValue(fx.emptyDate);
		await modal.locator('#add-end').fill(`${fx.month}-01`);
		await modal.getByRole('button', { name: 'Add class days' }).click();
		await expect(modal.locator('#add-days-error')).toHaveText(
			'The end date must be on or after the start date.'
		);
		await expect(isOpen(modal)).toBeVisible();
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
			await expect(modal.locator('#add-start')).toHaveValue(first);
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
