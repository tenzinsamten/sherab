import { expect, test, type Page } from '@playwright/test';
import { fixtureTeam, service, signIn, type TestUser } from './fixtures';

/**
 * spec-parent-message-board story 3 (CAP-1, CAP-2 text only): a granted
 * parent posts on /board; a student signs in, sees the post with the
 * parent's name, and has no post form. Story 8 (story 4 before it): a post
 * with a JPEG image, which the student sees and opens full size; a long
 * post expands in place. (A legacy PDF row can no longer be inserted, 0064;
 * its download link is covered by page.render.spec.ts.)
 * Story 5: the author edits, then deletes a post with an image (its object
 * goes too); a teacher deletes a parent's post; a student sees no controls.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const parentName = `BRD Parent ${tag}`;
const message = `Picnic on Saturday ${tag}`;
const flyerMessage = `Flyer for the picnic ${tag}`;
const BUCKET = 'board-files';
const refusedMessage = `Refused files ${tag}`;
const longMessage = `Long news ${tag} ` + 'The school trip starts early. '.repeat(15);
const editMessage = `Bring a jacket ${tag}`;
const editedMessage = `Bring a warm jacket ${tag}`;
const moderatedMessage = `Unsuitable post ${tag}`;
/** A file whose content starts like a JPEG, `size` bytes long. */
function jpeg(name: string, size = 2048) {
	const buffer = Buffer.alloc(size);
	buffer.set([0xff, 0xd8, 0xff, 0xe0]);
	return { name, mimeType: 'image/jpeg', buffer };
}

/** A file whose content starts like a PDF, sent under any name and type. */
function pdfBytes(name: string, mimeType = 'application/pdf') {
	const buffer = Buffer.alloc(2048);
	buffer.write('%PDF-1.7\n');
	return { name, mimeType, buffer };
}

let parent: TestUser;
let student: TestUser;
let teacher: TestUser;
const userIds: string[] = [];
const team = fixtureTeam(tag);

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'parent' | 'student' | 'teacher', key: string): Promise<TestUser> {
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

	teacher = await createUser('teacher', 't');
	check(
		await service
			.from('profiles')
			.update({ display_name: `BRD Teacher ${tag}` })
			.eq('id', teacher.id),
		'name teacher'
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
		// Story 7: a title is required.
		await form.getByLabel('Title').fill(`Picnic ${tag}`);
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
		await expect(mine.getByRole('heading', { name: `Picnic ${tag}` })).toBeVisible();
		// The form is empty again.
		await expect(form.locator('#content')).toHaveText('');
		await expect(form.getByLabel('Title')).toHaveValue('');
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
		await expect(mine.getByTestId('board-post-title')).toHaveText(`Picnic ${tag}`);
		await expect(page.getByTestId('board-form')).toHaveCount(0);
	} finally {
		await studentContext.close();
	}
});

