import { describe, expect, it } from 'vitest';
import { load } from './+layout.server';

/**
 * Root layout load: the nav badge count (Stories 1-2, 7-1, 7-5). A fake
 * `locals.supabase` answers the caller's profile, the pending-student and
 * pending-parent counts, and sick_leave_queue().
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
	role: 'admin' | 'teacher' | 'parent';
	pendingStudents?: number;
	pendingParents?: number;
	sickQueue?: { data: unknown; error: unknown };
}) {
	const chain = (table: string) => {
		let head = false;
		const c = {
			select: (_cols: string, options?: { head?: boolean }) => {
				head = Boolean(options?.head);
				return c;
			},
			eq: () => c,
			single: async (): Promise<Result> => ({ data: { id: 'u1', role: opts.role }, error: null }),
			then: (resolve: (value: Result) => unknown) =>
				resolve(
					head
						? {
								count:
									table === 'parents' ? (opts.pendingParents ?? 0) : (opts.pendingStudents ?? 0),
								error: null
							}
						: { data: null, error: null }
				)
		};
		return c;
	};
	const rpcCalls: string[] = [];
	const supabase = {
		from: chain,
		rpc: async (fn: string) => {
			rpcCalls.push(fn);
			return opts.sickQueue ?? { data: [], error: null };
		}
	};
	const result = load({
		cookies: { get: () => undefined },
		locals: {
			supabase,
			safeGetSession: async () => ({ session: {}, user: { id: 'u1' } })
		}
	} as unknown as Parameters<typeof load>[0]) as Promise<{
		pendingRequestsCount: number;
		loadError: boolean;
	}>;
	return { result, rpcCalls };
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
});
