import { expect, test, type Page } from '@playwright/test';
import { fixtureTeam, service, signIn, type TestUser } from './fixtures';

/**
 * spec-parent-message-board story 3 (CAP-1, CAP-2 text only): a granted
 * parent posts on /board; a student signs in, sees the post with the
 * parent's name, and has no post form. Story 4: a post with a PDF file,
 * which the student opens through /files/board/[fileId].
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const parentName = `BRD Parent ${tag}`;
const message = `Picnic on Saturday ${tag}`;
const flyerMessage = `Flyer for the picnic ${tag}`;
const BUCKET = 'board-files';
const MB5 = 5_242_880;
const refusedMessage = `Refused files ${tag}`;
const docx = {
	name: 'notes.docx',
	mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	buffer: Buffer.from('PK\u0003\u0004 not a pdf')
};

/** A file whose content starts like a PDF, `size` bytes long. */
function pdf(name: string, size = 2048) {
	const buffer = Buffer.alloc(size);
	buffer.write('%PDF-1.7\n');
	return { name, mimeType: 'application/pdf', buffer };
}

let parent: TestUser;
let student: TestUser;
const userIds: string[] = [];
const team = fixtureTeam(tag);

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'parent' | 'student', key: string): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-brd-${key}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

test.beforeAll(async () => {
	parent = await createUser('parent', 'p');
	check(
		await service
			.from('parents')
			.update({ status: 'approved', can_post_board: true })
			.eq('id', parent.id),
		'approve and grant parent'
	);
	check(
		await service.from('profiles').update({ display_name: parentName }).eq('id', parent.id),
		'name parent'
	);

	student = await createUser('student', 's');
	check(
		await service
			.from('profiles')
			.update({
				status: 'approved',
				registration_name: `BRD Student ${tag}`,
				display_name: `BRD Student ${tag}`,
				team_id: await team.id()
			})
			.eq('id', student.id),
		'approve student'
	);
});

test.afterAll(async () => {
	const problems: string[] = [];
	if (parent) {
		// The service role's delete cascades to the file rows but not the
		// bucket: remove the posts' objects first.
		const { data: postRows } = await service
			.from('board_posts')
			.select('id')
			.eq('author_id', parent.id);
		for (const { id } of postRows ?? []) {
			const { data: objects } = await service.storage.from(BUCKET).list(id);
			const paths = (objects ?? []).map((object) => `${id}/${object.name}`);
			if (paths.length) {
				const { error } = await service.storage.from(BUCKET).remove(paths);
				if (error) problems.push(`remove files: ${error.message}`);
			}
		}
		const { error } = await service.from('board_posts').delete().eq('author_id', parent.id);
		if (error) problems.push(`delete posts: ${error.message}`);
	}
	for (const id of userIds.slice().reverse()) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	if (problems.length) throw new Error(problems.join('; '));
});