test('a parent posts with a JPEG; the student sees it and opens it full size', async ({
	browser
}) => {
	const parentContext = await browser.newContext();
	try {
		const page = await parentContext.newPage();
		await signIn(page, parent);
		await open(page, '/board');
		const form = page.getByTestId('board-form');
		await expect(form.getByLabel('Image (optional)')).toHaveAttribute(
			'accept',
			'image/jpeg,image/png,image/webp'
		);
		await form.getByLabel('Title').fill(`Flyer ${tag}`);
		const editor = form.locator('#content');
		await expect(editor).toHaveAttribute('contenteditable', 'true');
		await editor.click();
		await page.keyboard.type(flyerMessage);
		await form.locator('input[type="file"]').setInputFiles([jpeg(`Flyer ${tag}.jpg`, 4096)]);
		await form.getByRole('button', { name: 'Post' }).click();

		await expect(
			page.locator('[data-sonner-toast]').getByText('Your post is on the board.').first()
		).toBeVisible();
		const mine = posts(page).filter({ hasText: flyerMessage });
		await expect(mine.getByTestId('board-post-image')).toHaveAttribute('alt', `Flyer ${tag}`);
	} finally {
		await parentContext.close();
	}

	const studentContext = await browser.newContext();
	try {
		const page = await studentContext.newPage();
		await signIn(page, student);
		await open(page, '/board');
		const mine = posts(page).filter({ hasText: flyerMessage });
		const img = mine.getByTestId('board-post-image');
		await expect(img).toHaveAttribute('loading', 'lazy');
		// Through the endpoint, which signs a fresh link on each request.
		const src = await img.getAttribute('src');
		// SvelteKit renders it relative to the page ("./files/board/<id>").
		expect(src).toMatch(/^(\.)?\/files\/board\/[0-9a-f-]{36}$/);
		const link = mine.getByTestId('board-post-image-link');
		// The same endpoint (the image keeps its server-rendered relative src).
		const href = await link.getAttribute('href');
		expect(new URL(href!, page.url()).href).toBe(new URL(src!, page.url()).href);
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(link).toHaveAttribute(
			'aria-label',
			'Open the image full size (opens in a new tab)'
		);
		const redirect = await page.request.get(new URL(src!, page.url()).href, {
			maxRedirects: 0
		});
		expect(redirect.status()).toBe(303);
		const location = redirect.headers()['location'];
		expect(location).toContain(`/storage/v1/object/sign/${BUCKET}/`);
		expect(location).toMatch(/\.jpg\?token=/);
		const file = await page.request.get(location);
		expect(file.status()).toBe(200);
		expect(file.headers()['content-type']).toBe('image/jpeg');
		expect([...(await file.body()).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
	} finally {
		await studentContext.close();
	}
});

test('a long post is clamped with "…see more", expands in place and collapses again', async ({
	page
}) => {
	await signIn(page, parent);
	await open(page, '/board');
	const form = page.getByTestId('board-form');
	await form.getByLabel('Title').fill(`Trip ${tag}`);
	const editor = form.locator('#content');
	await expect(editor).toHaveAttribute('contenteditable', 'true');
	await editor.click();
	await page.keyboard.type(longMessage);
	await form.getByRole('button', { name: 'Post' }).click();
	await expect(
		page.locator('[data-sonner-toast]').getByText('Your post is on the board.').first()
	).toBeVisible();

	const card = posts(page).filter({ hasText: `Long news ${tag}` });
	const body = card.getByTestId('board-post-body');
	const more = card.getByTestId('board-post-more');
	await expect(body).toHaveClass(/line-clamp-3/);
	await expect(more).toHaveText('…see more');
	await expect(more).toHaveAttribute('aria-expanded', 'false');
	const bodyId = await body.getAttribute('id');
	await expect(more).toHaveAttribute('aria-controls', bodyId!);
	const clamped = (await body.boundingBox())!.height;

	await more.click();
	await expect(more).toHaveText('See less');
	await expect(more).toHaveAttribute('aria-expanded', 'true');
	await expect(body).not.toHaveClass(/line-clamp-3/);
	expect((await body.boundingBox())!.height).toBeGreaterThan(clamped);

	await more.click();
	await expect(more).toHaveText('…see more');
	await expect(body).toHaveClass(/line-clamp-3/);

	// A click on the preview text expands it too.
	await body.click();
	await expect(more).toHaveAttribute('aria-expanded', 'true');

	// Not remembered across loads.
	await open(page, '/board');
	await expect(
		posts(page)
			.filter({ hasText: `Long news ${tag}` })
			.getByTestId('board-post-more')
	).toHaveAttribute('aria-expanded', 'false');

	// A short post has no button.
	await expect(posts(page).filter({ hasText: message }).getByTestId('board-post-more')).toHaveCount(
		0
	);
});

test('a too-large image or a GIF is refused in the browser; PDF bytes named .jpg by the server; no post', async ({
	page
}) => {
	await signIn(page, parent);
	await open(page, '/board');
	const form = page.getByTestId('board-form');
	await form.getByLabel('Title').fill(`Refused ${tag}`);
	const editor = form.locator('#content');
	await expect(editor).toHaveAttribute('contenteditable', 'true');
	await editor.click();
	await page.keyboard.type(refusedMessage);
	const input = form.locator('input[type="file"][name="image"]');
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

	// 6 MB, or a GIF: refused here, nothing posted.
	const posted: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().includes('?/post')) posted.push(request.url());
	});
	await input.setInputFiles([jpeg('big.jpg', 6 * 1024 * 1024)]);
	await submit.click();
	await expect(error).toHaveText('The image is larger than 5.0 MB. Choose a smaller one.');
	await expect(input).toHaveAttribute('aria-invalid', 'true');
	// Choosing another file clears the message.
	await input.setInputFiles([
		{ name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') }
	]);
	await expect(error).toHaveCount(0);
	await submit.click();
	await expect(error).toHaveText('Choose a JPEG, PNG or WebP image.');
	expect(posted).toEqual([]);
	expect(await stored()).toBe(before);

	// PDF bytes renamed photo.jpg: checked by the server, no post.
	await input.setInputFiles([pdfBytes('photo.jpg', 'image/jpeg')]);
	await submit.click();
	await expect(error).toHaveText('Choose a JPEG, PNG or WebP image.');
	expect(posted).toHaveLength(1);
	expect(await stored()).toBe(before);
	await expect(posts(page).filter({ hasText: refusedMessage })).toHaveCount(0);
});

