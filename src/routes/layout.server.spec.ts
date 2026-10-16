import { describe, expect, it, vi } from 'vitest';
import { load } from './+layout.server';

/**
 * Root layout load: the nav badge count (Stories 1-2, 7-1, 7-5, 7-6). A fake
 * `locals.supabase` answers the caller's profile, the pending-student,
 * pending-parent and pending-deletion counts, and sick_leave_queue().
 */
type Result = { data?: unknown; count?: number | null; error: unknown };

function sick(id: string, decision: 'approved' | 'rejected' | null, ownChild: boolean) {
	return {
		class_session_id: `s-${id}`,
		student_id: `k-${id}`,
		student_name: id,
		class_id: 'c1',
		class_name: 'Alphabet',
		day: '2026-09-27',
		start_time: null,
		answered_at: '2026-09-27T08:00:00Z',
		decision,
		decided_at: decision ? '2026-09-27T09:00:00Z' : null,
		decided_by_system: false,
		own_child: ownChild
	};
}

function runLoad(opts: {
	role: 'admin' | 'teacher' | 'parent' | 'student';
	/** The profile's status (students: pending until approved). */
	status?: string;
	/** Badge detail CAP-9: the caller's unseen badges_earned rows. */
	unseen?: { data: unknown; error: unknown };
	/** B13: the caller's own parents row status (getCapabilities' read). */
	parentStatus?: string;
	parentReadError?: unknown;
	cookie?: string;
	path?: string;
	pendingStudents?: number;
	pendingParents?: number;
	pendingDeletions?: number;
	deletionError?: unknown;
	sickQueue?: { data: unknown; error: unknown };
	joinQueue?: { data: unknown; error: unknown };
}) {
	const calls: { table: string; method: string; args: unknown[] }[] = [];
	const chain = (table: string) => {
		let head = false;
		const c = {
			select: (_cols: string, options?: { head?: boolean }) => {
				head = Boolean(options?.head);
				return c;
			},
			eq: (...args: unknown[]) => {
				calls.push({ table, method: 'eq', args });
				return c;
			},
			neq: (...args: unknown[]) => {
				calls.push({ table, method: 'neq', args });
				return c;
			},
			is: (...args: unknown[]) => {
				calls.push({ table, method: 'is', args });
				return c;
			},
			single: async (): Promise<Result> => ({
				data: { id: 'u1', role: opts.role, status: opts.status ?? 'approved' },
				error: null
			}),
			then: (resolve: (value: Result) => unknown) =>
				resolve(
					head
						? table === 'deletion_requests'
							? { count: opts.pendingDeletions ?? 0, error: opts.deletionError ?? null }
							: {
									count:
										table === 'parents' ? (opts.pendingParents ?? 0) : (opts.pendingStudents ?? 0),
									error: null
								}
						: table === 'badges_earned'
							? (opts.unseen ?? { data: [], error: null })
							: { data: null, error: null }
				),
			maybeSingle: async (): Promise<Result> =>
				table === 'profiles'
					? { data: { role: opts.role }, error: null }
					: table === 'parents'
						? opts.parentReadError
							? { data: null, error: opts.parentReadError }
							: { data: opts.parentStatus ? { status: opts.parentStatus } : null, error: null }
						: { data: null, error: null }
		};
		return c;
	};
	const rpcCalls: string[] = [];
	const supabase = {
		from: chain,
		rpc: async (fn: string) => {
			rpcCalls.push(fn);
			if (fn === 'list_class_join_requests') return opts.joinQueue ?? { data: [], error: null };
			return opts.sickQueue ?? { data: [], error: null };
		}
	};
	const result = load({
		cookies: { get: (name: string) => (name === 'active_role' ? opts.cookie : undefined) },
		url: new URL(`http://localhost${opts.path ?? '/calendar'}`),
		locals: {
			supabase,
			safeGetSession: async () => ({ session: {}, user: { id: 'u1' } })
		}
	} as unknown as Parameters<typeof load>[0]) as Promise<{
		pendingRequestsCount: number;
		roles: string[];
		activeRole: string | null;
		newBadges: unknown[];
		loadError: boolean;
	}>;
	return { result, rpcCalls, calls };
}

const queue = {
	data: [
		sick('own', null, true),
		sick('other', null, false),
		sick('other2', null, false),
		sick('decided', 'approved', false),
		sick('rejected', 'rejected', false)
	],
	error: null
};

function join(id: string, ownChild: boolean) {
	return {
		request_id: `r-${id}`,
		student_id: `k-${id}`,
		student_name: id,
		current_classes: 'Alphabet',
		class_id: 'c2',
		class_name: 'Grammar',
		requested_at: '2026-09-29T08:00:00Z',
		own_child: ownChild
	};
}