async function open(page: Page, path: string) {
	await page.goto(path);
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

const posts = (page: Page) => page.getByTestId('board-post');

test('a granted parent posts; the student sees it and has no form', async ({ browser }) => {
	const parentContext = await browser.newContext();
	try {
		const page = await parentContext.newPage();
		await signIn(page, parent);
		await open(page, '/board');
		await expect(page.getByRole('heading', { level: 1, name: 'Message board' })).toBeVisible();

		const form = page.getByTestId('board-form');
		await expect(form).toBeVisible();
		const editor = form.locator('#content');
		await expect(editor).toHaveAttribute('contenteditable', 'true');
		await editor.click();
		await page.keyboard.type(message);
		await form.getByRole('button', { name: 'Post' }).click();

		await expect(
			page.locator('[data-sonner-toast]').getByText('Your post is on the board.').first()
		).toBeVisible();
		// By its own text: another e2e file may post at the same time.
		const mine = posts(page).filter({ hasText: message });
		await expect(mine).toHaveCount(1);
		await expect(mine).toContainText(parentName);
		// The form is empty again.
		await expect(form.locator('#content')).toHaveText('');
	} finally {
		await parentContext.close();
	}

	const studentContext = await browser.newContext();
	try {
		const page = await studentContext.newPage();
		await signIn(page, student);
		await open(page, '/board');
		const mine = posts(page).filter({ hasText: message });
		await expect(mine).toHaveCount(1);
		await expect(mine).toContainText(parentName);
		await expect(mine.locator('time[datetime]')).toBeVisible();
		await expect(page.getByTestId('board-form')).toHaveCount(0);
	} finally {
		await studentContext.close();
	}
});

test('a parent posts with a PDF; the student sees it and opens the file', async ({ browser }) => {
	const parentContext = await browser.newContext();
	try {
		const page = await parentContext.newPage();
		await signIn(page, parent);
		await open(page, '/board');
		const form = page.getByTestId('board-form');
		const editor = form.locator('#content');
		await expect(editor).toHaveAttribute('contenteditable', 'true');
		await editor.click();
		await page.keyboard.type(flyerMessage);
		await form.locator('input[type="file"]').setInputFiles([pdf(`Flyer ${tag}.pdf`, 4096)]);
		await form.getByRole('button', { name: 'Post' }).click();

		await expect(
			page.locator('[data-sonner-toast]').getByText('Your post is on the board.').first()
		).toBeVisible();
		const mine = posts(page).filter({ hasText: flyerMessage });
		await expect(mine.getByTestId('file-name')).toHaveText(`Flyer ${tag}.pdf`);
	} finally {
		await parentContext.close();
	}

	const studentContext = await browser.newContext();
	try {
		const page = await studentContext.newPage();
		await signIn(page, student);
		await open(page, '/board');
		const mine = posts(page).filter({ hasText: flyerMessage });
		const link = mine.getByTestId('file-name');
		await expect(link).toHaveText(`Flyer ${tag}.pdf`);
		await expect(mine.getByTestId('file-size')).toHaveText('4 KB');

		const href = await link.getAttribute('href');
		expect(href).toMatch(/^\/files\/board\/[0-9a-f-]{36}$/);
		const redirect = await page.request.get(href!, { maxRedirects: 0 });
		expect(redirect.status()).toBe(303);
		expect(redirect.headers()['cache-control']).toBe('no-store');
		const location = redirect.headers()['location'];
		expect(location).toContain(`/storage/v1/object/sign/${BUCKET}/`);
		const file = await page.request.get(location);
		expect(file.status()).toBe(200);
		expect((await file.body()).subarray(0, 5).toString()).toBe('%PDF-');

		const download = await page.request.get(`${href}?download`, { maxRedirects: 0 });
		expect(download.status()).toBe(303);
		expect(download.headers()['location']).toContain(
			`download=${encodeURIComponent(`Flyer ${tag}.pdf`)}`
		);
	} finally {
		await studentContext.close();
	}
});

test('too many or too large files are refused in the browser; a Word file by the server; no post', async ({
	page
}) => {
	await signIn(page, parent);
	await open(page, '/board');
	const form = page.getByTestId('board-form');
	const editor = form.locator('#content');
	await expect(editor).toHaveAttribute('contenteditable', 'true');
	await editor.click();
	await page.keyboard.type(refusedMessage);
	const input = form.locator('input[type="file"][name="files"]');
	const error = page.getByTestId('file-error');
	const submit = form.getByRole('button', { name: 'Post' });
	const stored = async () =>
		(
			check(
				await service.from('board_posts').select('id').eq('author_id', parent.id),
				'read posts'
			) ?? []
		).length;
	const before = await stored();

	// Three files, or one over 5 MB: refused here, nothing posted.
	const posted: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().includes('?/post')) posted.push(request.url());
	});
	await input.setInputFiles([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);
	await submit.click();
	await expect(error).toHaveText('A post can have at most 2 files.');
	await expect(input).toHaveAttribute('aria-invalid', 'true');
	// Choosing other files clears the message.
	await input.setInputFiles([pdf('big.pdf', MB5 + 1)]);
	await expect(error).toHaveCount(0);
	await submit.click();
	await expect(error).toHaveText('The file is too large. A PDF can be up to 5.0 MB.');
	expect(posted).toEqual([]);
	expect(await stored()).toBe(before);

	// A Word file next to a PDF: checked by the server, no post.
	await input.setInputFiles([pdf('a.pdf'), docx]);
	await submit.click();
	await expect(error).toContainText('PDF files only.');
	await expect(error).toContainText('notes.docx');
	expect(posted).toHaveLength(1);
	expect(await stored()).toBe(before);
	await expect(posts(page).filter({ hasText: refusedMessage })).toHaveCount(0);
});
