import { expect, test, type Page } from '@playwright/test';
import { currentSchoolYear } from '../src/lib/school-year';
import { createCalendarFixture, service, signIn, type CalendarFixture } from './fixtures';

/**
 * Syllabus sections (0038): a teacher adds two sections to a syllabus,
 * reorders and deletes them; the admin and an enrolled student see them in
 * that order. Uses the calendar fixture's class A (the teacher's, the student
 * enrolled) and class B (the teacher's too, for the wrong-class post).
 */

test.describe.configure({ mode: 'serial' });

const ORIGIN = 'http://localhost:5199';

let fx: CalendarFixture;
let syllabusId: string;
let teacherPath: string;

test.beforeAll(async () => {
	fx = await createCalendarFixture();
	const { data, error } = await service
		.from('class_syllabi')
		.insert({ class_id: fx.classA.id, school_year: currentSchoolYear() })
		.select('id')
		.single();
	if (error || !data) throw new Error(`create syllabus: ${error?.message}`);
	syllabusId = data.id;
	teacherPath = `/teacher/classes/${fx.classA.id}/syllabus/${syllabusId}`;
});

test.afterAll(async () => {
	// Syllabi and their sections cascade with the class.
	await fx?.cleanup();
});

/** Waits for hydration and for the iX form components to be defined. */
async function open(page: Page, path: string) {
	await page.goto(path);
	await page.waitForFunction(() => customElements.get('ix-input') !== undefined);
	await page.waitForLoadState('networkidle');
}

async function stored() {
	const { data, error } = await service
		.from('class_syllabus_sections')
		.select('id, title, content_language, links')
		.eq('syllabus_id', syllabusId)
		.order('position');
	if (error) throw new Error(`read sections: ${error.message}`);
	return data ?? [];
}

const titles = (page: Page) => page.locator('h2.section-title');
const card = (page: Page, title: string) =>
	page.locator('section[data-section-id]').filter({ has: page.getByText(title, { exact: true }) });
const moveButton = (page: Page, title: string, direction: 'up' | 'down') =>
	// iX moves the host's aria-label onto its inner button.
	page.getByRole('button', { name: `Move “${title}” ${direction}`, exact: true });

test('student: a syllabus with no sections shows the "no syllabus yet" text', async ({ page }) => {
	await signIn(page, fx.student);
	await open(page, `/student/classes/${fx.classA.id}`);
	await expect(page.getByText("There's no syllabus for this class yet.")).toBeVisible();
	await expect(page.locator('.syllabus-section')).toHaveCount(0);
});

