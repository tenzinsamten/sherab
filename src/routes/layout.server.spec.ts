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
	parentCountError?: unknown;
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
									error: table === 'parents' ? (opts.parentCountError ?? null) : null
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

	it('flags a load error when the pending parents count fails', async () => {
		const { result } = runLoad({ role: 'admin', parentCountError: { message: 'boom' } });
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

/**
 * CAP-3 (navigation latency 3): a deferred fake that holds every query until
 * the test releases it, so the load's rounds of queries can be counted. Each
 * round is the set of queries in flight once the load is waiting; all of them
 * are released together before the next round is read.
 */
function runRounds(opts: {
	role: 'admin' | 'teacher' | 'parent' | 'student';
	status?: string;
	parentStatus?: string;
	capabilitiesError?: unknown;
	pendingStudents?: number;
	pendingParents?: number;
	pendingDeletions?: number;
	countError?: unknown;
	unseen?: { data: unknown; error: unknown };
}) {
	type Pending = { label: string; release: () => void };
	let pending: Pending[] = [];
	const selects: { table: string; columns: string }[] = [];
	const defer = (label: string, value: () => unknown) =>
		new Promise((resolve) => pending.push({ label, release: () => resolve(value()) }));

	const chain = (table: string) => {
		let head = false;
		const c = {
			select: (columns: string, options?: { head?: boolean }) => {
				selects.push({ table, columns });
				head = Boolean(options?.head);
				return c;
			},
			eq: () => c,
			neq: () => c,
			is: () => c,
			single: () =>
				defer('profiles.single', () => ({
					data: {
						id: 'u1',
						role: opts.role,
						status: opts.status ?? 'approved',
						display_name: 'Tashi',
						email: 'tashi@example.com',
						email_confirmed_at: null,
						tours_seen: []
					},
					error: null
				})),
			maybeSingle: () =>
				defer(`${table}.maybeSingle`, () =>
					table === 'profiles'
						? { data: { role: opts.role }, error: null }
						: opts.capabilitiesError
							? { data: null, error: opts.capabilitiesError }
							: { data: opts.parentStatus ? { status: opts.parentStatus } : null, error: null }
				),
			then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
				defer(head ? `${table}.count` : table, () =>
					head
						? {
								count:
									table === 'parents'
										? (opts.pendingParents ?? 0)
										: table === 'deletion_requests'
											? (opts.pendingDeletions ?? 0)
											: (opts.pendingStudents ?? 0),
								error: table === 'deletion_requests' ? (opts.countError ?? null) : null
							}
						: (opts.unseen ?? { data: [], error: null })
				).then(resolve, reject)
		};
		return c;
	};
	const supabase = {
		from: chain,
		rpc: (fn: string) => defer(`rpc.${fn}`, () => ({ data: [], error: null }))
	};
	const pathReads = { count: 0 };
	const realUrl = new URL('http://localhost/calendar');
	const url = {
		get pathname() {
			pathReads.count += 1;
			return realUrl.pathname;
		}
	};

	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

	async function drive() {
		let settled = false;
		const result = (
			load({
				cookies: { get: () => undefined },
				url,
				locals: {
					supabase,
					safeGetSession: async () => ({ session: {}, user: { id: 'u1' } })
				}
			} as unknown as Parameters<typeof load>[0]) as Promise<Record<string, unknown>>
		).then((value) => {
			settled = true;
			return value;
		});
		const rounds: string[][] = [];
		for (;;) {
			await flush();
			if (settled || pending.length === 0) break;
			const batch = pending;
			pending = [];
			rounds.push(batch.map((p) => p.label).sort());
			for (const p of batch) p.release();
		}
		return { data: await result, rounds, selects, pathReads: pathReads.count };
	}
	return drive();
}

describe('root layout: two rounds of queries (CAP-3)', () => {
	it('an admin reads profile and capabilities, then every count in one batch', async () => {
		const { data, rounds } = await runRounds({
			role: 'admin',
			pendingStudents: 1,
			pendingParents: 2,
			pendingDeletions: 3
		});
		expect(rounds).toEqual([
			['parents.maybeSingle', 'profiles.maybeSingle', 'profiles.single'],
			[
				'deletion_requests.count',
				'parents.count',
				'profiles.count',
				'rpc.list_class_join_requests',
				'rpc.sick_leave_queue'
			]
		]);
		expect(data).toMatchObject({
			pendingRequestsCount: 6,
			roles: ['admin'],
			activeRole: 'admin',
			newBadges: [],
			loadError: false
		});
	});

	it('every admin count has started before any of them resolves', async () => {
		const { rounds } = await runRounds({ role: 'admin' });
		// The whole second round was in flight at once, with none released yet.
		expect(rounds[1]).toHaveLength(5);
		expect(rounds).toHaveLength(2);
	});

	it('a teacher reads profile and capabilities, then only the three staff reads', async () => {
		const { data, rounds } = await runRounds({ role: 'teacher', pendingStudents: 2 });
		expect(rounds).toEqual([
			['parents.maybeSingle', 'profiles.maybeSingle', 'profiles.single'],
			['profiles.count', 'rpc.list_class_join_requests', 'rpc.sick_leave_queue']
		]);
		expect(data).toMatchObject({
			pendingRequestsCount: 2,
			roles: ['teacher'],
			activeRole: 'teacher',
			loadError: false
		});
	});

	it('any failed admin count flags a load error', async () => {
		const { data } = await runRounds({ role: 'admin', countError: { message: 'boom' } });
		expect(data).toMatchObject({ loadError: true });
	});

	it('reads only the profile columns its consumers use', async () => {
		const { selects } = await runRounds({ role: 'admin' });
		expect(selects.find((s) => s.table === 'profiles')?.columns).toBe(
			'id, role, status, display_name, email, email_confirmed_at, tours_seen'
		);
	});

	it('a parent-only login reads no counts and ignores its capabilities', async () => {
		for (const capabilities of [
			{ parentStatus: 'approved' },
			{ capabilitiesError: { message: 'boom' } }
		]) {
			const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { data, rounds } = await runRounds({ role: 'parent', ...capabilities });
			logged.mockRestore();
			expect(rounds).toEqual([['parents.maybeSingle', 'profiles.maybeSingle', 'profiles.single']]);
			expect(data).toMatchObject({
				roles: ['parent'],
				activeRole: 'parent',
				pendingRequestsCount: 0,
				newBadges: [],
				loadError: false
			});
		}
	});

	it('an unapproved student gets no menu data or badges, and the path is read', async () => {
		const { data, rounds, pathReads } = await runRounds({ role: 'student', status: 'pending' });
		expect(rounds).toHaveLength(1);
		expect(pathReads).toBeGreaterThan(0);
		expect(data).toMatchObject({ pendingRequestsCount: 0, newBadges: [], loadError: false });
	});

	it('an approved student reads new badges in round 2, and not the path', async () => {
		const { data, rounds, pathReads } = await runRounds({
			role: 'student',
			unseen: {
				data: [
					{
						id: 'b1',
						badge_subject: 'dance',
						badge_type: 'attendance',
						milestone: 1,
						earned_at: '2026-10-11T10:00:00Z'
					}
				],
				error: null
			}
		});
		expect(rounds).toEqual([
			['parents.maybeSingle', 'profiles.maybeSingle', 'profiles.single'],
			['badges_earned']
		]);
		expect(pathReads).toBe(0);
		expect(data).toMatchObject({
			newBadges: [expect.objectContaining({ id: 'b1' })],
			loadError: false
		});
	});

	it('a failed badge read in round 2 shows nothing and is no load error', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { data } = await runRounds({
			role: 'student',
			unseen: { data: null, error: { message: 'boom' } }
		});
		logged.mockRestore();
		expect(data).toMatchObject({ newBadges: [], loadError: false });
	});
});
