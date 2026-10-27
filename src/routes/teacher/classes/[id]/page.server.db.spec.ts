/**
 * #106: the teacher's class page load against a real local Supabase
 * instance, like calendar/page.server.db.spec.ts. A parent's On leave for a
 * coming session (one session, or a leave period through set_leave_range)
 * must reach the class's teacher under RLS, which a fake client cannot check.
 * Skipped when local Supabase isn't reachable. Every user, class, team and
 * class day it creates is removed again.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { todayInBerlin } from '$lib/berlin-date';
import { STUDENT_EMAIL_DOMAIN } from '$lib/server/temp-password';
import type { Database } from '$lib/supabase/database.types';
import { linkParent } from '$lib/server/testing/link-parent';
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

async function createLogin(role: 'student' | 'parent' | 'teacher', name: string): Promise<Login> {
	const domain = role === 'student' ? STUDENT_EMAIL_DOMAIN : 'example.test';
	const email = `tl106-${name}-${tag}@${domain}`;
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

const addDays = (isoDate: string, days: number) => {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
};

/** The session of `classId` on `day`, creating the day (removed afterwards) if it is new. */
async function sessionFor(classId: string, day: string): Promise<string> {
	const before = check(await service.from('class_days').select('id').eq('day', day), 'read day');
	const id = check(
		await service.rpc('attendance_backfill_session', { p_class_id: classId, p_day: day }),
		'create session'
	);
	if (!before?.length) {
		const days = check(await service.from('class_days').select('id').eq('day', day), 'read day');
		for (const d of days ?? []) dayIds.push(d.id);
	}
	return id;
}

type LoadResult = {
	students: { id: string }[];
	leaveAnswers: Record<string, string>;
	upcomingLeave: {
		sessionId: string;
		day: string;
		entries: { studentId: string; answer: string }[];
	}[];
	loadError: boolean;
};

const reachable = await isSupabaseReachable();

describe.skipIf(!reachable)(
	'teacher class page load on the real DB (#106, requires local Supabase)',
	() => {
		const today = todayInBerlin();
		// Days in the coming 12 weeks; random so parallel runs rarely share one.
		const offset = 7 + Math.floor(Math.random() * 50);
		const day = addDays(today, offset);
		const rangeDay = addDays(today, offset + 14);

		let teacher: Login;
		let parent: Login;
		let kid: Login;
		let classId: string;
		let session: string;
		let rangeSession: string;

		beforeAll(async () => {
			teacher = await createLogin('teacher', 'teacher');
			parent = await createLogin('parent', 'parent');
			check(
				await service.from('parents').upsert([{ id: parent.id }], { onConflict: 'id' }),
				'add parents row'
			);
			check(
				await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
				'approve parent'
			);
			const cls = check(
				await service
					.from('classes')
					.insert({
						name: `TL106 ${tag}`,
						code: `T${crypto.randomUUID().slice(0, 5).toUpperCase()}`
					})
					.select('id')
					.single(),
				'create class'
			);
			classId = cls.id;
			classIds.push(classId);
			check(
				await service.from('class_teachers').insert({ class_id: classId, teacher_id: teacher.id }),
				'assign teacher'
			);
			const team = check(
				await service
					.from('teams')
					.insert({ name: `TL106 Team ${tag}` })
					.select('id')
					.single(),
				'create team'
			);
			teamId = team.id;

			kid = await createLogin('student', 'kid');
			studentIds.push(kid.id);
			check(
				await service
					.from('profiles')
					.update({
						class_id: classId,
						status: 'approved',
						registration_name: 'TL106 Kid',
						display_name: 'TL106 Kid',
						team_id: teamId
					})
					.eq('id', kid.id),
				'set up kid'
			);
			await linkParent(service, kid.id, parent.id);
			const enrolled = check(
				await service
					.from('class_enrollments')
					.select('class_id')
					.eq('student_id', kid.id)
					.eq('class_id', classId),
				'read enrollment'
			);
			if (!enrolled?.length) {
				check(
					await service.from('class_enrollments').insert({ student_id: kid.id, class_id: classId }),
					'enroll kid'
				);
			}

			session = await sessionFor(classId, day);
			rangeSession = await sessionFor(classId, rangeDay);

			// As the parent does it: one session On leave, and a leave period.
			const parentClient = await signedIn(parent);
			check(
				await parentClient
					.from('session_leave_history')
					.insert({ class_session_id: session, student_id: kid.id, answer: 'on_leave' })
					.select('id'),
				'set On leave'
			);
			check(
				await parentClient.rpc('set_leave_range', {
					p_student: kid.id,
					p_from: rangeDay,
					p_to: rangeDay,
					p_class: classId,
					p_answer: 'on_leave'
				}),
				'set leave period'
			);
		}, 60_000);

		afterAll(async () => {
			if (dayIds.length) await service.from('class_days').delete().in('id', dayIds);
			const rest = userIds.filter((id) => !studentIds.includes(id));
			for (const id of [...studentIds, ...rest]) await service.auth.admin.deleteUser(id);
			if (classIds.length) await service.from('classes').delete().in('id', classIds);
			if (teamId) await service.from('teams').delete().eq('id', teamId);
		}, 60_000);

		it("the class's teacher sees the child's On leave for both coming sessions", async () => {
			const client = await signedIn(teacher);
			const result = (await load({
				params: { id: classId },
				locals: {
					supabase: client,
					safeGetSession: async () => ({ session: {}, user: { id: teacher.id } })
				}
			} as unknown as Parameters<typeof load>[0])) as LoadResult;

			expect(result.loadError).toBe(false);
			expect(result.students.map((s) => s.id)).toEqual([kid.id]);
			expect(result.upcomingLeave.map((s) => [s.sessionId, s.day, s.entries])).toEqual([
				[session, day, [{ studentId: kid.id, answer: 'on_leave' }]],
				[rangeSession, rangeDay, [{ studentId: kid.id, answer: 'on_leave' }]]
			]);
		});
	}
);