const joinQueue = {
	data: [join('own', true), join('other', false), join('other2', false)],
	error: null
};

describe('root layout: nav badge count', () => {
	it('adds only pending Sick of other children for a teacher (Story 7-5)', async () => {
		const { result } = runLoad({ role: 'teacher', pendingStudents: 1, sickQueue: queue });
		expect(await result).toMatchObject({ pendingRequestsCount: 3, loadError: false });
	});

	it('adds pending students, parents and Sick for the admin', async () => {
		const { result } = runLoad({
			role: 'admin',
			pendingStudents: 1,
			pendingParents: 2,
			sickQueue: queue
		});
		expect(await result).toMatchObject({ pendingRequestsCount: 5, loadError: false });
	});

	it('adds pending deletion requests the admin did not submit (Story 7-6)', async () => {
		const { result, calls } = runLoad({
			role: 'admin',
			pendingStudents: 1,
			pendingParents: 2,
			pendingDeletions: 3,
			sickQueue: queue
		});
		expect(await result).toMatchObject({ pendingRequestsCount: 8, loadError: false });
		expect(
			calls.filter((c) => c.table === 'deletion_requests').map((c) => [c.method, ...c.args])
		).toEqual([
			['eq', 'status', 'pending'],
			['neq', 'requested_by', 'u1']
		]);
	});

	it('never asks a teacher about deletion requests', async () => {
		const { result, calls } = runLoad({ role: 'teacher', pendingDeletions: 3, sickQueue: queue });
		expect(await result).toMatchObject({ pendingRequestsCount: 2 });
		expect(calls.some((c) => c.table === 'deletion_requests')).toBe(false);
	});

	it('flags a load error when the deletion count fails', async () => {
		const { result } = runLoad({ role: 'admin', deletionError: { message: 'boom' } });
		expect(await result).toMatchObject({ loadError: true });
	});

	it('flags a load error when sick_leave_queue fails', async () => {
		const { result } = runLoad({
			role: 'teacher',
			pendingStudents: 1,
			sickQueue: { data: null, error: { message: 'boom' } }
		});
		expect(await result).toMatchObject({ pendingRequestsCount: 1, loadError: true });
	});

	it('asks nothing about Sick leave for a parent-only login', async () => {
		const { result, rpcCalls } = runLoad({ role: 'parent', sickQueue: queue });
		expect(await result).toMatchObject({ pendingRequestsCount: 0, loadError: false });
		expect(rpcCalls).toEqual([]);
	});

	it('adds pending class join requests the teacher may decide, never their own child (B12b)', async () => {
		const { result, rpcCalls } = runLoad({
			role: 'teacher',
			pendingStudents: 1,
			sickQueue: queue,
			joinQueue
		});
		expect(await result).toMatchObject({ pendingRequestsCount: 5, loadError: false });
		expect(rpcCalls).toContain('list_class_join_requests');
	});

	it('adds class join requests for the admin too', async () => {
		const { result } = runLoad({ role: 'admin', joinQueue });
		expect(await result).toMatchObject({ pendingRequestsCount: 2, loadError: false });
	});

	it('flags a load error when list_class_join_requests fails', async () => {
		const { result } = runLoad({
			role: 'teacher',
			pendingStudents: 1,
			joinQueue: { data: null, error: { message: 'boom' } }
		});
		expect(await result).toMatchObject({ pendingRequestsCount: 1, loadError: true });
	});
});

