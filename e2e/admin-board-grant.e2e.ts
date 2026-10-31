import { expect, test, type Page } from '@playwright/test';
import { service, signIn, type TestUser } from './fixtures';

/**
 * spec-parent-message-board story 2 (CAP-4): on /admin/parents the admin
 * allows an approved parent to post on the board, sees the toast naming them
 * and the "Can post" badge, then stops it again.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const parentName = `ABG Parent ${tag}`;

let admin: TestUser;
let parent: TestUser;
const userIds: string[] = [];

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'parent' | 'admin', key: string): Promise<TestUser> {
	const email = `e2e-abg-${key}-${tag}@example.test`;
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

async function setFlag(on: boolean) {
	check(
		await service.from('parents').update({ can_post_board: on }).eq('id', parent.id),
		'set can_post_board'
	);
}

test.beforeAll(async () => {
	admin = await createUser('admin', 'admin');
	parent = await createUser('parent', 'p');
	check(
		await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
		'approve parent'
	);
	check(
		await service.from('profiles').update({ display_name: parentName }).eq('id', parent.id),
		'name parent'
	);
	await setFlag(false);
});

test.afterAll(async () => {
	const problems: string[] = [];
	if (parent) {
		const { error } = await service
			.from('parents')
			.update({ can_post_board: false })
			.eq('id', parent.id);
		if (error) problems.push(`reset can_post_board: ${error.message}`);
	}
	for (const id of userIds) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
});

async function open(page: Page, path: string) {
	await page.goto(path);
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

test('the admin allows, then stops, board posting for an approved parent', async ({ browser }) => {
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await signIn(page, admin);
		await open(page, '/admin/parents');

		const row = page
			.getByTestId('parent-row')
			.filter({ has: page.getByRole('cell', { name: parentName, exact: true }) });
		const board = row.getByTestId('board-posting');
		await expect(board).toContainText("Can't post on the board");

		await row.getByRole('button', { name: `Allow board posts: ${parentName}` }).click();
		await expect(page.getByText(`${parentName} can now post on the board.`)).toBeVisible();
		await expect(board).toContainText('Can post on the board');
		await expect(
			row.getByRole('button', { name: `Stop board posts: ${parentName}` })
		).toBeVisible();
		const on = check(
			await service.from('parents').select('can_post_board').eq('id', parent.id).single(),
			'read flag'
		);
		expect(on.can_post_board).toBe(true);

		await row.getByRole('button', { name: `Stop board posts: ${parentName}` }).click();
		await expect(page.getByText(`${parentName} can no longer post on the board.`)).toBeVisible();
		await expect(board).toContainText("Can't post on the board");
		await expect(
			row.getByRole('button', { name: `Allow board posts: ${parentName}` })
		).toBeVisible();
		const off = check(
			await service.from('parents').select('can_post_board').eq('id', parent.id).single(),
			'read flag'
		);
		expect(off.can_post_board).toBe(false);
	} finally {
		await context.close();
	}
});