test('teacher: adds two sections with links, an empty title is refused, and reorders them', async ({
	page
}) => {
	await signIn(page, fx.teacher);
	await open(page, teacherPath);
	await expect(page.getByText('No sections yet.')).toBeVisible();

	// Empty title: a message under the field, nothing saved.
	await page.getByRole('button', { name: 'Add section' }).click();
	await expect(page.locator('#section-title-new-error')).toHaveText(
		'Enter a title of up to 200 characters.'
	);
	expect(await stored()).toEqual([]);

	// "Song 1": created last, opens for editing with its title, the add field cleared.
	await page.locator('#section-title-new input').fill('Song 1');
	await page.getByRole('button', { name: 'Add section' }).click();
	const title = page.locator('form[action="?/updateSection"] ix-input[name="title"]');
	await expect(title).toHaveJSProperty('value', 'Song 1');
	await expect(page.locator('#section-title-new-error')).toHaveCount(0);
	await expect(page.locator('#section-title-new')).toHaveJSProperty('value', '');
	const editor = page.locator('.rte-input');
	await expect(editor).toHaveAttribute('contenteditable', 'true');
	await editor.click();
	await page.keyboard.type('The first song');
	await page.locator('ix-input[name="linkUrl"] input').fill('https://one.example');
	await page.locator('ix-input[name="linkLabel"] input').fill('Song 1 video');

	// A cleared title is refused under its field and the form keeps what was typed.
	await title.locator('input').fill('');
	await page.getByRole('button', { name: 'Save section' }).click();
	await expect(page.locator('[id^="section-title-error-"]')).toHaveText(
		'Enter a title of up to 200 characters.'
	);
	await expect(editor).toHaveText('The first song');
	await expect(page.locator('ix-input[name="linkUrl"]')).toHaveJSProperty(
		'value',
		'https://one.example'
	);
	await title.locator('input').fill('Song 1');
	await page.getByRole('button', { name: 'Save section' }).click();
	await expect(page.locator('ix-toast').getByText('Section saved.')).toBeVisible();
	await expect(titles(page)).toHaveText(['Song 1']);

	// "Song 2", with its own link.
	await page.locator('#section-title-new input').fill('Song 2');
	await page.getByRole('button', { name: 'Add section' }).click();
	await expect(title).toHaveJSProperty('value', 'Song 2');
	await page.locator('ix-input[name="linkUrl"] input').fill('https://two.example');
	await page.getByRole('button', { name: 'Save section' }).click();
	await expect(titles(page)).toHaveText(['Song 1', 'Song 2']);
	await expect(card(page, 'Song 1').getByRole('link', { name: 'Song 1 video' })).toHaveAttribute(
		'href',
		'https://one.example'
	);
	await expect(card(page, 'Song 2').getByRole('link')).toHaveAttribute(
		'href',
		'https://two.example'
	);
	expect((await stored()).map((s) => [s.title, s.content_language, s.links])).toEqual([
		['Song 1', 'en', [{ url: 'https://one.example', label: 'Song 1 video' }]],
		['Song 2', 'en', [{ url: 'https://two.example', label: null }]]
	]);

	// First cannot go up, last cannot go down; moving Song 2 up swaps them.
	await expect(moveButton(page, 'Song 1', 'up')).toBeDisabled();
	await expect(moveButton(page, 'Song 2', 'down')).toBeDisabled();
	await moveButton(page, 'Song 2', 'up').click();
	await expect(titles(page)).toHaveText(['Song 2', 'Song 1']);
	expect((await stored()).map((s) => s.title)).toEqual(['Song 2', 'Song 1']);
	await moveButton(page, 'Song 2', 'down').click();
	await expect(titles(page)).toHaveText(['Song 1', 'Song 2']);
	await moveButton(page, 'Song 1', 'down').click();
	await expect(titles(page)).toHaveText(['Song 2', 'Song 1']);

	// The year list counts the sections.
	await open(page, `/teacher/classes/${fx.classA.id}/syllabus`);
	await expect(page.locator('.syllabus-row')).toContainText('2 section(s)');
});

test("admin: sees both sections in the teacher's order, moves one and back, and deletes a throwaway section", async ({
	page
}) => {
	await signIn(page, fx.admin);
	await open(page, `/admin/classes/${fx.classA.id}/syllabus/${syllabusId}`);
	await expect(titles(page)).toHaveText(['Song 2', 'Song 1']);
	await expect(card(page, 'Song 1').locator('.rich-text')).toHaveText('The first song');

	// Move and move back, through the admin route's action.
	await moveButton(page, 'Song 1', 'up').click();
	await expect(titles(page)).toHaveText(['Song 1', 'Song 2']);
	expect((await stored()).map((s) => s.title)).toEqual(['Song 1', 'Song 2']);
	await moveButton(page, 'Song 1', 'down').click();
	await expect(titles(page)).toHaveText(['Song 2', 'Song 1']);
	expect((await stored()).map((s) => s.title)).toEqual(['Song 2', 'Song 1']);

	// A throwaway section, added and deleted as the admin.
	await page.locator('#section-title-new input').fill('Throwaway');
	await page.getByRole('button', { name: 'Add section' }).click();
	await expect(page.locator('ix-toast').getByText('Section added.')).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(titles(page)).toHaveText(['Song 2', 'Song 1', 'Throwaway']);
	await card(page, 'Throwaway').getByRole('button', { name: 'Delete section' }).click();
	await page.locator('ix-modal').getByRole('button', { name: 'Delete' }).click();
	await expect(page.locator('ix-toast').getByText('Section deleted.')).toBeVisible();
	await expect(titles(page)).toHaveText(['Song 2', 'Song 1']);
	expect((await stored()).map((s) => s.title)).toEqual(['Song 2', 'Song 1']);
});

