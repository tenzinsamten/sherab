import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import {
	berlinToday,
	createCalendarFixture,
	env,
	linkParent,
	service,
	signIn,
	type CalendarFixture,
	type TestUser
} from './fixtures';

/**
 * #110: PDF files on a homework (0053). The teacher attaches files on the
 * create form (a wrong file or a third file creates nothing) and manages
 * them on the homework page; the student the homework is set for and that
 * student's approved parent open them; nobody outside gets a file. Uses the
 * calendar fixture's class A (the teacher's, the student enrolled) and class
 * B (the teacher's too, for the wrong-class post).
 */

test.describe.configure({ mode: 'serial' });

const ORIGIN = 'http://localhost:5199';
const BUCKET = 'homework-files';
const MB5 = 5_242_880;

let fx: CalendarFixture;
let parent: TestUser;
let otherTeacher: TestUser;
let assignmentId: string;
let instanceId: string;
const title = () => `E2E110 Worksheet ${fx.tag}`;
const weeklyTitle = () => `E2E110 Weekly ${fx.tag}`;

/** A file whose content starts like a PDF, `size` bytes long. */
function pdf(name: string, size = 2048) {
	const buffer = Buffer.alloc(size);
	buffer.write('%PDF-1.7\n');
	return { name, mimeType: 'application/pdf', buffer };
}
const docx = {
	name: 'notes.docx',
	mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	buffer: Buffer.from('PK\u0003\u0004 not a pdf')
};

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'parent' | 'teacher', key: string): Promise<TestUser> {
	const email = `e2e-110-${key}-${fx.tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	return { id: data.user.id, email, password };
}

/** The homework's file rows, in the order shown. */
async function rows(assignment = assignmentId) {
	return (
		check(
			await service
				.from('homework_assignment_files')
				.select('id, file_name, size_bytes, object_path')
				.eq('assignment_id', assignment)
				.order('created_at')
				.order('id'),
			'read files'
		) ?? []
	);
}

/** The object paths the bucket holds for a homework. */
async function objects(classId: string, assignment: string) {
	const listed = check(
		await service.storage.from(BUCKET).list(`${classId}/${assignment}`),
		'list objects'
	);
	return (listed ?? []).map((object) => `${classId}/${assignment}/${object.name}`).sort();
}

async function classObjects(classId: string) {
	const folders = check(await service.storage.from(BUCKET).list(classId), 'list folders') ?? [];
	const all: string[] = [];
	for (const folder of folders) all.push(...(await objects(classId, folder.name)));
	return all;
}

test.beforeAll(async () => {
	fx = await createCalendarFixture();
	parent = await createUser('parent', 'parent');
	check(
		await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
		'approve parent'
	);
	await linkParent(fx.student.id, parent.id);
	otherTeacher = await createUser('teacher', 'teacher');
});

test.afterAll(async () => {
	// The fixture deletes its classes with the service role, which cannot
	// reach the bucket: empty their folders first.
	if (fx) {
		for (const classId of [fx.classA.id, fx.classB.id]) {
			const paths = await classObjects(classId);
			if (paths.length) await service.storage.from(BUCKET).remove(paths);
		}
	}
	// The fixture's students before the parent: a parent with linked
	// children cannot be deleted (student_parents, AD-10).
	await fx?.cleanup();
	for (const user of [parent, otherTeacher]) {
		if (user) await service.auth.admin.deleteUser(user.id);
	}
});

/** Waits for hydration: every page here marks its new-UI root. */
async function open(page: Page, path: string) {
	await page.goto(path);
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

async function contentEditor(page: Page) {
	const area = page.locator('#content');
	await expect(area).toHaveAttribute('contenteditable', 'true');
	return area;
}

const toast = (page: Page, text: string) =>
	page.locator('[data-sonner-toast]').getByText(text).first();
const fileList = (page: Page) => page.getByTestId('homework-files');
const files = (page: Page) => fileList(page).locator('li[data-file-id]');
const names = (page: Page) => files(page).getByTestId('file-name');
const dialog = (page: Page) => page.getByTestId('confirm-dialog');
const detailPath = () => `/teacher/classes/${fx.classA.id}/homework/${assignmentId}`;

/** The file and create posts the page sends from now on, in order. */
function recordPosts(page: Page): string[] {
	const posts: string[] = [];
	page.on('request', (request) => {
		const action = /\?\/(uploadFile|replaceFile|createAssignment)$/.exec(request.url())?.[1];
		if (request.method() === 'POST' && action) posts.push(action);
	});
	return posts;
}

/** Follows a file link as the signed-in page would and returns what arrives. */
async function fetchFile(page: Page, href: string) {
	const redirect = await page.request.get(href, { maxRedirects: 0 });
	expect(redirect.status(), href).toBe(303);
	expect(redirect.headers()['cache-control']).toBe('no-store');
	const location = redirect.headers()['location'];
	expect(location).toContain(`/storage/v1/object/sign/${BUCKET}/`);
	const response = await page.request.get(location);
	return { location, response };
}

test('create: a wrong file or three files create nothing and keep what was typed; two PDFs are attached', async ({
	page
}) => {
	await signIn(page, fx.teacher);
	await open(page, `/teacher/classes/${fx.classA.id}/homework/new`);
	await page.locator('#title').fill(title());
	await (await contentEditor(page)).fill('Fill in the worksheet');
	// Due today: inside the parent list's look-ahead window.
	await page.locator('#dueDate').fill(berlinToday());
	await expect(
		page.getByText('PDF only, up to 5.0 MB each. At most 2 files.', { exact: false })
	).toBeVisible();
	const input = page.locator('input[type="file"][name="files"]');
	const error = page.getByTestId('file-error');
	const create = page.getByRole('button', { name: 'Create assignment' });
	const created = async () =>
		check(
			await service.from('homework_assignments').select('id').eq('title', title()),
			'read homework'
		) ?? [];

	// A Word file next to a PDF: checked by the server, nothing created.
	await input.setInputFiles([pdf('a.pdf'), docx]);
	await create.click();
	await expect(error).toContainText('PDF files only.');
	await expect(error).toContainText('notes.docx');
	expect(await created()).toEqual([]);
	// What was typed is still there.
	await expect(page.locator('#title')).toHaveValue(title());
	await expect(page.locator('#content')).toContainText('Fill in the worksheet');
	await expect(page.locator('#dueDate')).toHaveValue(berlinToday());

	// Three files, or one over 5 MB: refused in the browser, nothing posted.
	const posted = recordPosts(page);
	await input.setInputFiles([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);
	await create.click();
	await expect(error).toHaveText('A homework can have at most 2 files.');
	await input.setInputFiles([pdf('big.pdf', MB5 + 1)]);
	await create.click();
	await expect(error).toHaveText('The file is too large. A PDF can be up to 5.0 MB.');
	expect(posted).toEqual([]);
	expect(await created()).toEqual([]);

	// Two valid PDFs: the homework is created with both.
	await input.setInputFiles([pdf('Worksheet.pdf', 300 * 1024), pdf('གཞས་ཚིག.pdf')]);
	await create.click();
	await page.waitForURL(/\/homework\?created=/);
	const [homework] = await created();
	expect(homework).toBeTruthy();
	assignmentId = homework.id;
	instanceId = check(
		await service
			.from('homework_instances')
			.select('id')
			.eq('assignment_id', assignmentId)
			.single(),
		'read copy'
	)!.id;
	const stored = await rows();
	expect(stored.map((row) => [row.file_name, row.size_bytes]).sort()).toEqual(
		[
			['Worksheet.pdf', 300 * 1024],
			['གཞས་ཚིག.pdf', 2048]
		].sort()
	);
	for (const row of stored) {
		expect(row.object_path).toMatch(
			new RegExp(`^${fx.classA.id}/${assignmentId}/[0-9a-f-]{36}\\.pdf$`)
		);
	}
	expect(await objects(fx.classA.id, assignmentId)).toEqual(
		stored.map((row) => row.object_path).sort()
	);
});

test('homework list: a file not attached on create is named in a warning, and the address loses the parameter', async ({
	page
}) => {
	const list = `/teacher/classes/${fx.classA.id}/homework`;
	await signIn(page, fx.teacher);
	// Arrives as the create page's redirect does: an in-app navigation (as
	// in teacher.e2e.ts), not a fresh page load.
	await open(page, list);
	await page.evaluate((href) => {
		const link = document.createElement('a');
		link.href = href;
		link.textContent = 'e2e arrive';
		document.body.append(link);
	}, `${list}?created=0&notAttached=Lyrics%20sheet.pdf`);
	await page.getByRole('link', { name: 'e2e arrive' }).click();
	await expect(
		toast(
			page,
			'The homework was created, but these files were not attached: “Lyrics sheet.pdf”. Add them on the homework page.'
		)
	).toBeVisible();
	await expect.poll(() => new URL(page.url()).searchParams.has('notAttached')).toBe(false);
	expect(new URL(page.url()).searchParams.has('created')).toBe(false);
});

test('teacher page: the files are listed; at 2 the upload is hidden; remove asks first; a wrong file is refused; replace keeps the place', async ({
	page
}) => {
	await signIn(page, fx.teacher);
	await open(page, detailPath());
	const before = await rows();
	await expect(names(page)).toHaveText(before.map((row) => row.file_name));
	await expect(page.locator('form[action="?/uploadFile"]')).toHaveCount(0);
	await expect(
		page.getByText('This homework has 2 files, the most it can have.', { exact: false })
	).toBeVisible();

	// Each opens as a PDF.
	for (const row of before) {
		const { response } = await fetchFile(page, `/files/homework/${row.id}`);
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toBe('application/pdf');
		expect((await response.body()).length).toBe(row.size_bytes);
	}

	// Remove: cancelled, nothing happens; confirmed, row and object gone.
	const second = files(page).nth(1);
	await second.getByRole('button', { name: /^Remove/ }).click();
	await dialog(page).getByRole('button', { name: 'Cancel' }).click();
	expect(await rows()).toEqual(before);
	await second.getByRole('button', { name: /^Remove/ }).click();
	await dialog(page).getByRole('button', { name: 'Remove' }).click();
	await expect(toast(page, 'File removed.')).toBeVisible();
	await expect(names(page)).toHaveCount(1);
	expect((await rows()).map((row) => row.id)).toEqual([before[0].id]);
	expect(await objects(fx.classA.id, assignmentId)).toEqual([before[0].object_path]);

	// The upload field is back; a wrong file is refused at it.
	const uploadForm = page.locator('form[action="?/uploadFile"]');
	const uploadError = page.locator('#homework-file-error');
	await uploadForm.locator('input[type="file"]').setInputFiles(docx);
	await uploadForm.getByRole('button', { name: 'Upload' }).click();
	await expect(uploadError).toHaveText('PDF files only.');
	expect(await rows()).toHaveLength(1);

	await uploadForm.locator('input[type="file"]').setInputFiles(pdf('Reading.pdf', 4096));
	await uploadForm.getByRole('button', { name: 'Upload' }).click();
	await expect(toast(page, 'File uploaded.')).toBeVisible();
	await expect(names(page)).toHaveText([before[0].file_name, 'Reading.pdf']);
	await expect(page.locator('form[action="?/uploadFile"]')).toHaveCount(0);

	// Replace the first: same place, new name and size, old object gone.
	const first = files(page).first();
	const replaceInput = first.locator('form[action="?/replaceFile"] input[type="file"]');
	await replaceInput.setInputFiles(docx);
	await expect(first.getByTestId('file-error')).toHaveText('PDF files only.');
	await replaceInput.setInputFiles(pdf('Worksheet v2.pdf', 8192));
	await expect(toast(page, 'File replaced.')).toBeVisible();
	await expect(names(page)).toHaveText(['Worksheet v2.pdf', 'Reading.pdf']);
	await expect(files(page).getByTestId('file-size')).toHaveText(['8 KB', '4 KB']);
	const after = await rows();
	expect(after[0]).toMatchObject({ id: before[0].id, file_name: 'Worksheet v2.pdf' });
	expect(await objects(fx.classA.id, assignmentId)).toEqual(
		after.map((row) => row.object_path).sort()
	);
	expect(await objects(fx.classA.id, assignmentId)).not.toContain(before[0].object_path);
});

test('teacher on a phone (390 px): the file list and its buttons fit without sideways scrolling', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await signIn(page, fx.teacher);
	await open(page, detailPath());
	await expect(names(page)).toHaveCount(2);
	const fits = () =>
		page.evaluate(
			() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
		);
	expect(await fits()).toBe(true);
	for (const control of [
		files(page)
			.first()
			.getByRole('button', { name: /^Replace/ }),
		files(page)
			.first()
			.getByRole('button', { name: /^Remove/ })
	]) {
		const box = (await control.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(390);
	}

	// The create form's file field fits too.
	await open(page, `/teacher/classes/${fx.classA.id}/homework/new`);
	expect(await fits()).toBe(true);
	const box = (await page.locator('input[type="file"][name="files"]').boundingBox())!;
	expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('student: sees the files on the homework page, opens one and downloads it under its original name; has no upload', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await signIn(page, fx.student);
	await open(page, `/student/homework/${instanceId}`);
	const stored = await rows();
	await expect(fileList(page).getByTestId('file-name')).toHaveText(
		stored.map((row) => row.file_name)
	);
	await expect(page.locator('input[type="file"]')).toHaveCount(0);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
		)
	).toBe(true);

	const shown = await fetchFile(page, `/files/homework/${stored[1].id}`);
	expect(shown.response.status()).toBe(200);
	expect(shown.response.headers()['content-type']).toBe('application/pdf');

	const download = page.getByRole('link', { name: `Download “${stored[0].file_name}”` });
	await expect(download).toHaveAttribute('href', `/files/homework/${stored[0].id}?download`);
	const saved = await fetchFile(page, `/files/homework/${stored[0].id}?download`);
	const disposition = saved.response.headers()['content-disposition'];
	expect(disposition).toContain('attachment');
	expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent(stored[0].file_name)}`);

	// A student cannot post a file to the teacher's page.
	const response = await page.request.post(`${detailPath()}?/uploadFile`, {
		multipart: { file: pdf('student.pdf') },
		headers: { origin: ORIGIN, 'x-sveltekit-action': 'true', accept: 'application/json' },
		maxRedirects: 0
	});
	expect(response.status() === 200 ? (await response.json()).type : 'refused').not.toBe('success');
	expect(await rows()).toEqual(stored);
});

