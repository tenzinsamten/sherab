import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import type { Database } from '../src/lib/supabase/database.types';
import { env, fixtureTeam, linkParent, service, type TestUser } from './fixtures';

/**
 * spec-second-parent story 5 (CAP-5, AD-11, AD-16): parent A invites B's
 * email for a child. B registering the same name at /join with B's email is
 * refused with the already-invited message and nothing is created; a
 * different name registers as today.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const childName = `JAI Tenzin ${tag}`;
const otherName = `JAI Pema ${tag}`;
const className = `JAI Class ${tag}`;
const classCode = `K${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
const ALREADY_INVITED =
	"This parent email was already invited for a child with this name, or is or was linked to one. Please don't register the child again. If there is an invite, sign in as the parent and accept it under “Invites” on the start page.";

let parentA: TestUser;
let parentB: TestUser;
let child: TestUser;
let classId = '';
const team = fixtureTeam(tag);
const parentIds: string[] = [];

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'student' | 'parent', key: string): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-jai-${key}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	if (role === 'parent') parentIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

/** Students called `name`, whoever registered them. */
async function studentsNamed(name: string) {
	return check(
		await service
			.from('profiles')
			.select('id')
			.eq('role', 'student')
			.ilike('registration_name', name),
		`read students named ${name}`
	);
}

test.beforeAll(async () => {
	parentA = await createUser('parent', 'a');
	parentB = await createUser('parent', 'b');
	for (const p of [parentA, parentB]) {
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', p.id),
			'approve parent'
		);
	}
	classId = check(
		await service
			.from('classes')
			.insert({ name: className, code: classCode })
			.select('id')
			.single(),
		'create class'
	).id;
	child = await createUser('student', 'kid');
	check(
		await service
			.from('profiles')
			.update({
				status: 'approved',
				registration_name: childName,
				display_name: childName,
				team_id: await team.id()
			})
			.eq('id', child.id),
		'set up child'
	);
	await linkParent(child.id, parentA.id);

	// A invites B's email, through the invite function as A.
	const clientA = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	check(
		await clientA.auth.signInWithPassword({ email: parentA.email, password: parentA.password }),
		'sign in A'
	);
	check(
		await clientA.rpc('create_parent_invite', { p_student_id: child.id, p_email: parentB.email }),
		'invite B'
	);
	await clientA.auth.signOut();
});

test.afterAll(async () => {
	const problems: string[] = [];
	// Students first: a parent with links cannot be deleted.
	const { data: students } = await service
		.from('profiles')
		.select('id')
		.eq('role', 'student')
		.in('registration_name', [childName, otherName]);
	for (const { id } of students ?? []) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete student ${id}: ${error.message}`);
	}
	for (const id of parentIds) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete parent ${id}: ${error.message}`);
	}
	if (classId) {
		const { error } = await service.from('classes').delete().eq('id', classId);
		if (error) problems.push(`delete class: ${error.message}`);
	}
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	if (problems.length) throw new Error(problems.join('; '));
});

async function register(page: Page, name: string, guardianEmail: string) {
	await page.goto('/join');
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');

	await page.getByLabel('What is your class code?').fill(classCode);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.getByText(`${className} · ${classCode}`)).toBeVisible();

	await page.getByLabel('Full name').fill(name);
	await page.getByRole('button', { name: 'Continue' }).click();

	await page.getByLabel("Guardian's email").fill(guardianEmail);
	await page.getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Submit' }).click();
}

test("/join with the invited child's name and B's email points B to the invite", async ({
	page
}) => {
	await register(page, `  ${childName.toLowerCase()} `, parentB.email.toUpperCase());

	await expect(page.locator('[data-sonner-toast]').getByText(ALREADY_INVITED)).toBeVisible();
	await expect(page).toHaveURL(/\/join$/);
	expect(await studentsNamed(childName)).toEqual([{ id: child.id }]);
});

test("/join with a different name and B's email registers as today", async ({ page }) => {
	await register(page, otherName, parentB.email);

	await expect(page).toHaveURL(/\/join\/pending$/);
	expect(await studentsNamed(otherName)).toHaveLength(1);
});
