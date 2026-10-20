import { expect, test, type Page } from '@playwright/test';
import { fixtureTeam, mainNav, openAccountMenu, service, signIn, type TestUser } from './fixtures';

/**
 * #100: the username and PIN are made at registration. A family registers a
 * student, reads both off the confirmation screen and signs in at once. Until
 * the teacher approves, the student sees only the pending page, by GET and
 * POST; after approval the same PIN opens the dashboard. A rejected student
 * signs in and sees only the not-accepted page.
 * Its own fixture: a class with a teacher, a team and an approved parent.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const className = `E2E100 ${tag} Class`;
const classCode = `H${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
const approvedName = `E2E100 Pema ${tag}`;
const rejectedName = `E2E100 Dawa ${tag}`;

let classId = '';
let teacher: TestUser;
let parent: TestUser;
const userIds: string[] = [];
const team = fixtureTeam(tag);

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createStaff(role: 'teacher' | 'parent'): Promise<TestUser> {
	const email = `e2e-100-${role}-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${role}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

async function cleanup() {
	const problems: string[] = [];
	// The registered students first: profiles.parent_id is ON DELETE
	// RESTRICT, and a class or team with students cannot be deleted.
	if (classId) {
		const { data: students, error } = await service
			.from('profiles')
			.select('id')
			.eq('role', 'student')
			.eq('class_id', classId);
		if (error) problems.push(`read students: ${error.message}`);
		for (const { id } of students ?? []) {
			const { error: deleteError } = await service.auth.admin.deleteUser(id);
			if (deleteError) problems.push(`delete student: ${deleteError.message}`);
		}
	}
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	for (const id of userIds.splice(0)) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user: ${error.message}`);
	}
	if (classId) {
		const { error } = await service.from('classes').delete().eq('id', classId);
		if (error) problems.push(`delete class: ${error.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
}

test.beforeAll(async () => {
	try {
		classId = check(
			await service
				.from('classes')
				.insert({ name: className, code: classCode })
				.select('id')
				.single(),
			'create class'
		).id;
		teacher = await createStaff('teacher');
		check(
			await service.from('class_teachers').insert({ class_id: classId, teacher_id: teacher.id }),
			'assign teacher'
		);
		parent = await createStaff('parent');
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);
		// #99: approval needs a team.
		await team.id();
	} catch (error) {
		await cleanup().catch(() => undefined);
		throw error;
	}
});

test.afterAll(async () => {
	await cleanup();
});

/** A join page (mobile-first story 6b): its new-UI root is hydrated. */
async function joinReady(page: Page) {
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

/** Registers `name` through /join and returns what the confirmation screen shows. */
async function register(page: Page, name: string) {
	await page.goto('/join');
	await joinReady(page);
	await page.getByLabel('What is your class code?').fill(classCode);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.getByText(`${className} · ${classCode}`)).toBeVisible();
	await page.getByLabel('Full name').fill(name);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByLabel("Guardian's email").fill(parent.email);
	await page.getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Submit' }).click();

	await expect(page).toHaveURL(/\/join\/pending$/);
	const values = page.locator('[data-testid="join-credentials"] .credential');
	await expect(values).toHaveCount(2);
	const username = (await values.nth(0).textContent())?.trim() ?? '';
	const pin = (await values.nth(1).textContent())?.trim() ?? '';
	return { username, pin };
}

async function signInAsStudent(page: Page, credentials: { username: string; pin: string }) {
	await signIn(page, { id: '', email: credentials.username, password: credentials.pin });
}