describe('root layout: roles and active role (B13 #68)', () => {
	it('a single-role login holds just its role', async () => {
		for (const role of ['teacher', 'admin', 'parent'] as const) {
			const { result } = runLoad({ role, cookie: 'parent' });
			expect(await result).toMatchObject({ roles: [role], activeRole: role });
		}
	});

	it('never reads the parents row of a parent-only login', async () => {
		const { calls } = runLoad({ role: 'parent' });
		expect(calls.some((c) => c.table === 'parents')).toBe(false);
	});

	it('a teacher-parent defaults to the teacher role', async () => {
		const { result } = runLoad({ role: 'teacher', parentStatus: 'approved' });
		expect(await result).toMatchObject({ roles: ['teacher', 'parent'], activeRole: 'teacher' });
	});

	it('the cookie picks Parent on a shared route', async () => {
		const { result } = runLoad({ role: 'teacher', parentStatus: 'approved', cookie: 'parent' });
		expect(await result).toMatchObject({ activeRole: 'parent' });
	});

	it('the URL wins over the cookie, localized paths included', async () => {
		const teacherPage = runLoad({
			role: 'teacher',
			parentStatus: 'approved',
			cookie: 'parent',
			path: '/teacher/classes/c1'
		});
		expect(await teacherPage.result).toMatchObject({ activeRole: 'teacher' });
		const parentPage = runLoad({
			role: 'admin',
			parentStatus: 'approved',
			cookie: 'admin',
			path: '/de/parent/homework'
		});
		expect(await parentPage.result).toMatchObject({ activeRole: 'parent' });
	});

	it('a forged cookie is ignored', async () => {
		const { result } = runLoad({ role: 'teacher', parentStatus: 'approved', cookie: 'admin' });
		expect(await result).toMatchObject({ activeRole: 'teacher' });
	});

	it('a pending parent holds only the staff role', async () => {
		const { result } = runLoad({ role: 'teacher', parentStatus: 'pending', cookie: 'parent' });
		expect(await result).toMatchObject({ roles: ['teacher'], activeRole: 'teacher' });
	});

	it('the badge count stays on for a teacher-parent with Parent active', async () => {
		const { result } = runLoad({
			role: 'teacher',
			parentStatus: 'approved',
			cookie: 'parent',
			pendingStudents: 2
		});
		expect(await result).toMatchObject({ pendingRequestsCount: 2 });
	});

	it('a failed parents read falls back to the profile role, with no load error', async () => {
		const { result } = runLoad({
			role: 'teacher',
			parentStatus: 'approved',
			parentReadError: { message: 'boom' },
			cookie: 'parent'
		});
		expect(await result).toMatchObject({
			roles: ['teacher'],
			activeRole: 'teacher',
			loadError: false
		});
	});
});

describe('root layout: new badges (badge detail CAP-9)', () => {
	const row = (id: string, subject: string, type: string, milestone: number) => ({
		id,
		badge_subject: subject,
		badge_type: type,
		milestone,
		earned_at: '2026-10-11T10:00:00Z'
	});
	const unseen = {
		data: [
			row('b3', 'dance', 'homework', 1),
			row('b2', 'dance', 'attendance', 5),
			row('b1', 'language', 'attendance', 100),
			row('b4', 'dance', 'attendance', 1)
		],
		error: null
	};

	it('an approved student gets their own unseen badges, in tile order, with icons', async () => {
		const { result, calls } = runLoad({ role: 'student', unseen });
		const { newBadges, loadError } = await result;
		expect(loadError).toBe(false);
		expect(newBadges).toEqual([
			{
				id: 'b1',
				subject: 'language',
				badgeType: 'attendance',
				milestone: 100,
				earnedAt: '2026-10-11T10:00:00Z',
				icon: '/badges/language-attendance-100.svg'
			},
			expect.objectContaining({ id: 'b4', icon: '/badges/dance-attendance-1.svg' }),
			expect.objectContaining({ id: 'b2', icon: '/badges/dance-attendance-5.svg' }),
			expect.objectContaining({ id: 'b3', icon: '/badges/dance-homework-1.svg' })
		]);
		expect(
			calls.filter((c) => c.table === 'badges_earned').map((c) => [c.method, ...c.args])
		).toEqual([
			['eq', 'student_id', 'u1'],
			['is', 'seen_at', null]
		]);
	});

	it('a milestone without an icon keeps the badge, with no icon (trophy fallback)', async () => {
		const { result } = runLoad({
			role: 'student',
			unseen: { data: [row('b9', 'dance', 'attendance', 7)], error: null }
		});
		expect((await result).newBadges).toEqual([expect.objectContaining({ id: 'b9', icon: null })]);
	});

	it('a pending student gets none and nothing is read', async () => {
		const { result, calls } = runLoad({ role: 'student', status: 'pending', unseen });
		expect((await result).newBadges).toEqual([]);
		expect(calls.some((c) => c.table === 'badges_earned')).toBe(false);
	});

	it('parent, teacher and admin logins never read or get new badges', async () => {
		for (const role of ['parent', 'teacher', 'admin'] as const) {
			const { result, calls } = runLoad({ role, unseen, sickQueue: queue });
			expect((await result).newBadges).toEqual([]);
			expect(calls.some((c) => c.table === 'badges_earned')).toBe(false);
		}
	});

	it('a failed read shows nothing and is no load error', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { result } = runLoad({
			role: 'student',
			unseen: { data: null, error: { message: 'boom' } }
		});
		expect(await result).toMatchObject({ newBadges: [], loadError: false });
		logged.mockRestore();
	});
});
