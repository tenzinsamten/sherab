import { expect, test, type Page } from '@playwright/test';
import { currentSchoolYear, selectableSchoolYears } from '../src/lib/school-year';
import { createCalendarFixture, service, signIn, type CalendarFixture } from './fixtures';

/**
 * Shared iX form components (#66 B7): the I/O matrix rows "Link rows" and
 * "Required select empty". Uses the calendar fixture's class C (admin-only,
 * no syllabus, the fixture student not enrolled) and its admin.
 */

test.describe.configure({ mode: 'serial' });

let fx: CalendarFixture;
// A second approved student in class A, so the enrol panel still has
// someone to offer after the fixture student is added to class C.
let otherStudentId: string | undefined;

test.beforeAll(async () => {
	fx = await createCalendarFixture();
	const { data, error } = await service.auth.admin.createUser({
		email: `e2e-66-student-${fx.tag}@students.internal.invalid`,
		password: crypto.randomUUID(),
		email_confirm: true,
		app_metadata: { role: 'student' }
	});
	if (error || !data.user) throw new Error(`create other student: ${error?.message}`);
	otherStudentId = data.user.id;
	const { error: approveError } = await service
		.from('profiles')
		.update({
			class_id: fx.classA.id,
			status: 'approved',
			registration_name: `E2E66 Other ${fx.tag}`,
			display_name: `E2E66 Other ${fx.tag}`
		})
		.eq('id', otherStudentId);
	if (approveError) throw new Error(`approve other student: ${approveError.message}`);
	const { data: enrolled } = await service
		.from('class_enrollments')
		.select('class_id')
		.eq('student_id', otherStudentId)
		.eq('class_id', fx.classA.id);
	if (!enrolled?.length) {
		const { error: enrollError } = await service
			.from('class_enrollments')
			.insert({ student_id: otherStudentId, class_id: fx.classA.id });
		if (enrollError) throw new Error(`enroll other student: ${enrollError.message}`);
	}
});

test.afterAll(async () => {
	// Before the fixture cleanup: a class with students cannot be deleted.
	if (otherStudentId) {
		const { error } = await service.auth.admin.deleteUser(otherStudentId);
		if (error) throw new Error(`delete other student: ${error.message}`);
	}
	await fx?.cleanup();
});

/** Waits for hydration and for the iX form components to be defined. */
async function openForm(page: Page, path: string) {
	await page.goto(path);
	await page.waitForFunction(() => customElements.get('ix-select') !== undefined);
	await page.waitForLoadState('networkidle');
}

test('link rows: a blank middle row is skipped, rows 1 and 3 save and reopen in order', async ({
	page
}) => {
	const posts: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes('?/update')) posts.push(r.postData() ?? '');
	});
	await signIn(page, fx.admin);
	await openForm(page, `/admin/classes/${fx.classC.id}/syllabus`);
	await page.getByRole('button', { name: 'Add syllabus' }).click();
	await page.waitForURL(/edit=1/);
	await page.waitForLoadState('networkidle');

	await page.locator('ix-textarea textarea').fill('Week 1: alphabet\nWeek 2: songs');
	await page.getByRole('button', { name: 'Add link' }).click();
	await page.getByRole('button', { name: 'Add link' }).click();
	// iX fields: typing goes into the native <input> in their shadow DOM.
	const urls = page.locator('ix-input[name="linkUrl"] input');
	const labels = page.locator('ix-input[name="linkLabel"] input');
	await expect(urls).toHaveCount(3);
	await urls.nth(0).fill('https://a.example');
	await labels.nth(0).fill('Alphabet');
	await urls.nth(2).fill('https://c.example');
	await labels.nth(2).fill('Songs');
	await page.getByRole('button', { name: 'Save syllabus' }).click();
	await expect(page.locator('ix-toast').getByText('Syllabus saved.')).toBeVisible();

	// Posted in row order, the blank row as empty strings.
	expect(posts).toHaveLength(1);
	const form = new URLSearchParams(posts[0]);
	expect(form.getAll('linkUrl')).toEqual(['https://a.example', '', 'https://c.example']);
	expect(form.getAll('linkLabel')).toEqual(['Alphabet', '', 'Songs']);

	// Stored without the blank row (parseReferenceLinks ignores an empty URL).
	// The add form preselects the current school year.
	const { data: saved } = await service
		.from('class_syllabi')
		.select('school_year, content, links')
		.eq('class_id', fx.classC.id)
		.single();
	expect(saved).toEqual({
		school_year: currentSchoolYear(),
		content: 'Week 1: alphabet\nWeek 2: songs',
		links: [
			{ url: 'https://a.example', label: 'Alphabet' },
			{ url: 'https://c.example', label: 'Songs' }
		]
	});

	// Reopened: text and both links, in order.
	await openForm(page, page.url().replace(/\?.*$/, ''));
	await page.getByRole('button', { name: 'Edit syllabus' }).click();
	await expect(page.locator('ix-textarea')).toHaveJSProperty(
		'value',
		'Week 1: alphabet\nWeek 2: songs'
	);
	await expect(page.locator('ix-input[name="linkUrl"]')).toHaveCount(2);
	await expect(page.locator('ix-input[name="linkUrl"]').nth(0)).toHaveJSProperty(
		'value',
		'https://a.example'
	);
	await expect(page.locator('ix-input[name="linkLabel"]').nth(0)).toHaveJSProperty(
		'value',
		'Alphabet'
	);
	await expect(page.locator('ix-input[name="linkUrl"]').nth(1)).toHaveJSProperty(
		'value',
		'https://c.example'
	);
	await expect(page.locator('ix-input[name="linkLabel"]').nth(1)).toHaveJSProperty(
		'value',
		'Songs'
	);
});

