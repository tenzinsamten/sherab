import { expect, test, type Page } from '@playwright/test';
import { service, signIn, type TestUser } from './fixtures';

/**
 * #97: clicking a team opens a page that lists its students by name. The
 * admin, teachers and approved students open every team; an approved parent
 * only the team of their own child. Fixtures go through the service-role
 * client and are removed again in afterAll.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const userIds: string[] = [];
const studentIds: string[] = [];
const teamIds: string[] = [];
let classId = '';

const TEAM_A = `E97 Lions ${tag}`;
const TEAM_B = `E97 Yaks ${tag}`;
const TEAM_EMPTY = `E97 Empty ${tag}`;
// Registered out of order; the page shows them sorted by name.
const LONG_NAME = `E97 ${tag} Zzz${'Longname'.repeat(8)}`;
const NAMES_A = [`E97 ${tag} Anna`, `E97 ${tag} Bkra shis`, `E97 ${tag} Chodon`, LONG_NAME];
const NAME_B = `E97 ${tag} Dawa`;
const PENDING_NAME = `E97 ${tag} Pending`;

let admin: TestUser;
let teacher: TestUser;
let parent: TestUser;
let studentA: TestUser;
let pendingStudent: TestUser;
let childId = '';
let teamA = '';
let teamB = '';
let teamEmpty = '';

async function createUser(role: 'admin' | 'teacher' | 'parent', key: string): Promise<TestUser> {
	const email = `e2e-97-${key}-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role },
		user_metadata: { display_name: `E97 ${key} ${tag}` }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

async function createTeam(name: string): Promise<string> {
	const { data, error } = await service.from('teams').insert({ name }).select('id').single();
	if (error || !data) throw new Error(`create team ${name}: ${error?.message}`);
	teamIds.push(data.id);
	return data.id;
}

/** A student registered the way the join wizard does, as a child of the parent with `guardianEmail`. */
async function createStudent(
	name: string,
	teamId: string,
	guardianEmail: string,
	status: 'approved' | 'pending' = 'approved'
): Promise<TestUser> {
	const email = `pending-${crypto.randomUUID()}@students.internal.invalid`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		user_metadata: {
			role: 'student',
			class_id: classId,
			registration_name: name,
			guardian_consent_given_at: new Date().toISOString(),
			guardian_email: guardianEmail
		}
	});
	if (error || !data.user) throw new Error(`create student ${name}: ${error?.message}`);
	studentIds.push(data.user.id);
	const { error: updateError } = await service
		.from('profiles')
		.update({ status, team_id: teamId })
		.eq('id', data.user.id);
	if (updateError) throw new Error(`set up student ${name}: ${updateError.message}`);
	return { id: data.user.id, email, password };
}

test.beforeAll(async () => {
	admin = await createUser('admin', 'admin');
	teacher = await createUser('teacher', 'teacher');
	parent = await createUser('parent', 'parent');
	const { error: approveError } = await service
		.from('parents')
		.update({ status: 'approved' })
		.eq('id', parent.id);
	if (approveError) throw new Error(`approve parent: ${approveError.message}`);

	const { data: cls, error: classError } = await service
		.from('classes')
		.insert({
			name: `E97 class ${tag}`,
			code: `E${crypto.randomUUID().slice(0, 5).toUpperCase()}`
		})
		.select('id')
		.single();
	if (classError || !cls) throw new Error(`create class: ${classError?.message}`);
	classId = cls.id;

	teamA = await createTeam(TEAM_A);
	teamB = await createTeam(TEAM_B);
	teamEmpty = await createTeam(TEAM_EMPTY);

	// The parent's only approved child is in team B.
	childId = (await createStudent(NAME_B, teamB, parent.email)).id;

	// Team A's students belong to another parent, so `parent` has no child there.
	const otherParent = await createUser('parent', 'parent2');
	const { error: approve2 } = await service
		.from('parents')
		.update({ status: 'approved' })
		.eq('id', otherParent.id);
	if (approve2) throw new Error(`approve parent 2: ${approve2.message}`);
	await createStudent(NAMES_A[2], teamA, otherParent.email);
	studentA = await createStudent(NAMES_A[0], teamA, otherParent.email);
	await createStudent(LONG_NAME, teamA, otherParent.email);
	await createStudent(NAMES_A[1], teamA, otherParent.email);
	pendingStudent = await createStudent(PENDING_NAME, teamA, otherParent.email, 'pending');
});

