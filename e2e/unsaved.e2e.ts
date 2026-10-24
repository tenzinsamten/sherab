import { expect, test, type Browser, type Page } from '@playwright/test';
import { currentSchoolYear } from '../src/lib/school-year';
import {
	berlinToday,
	createCalendarFixture,
	service,
	signIn,
	type CalendarFixture
} from './fixtures';

/**
 * #121: leaving a changed homework create form, homework edit form or
 * syllabus section form asks first. The create page's I/O matrix at phone
 * width (bottom nav), Back, typed-then-undone, reload (the browser's own
 * prompt), a save that redirects, the Tibetan question; a save on the edit
 * page and on a syllabus section asks nothing afterwards. Uses the calendar
 * fixture's class A (the teacher's, the student enrolled).
 */

test.describe.configure({ mode: 'serial' });

const PHONE = { width: 375, height: 740 };

let fx: CalendarFixture;
let syllabusId: string;
let assignmentId: string;

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

test.beforeAll(async () => {
	fx = await createCalendarFixture();
	syllabusId = check(
		await service
			.from('class_syllabi')
			.insert({ class_id: fx.classA.id, school_year: currentSchoolYear() })
			.select('id')
			.single(),
		'create syllabus'
	).id;
	check(
		await service
			.from('class_syllabus_sections')
			.insert({ syllabus_id: syllabusId, title: 'Song 1', position: 1 })
			.select('id')
			.single(),
		'create section'
	);
	assignmentId = check(
		await service
			.from('homework_assignments')
			.insert({
				class_id: fx.classA.id,
				title: `E2E121 Edit ${fx.tag}`,
				skill_area: 'song',
				// A link: the stored mark has only `href`, the editor adds its own
				// attributes, so the stored string is not the editor's.
				content: {
					type: 'doc',
					content: [
						{
							type: 'paragraph',
							content: [
								{ type: 'text', text: 'Sing ' },
								{
									type: 'text',
									text: 'it',
									marks: [{ type: 'link', attrs: { href: 'https://song.example' } }]
								}
							]
						}
					]
				},
				whole_class: true,
				created_by: fx.teacher.id
			})
			.select('id')
			.single(),
		'create homework'
	).id;
});

test.afterAll(async () => {
	// Syllabi, sections and homework go with the class.
	await fx?.cleanup();
});

const classPath = () => `/teacher/classes/${fx.classA.id}`;
const newPath = () => `${classPath()}/homework/new`;
const dialog = (page: Page) => page.getByTestId('confirm-dialog');
const bottomNav = (page: Page) => page.getByTestId('bottom-nav');
const dashboardTab = (page: Page) => bottomNav(page).getByRole('link', { name: 'Dashboard' });

async function phonePage(browser: Browser, locale?: string): Promise<Page> {
	const context = await browser.newContext({ viewport: PHONE });
	const page = await context.newPage();
	await signIn(page, fx.teacher);
	if (locale) {
		await context.addCookies([
			{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }
		]);
	}
	return page;
}

/** Waits for hydration: these pages mark their new-UI root. */
async function open(page: Page, path: string) {
	await page.goto(path);
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

async function editor(page: Page, selector: string) {
	const area = page.locator(selector);
	await expect(area).toHaveAttribute('contenteditable', 'true');
	return area;
}

test('create: unchanged leaves; a typed title asks, Cancel keeps it, Leave goes', async ({
	browser
}) => {
	const page = await phonePage(browser);
	try {
		// Opened and touched, nothing typed: the nav leaves at once.
		await open(page, newPath());
		await page.locator('#title').click();
		await dashboardTab(page).click();
		await page.waitForURL(/\/teacher$/);
		await expect(dialog(page)).toHaveCount(0);

		// A typed title: the question; Cancel keeps the page and the title.
		await open(page, newPath());
		await page.locator('#title').fill('Read page 3');
		await dashboardTab(page).click();
		await expect(dialog(page)).toBeVisible();
		await expect(dialog(page)).toContainText('Leave this page? What you typed is not saved.');
		await dialog(page).getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog(page)).toHaveCount(0);
		expect(new URL(page.url()).pathname).toBe(newPath());
		await expect(page.locator('#title')).toHaveValue('Read page 3');

		// Leave goes to the tapped link.
		await dashboardTab(page).click();
		await dialog(page).getByRole('button', { name: 'Leave' }).click();
		await page.waitForURL(/\/teacher$/);
	} finally {
		await page.context().close();
	}
});

test('create: typed then undone leaves without asking', async ({ browser }) => {
	const page = await phonePage(browser);
	try {
		await open(page, newPath());
		await page.locator('#title').fill('Read page 3');
		await page.locator('#title').fill('');
		await dashboardTab(page).click();
		await page.waitForURL(/\/teacher$/);
		await expect(dialog(page)).toHaveCount(0);
	} finally {
		await page.context().close();
	}
});

test('create: Back with text in the editor asks; Cancel stays, Leave goes back', async ({
	browser
}) => {
	const page = await phonePage(browser);
	try {
		// Reached in the app, so Back is the app's own navigation.
		await open(page, `${classPath()}/homework`);
		await page.getByRole('link', { name: 'Create homework' }).click();
		await page.waitForURL((url) => url.pathname === newPath());
		await (await editor(page, '#content')).fill('Read it aloud');

		await page.evaluate(() => history.back());
		await expect(dialog(page)).toBeVisible();
		await dialog(page).getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog(page)).toHaveCount(0);
		await expect.poll(() => new URL(page.url()).pathname).toBe(newPath());
		await expect(page.locator('#content')).toHaveText('Read it aloud');

		await page.evaluate(() => history.back());
		await dialog(page).getByRole('button', { name: 'Leave' }).click();
		await page.waitForURL((url) => url.pathname === `${classPath()}/homework`);
	} finally {
		await page.context().close();
	}
});

