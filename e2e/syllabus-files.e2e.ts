import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { currentSchoolYear } from '../src/lib/school-year';
import {
	createCalendarFixture,
	env,
	service,
	signIn,
	type CalendarFixture,
	type TestUser
} from './fixtures';

/**
 * PDF files on a syllabus section (0039): a teacher uploads, the admin
 * replaces, an enrolled student opens; wrong files and a sixth file are
 * refused; nobody outside the class gets a file; deleting a file, section,
 * syllabus or class leaves nothing in the bucket. Uses the calendar
 * fixture's class A (the teacher's, the student enrolled) and class B (the
 * teacher's too, for the wrong-class posts).
 */

test.describe.configure({ mode: 'serial' });

const ORIGIN = 'http://localhost:5199';
const BUCKET = 'syllabus-files';
const MB = 1_048_576;

let fx: CalendarFixture;
let syllabusId: string;
let sectionId: string;
let teacherPath: string;
let adminPath: string;
let otherTeacher: TestUser;
/** Classes whose bucket folders are emptied at the end. */
const classIds: string[] = [];

/** A file whose content starts like a PDF, `size` bytes long. */
function pdf(name: string, size = 2048, mimeType = 'application/pdf') {
	const buffer = Buffer.alloc(size);
	buffer.write('%PDF-1.7\n');
	return { name, mimeType, buffer };
}
const docx = {
	name: 'notes.docx',
	mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	buffer: Buffer.from('PK\u0003\u0004 not a pdf')
};
const fakePdf = { name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hello') };

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function makeSyllabus(classId: string, year = currentSchoolYear()) {
	return check(
		await service
			.from('class_syllabi')
			.insert({ class_id: classId, school_year: year })
			.select('id')
			.single(),
		'create syllabus'
	)!.id;
}

async function makeSection(forSyllabus: string, title: string, position = 1) {
	return check(
		await service
			.from('class_syllabus_sections')
			.insert({ syllabus_id: forSyllabus, position, title })
			.select('id')
			.single(),
		'create section'
	)!.id;
}

/** A stored file made by the service role: object and row. */
async function storeFile(classId: string, section: string, name: string) {
	const path = `${classId}/${section}/${crypto.randomUUID()}.pdf`;
	check(
		await service.storage
			.from(BUCKET)
			.upload(path, pdf(name).buffer, { contentType: 'application/pdf' }),
		'store object'
	);
	check(
		await service
			.from('class_syllabus_section_files')
			.insert({ section_id: section, object_path: path, file_name: name, size_bytes: 2048 }),
		'record file'
	);
	return path;
}

/** The file rows of a section, in the order shown. */
async function rows(section = sectionId) {
	return (
		check(
			await service
				.from('class_syllabus_section_files')
				.select('id, file_name, size_bytes, object_path')
				.eq('section_id', section)
				.order('created_at'),
			'read files'
		) ?? []
	);
}

/** The object paths the bucket holds for a section. */
async function objects(classId: string, section: string) {
	const listed = check(
		await service.storage.from(BUCKET).list(`${classId}/${section}`),
		'list objects'
	);
	return (listed ?? []).map((object) => `${classId}/${section}/${object.name}`).sort();
}

/** Every object path the bucket holds for a class. */
async function classObjects(classId: string) {
	const folders = check(await service.storage.from(BUCKET).list(classId), 'list folders') ?? [];
	const all: string[] = [];
	for (const folder of folders) all.push(...(await objects(classId, folder.name)));
	return all;
}

test.beforeAll(async () => {
	fx = await createCalendarFixture();
	classIds.push(fx.classA.id, fx.classB.id);
	syllabusId = await makeSyllabus(fx.classA.id);
	sectionId = await makeSection(syllabusId, 'Song 1');
	teacherPath = `/teacher/classes/${fx.classA.id}/syllabus/${syllabusId}`;
	adminPath = `/admin/classes/${fx.classA.id}/syllabus/${syllabusId}`;

	// A teacher of no class: signed in, but outside class A.
	const email = `e2e-0039-teacher-${fx.tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role: 'teacher' }
	});
	if (error || !data.user) throw new Error(`create teacher: ${error?.message}`);
	otherTeacher = { id: data.user.id, email, password };
});

test.afterAll(async () => {
	// The fixture deletes its classes with the service role, which cannot
	// reach the bucket: empty their folders first.
	for (const classId of classIds) {
		const paths = await classObjects(classId);
		if (paths.length) await service.storage.from(BUCKET).remove(paths);
	}
	if (otherTeacher) await service.auth.admin.deleteUser(otherTeacher.id);
	await fx?.cleanup();
});

/** Waits for hydration and for the iX form components to be defined. */
async function open(page: Page, path: string) {
	await page.goto(path);
	await page.waitForFunction(() => customElements.get('ix-button') !== undefined);
	await page.waitForLoadState('networkidle');
}

const card = (page: Page, title: string) =>
	page.locator('section[data-section-id]').filter({ has: page.getByText(title, { exact: true }) });
const files = (page: Page) => card(page, 'Song 1').locator('li.file');
const names = (page: Page) => files(page).locator('.file-name');
/** The file actions the page posts to from now on (`uploadFile`, `replaceFile`), in order. */
function recordPosts(page: Page): string[] {
	const posts: string[] = [];
	page.on('request', (request) => {
		const action = /\?\/(uploadFile|replaceFile)$/.exec(request.url())?.[1];
		if (request.method() === 'POST' && action) posts.push(action);
	});
	return posts;
}

const toast = (page: Page, text: string) => page.locator('ix-toast').getByText(text).first();

async function upload(page: Page, file: ReturnType<typeof pdf>) {
	const section = card(page, 'Song 1');
	await section.locator('form[action="?/uploadFile"] input[type="file"]').setInputFiles(file);
	await section.getByRole('button', { name: 'Upload' }).click();
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

test('teacher: wrong files are refused with a message; two PDFs are listed with name and size and open as PDFs', async ({
	page
}) => {
	await signIn(page, fx.teacher);
	await open(page, teacherPath);
	const section = card(page, 'Song 1');
	const error = section.locator(`#section-file-error-${sectionId}`);
	await expect(
		section.getByText('PDF only, up to 1.0 MB. At most 5 files per section.')
	).toBeVisible();
	await expect(section.getByText('No description or links yet.')).toBeVisible();

	// No file chosen.
	await section.getByRole('button', { name: 'Upload' }).click();
	await expect(error).toHaveText('Choose a PDF file.');

	// Over 1 MB: refused in the browser, before anything is sent.
	const posted = recordPosts(page);
	await upload(page, pdf('big.pdf', MB + 1));
	await expect(error).toHaveText('The file is too large. A PDF can be up to 1.0 MB.');

	expect(posted).toEqual([]);

	// Not a PDF: a Word file, and a ".pdf" whose content is something else.
	await upload(page, docx);
	await expect(error).toHaveText('PDF files only.');
	await upload(page, fakePdf);
	await expect(error).toHaveText('PDF files only.');
	expect(await rows()).toEqual([]);
	expect(await objects(fx.classA.id, sectionId)).toEqual([]);

	// Two PDFs, one with a Tibetan name.
	await upload(page, pdf('Song 1 lyrics.pdf', 300 * 1024));
	await expect(toast(page, 'File uploaded.')).toBeVisible();
	await expect(names(page)).toHaveText(['Song 1 lyrics.pdf']);
	await expect(error).toHaveCount(0);
	await upload(page, pdf('གཞས་ཚིག.pdf'));
	await expect(names(page)).toHaveText(['Song 1 lyrics.pdf', 'གཞས་ཚིག.pdf']);
	await expect(files(page).locator('.file-size')).toHaveText(['300 KB', '2 KB']);
	await expect(section.getByText('No description or links yet.')).toHaveCount(0);

	// Stored under the class and section, never under the file's name.
	const stored = await rows();
	expect(stored.map((row) => [row.file_name, row.size_bytes])).toEqual([
		['Song 1 lyrics.pdf', 300 * 1024],
		['གཞས་ཚིག.pdf', 2048]
	]);
	for (const row of stored) {
		expect(row.object_path).toMatch(
			new RegExp(`^${fx.classA.id}/${sectionId}/[0-9a-f-]{36}\\.pdf$`)
		);
	}
	expect(await objects(fx.classA.id, sectionId)).toEqual(stored.map((r) => r.object_path).sort());

	// Each opens as a PDF, in a new tab.
	for (const [i, row] of stored.entries()) {
		const link = names(page).nth(i);
		await expect(link).toHaveAttribute('href', `/files/syllabus/${row.id}`);
		await expect(link).toHaveAttribute('target', '_blank');
		const { response } = await fetchFile(page, `/files/syllabus/${row.id}`);
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toBe('application/pdf');
		const body = await response.body();
		expect(body.subarray(0, 5).toString()).toBe('%PDF-');
		expect(body.length).toBe(row.size_bytes);
	}
});

test('teacher on a phone (390 px): the upload control and the file list fit without sideways scrolling', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await signIn(page, fx.teacher);
	await open(page, teacherPath);
	const section = card(page, 'Song 1');
	await expect(names(page)).toHaveCount(2);
	const fits = () =>
		page.evaluate(() => {
			const root = document.documentElement;
			return root.scrollWidth <= root.clientWidth;
		});
	expect(await fits()).toBe(true);
	for (const control of [
		section.locator('form[action="?/uploadFile"] input[type="file"]'),
		section.getByRole('button', { name: 'Upload' }),
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

	// A long name without spaces wraps instead of widening the page; uploaded from the phone.
	await upload(page, pdf(`${'Tashi_delek_'.repeat(12)}.pdf`));
	await expect(names(page)).toHaveCount(3);
	expect(await fits()).toBe(true);
	const long = (await rows())[2];
	await files(page)
		.nth(2)
		.getByRole('button', { name: /^Remove/ })
		.click();
	await page.locator('ix-modal').getByRole('button', { name: 'Remove' }).click();
	await expect(names(page)).toHaveCount(2);
	expect(await objects(fx.classA.id, sectionId)).not.toContain(long.object_path);
});

test('admin: sees and opens the files; replacing keeps the place with the new name and size and removes the old object; an invalid replacement keeps the old file', async ({
	page
}) => {
	await signIn(page, fx.admin);
	await open(page, adminPath);
	await expect(names(page)).toHaveText(['Song 1 lyrics.pdf', 'གཞས་ཚིག.pdf']);
	const before = await rows();
	const opened = await fetchFile(page, `/files/syllabus/${before[1].id}`);
	expect(opened.response.headers()['content-type']).toBe('application/pdf');

	const first = files(page).first();
	const replaceInput = first.locator('form[action="?/replaceFile"] input[type="file"]');

	// Invalid: the old file stays, with the message at that file.
	await replaceInput.setInputFiles(docx);
	await expect(first.locator('.file-error')).toHaveText('PDF files only.');
	// Over 1 MB: refused in the browser, nothing is posted.
	const posted = recordPosts(page);
	await replaceInput.setInputFiles(pdf('big.pdf', MB + 1));
	await expect(first.locator('.file-error')).toHaveText(
		'The file is too large. A PDF can be up to 1.0 MB.'
	);
	expect(posted).toEqual([]);
	expect(await rows()).toEqual(before);
	expect(await objects(fx.classA.id, sectionId)).toEqual(before.map((r) => r.object_path).sort());

	// Valid: same place, new name and size, the old object gone.
	await replaceInput.setInputFiles(pdf('Lyrics v2.pdf', 4096));
	await expect(toast(page, 'File replaced.')).toBeVisible();
	await expect(names(page)).toHaveText(['Lyrics v2.pdf', 'གཞས་ཚིག.pdf']);
	await expect(files(page).locator('.file-size')).toHaveText(['4 KB', '2 KB']);
	await expect(first.locator('.file-error')).toHaveCount(0);
	const after = await rows();
	expect(after[0]).toMatchObject({
		id: before[0].id,
		file_name: 'Lyrics v2.pdf',
		size_bytes: 4096
	});
	expect(after[0].object_path).not.toBe(before[0].object_path);
	expect(after[1]).toEqual(before[1]);
	expect(await objects(fx.classA.id, sectionId)).toEqual(after.map((r) => r.object_path).sort());
	const { response } = await fetchFile(page, `/files/syllabus/${after[0].id}`);
	expect((await response.body()).length).toBe(4096);
});

test('student: sees the files with name and size, opens one as a PDF and downloads it under its original name; has no upload, replace or remove', async ({
	page
}) => {
	await signIn(page, fx.student);
	await open(page, `/student/classes/${fx.classA.id}`);
	const section = page.locator('.syllabus-section').filter({ hasText: 'Song 1' });
	await expect(section.locator('.file-name')).toHaveText(['Lyrics v2.pdf', 'གཞས་ཚིག.pdf']);
	await expect(section.locator('.file-size')).toHaveText(['4 KB', '2 KB']);
	await expect(section.locator('input[type="file"]')).toHaveCount(0);
	await expect(section.locator('form')).toHaveCount(0);

	const stored = await rows();
	const link = section.locator('.file-name').nth(1);
	await expect(link).toHaveAttribute('href', `/files/syllabus/${stored[1].id}`);
	await expect(link).toHaveAttribute('target', '_blank');
	const shown = await fetchFile(page, `/files/syllabus/${stored[1].id}`);
	expect(shown.response.status()).toBe(200);
	expect(shown.response.headers()['content-type']).toBe('application/pdf');
	expect(shown.response.headers()['content-disposition'] ?? '').not.toContain('attachment');
	expect((await shown.response.body()).subarray(0, 5).toString()).toBe('%PDF-');

	// The Download link saves it under the name the teacher's file had.
	const download = section.getByRole('link', { name: 'Download “གཞས་ཚིག.pdf”' });
	await expect(download).toHaveAttribute('href', `/files/syllabus/${stored[1].id}?download`);
	const saved = await fetchFile(page, `/files/syllabus/${stored[1].id}?download`);
	const disposition = saved.response.headers()['content-disposition'];
	expect(disposition).toContain('attachment');
	expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent('གཞས་ཚིག.pdf')}`);

	// A student cannot post a file to the teacher's or the admin's page.
	for (const path of [teacherPath, adminPath]) {
		const response = await page.request.post(`${path}?/uploadFile`, {
			multipart: { sectionId, file: pdf('student.pdf') },
			headers: { origin: ORIGIN, 'x-sveltekit-action': 'true', accept: 'application/json' },
			maxRedirects: 0
		});
		expect(response.status() === 200 ? (await response.json()).type : 'refused').not.toBe(
			'success'
		);
	}
	expect((await rows()).map((r) => r.file_name)).toEqual(['Lyrics v2.pdf', 'གཞས་ཚིག.pdf']);
});

test('outsiders: a copied file link gives "not found" and no file to a teacher of another class and to a signed-out visitor', async ({
	page
}) => {
	const stored = await rows();
	const href = `/files/syllabus/${stored[0].id}`;

	// Signed out: no session at all.
	const anonymous = await playwrightRequest.newContext({ baseURL: ORIGIN });
	for (const url of [href, `${href}?download`, `/files/syllabus/${crypto.randomUUID()}`]) {
		const response = await anonymous.get(url, { maxRedirects: 0 });
		expect(response.status(), url).toBe(404);
		expect(response.headers()['location']).toBeUndefined();
		expect(await response.text()).not.toContain('%PDF-');
	}
	// Guessing the storage address directly: no public object, no link without a token.
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

	// Signed in, but not in the class.
	await signIn(page, otherTeacher);
	for (const url of [href, `${href}?download`]) {
		const response = await page.request.get(url, { maxRedirects: 0 });
		expect(response.status(), url).toBe(404);
		expect(response.headers()['location']).toBeUndefined();
	}
	await page.goto(href);
	await expect(page.getByText('File not found.')).toBeVisible();
	// Nor can they post to the class's page.
	const posted = await page.request.post(`${teacherPath}?/deleteFile`, {
		form: { sectionId, fileId: stored[0].id },
		headers: { origin: ORIGIN, 'x-sveltekit-action': 'true', accept: 'application/json' }
	});
	expect(posted.status() === 200 ? (await posted.json()).type : 'refused').not.toBe('success');
	expect(await rows()).toEqual(stored);
	expect(await objects(fx.classA.id, sectionId)).toEqual(stored.map((r) => r.object_path).sort());
});

test('plain form posts: upload, replace and remove work without JavaScript; wrong files and a wrong class change nothing', async ({
	page
}) => {
	await signIn(page, fx.teacher);
	const headers = { origin: ORIGIN, accept: 'text/html' };
	const action = { ...headers, 'x-sveltekit-action': 'true', accept: 'application/json' };
	const before = await rows();

	// A plain (not enhanced) upload answers with the page, the new file listed.
	const added = await page.request.post(`${teacherPath}?/uploadFile`, {
		multipart: { sectionId, file: pdf('Plain post.pdf', 1234) },
		headers
	});
	expect(added.status()).toBe(200);
	expect(await added.text()).toContain('Plain post.pdf');
	let stored = await rows();
	expect(stored.map((r) => r.file_name)).toEqual([
		'Lyrics v2.pdf',
		'གཞས་ཚིག.pdf',
		'Plain post.pdf'
	]);
	const plain = stored[2];

	// Refused files come back as the page with the message, nothing stored.
	for (const [file, message] of [
		[pdf('big.pdf', MB + 1), 'The file is too large. A PDF can be up to 1.0 MB.'],
		[pdf('huge.pdf', 3 * MB), 'The file is too large. A PDF can be up to 1.0 MB.'],
		[docx, 'PDF files only.'],
		[fakePdf, 'PDF files only.']
	] as const) {
		const refused = await page.request.post(`${teacherPath}?/uploadFile`, {
			multipart: { sectionId, file },
			headers
		});
		expect([400, 413], file.name).toContain(refused.status());
		expect(await refused.text(), file.name).toContain(message);
	}
	const empty = await page.request.post(`${teacherPath}?/uploadFile`, {
		multipart: { sectionId },
		headers
	});
	expect(empty.status()).toBe(400);
	expect(await empty.text()).toContain('Choose a PDF file.');
	expect(await rows()).toEqual(stored);

	// Replace, plain: an invalid file keeps the old one.
	const badReplace = await page.request.post(`${teacherPath}?/replaceFile`, {
		multipart: { sectionId, fileId: plain.id, file: docx },
		headers: action
	});
	expect(await badReplace.json()).toMatchObject({ type: 'failure', status: 400 });
	expect(await rows()).toEqual(stored);

	// Wrong class: the teacher's other class with this section and its files.
	const wrongClassPath = `/teacher/classes/${fx.classB.id}/syllabus/${syllabusId}`;
	// And the right class with a syllabus that is not the section's.
	const otherSyllabus = await makeSyllabus(fx.classA.id, currentSchoolYear() - 1);
	const wrongSyllabusPath = `/teacher/classes/${fx.classA.id}/syllabus/${otherSyllabus}`;
	for (const path of [wrongClassPath, wrongSyllabusPath]) {
		for (const [name, body] of [
			['uploadFile', { multipart: { sectionId, file: pdf('Hijacked.pdf') } }],
			['replaceFile', { multipart: { sectionId, fileId: plain.id, file: pdf('Hijacked.pdf') } }],
			['deleteFile', { form: { sectionId, fileId: plain.id } }],
			['deleteSection', { form: { sectionId } }]
		] as const) {
			const response = await page.request.post(`${path}?/${name}`, { ...body, headers: action });
			expect(await response.json(), `${path} ${name}`).toMatchObject({
				type: 'failure',
				status: 400
			});
		}
	}
	// A file id of another section in a post for this one.
	const otherSection = await makeSection(syllabusId, 'Other section', 2);
	await storeFile(fx.classA.id, otherSection, 'Elsewhere.pdf');
	const elsewhere = (await rows(otherSection))[0];
	for (const name of ['replaceFile', 'deleteFile'] as const) {
		const response = await page.request.post(`${teacherPath}?/${name}`, {
			multipart: { sectionId, fileId: elsewhere.id, file: pdf('Hijacked.pdf') },
			headers: action
		});
		expect(await response.json(), name).toMatchObject({ type: 'failure', status: 400 });
	}
	expect(await rows()).toEqual(stored);
	expect(await rows(otherSection)).toEqual([elsewhere]);
	expect(await objects(fx.classA.id, sectionId)).toEqual(stored.map((r) => r.object_path).sort());
	expect(await objects(fx.classA.id, otherSection)).toEqual([elsewhere.object_path]);

	// Replace and remove, plain.
	const replaced = await page.request.post(`${teacherPath}?/replaceFile`, {
		multipart: { sectionId, fileId: plain.id, file: pdf('Plain replaced.pdf', 999) },
		headers
	});
	expect(replaced.status()).toBe(200);
	stored = await rows();
	expect(stored[2]).toMatchObject({
		id: plain.id,
		file_name: 'Plain replaced.pdf',
		size_bytes: 999
	});
	expect(await objects(fx.classA.id, sectionId)).toEqual(stored.map((r) => r.object_path).sort());

	const removed = await page.request.post(`${teacherPath}?/deleteFile`, {
		form: { sectionId, fileId: plain.id },
		headers
	});
	expect(removed.status()).toBe(200);
	expect(await rows()).toEqual(before);
	expect(await objects(fx.classA.id, sectionId)).toEqual(before.map((r) => r.object_path).sort());
});

test('a section holds 5 files: the upload control is hidden at 5 and a sixth is refused', async ({
	page
}) => {
	await signIn(page, fx.teacher);
	await open(page, teacherPath);
	const section = card(page, 'Song 1');
	for (const name of ['Three.pdf', 'Four.pdf', 'Five.pdf']) {
		await upload(page, pdf(name));
		await expect(names(page).filter({ hasText: name })).toHaveCount(1);
	}
	await expect(names(page)).toHaveCount(5);
	await expect(section.locator('form[action="?/uploadFile"]')).toHaveCount(0);
	await expect(
		section.getByText('This section has 5 files, the most it can have. Remove one to add another.')
	).toBeVisible();
	// The other section still offers it.
	await expect(card(page, 'Other section').locator('form[action="?/uploadFile"]')).toHaveCount(1);

	const stored = await rows();
	const sixth = await page.request.post(`${teacherPath}?/uploadFile`, {
		multipart: { sectionId, file: pdf('Six.pdf') },
		headers: { origin: ORIGIN, accept: 'text/html' }
	});
	expect(sixth.status()).toBe(400);
	expect(await sixth.text()).toContain('A section can have at most 5 files.');
	expect(await rows()).toEqual(stored);
	expect(await objects(fx.classA.id, sectionId)).toHaveLength(5);

	// Replacing is still possible at 5.
	await files(page)
		.nth(4)
		.locator('form[action="?/replaceFile"] input[type="file"]')
		.setInputFiles(pdf('Five again.pdf'));
	await expect(names(page).nth(4)).toHaveText('Five again.pdf');
	expect(await objects(fx.classA.id, sectionId)).toHaveLength(5);
});

test('teacher: removing a file asks first; cancelled, nothing happens; confirmed, the row and the stored object are gone', async ({
	page
}) => {
	await signIn(page, fx.teacher);
	await open(page, teacherPath);
	const before = await rows();
	const target = before[4];

	await files(page).nth(4).getByRole('button', { name: 'Remove “Five again.pdf”' }).click();
	const modal = page.locator('ix-modal');
	await expect(modal).toContainText('Remove the file “Five again.pdf”?');
	await modal.getByRole('button', { name: 'Cancel' }).click();
	await expect(modal).toHaveCount(0);
	expect(await rows()).toEqual(before);
	expect(await objects(fx.classA.id, sectionId)).toContain(target.object_path);

	await files(page).nth(4).getByRole('button', { name: 'Remove “Five again.pdf”' }).click();
	await page.locator('ix-modal').getByRole('button', { name: 'Remove' }).click();
	await expect(toast(page, 'File removed.')).toBeVisible();
	await expect(names(page)).toHaveCount(4);
	expect(await rows()).toEqual(before.slice(0, 4));
	expect(await objects(fx.classA.id, sectionId)).toEqual(
		before
			.slice(0, 4)
			.map((r) => r.object_path)
			.sort()
	);
	// The upload control is back below 5.
	await expect(card(page, 'Song 1').locator('form[action="?/uploadFile"]')).toHaveCount(1);
	// The removed file's link is gone for good.
	const gone = await page.request.get(`/files/syllabus/${target.id}`, { maxRedirects: 0 });
	expect(gone.status()).toBe(404);
});

test('deleting a section, a syllabus or a class removes their stored files from the bucket', async ({
	page
}) => {
	// Section, by the teacher.
	await signIn(page, fx.teacher);
	await open(page, teacherPath);
	expect(await objects(fx.classA.id, sectionId)).toHaveLength(4);
	await card(page, 'Song 1').getByRole('button', { name: 'Delete section' }).click();
	await page.locator('ix-modal').getByRole('button', { name: 'Delete' }).click();
	await expect(toast(page, 'Section deleted.')).toBeVisible();
	expect(await objects(fx.classA.id, sectionId)).toEqual([]);
	expect(await rows()).toEqual([]);
	// The other section's file is untouched.
	expect(await classObjects(fx.classA.id)).toHaveLength(1);

	// Syllabus, by the teacher: its remaining section's file goes with it.
	await page.getByRole('button', { name: 'Delete syllabus' }).click();
	await page.locator('ix-modal').getByRole('button', { name: 'Delete' }).click();
	// The list page shows the toast and drops `?deleted=` from the address.
	await expect(page).toHaveURL(
		new RegExp(`/teacher/classes/${fx.classA.id}/syllabus(\\?deleted=\\d+)?$`)
	);
	expect(await classObjects(fx.classA.id)).toEqual([]);

	// Class, by the admin: a class of its own with two syllabi holding files.
	const cls = check(
		await service
			.from('classes')
			.insert({
				name: `E2E0039 ${fx.tag}`,
				code: `P${crypto.randomUUID().slice(0, 5).toUpperCase()}`
			})
			.select('id, name')
			.single(),
		'create class'
	)!;
	classIds.push(cls.id);
	for (const year of [currentSchoolYear(), currentSchoolYear() - 1]) {
		const section = await makeSection(await makeSyllabus(cls.id, year), `Year ${year}`);
		await storeFile(cls.id, section, 'One.pdf');
		await storeFile(cls.id, section, 'Two.pdf');
	}
	expect(await classObjects(cls.id)).toHaveLength(4);

	await page.context().clearCookies();
	await signIn(page, fx.admin);
	const deleted = await page.request.post('/admin/classes?/delete', {
		form: { classId: cls.id, className: cls.name },
		headers: { origin: ORIGIN, 'x-sveltekit-action': 'true', accept: 'application/json' }
	});
	expect(await deleted.json()).toMatchObject({ type: 'success' });
	expect(await classObjects(cls.id)).toEqual([]);
	const { data } = await service.from('classes').select('id').eq('id', cls.id);
	expect(data).toEqual([]);
});