test('student: sections in order with text and links; an English section keeps its font under the Tibetan interface', async ({
	page
}) => {
	await signIn(page, fx.student);
	await open(page, `/student/classes/${fx.classA.id}`);
	const sections = page.locator('.syllabus-section');
	await expect(sections.locator('h3')).toHaveText(['Song 2', 'Song 1']);
	await expect(sections.nth(0).getByRole('link')).toHaveAttribute('href', 'https://two.example');
	await expect(sections.nth(1).locator('.rich-text')).toHaveText('The first song');
	await expect(sections.nth(1).getByRole('link', { name: 'Song 1 video' })).toHaveAttribute(
		'href',
		'https://one.example'
	);

	// A /<locale>/... address sets the language cookie and redirects (#79).
	await open(page, `/bo/student/classes/${fx.classA.id}`);
	await expect(page.locator('html')).toHaveAttribute('lang', 'bo');
	const english = page.locator('.syllabus-section').nth(1);
	await expect(english.locator('.rich-text')).toHaveAttribute('lang', 'en');
	await expect(english.locator('.rich-text')).not.toHaveCSS('font-family', /Atisha/);
	await expect(english.locator('h3')).toHaveAttribute('lang', 'en');
	await expect(english.locator('h3')).not.toHaveCSS('font-family', /Atisha/);
	// The interface around it is in the Tibetan font.
	await expect(page.locator('h1.page-heading')).toHaveCSS('font-family', /Atisha/);
});

test('teacher: deleting a section asks first and leaves the others in order', async ({ page }) => {
	await signIn(page, fx.teacher);
	await open(page, teacherPath);
	await expect(titles(page)).toHaveText(['Song 2', 'Song 1']);

	await card(page, 'Song 2').getByRole('button', { name: 'Delete section' }).click();
	const modal = page.locator('ix-modal');
	await expect(modal).toContainText('Delete the section “Song 2”?');
	await modal.getByRole('button', { name: 'Cancel' }).click();
	await expect(modal).toHaveCount(0);
	expect((await stored()).map((s) => s.title)).toEqual(['Song 2', 'Song 1']);

	await card(page, 'Song 2').getByRole('button', { name: 'Delete section' }).click();
	await page.locator('ix-modal').getByRole('button', { name: 'Delete' }).click();
	await expect(page.locator('ix-toast').getByText('Section deleted.')).toBeVisible();
	await expect(titles(page)).toHaveText(['Song 1']);
	expect((await stored()).map((s) => s.title)).toEqual(['Song 1']);
});

test('without JavaScript: plain form posts add and save a section; a wrong class changes nothing', async ({
	page
}) => {
	await signIn(page, fx.teacher);
	// What a browser sends for a form it submits itself (no fetch, no JSON).
	const headers = { origin: ORIGIN, accept: 'text/html' };

	// A plain (not enhanced) post answers with the page, the new section's form open.
	const added = await page.request.post(`${teacherPath}?/addSection`, {
		form: { title: 'Plain post' },
		headers
	});
	expect(added.status()).toBe(200);
	const sections = await stored();
	expect(sections.map((s) => s.title)).toEqual(['Song 1', 'Plain post']);
	const plain = sections[1];
	const html = await added.text();
	expect(html).toContain('action="?/updateSection"');
	expect(html).toContain(`name="sectionId" value="${plain.id}"`);

	const saved = await page.request.post(`${teacherPath}?/updateSection`, {
		form: {
			sectionId: plain.id,
			title: 'Plain saved',
			content: '',
			contentLanguage: 'de',
			linkUrl: 'https://plain.example',
			linkLabel: ''
		},
		headers
	});
	expect(saved.status()).toBe(200);
	expect((await stored())[1]).toEqual({
		id: plain.id,
		title: 'Plain saved',
		content_language: 'de',
		links: [{ url: 'https://plain.example', label: null }]
	});

	// An empty title comes back as the page with the message under the field.
	const refused = await page.request.post(`${teacherPath}?/addSection`, {
		form: { title: '   ' },
		headers
	});
	expect(refused.status()).toBe(400);
	expect(await refused.text()).toContain('Enter a title of up to 200 characters.');

	// Wrong class: the teacher's other class with this syllabus's section.
	const wrongClassPath = `/teacher/classes/${fx.classB.id}/syllabus/${syllabusId}`;
	const action = { ...headers, 'x-sveltekit-action': 'true', accept: 'application/json' };
	for (const [name, form] of [
		['moveSection', { sectionId: plain.id, direction: 'up' }],
		['deleteSection', { sectionId: plain.id }],
		[
			'updateSection',
			{ sectionId: plain.id, title: 'Hijacked', content: '', contentLanguage: 'en' }
		],
		['addSection', { title: 'Hijacked' }]
	] as const) {
		const response = await page.request.post(`${wrongClassPath}?/${name}`, {
			form,
			headers: action
		});
		expect(await response.json(), name).toMatchObject({ type: 'failure', status: 400 });
	}
	expect((await stored()).map((s) => s.title)).toEqual(['Song 1', 'Plain saved']);
});