async function openRequests(page: Page) {
	await page.goto('/requests');
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

/** A request row (a card below 80em, a table row from 80em). */
const requestRow = (page: Page, text: string) =>
	page.getByTestId('request-row').filter({ hasText: text });

const status = (page: Page) => page.locator('[data-testid="student-status"]');
const menuItems = (page: Page) => mainNav(page).getByRole('link');

/** The avatar menu of an unapproved student: sign-out, no "My Account". */
async function expectNoAccountEntry(page: Page) {
	const menu = await openAccountMenu(page);
	await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(1);
	await expect(menu.getByRole('menuitem', { name: 'My Account' })).toHaveCount(0);
	await page.keyboard.press('Escape');
}

let approved: { username: string; pin: string };

test('register: the screen shows the username and PIN once, and they sign the student in to the pending page only', async ({
	page,
	baseURL
}) => {
	approved = await register(page, approvedName);
	expect(approved.username).toMatch(/^e2e100pema[0-9a-f]{8}\d*$/);
	expect(approved.pin).toMatch(/^[0-9]{6}$/);
	await expect(page.getByText(approvedName)).toBeVisible();
	await expect(page.getByText(className)).toBeVisible();
	await expect(
		page.getByText('Your username and PIN are shown here only once.', { exact: false })
	).toBeVisible();

	// The account is pending and its address is the username; no PIN is stored.
	const profile = check(
		await service
			.from('profiles')
			.select('status, email')
			.eq('registration_name', approvedName)
			.single(),
		'read the registered student'
	);
	expect(profile).toEqual({
		status: 'pending',
		email: `${approved.username}@students.internal.invalid`
	});

	// The link on the screen leads to the login page.
	await page.getByRole('link', { name: 'Go to sign in' }).click();
	await expect(page).toHaveURL(/\/login$/);

	await signInAsStudent(page, approved);
	await expect(page).toHaveURL(/\/student\/pending$/);
	await expect(status(page)).toHaveAttribute('data-state', 'pending');
	await expect(status(page)).toContainText('Waiting for approval');
	await expect(mainNav(page)).toHaveCount(0);
	await expect(menuItems(page)).toHaveCount(0);
	await expectNoAccountEntry(page);

	// Any other page ends on the pending page.
	for (const path of [
		'/',
		'/student',
		'/student/homework',
		'/leaderboard',
		'/calendar',
		'/account'
	]) {
		await page.goto(path);
		await expect(page, path).toHaveURL(/\/student\/pending$/);
	}

	// A form post is stopped before its action runs: a plain form gets the
	// redirect, an enhanced one (which asks for JSON) the same as data.
	const post = await page.request.post('/student?/dismissJoin', {
		form: { requestId: crypto.randomUUID() },
		headers: { origin: baseURL ?? '', accept: 'text/html' },
		maxRedirects: 0
	});
	expect(post.status()).toBe(303);
	expect(post.headers().location).toBe('/student/pending');
	const enhanced = await page.request.post('/account?/updateName', {
		form: { displayName: 'Not allowed' },
		headers: { origin: baseURL ?? '', accept: 'application/json' },
		maxRedirects: 0
	});
	expect(await enhanced.json()).toMatchObject({
		type: 'redirect',
		status: 303,
		location: '/student/pending'
	});
});

test('confirmation screen without its cookie: generic text, no username or PIN', async ({
	page
}) => {
	await page.goto('/join/pending');
	await joinReady(page);
	await expect(page.getByRole('heading', { name: 'Pending' })).toBeVisible();
	await expect(page.locator('[data-testid="join-credentials"]')).toHaveCount(0);
	await expect(page.locator('.credential')).toHaveCount(0);
});

test('approval: the approver sees the username and no PIN; the same PIN opens the dashboard', async ({
	page,
	browser
}) => {
	await signInAsStudent(page, approved);
	await expect(page).toHaveURL(/\/student\/pending$/);

	const teacherContext = await browser.newContext();
	const teacherPage = await teacherContext.newPage();
	try {
		await signIn(teacherPage, teacher);
		await openRequests(teacherPage);
		await requestRow(teacherPage, approvedName).getByRole('button', { name: 'Approve' }).click();
		const bar = teacherPage.getByTestId('requests-outcome');
		await expect(bar).toContainText('The family already has the PIN from registration.');
		await expect(bar.locator('.credential')).toHaveCount(1);
		await expect(bar.locator('.credential')).toHaveText(approved.username);
		await expect(bar).not.toContainText(approved.pin);
	} finally {
		await teacherContext.close();
	}

	// The signed-in student's next navigation reaches the dashboard, menu
	// and account entry included, without a page reload: the header logo is a
	// client-side link.
	await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
	await page.getByTestId('header-home').click();
	await expect(page).toHaveURL(/\/student$/);
	await expect(menuItems(page).filter({ hasText: 'My Homework' })).toHaveCount(1);
	await expect(menuItems(page)).toHaveCount(5);
	const accountMenu = await openAccountMenu(page);
	await expect(accountMenu.getByRole('menuitem', { name: 'My Account' })).toHaveCount(1);
	await page.keyboard.press('Escape');
	expect(
		await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)
	).toBe(true);

	// The pending page is no place for an approved student.
	await page.goto('/student/pending');
	await expect(page).toHaveURL(/\/student$/);

	// A fresh sign-in with the PIN from registration.
	await page.context().clearCookies();
	await signInAsStudent(page, approved);
	await expect(page).toHaveURL(/\/student$/);
});

test('a rejected student signs in and sees only the not-accepted page, with sign-out', async ({
	page,
	browser
}) => {
	const rejected = await register(page, rejectedName);

	const teacherContext = await browser.newContext();
	const teacherPage = await teacherContext.newPage();
	try {
		await signIn(teacherPage, teacher);
		await openRequests(teacherPage);
		await requestRow(teacherPage, rejectedName).getByRole('button', { name: 'Reject' }).click();
		await teacherPage
			.getByRole('alertdialog', { name: 'Are you sure?' })
			.getByRole('button', { name: 'Reject' })
			.click();
		await expect
			.poll(async () => {
				const { data } = await service
					.from('profiles')
					.select('status')
					.eq('registration_name', rejectedName)
					.maybeSingle();
				return data?.status;
			})
			.toBe('rejected');
	} finally {
		await teacherContext.close();
	}

	await signInAsStudent(page, rejected);
	await expect(page).toHaveURL(/\/student\/pending$/);
	await expect(status(page)).toHaveAttribute('data-state', 'rejected');
	await expect(status(page)).toContainText('Your registration was not accepted.');
	await expect(page.getByRole('link', { name: 'Check again' })).toHaveCount(0);
	await expect(mainNav(page)).toHaveCount(0);
	await expect(menuItems(page)).toHaveCount(0);
	await expectNoAccountEntry(page);

	for (const path of ['/student', '/leaderboard', '/account']) {
		await page.goto(path);
		await expect(page, path).toHaveURL(/\/student\/pending$/);
	}

	await status(page).getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login$/);
	await page.goto('/student/pending');
	await expect(page).toHaveURL(/\/login$/);
});