test('syllabus add: with the current year taken, the first addable year is preselected and stored', async ({
	page
}) => {
	// The link-rows test above created class C's current-year syllabus.
	const current = currentSchoolYear();
	const { data: existing } = await service
		.from('class_syllabi')
		.select('school_year')
		.eq('class_id', fx.classC.id);
	expect(existing).toEqual([{ school_year: current }]);
	const firstAddable = selectableSchoolYears(current, [current])[0];

	const posts: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes('?/create')) posts.push(r.postData() ?? '');
	});
	await signIn(page, fx.admin);
	await openForm(page, `/admin/classes/${fx.classC.id}/syllabus`);
	await expect(page.locator('#schoolYear')).toHaveJSProperty('value', String(firstAddable));
	await page.getByRole('button', { name: 'Add syllabus' }).click();
	await page.waitForURL(/edit=1/);

	expect(posts).toHaveLength(1);
	expect(new URLSearchParams(posts[0]).get('schoolYear')).toBe(String(firstAddable));
	const { data: years } = await service
		.from('class_syllabi')
		.select('school_year')
		.eq('class_id', fx.classC.id)
		.order('school_year');
	expect(years).toEqual(
		[current, firstAddable].sort((a, b) => a - b).map((school_year) => ({ school_year }))
	);
});

test('enrol: no student chosen sends nothing and marks the select; choosing one enrols them and clears it', async ({
	page
}) => {
	// An empty submit must never reach the server: fail the test on any
	// ?/enroll request while the select is empty.
	let allowEnroll = false;
	const enrollPosts: string[] = [];
	const blocked: string[] = [];
	await page.route(/\?\/enroll/, async (route) => {
		if (!allowEnroll) {
			blocked.push(route.request().url());
			return route.abort();
		}
		enrollPosts.push(route.request().postData() ?? '');
		return route.continue();
	});
	await signIn(page, fx.admin);
	await openForm(page, `/admin/classes/${fx.classC.id}/students`);

	const select = page.locator('#enroll-student');
	const submit = page.getByRole('button', { name: 'Add to class' });
	await submit.click();
	await expect(select).toHaveClass(/\bix-invalid\b/);
	// Light-DOM message, announced and linked to the select's native input.
	const error = page.locator('#enroll-student-error');
	await expect(error).toHaveText('Choose a student to add.');
	await expect(error).toHaveAttribute('role', 'alert');
	const selectInput = select.locator('input').first();
	await expect(selectInput).toHaveAttribute('aria-invalid', 'true');
	await expect
		.poll(() =>
			selectInput.evaluate((el) =>
				(el.ariaDescribedByElements ?? []).map((d) => d.textContent?.trim()).join(' ')
			)
		)
		.toBe('Choose a student to add.');

	expect(blocked).toEqual([]);

	// Open the list and pick the fixture student.
	allowEnroll = true;
	await select.locator('input').first().click();
	await page.locator(`ix-select-item[label*="Student ${fx.tag}"]`).click();
	await expect(select).not.toHaveClass(/\bix-invalid\b/);
	await expect(error).toHaveCount(0);
	await submit.click();
	await expect(page.locator('ix-toast').getByText('Student added to the class.')).toBeVisible();
	expect(enrollPosts).toHaveLength(1);
	expect(new URLSearchParams(enrollPosts[0]).get('studentId')).toBe(fx.student.id);
	await expect(page.locator('.member-list')).toContainText(`Student ${fx.tag}`);

	const { data: row } = await service
		.from('class_enrollments')
		.select('student_id')
		.eq('class_id', fx.classC.id)
		.eq('student_id', fx.student.id)
		.maybeSingle();
	expect(row).not.toBeNull();

	// The select is empty again, and submitting it is blocked again.
	allowEnroll = false;
	const selectAfter = page.locator('#enroll-student');
	// Focus moves to the remounted select, not <body>.
	await expect(selectAfter).toBeFocused();
	await expect(selectAfter).not.toHaveClass(/\bix-invalid\b/);
	await expect
		.poll(() =>
			selectAfter.evaluate((el) => {
				const v = (el as HTMLElement & { value?: unknown }).value;
				return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
			})
		)
		.toBe(true);
	await page.getByRole('button', { name: 'Add to class' }).click();
	await expect(selectAfter).toHaveClass(/\bix-invalid\b/);
	expect(blocked).toEqual([]);
	expect(enrollPosts).toHaveLength(1);
});