const confirmDelete = (page: Page) =>
	page.getByRole('alertdialog', { name: 'Are you sure?' }).getByRole('button', { name: 'Delete' });

test('the author edits a post with an image, then deletes it; its object goes too', async ({
	page
}) => {
	await signIn(page, parent);
	await open(page, '/board');
	const form = page.getByTestId('board-form');
	await form.getByLabel('Title').fill(`Jacket ${tag}`);
	const editor = form.locator('#content');
	await expect(editor).toHaveAttribute('contenteditable', 'true');
	await editor.click();
	await page.keyboard.type(editMessage);
	// A non-default language, which the edit must keep.
	await form.locator('#contentLanguage').selectOption('bo');
	await form.locator('input[type="file"]').setInputFiles([jpeg(`Map ${tag}.jpg`)]);
	await form.getByRole('button', { name: 'Post' }).click();
	await expect(
		page.locator('[data-sonner-toast]').getByText('Your post is on the board.').first()
	).toBeVisible();

	const mine = posts(page).filter({ hasText: editMessage });
	await expect(mine.getByTestId('board-post-image')).toHaveCount(1);
	const postId = await mine.locator('input[name="postId"]').first().inputValue();
	const folder = async () =>
		(check(await service.storage.from(BUCKET).list(postId), 'list objects') ?? []).length;
	expect(await folder()).toBe(1);

	// Posted over a minute ago, so the edit shows "Edited".
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
	check(
		await service
			.from('board_posts')
			.update({ created_at: fiveMinutesAgo, updated_at: fiveMinutesAgo })
			.eq('id', postId),
		'backdate post'
	);
	await open(page, '/board');
	// By its id from here on: the edit changes its text.
	const card = posts(page).filter({
		has: page.locator(`input[name="postId"][value="${postId}"]`)
	});
	await expect(card.getByTestId('board-post-edited')).toHaveCount(0);

	await card.getByRole('button', { name: `Edit the post by ${parentName}` }).click();
	const editForm = card.getByTestId('board-edit-form');
	const editEditor = editForm.locator(`#edit-content-${postId}`);
	await expect(editEditor).toHaveAttribute('contenteditable', 'true');
	await expect(editEditor).toHaveText(editMessage);
	await expect(editForm.locator(`#edit-language-${postId}`)).toHaveValue('bo');
	await expect(editForm.getByTestId('board-edit-title')).toHaveValue(`Jacket ${tag}`);
	// Cancel restores the view.
	await editForm.getByRole('button', { name: `Cancel editing the post by ${parentName}` }).click();
	await expect(editForm).toHaveCount(0);
	await expect(card).toContainText(editMessage);

	await card.getByRole('button', { name: `Edit the post by ${parentName}` }).click();
	await expect(editEditor).toHaveAttribute('contenteditable', 'true');
	await editEditor.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type(editedMessage);
	// Story 7: the title is edited too.
	await editForm.getByTestId('board-edit-title').fill(`Warm jacket ${tag}`);
	await editForm.getByRole('button', { name: `Save the post by ${parentName}` }).click();
	await expect(
		page.locator('[data-sonner-toast]').getByText('Your post was updated.').first()
	).toBeVisible();

	expect(
		check(
			await service.from('board_posts').select('content_language').eq('id', postId).single(),
			'read edited post'
		).content_language
	).toBe('bo');

	const edited = card;
	await expect(edited).toContainText(editedMessage);
	await expect(edited).not.toContainText(editMessage);
	await expect(edited.getByTestId('board-edit-form')).toHaveCount(0);
	await expect(edited.getByTestId('board-post-title')).toHaveText(`Warm jacket ${tag}`);
	await expect(edited.getByTestId('board-post-edited')).toHaveText('Edited');
	// The image is unchanged by the edit.
	await expect(edited.getByTestId('board-post-image')).toHaveCount(1);
	expect(await folder()).toBe(1);

	await edited.getByRole('button', { name: `Delete the post by ${parentName}` }).click();
	await expect(page.getByRole('alertdialog', { name: 'Are you sure?' })).toContainText(
		'Its image is deleted too.'
	);
	await confirmDelete(page).click();
	await expect(
		page.locator('[data-sonner-toast]').getByText('The post was deleted.').first()
	).toBeVisible();
	await expect(posts(page).filter({ hasText: editedMessage })).toHaveCount(0);

	expect(
		check(await service.from('board_posts').select('id').eq('id', postId), 'read post')
	).toEqual([]);
	expect(
		check(await service.from('board_post_files').select('id').eq('post_id', postId), 'read files')
	).toEqual([]);
	expect(await folder()).toBe(0);
});