test.afterAll(async () => {
	const problems: string[] = [];
	// Students first: a parent with linked children, a class with students and
	// a team with students cannot be deleted.
	for (const id of [...studentIds, ...userIds]) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	if (classId) {
		const { error } = await service.from('classes').delete().eq('id', classId);
		if (error) problems.push(`delete class: ${error.message}`);
	}
	if (teamIds.length) {
		const { error } = await service.from('teams').delete().in('id', teamIds);
		if (error) problems.push(`delete teams: ${error.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
});

const teamLink = (page: Page, team: string) =>
	page.getByRole('link', { name: `Students of team ${team}` });
const studentItems = (page: Page) => page.getByTestId('team-students').getByRole('listitem');
const board = (page: Page) => page.getByTestId('leaderboard');

/** The page's new-UI root is hydrated (mobile-first stories 3-5). */
async function ready(page: Page) {
	await page.waitForSelector('main > [data-ui="new"][data-hydrated]');
	await page.waitForLoadState('networkidle');
}

async function expectTeamA(page: Page) {
	await expect(page).toHaveURL(new RegExp(`/teams/${teamA}$`));
	await expect(page.getByRole('heading', { level: 1, name: TEAM_A })).toBeVisible();
	await expect(studentItems(page)).toHaveText(NAMES_A);
	await expect(page.getByText(PENDING_NAME)).toHaveCount(0);
}

async function expectNotFound(page: Page, teamId: string) {
	const response = await page.goto(`/teams/${teamId}`);
	expect(response?.status()).toBe(404);
	// The error page (#115): its own heading, not the server's message.
	await expect(
		page.getByTestId('error-page').getByRole('heading', { level: 1, name: 'Page not found' })
	).toBeVisible();
	for (const name of [...NAMES_A, NAME_B]) {
		await expect(page.getByText(name)).toHaveCount(0);
	}
}

test('an approved student opens any team from the leaderboard and sees names only', async ({
	page
}) => {
	await signIn(page, studentA);
	await page.goto('/leaderboard');
	await ready(page);

	// The leaderboard itself still shows team totals only.
	await expect(board(page)).toContainText(TEAM_A);
	for (const name of [...NAMES_A, NAME_B]) await expect(board(page)).not.toContainText(name);

	// Another team than their own.
	await teamLink(page, TEAM_B).click();
	await expect(page).toHaveURL(new RegExp(`/teams/${teamB}$`));
	await expect(page.getByRole('heading', { level: 1, name: TEAM_B })).toBeVisible();
	await expect(studentItems(page)).toHaveText([NAME_B]);

	// Their own team: students sorted by name, the pending one not listed.
	await page.goto('/leaderboard');
	await ready(page);
	await teamLink(page, TEAM_A).click();
	await expectTeamA(page);

	// Nothing else about a student: each row is the name and nothing more.
	const card = page.getByRole('region', { name: 'Students (4)' });
	await expect(card.getByRole('heading', { level: 2 })).toHaveText('Students (4)');
	await expect(card.locator('a, button')).toHaveCount(0);

	// The breadcrumb leads back to the leaderboard.
	const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
	await expect(trail.locator('[aria-current="page"]')).toHaveText(TEAM_A);
	await trail.getByRole('link', { name: 'Team Leaderboard' }).click();
	await expect(page).toHaveURL(/\/leaderboard$/);

	// A team without students.
	await page.goto(`/teams/${teamEmpty}`);
	await expect(page.getByRole('heading', { level: 1, name: TEAM_EMPTY })).toBeVisible();
	await expect(page.getByText('No students in this team yet.')).toBeVisible();
	await expect(studentItems(page)).toHaveCount(0);

	// An unknown team.
	await expectNotFound(page, crypto.randomUUID());
});

test("the student's team tile opens their team", async ({ page }) => {
	await signIn(page, studentA);
	await page.goto('/student');
	await ready(page);
	await page
		.getByTestId('dashboard-tiles')
		.getByRole('link', { name: /My team/ })
		.click();
	await expectTeamA(page);
});

test('at 390 px the names wrap and nothing scrolls sideways', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 800 });
	await signIn(page, studentA);
	await page.goto(`/teams/${teamA}`);
	await ready(page);
	await expect(studentItems(page)).toHaveText(NAMES_A);

	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	// The long name takes more than one line and stays inside the page.
	const long = studentItems(page).last();
	const short = studentItems(page).first();
	const longBox = await long.boundingBox();
	const shortBox = await short.boundingBox();
	expect(longBox).not.toBeNull();
	expect(shortBox).not.toBeNull();
	if (!longBox || !shortBox) return;
	expect(longBox.height).toBeGreaterThan(shortBox.height * 1.5);
	expect(longBox.x + longBox.width).toBeLessThanOrEqual(390);
});

test('a teacher opens a team from the leaderboard', async ({ page }) => {
	await signIn(page, teacher);
	await page.goto('/leaderboard');
	await ready(page);
	await teamLink(page, TEAM_A).click();
	await expectTeamA(page);
});

test('the admin opens a team from the Teams list', async ({ page }) => {
	await signIn(page, admin);
	await page.goto('/admin/teams');
	await ready(page);
	// Here the link's name is the team name; what it opens is its description.
	const link = page.getByRole('link', { name: TEAM_A, exact: true });
	await expect(link).toHaveAttribute('title', `Students of team ${TEAM_A}`);
	await link.click();
	await expectTeamA(page);
});

test("a parent opens their child's team from the child's page, and no other team", async ({
	page
}) => {
	await signIn(page, parent);
	await page.goto(`/parent/children/${childId}`);
	await ready(page);
	await teamLink(page, TEAM_B).click();
	await expect(page).toHaveURL(new RegExp(`/teams/${teamB}$`));
	await expect(page.getByRole('heading', { level: 1, name: TEAM_B })).toBeVisible();
	await expect(studentItems(page)).toHaveText([NAME_B]);

	// On the leaderboard only the child's team is a link.
	await page.goto('/leaderboard');
	await ready(page);
	await expect(board(page)).toContainText(TEAM_A);
	await expect(teamLink(page, TEAM_B)).toHaveCount(1);
	await expect(teamLink(page, TEAM_A)).toHaveCount(0);
	await expect(teamLink(page, TEAM_EMPTY)).toHaveCount(0);
	await expect(
		board(page).getByTestId('leaderboard-row').filter({ hasText: TEAM_A }).getByRole('link')
	).toHaveCount(0);

	// Another team's address: not found, no names.
	await expectNotFound(page, teamA);
	await expectNotFound(page, teamEmpty);
});

test('a pending student is sent to the pending page (#100); signed out, the sign-in page', async ({
	page,
	browser
}) => {
	const context = await browser.newContext();
	const anonymous = await context.newPage();
	try {
		await anonymous.goto(`/teams/${teamA}`);
		await expect(anonymous).toHaveURL(/\/login/);
		for (const name of NAMES_A) await expect(anonymous.getByText(name)).toHaveCount(0);
	} finally {
		await context.close();
	}

	// A pending student can sign in, but may not open any team: since #100
	// every page but the pending page sends them there. (The database's own
	// refusal of team_students() for a pending student is in rls.spec.ts.)
	await page.goto('/login');
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
	await page.locator('#email').fill(pendingStudent.email);
	await page.locator('#password').fill(pendingStudent.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/student\/pending$/);

	for (const teamId of [teamA, teamEmpty]) {
		await page.goto(`/teams/${teamId}`);
		await expect(page).toHaveURL(/\/student\/pending$/);
		for (const name of [...NAMES_A, NAME_B]) {
			await expect(page.getByText(name)).toHaveCount(0);
		}
	}
});
