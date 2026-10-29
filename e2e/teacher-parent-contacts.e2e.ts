import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import type { Database } from '../src/lib/supabase/database.types';
import {
	berlinToday,
	env,
	fixtureTeam,
	linkParent,
	service,
	signIn,
	type TestUser
} from './fixtures';

/**
 * spec-second-parent CAP-6 (AD-12, AD-13): the class teacher sees both of a
 * child's parents (name and email, as mailto links) in the child's panel on
 * the class page, and B's On leave for a coming session reads "Set by {B}"
 * in the upcoming-leave card. Its own class, child and parents; a class day
 * within the card's 12 weeks that no one else uses, removed afterwards.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const childName = `TPC Kid ${tag}`;
const nameA = `TPC Parent A ${tag}`;
const nameB = `TPC Parent B ${tag}`;
/** A child with no active parent link. */
const unlinkedName = `TPC Unlinked ${tag}`;
/** A child whose only parent (C) has no display name. */
const namelessName = `TPC Nameless ${tag}`;

let teacher: TestUser;
let parentA: TestUser;
let parentB: TestUser;
let parentC: TestUser;
let child: TestUser;
let unlinked: TestUser;
let nameless: TestUser;
let classId = '';
/** The class_days row this file created (only that row is removed afterwards). */
let createdDayId: string | undefined;
const team = fixtureTeam(tag);
const parentIds: string[] = [];
const otherIds: string[] = [];

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'teacher' | 'student' | 'parent', key: string): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-tpc-${key}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	(role === 'parent' ? parentIds : otherIds).push(data.user.id);
	return { id: data.user.id, email, password };
}

const addDays = (isoDate: string, days: number) => {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
};

/** A day 2 to 10 weeks ahead with no class day yet (class days are school-wide). */
async function freeUpcomingDay(): Promise<string> {
	const today = berlinToday();
	for (let attempt = 0; attempt < 30; attempt++) {
		const day = addDays(today, 14 + Math.floor(Math.random() * 56));
		const existing = check(
			await service.from('class_days').select('id').eq('day', day),
			'read class day'
		);
		if (!existing?.length) return day;
	}
	throw new Error('no free class day in the next 10 weeks');
}

/** An approved student of the class, enrolled. */
async function addChild(key: string, name: string): Promise<TestUser> {
	const user = await createUser('student', key);
	check(
		await service
			.from('profiles')
			.update({
				class_id: classId,
				status: 'approved',
				registration_name: name,
				display_name: name,
				team_id: await team.id()
			})
			.eq('id', user.id),
		`set up ${key}`
	);
	const enrolled = check(
		await service
			.from('class_enrollments')
			.select('class_id')
			.eq('student_id', user.id)
			.eq('class_id', classId),
		'read enrollment'
	);
	if (!enrolled?.length) {
		check(
			await service.from('class_enrollments').insert({ student_id: user.id, class_id: classId }),
			`enroll ${key}`
		);
	}
	return user;
}

test.beforeAll(async () => {
	test.setTimeout(60_000);
	teacher = await createUser('teacher', 't');
	parentA = await createUser('parent', 'a');
	parentB = await createUser('parent', 'b');
	parentC = await createUser('parent', 'c');
	for (const [p, displayName] of [
		[parentA, nameA],
		[parentB, nameB],
		[parentC, null]
	] as const) {
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', p.id),
			'approve parent'
		);
		check(
			await service.from('profiles').update({ display_name: displayName }).eq('id', p.id),
			'name parent'
		);
	}
	classId = check(
		await service
			.from('classes')
			.insert({
				name: `TPC Class ${tag}`,
				code: `P${crypto.randomUUID().slice(0, 5).toUpperCase()}`
			})
			.select('id')
			.single(),
		'create class'
	).id;
	check(
		await service.from('class_teachers').insert({ class_id: classId, teacher_id: teacher.id }),
		'assign teacher'
	);
	child = await addChild('kid', childName);
	unlinked = await addChild('unlinked', unlinkedName);
	nameless = await addChild('nameless', namelessName);
	await linkParent(child.id, parentA.id);
	await linkParent(child.id, parentB.id);
	await linkParent(nameless.id, parentC.id);

	// A coming session of the class, and B's On leave for it.
	const day = await freeUpcomingDay();
	const sessionId = check(
		await service.rpc('attendance_backfill_session', { p_class_id: classId, p_day: day }),
		'create session'
	);
	// freeUpcomingDay checked the day had no row, so this one is ours.
	createdDayId = check(
		await service.from('class_days').select('id').eq('day', day).single(),
		'read created class day'
	).id;
	const clientB = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	check(
		await clientB.auth.signInWithPassword({ email: parentB.email, password: parentB.password }),
		'sign in B'
	);
	check(
		await clientB
			.from('session_leave_history')
			.insert({ class_session_id: sessionId, student_id: child.id, answer: 'on_leave' }),
		'B marks leave'
	);
	await clientB.auth.signOut();
});