test("a teacher deletes a parent's post, and has no Edit on it", async ({ page }) => {
	const inserted = check(
		await service
			.from('board_posts')
			.insert({
				author_id: parent.id,
				content: {
					type: 'doc',
					content: [{ type: 'paragraph', content: [{ type: 'text', text: moderatedMessage }] }]
				},
				content_language: 'en'
			})
			.select('id')
			.single(),
		'insert post'
	);

	await signIn(page, teacher);
	await open(page, '/board');
	const theirs = posts(page).filter({ hasText: moderatedMessage });
	await expect(theirs).toHaveCount(1);
	await expect(theirs.getByTestId('board-post-edit')).toHaveCount(0);
	await theirs.getByRole('button', { name: `Delete the post by ${parentName}` }).click();
	await confirmDelete(page).click();
	await expect(
		page.locator('[data-sonner-toast]').getByText('The post was deleted.').first()
	).toBeVisible();
	await expect(posts(page).filter({ hasText: moderatedMessage })).toHaveCount(0);
	expect(
		check(await service.from('board_posts').select('id').eq('id', inserted.id), 'read post')
	).toEqual([]);
});

test("a student sees no Edit or Delete on a parent's post", async ({ page }) => {
	await signIn(page, student);
	await open(page, '/board');
	const theirs = posts(page).filter({ hasText: message });
	await expect(theirs).toHaveCount(1);
	await expect(theirs.getByTestId('board-post-edit')).toHaveCount(0);
	await expect(theirs.getByTestId('board-post-delete')).toHaveCount(0);
	await expect(page.getByTestId('board-post-actions')).toHaveCount(0);
});

test('story 9: a student likes a post, switches to a dislike, then takes it back', async ({
	page
}) => {
	await signIn(page, student);
	await open(page, '/board');
	const theirs = posts(page).filter({ hasText: message });
	const postId = await theirs
		.getByTestId('board-post-reactions')
		.locator('input[name="postId"]')
		.inputValue();
	// Another reader's 👍, so the counts are everyone's, not only the student's.
	check(
		await service
			.from('board_post_reactions')
			.insert({ post_id: postId, user_id: teacher.id, value: 1 }),
		'teacher reaction'
	);
	await open(page, '/board');
	const up = theirs.getByTestId('board-react-up');
	const down = theirs.getByTestId('board-react-down');
	await expect(up).toHaveAccessibleName('Like this post');
	await expect(down).toHaveAccessibleName('Dislike this post');
	await expect(up).toHaveAccessibleDescription('1');
	await expect(down).toHaveAccessibleDescription('0');
	await expect(up).toHaveAttribute('aria-pressed', 'false');
	await expect(down).toHaveAttribute('aria-pressed', 'false');

	await up.click();
	await expect(up).toHaveAttribute('aria-pressed', 'true');
	await expect(up).toHaveAccessibleDescription('2');
	await expect(theirs.getByTestId('board-react-up-count')).toHaveText('2');
	// No toast for a reaction.
	await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

	await down.click();
	await expect(down).toHaveAttribute('aria-pressed', 'true');
	await expect(up).toHaveAttribute('aria-pressed', 'false');
	await expect(theirs.getByTestId('board-react-up-count')).toHaveText('1');
	await expect(theirs.getByTestId('board-react-down-count')).toHaveText('1');

	await down.click();
	await expect(down).toHaveAttribute('aria-pressed', 'false');
	await expect(theirs.getByTestId('board-react-down-count')).toHaveText('0');
	await expect(theirs.getByTestId('board-react-up-count')).toHaveText('1');

	// After a reload too.
	await open(page, '/board');
	await expect(theirs.getByTestId('board-react-up-count')).toHaveText('1');
	await expect(theirs.getByTestId('board-react-down-count')).toHaveText('0');
	expect(
		check(
			await service.from('board_post_reactions').select('user_id').eq('post_id', postId),
			'read reactions'
		)
	).toEqual([{ user_id: teacher.id }]);
});
