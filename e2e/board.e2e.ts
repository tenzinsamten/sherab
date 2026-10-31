import { expect, test, type Page } from '@playwright/test';
import { fixtureTeam, service, signIn, type TestUser } from './fixtures';

/**
 * spec-parent-message-board story 3 (CAP-1, CAP-2 text only): a granted
 * parent posts on /board; a student signs in, sees the post with the
 * parent's name, and has no post form.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const parentName = `BRD Parent ${tag}`;
const message = `Picnic on Saturday ${tag}`;

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