test.afterAll(async () => {
	const problems: string[] = [];
	// The child before the parents: a parent with links cannot be deleted.
	for (const id of [...otherIds, ...parentIds]) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	if (classId) {
		const { error } = await service.from('classes').delete().eq('id', classId);
		if (error) problems.push(`delete class: ${error.message}`);
	}
	if (createdDayId) {
		const { error } = await service.from('class_days').delete().eq('id', createdDayId);
		if (error) problems.push(`delete class day: ${error.message}`);
	}
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	if (problems.length) throw new Error(problems.join('; '));
});

test("the teacher sees both parents' emails in the child's panel and B's leave set by B", async ({
	page
}) => {
	await signIn(page, teacher);
	await page.goto(`/teacher/classes/${classId}`);
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');

	// The upcoming-leave card names the parent who set the answer.
	const entry = page.getByTestId('upcoming-leave-entry').filter({ hasText: childName });
	await expect(entry).toHaveCount(1);
	await expect(entry.getByTestId('leave-set-by')).toHaveText(`Set by ${nameB}`);

	// The child's panel lists both parents, each email a mailto link.
	await page.locator(`.student-toggle[data-student-id="${child.id}"]`).click();
	const panel = page.locator(`#skills-panel-${child.id}`);
	await expect(panel).toBeVisible();
	const contacts = panel.getByTestId('parent-contact');
	await expect(contacts).toHaveCount(2);
	await expect(contacts.nth(0)).toContainText(nameA);
	await expect(contacts.nth(1)).toContainText(nameB);
	for (const p of [parentA, parentB]) {
		await expect(panel.getByRole('link', { name: p.email })).toHaveAttribute(
			'href',
			`mailto:${p.email}`
		);
	}
	await expect(panel.getByText('No parent contact')).toHaveCount(0);
});

test('a child with no active parent says "No parent contact"; a nameless parent shows only the mailto link', async ({
	page
}) => {
	await signIn(page, teacher);
	await page.goto(`/teacher/classes/${classId}`);
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');

	await page.locator(`.student-toggle[data-student-id="${unlinked.id}"]`).click();
	const unlinkedPanel = page.locator(`#skills-panel-${unlinked.id}`);
	await expect(unlinkedPanel).toBeVisible();
	await expect(unlinkedPanel.getByText('No parent contact')).toBeVisible();
	await expect(unlinkedPanel.getByTestId('parent-contact')).toHaveCount(0);

	await page.locator(`.student-toggle[data-student-id="${nameless.id}"]`).click();
	const namelessPanel = page.locator(`#skills-panel-${nameless.id}`);
	await expect(namelessPanel).toBeVisible();
	const contact = namelessPanel.getByTestId('parent-contact');
	await expect(contact).toHaveCount(1);
	// Only the link: no name and no leading separator.
	await expect(contact).toHaveText(parentC.email);
	await expect(contact.getByRole('link', { name: parentC.email })).toHaveAttribute(
		'href',
		`mailto:${parentC.email}`
	);
});