test("parent: the child's homework list shows the files, and they open", async ({ page }) => {
	await signIn(page, parent);
	await open(page, '/parent/homework');
	const stored = await rows();
	const list = page.getByRole('list', { name: `Files for “${title()}”` });
	await expect(list.getByTestId('file-name')).toHaveText(stored.map((row) => row.file_name));
	const { response } = await fetchFile(page, `/files/homework/${stored[0].id}`);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/pdf');
});

test('outsiders: a copied file link gives "not found" and no file', async ({ page }) => {
	const stored = await rows();
	const href = `/files/homework/${stored[0].id}`;

	const anonymous = await playwrightRequest.newContext({ baseURL: ORIGIN });
	for (const url of [href, `${href}?download`, `/files/homework/${crypto.randomUUID()}`]) {
		const response = await anonymous.get(url, { maxRedirects: 0 });
		expect(response.status(), url).toBe(404);
		expect(response.headers()['location']).toBeUndefined();
		expect(await response.text()).not.toContain('%PDF-');
	}
	const storage = `${env.PUBLIC_SUPABASE_URL}/storage/v1/object`;
	for (const url of [
		`${storage}/public/${BUCKET}/${stored[0].object_path}`,
		`${storage}/${BUCKET}/${stored[0].object_path}`,
		`${storage}/sign/${BUCKET}/${stored[0].object_path}`
	]) {
		const response = await anonymous.get(url);
		expect(response.status(), url).toBeGreaterThanOrEqual(400);
		expect(await response.text()).not.toContain('%PDF-');
	}
	await anonymous.dispose();

	// A teacher of no class, signed in: not found.
	await signIn(page, otherTeacher);
	const refused = await page.request.get(href, { maxRedirects: 0 });
	expect(refused.status()).toBe(404);
});

