/**
 * #104h (CAP-4): the calendar load against a real local Supabase instance,
 * like rls.spec.ts. The student and parent reads filter through embedded
 * resources (class_sessions -> class_days.day, profiles.parent_id) under the
 * caller's RLS, which a fake client cannot check. Skipped when local
 * Supabase isn't reachable. Every user, class, team and class day it creates
 * is removed again.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { STUDENT_EMAIL_DOMAIN } from '$lib/server/temp-password';
import type { Database } from '$lib/supabase/database.types';
import { load } from './+page.server';

const service = createClient<Database>(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false }
});

async function isSupabaseReachable(): Promise<boolean> {
	try {
		const res = await fetch(`${PUBLIC_SUPABASE_URL}/auth/v1/health`, {
			signal: AbortSignal.timeout(1500)
		});
		return res.ok;
	} catch {
		return false;
	}
}

type Client = ReturnType<typeof createClient<Database>>;
type Login = { id: string; email: string; password: string };

const tag = crypto.randomUUID().slice(0, 8);
const userIds: string[] = [];
const studentIds: string[] = [];
const classIds: string[] = [];
const dayIds: string[] = [];
let teamId: string | undefined;

/** Throws on a failed call. Writes without a select return no data. */
function check<T>(result: { data: T; error: { message: string } | null }, what: string) {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data as NonNullable<T>;
}

async function createLogin(role: 'student' | 'parent', name: string): Promise<Login> {
	const domain = role === 'student' ? STUDENT_EMAIL_DOMAIN : 'example.test';
	const email = `cal104-${name}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${name}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

async function createClass(name: string): Promise<string> {
	const data = check(
		await service
			.from('classes')
			.insert({
				name: `CAL104 ${name} ${tag}`,
				code: `Q${crypto.randomUUID().slice(0, 5).toUpperCase()}`
			})
			.select('id')
			.single(),
		`create class ${name}`
	);
	classIds.push(data.id);
	return data.id;
}

async function fixtureTeamId(): Promise<string> {
	if (!teamId) {
		const data = check(
			await service
				.from('teams')
				.insert({ name: `CAL104 Team ${tag}` })
				.select('id')
				.single(),
			'create team'
		);
		teamId = data.id;
	}
	return teamId;
}

/** A child of `parentId`, enrolled in `classId`. */
async function createChild(
	name: string,
	parentId: string,
	classId: string,
	status: 'approved' | 'pending'
): Promise<Login> {
	const login = await createLogin('student', name);
	studentIds.push(login.id);
	check(
		await service
			.from('profiles')
			.update({
				class_id: classId,
				status,
				parent_id: parentId,
				registration_name: `CAL104 ${name}`,
				display_name: `CAL104 ${name}`,
				...(status === 'approved' ? { team_id: await fixtureTeamId() } : {})
			})
			.eq('id', login.id),
		`set up ${name}`
	);
	const enrolled = check(
		await service
			.from('class_enrollments')
			.select('class_id')
			.eq('student_id', login.id)
			.eq('class_id', classId),
		'read enrollment'
	);
	if (!enrolled?.length) {
		check(
			await service.from('class_enrollments').insert({ student_id: login.id, class_id: classId }),
			`enroll ${name}`
		);
	}
	return login;
}

/** The session of `classId` on `day` (creating the day and session). */
async function sessionFor(classId: string, day: string): Promise<string> {
	const id = check(
		await service.rpc('attendance_backfill_session', { p_class_id: classId, p_day: day }),
		'create session'
	);
	const days = check(await service.from('class_days').select('id').eq('day', day), 'read day');
	for (const d of days ?? []) if (!dayIds.includes(d.id)) dayIds.push(d.id);
	return id;
}

async function signedIn(login: Login): Promise<Client> {
	const client = createClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	const { error } = await client.auth.signInWithPassword({
		email: login.email,
		password: login.password
	});
	if (error) throw new Error(`sign in ${login.email}: ${error.message}`);
	return client;
}

type LoadResult = {
	days: { sessions: { id: string }[] }[];
	children: { id: string; name: string }[];
	selectedChild: string | null;
	leaveAnswers: Record<string, string>;
	childAnswers: Record<string, { childId: string; name: string; answer: string | null }[]>;
	loadError: boolean;
};

function runLoad(client: Client, userId: string, role: string, month: string, query = '') {
	return load({
		url: new URL(`http://localhost/calendar?month=${month}${query}`),
		parent: async () => ({ profile: { role }, activeRole: role }),
		locals: { supabase: client, safeGetSession: async () => ({ user: { id: userId } }) }
	} as unknown as Parameters<typeof load>[0]) as Promise<LoadResult>;
}