test("create: reload with a typed title gets the browser's own prompt", async ({ browser }) => {
	const page = await phonePage(browser);
	try {
		await open(page, newPath());
		await page.locator('#title').fill('Read page 3');
		const types: string[] = [];
		page.on('dialog', (prompt) => {
			types.push(prompt.type());
			void prompt.accept();
		});
		await page.reload();
		expect(types).toEqual(['beforeunload']);
		await expect(dialog(page)).toHaveCount(0);
	} finally {
		await page.context().close();
	}
});

test('create: a successful save redirects to the list without a question', async ({ browser }) => {
	const page = await phonePage(browser);
	try {
		await open(page, newPath());
		await page.locator('#title').fill(`E2E121 Create ${fx.tag}`);
		await (await editor(page, '#content')).fill('Read it aloud');
		await page.locator('#dueDate').fill(berlinToday());
		await page.getByRole('button', { name: 'Create assignment' }).click();
		await page.waitForURL((url) => url.pathname === `${classPath()}/homework`);
		await expect(dialog(page)).toHaveCount(0);
	} finally {
		await page.context().close();
	}
});

test('create: the question is in Tibetan under the Tibetan interface', async ({ browser }) => {
	const page = await phonePage(browser, 'bo');
	try {
		await open(page, newPath());
		await expect(page.locator('html')).toHaveAttribute('lang', 'bo');
		await page.locator('#title').fill('Read page 3');
		await bottomNav(page).getByRole('link').first().click();
		await expect(dialog(page)).toContainText(
			'ཤོག་ངོས་འདི་ནས་ཐོན་ནམ། ཁྱེད་ཀྱིས་བྲིས་པ་དེ་ཉར་ཚགས་བྱས་མེད།'
		);
		await expect(dialog(page).getByRole('button', { name: 'ཐོན།' })).toBeVisible();
	} finally {
		await page.context().close();
	}
});

test('edit: typing in the saved content and undoing it leaves without asking', async ({
	browser
}) => {
	const page = await phonePage(browser);
	try {
		await open(page, `${classPath()}/homework/${assignmentId}`);
		await page.getByText('Edit', { exact: true }).click();
		const content = await editor(page, `#edit-content-${assignmentId}`);
		await content.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' twice');
		await expect(content).toHaveText('Sing it twice');
		for (let i = 0; i < ' twice'.length; i++) await page.keyboard.press('Backspace');
		await expect(content).toHaveText('Sing it');
		await dashboardTab(page).click();
		await page.waitForURL(/\/teacher$/);
		await expect(dialog(page)).toHaveCount(0);
	} finally {
		await page.context().close();
	}
});

test('edit: a changed title asks; after saving it, leaving asks nothing', async ({ browser }) => {
	const page = await phonePage(browser);
	try {
		await open(page, `${classPath()}/homework/${assignmentId}`);
		await page.getByText('Edit', { exact: true }).click();
		const title = page.locator(`#edit-title-${assignmentId}`);
		await title.fill(`E2E121 Edited ${fx.tag}`);
		await dashboardTab(page).click();
		await expect(dialog(page)).toBeVisible();
		await dialog(page).getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog(page)).toHaveCount(0);

		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect
			.poll(
				async () =>
					check(
						await service
							.from('homework_assignments')
							.select('title')
							.eq('id', assignmentId)
							.single(),
						'read homework'
					).title
			)
			.toBe(`E2E121 Edited ${fx.tag}`);
		await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
		await dashboardTab(page).click();
		await page.waitForURL(/\/teacher$/);
		await expect(dialog(page)).toHaveCount(0);
	} finally {
		await page.context().close();
	}
});

test('syllabus: a failed save keeps the guard', async ({ browser }) => {
	const page = await phonePage(browser);
	try {
		await open(page, `${classPath()}/syllabus/${syllabusId}`);
		await page.getByRole('button', { name: 'Edit section' }).click();
		await page.locator('form[action="?/updateSection"] input[name="title"]').fill('');
		await page.getByRole('button', { name: 'Save section' }).click();
		await expect(page.locator('[id^="section-title-error-"]')).toHaveText(
			'Enter a title of up to 200 characters.'
		);
		await dashboardTab(page).click();
		await expect(dialog(page)).toBeVisible();
		await dialog(page).getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog(page)).toHaveCount(0);
		expect(new URL(page.url()).pathname).toBe(`${classPath()}/syllabus/${syllabusId}`);
	} finally {
		await page.context().close();
	}
});

test('syllabus: a changed section asks, Cancel keeps it; once saved, leaving asks nothing', async ({
	browser
}) => {
	const page = await phonePage(browser);
	try {
		await open(page, `${classPath()}/syllabus/${syllabusId}`);
		await page.getByRole('button', { name: 'Edit section' }).click();
		const title = page.locator('form[action="?/updateSection"] input[name="title"]');
		await title.fill('Song 1 (verse)');
		await dashboardTab(page).click();
		await expect(dialog(page)).toBeVisible();
		await expect(dialog(page)).toContainText('Leave this page? What you typed is not saved.');
		await dialog(page).getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog(page)).toHaveCount(0);
		await expect(title).toHaveValue('Song 1 (verse)');

		await page.getByRole('button', { name: 'Save section' }).click();
		await expect(page.locator('[data-sonner-toast]').getByText('Section saved.')).toBeVisible();
		await dashboardTab(page).click();
		await page.waitForURL(/\/teacher$/);
		await expect(dialog(page)).toHaveCount(0);
	} finally {
		await page.context().close();
	}
});