test("wrong class: the class's teacher posts a file id through class B's address; nothing changes", async ({
	page
}) => {
	const stored = await rows();
	await signIn(page, fx.teacher);
	const response = await page.request.post(
		`/teacher/classes/${fx.classB.id}/homework/${assignmentId}?/deleteFile`,
		{
			form: { fileId: stored[0].id },
			headers: { origin: ORIGIN, 'x-sveltekit-action': 'true', accept: 'application/json' },
			maxRedirects: 0
		}
	);
	expect(await response.json()).toMatchObject({ type: 'failure', status: 400 });
	expect(await rows()).toEqual(stored);
	expect(await objects(fx.classA.id, assignmentId)).toEqual(
		stored.map((row) => row.object_path).sort()
	);
});

test('weekly homework: created with two files', async ({ page }) => {
	await signIn(page, fx.teacher);
	await open(page, `/teacher/classes/${fx.classA.id}/homework/new`);
	await page.locator('#title').fill(weeklyTitle());
	await (await contentEditor(page)).fill('Sing it every week');
	await page.getByRole('radio', { name: 'Weekly, recurring' }).check();
	await page.locator('#startDate').fill(`${fx.year}-10-05`);
	await page
		.locator('input[type="file"][name="files"]')
		.setInputFiles([pdf('Lyrics.pdf'), pdf('Chords.pdf')]);
	await page.getByRole('button', { name: 'Create assignment' }).click();
	await page.waitForURL(/\/homework\?created=weekly/);
	const series = check(
		await service.from('homework_assignments').select('id').eq('title', weeklyTitle()).single(),
		'read series'
	)!;
	expect((await rows(series.id)).map((row) => row.file_name).sort()).toEqual([
		'Chords.pdf',
		'Lyrics.pdf'
	]);
	expect(await objects(fx.classA.id, series.id)).toHaveLength(2);
});