const sessionIdsOf = (r: LoadResult) => r.days.flatMap((d) => d.sessions.map((s) => s.id)).sort();

const reachable = await isSupabaseReachable();

describe.skipIf(!reachable)('calendar load on the real DB (#104h, requires local Supabase)', () => {
	// A random far-future month (class days are unique school-wide), and the
	// month after it for the answer that must not show.
	const year = 3000 + Math.floor(Math.random() * 6000);
	const month = `${year}-06`;
	const day = `${month}-17`;
	const otherDay = `${year}-07-17`;

	let parent: Login;
	let parentClient: Client;
	let anna: Login;
	let bodhi: Login;
	let pema: Login;
	let classA: string;
	let classB: string;
	let classC: string;
	let sessionA: string;
	let sessionB: string;
	let sessionC: string;
	let otherSessionA: string;

	beforeAll(async () => {
		parent = await createLogin('parent', 'parent');
		check(
			await service.from('parents').upsert([{ id: parent.id }], { onConflict: 'id' }),
			'add parents row'
		);
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);
		classA = await createClass('A');
		classB = await createClass('B');
		classC = await createClass('C');
		anna = await createChild('anna', parent.id, classA, 'approved');
		bodhi = await createChild('bodhi', parent.id, classB, 'approved');
		pema = await createChild('pema', parent.id, classC, 'pending');
		sessionA = await sessionFor(classA, day);
		sessionB = await sessionFor(classB, day);
		sessionC = await sessionFor(classC, day);
		otherSessionA = await sessionFor(classA, otherDay);

		parentClient = await signedIn(parent);
		const answer = async (sessionId: string, studentId: string, value: 'coming' | 'on_leave') =>
			check(
				await parentClient
					.from('session_leave_history')
					.insert({ class_session_id: sessionId, student_id: studentId, answer: value })
					.select('id'),
				`answer ${value}`
			);
		// Two rows for one session: the newer (coming) is current.
		await answer(sessionA, anna.id, 'on_leave');
		await answer(sessionA, anna.id, 'coming');
		await answer(sessionB, bodhi.id, 'on_leave');
		// Another month: must not show in this month's answers.
		await answer(otherSessionA, anna.id, 'on_leave');
	}, 60_000);

	afterAll(async () => {
		// Class days first (their sessions and answers cascade), then students
		// before the parent and classes, then the team.
		if (dayIds.length) await service.from('class_days').delete().in('id', dayIds);
		const rest = userIds.filter((id) => !studentIds.includes(id));
		for (const id of [...studentIds, ...rest]) await service.auth.admin.deleteUser(id);
		if (classIds.length) await service.from('classes').delete().in('id', classIds);
		if (teamId) await service.from('teams').delete().eq('id', teamId);
	}, 60_000);

	it('a student gets their own current answer per session this month', async () => {
		const result = await runLoad(await signedIn(anna), anna.id, 'student', month);
		expect(result.loadError).toBe(false);
		expect(result.leaveAnswers).toEqual({ [sessionA]: 'coming' });
		expect(result.leaveAnswers[otherSessionA]).toBeUndefined();
	});

	it('a parent sees the approved children, their sessions and current answers', async () => {
		const result = await runLoad(parentClient, parent.id, 'parent', month);
		expect(result.loadError).toBe(false);
		expect(result.children.map((c) => c.id).sort()).toEqual([anna.id, bodhi.id].sort());
		expect(result.children.map((c) => c.id)).not.toContain(pema.id);
		expect(sessionIdsOf(result)).toEqual([sessionA, sessionB].sort());
		expect(sessionIdsOf(result)).not.toContain(sessionC);
		expect(result.childAnswers).toEqual({
			[sessionA]: [{ childId: anna.id, name: 'CAL104 anna', answer: 'coming' }],
			[sessionB]: [{ childId: bodhi.id, name: 'CAL104 bodhi', answer: 'on_leave' }]
		});
	});

	it('?child= narrows the parent view to that child', async () => {
		const result = await runLoad(parentClient, parent.id, 'parent', month, `&child=${anna.id}`);
		expect(result.loadError).toBe(false);
		expect(result.selectedChild).toBe(anna.id);
		expect(sessionIdsOf(result)).toEqual([sessionA]);
		expect(Object.keys(result.childAnswers)).toEqual([sessionA]);
	});

	it('the other month shows only that month’s answer', async () => {
		const result = await runLoad(parentClient, parent.id, 'parent', `${year}-07`);
		expect(result.loadError).toBe(false);
		expect(result.childAnswers).toEqual({
			[otherSessionA]: [{ childId: anna.id, name: 'CAL104 anna', answer: 'on_leave' }]
		});
	});
});
