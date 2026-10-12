import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const announceHomework = vi.fn();
vi.mock('$lib/server/push', () => ({
	announceHomework: (...args: unknown[]) => announceHomework(...args)
}));
vi.mock('$lib/supabase/admin', () => ({
	createSupabaseAdminClient: () => {
		throw new Error('the weekly path never uses the service role');
	}
}));
vi.mock('$lib/server/enrollments', () => ({
	loadClassRoster: async () => ({ students: [], error: null })
}));

const { actions } = await import('./+page.server');

/**
 * #96: the weekly branch of createAssignment. After the series is saved it
 * asks the database for the students' copies when the start date is today
 * (Munich) or earlier, and redirects with when students will see it.
 */
type Result = { data: unknown; error: unknown };

function event(
	fields: Record<string, string>,
	answers: { insert?: Result; rpc?: Result | (() => never) } = {}
) {
	const body = new FormData();
	body.set('mode', 'weekly');
	body.set('title', 'Sing it every week');
	body.set('skillArea', 'song');
	body.set(
		'content',
		JSON.stringify({
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sing' }] }]
		})
	);
	body.set('contentLanguage', 'en');
	body.set('dueOffsetDays', '7');
	for (const [name, value] of Object.entries(fields)) body.set(name, value);

	const inserts: { table: string; values: Record<string, unknown> }[] = [];
	const rpcs: { name: string; args: unknown }[] = [];
	const supabase = {
		from: (table: string) => ({
			insert: (values: Record<string, unknown>) => {
				inserts.push({ table, values });
				return {
					select: () => ({
						single: async () => answers.insert ?? { data: { id: 'series1' }, error: null }
					})
				};
			}
		}),
		rpc: async (name: string, args: unknown) => {
			rpcs.push({ name, args });
			if (typeof answers.rpc === 'function') return answers.rpc();
			return answers.rpc ?? { data: 1, error: null };
		}
	};
	const e = {
		request: new Request('https://app.test/teacher/classes/c1/homework/new', {
			method: 'POST',
			body
		}),
		params: { id: 'c1' },
		platform: undefined,
		locals: {
			supabase,
			safeGetSession: async () => ({ session: {}, user: { id: 'teacher1' } })
		}
	} as unknown as Parameters<typeof actions.createAssignment>[0];
	return { e, inserts, rpcs };
}

/** Runs the action and returns where it redirected to, or what it returned. */
async function run(e: Parameters<typeof actions.createAssignment>[0]) {
	try {
		return { result: await actions.createAssignment(e), location: null };
	} catch (thrown) {
		const redirect = thrown as { status?: number; location?: string };
		if (redirect.status !== 303 || !redirect.location) throw thrown;
		return { result: null, location: redirect.location };
	}
}

const LIST = '/teacher/classes/c1/homework?created=weekly';

describe('createAssignment, weekly (#96)', () => {
	beforeEach(() => {
		announceHomework.mockReset();
		vi.useFakeTimers();
		// Monday 12 October 2026, 12:00 in Munich.
		vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('start today: saves the series, creates the copies at once and says students see it now', async () => {
		const { e, inserts, rpcs } = event({ startDate: '2026-10-12' });
		const { location } = await run(e);

		expect(inserts).toHaveLength(1);
		expect(inserts[0].table).toBe('homework_assignments');
		expect(inserts[0].values).toMatchObject({
			class_id: 'c1',
			whole_class: true,
			created_by: 'teacher1',
			recurrence_rule: { frequency: 'weekly' },
			recurrence_start_date: '2026-10-12',
			due_offset_days: 7
		});
		expect(rpcs).toEqual([
			{ name: 'create_weekly_homework_first_copies', args: { p_assignment_id: 'series1' } }
		]);
		expect(location).toBe(`${LIST}&visible=now`);
	});

	it('start in the past: the same call, the database makes every week up to today', async () => {
		const { e, rpcs } = event({ startDate: '2026-09-21' });
		const { location } = await run(e);
		expect(rpcs).toHaveLength(1);
		expect(location).toBe(`${LIST}&visible=now`);
	});

	it('start in the future: no copy is asked for and the redirect names the date', async () => {
		const { e, inserts, rpcs } = event({ startDate: '2026-10-18' });
		const { location } = await run(e);
		expect(inserts).toHaveLength(1);
		expect(rpcs).toEqual([]);
		expect(location).toBe(`${LIST}&visible=2026-10-18`);
	});

	it('midnight in Munich: at 00:30 there (still yesterday in UTC) a start date of today is created at once', async () => {
		vi.setSystemTime(new Date('2026-10-11T22:30:00Z'));
		const { e, rpcs } = event({ startDate: '2026-10-12' });
		const { location } = await run(e);
		expect(rpcs).toHaveLength(1);
		expect(location).toBe(`${LIST}&visible=now`);
	});

	it('immediate creation fails: the series is kept, it is logged, and the teacher is told "from tomorrow morning"', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { e, inserts, rpcs } = event(
			{ startDate: '2026-10-12' },
			{ rpc: { data: null, error: { message: 'boom' } } }
		);
		const { result, location } = await run(e);

		expect(result).toBeNull();
		expect(inserts).toHaveLength(1);
		expect(rpcs).toHaveLength(1);
		expect(location).toBe(`${LIST}&visible=tomorrow`);
		expect(logged).toHaveBeenCalledTimes(1);
		expect(String(logged.mock.calls[0][0])).toContain('series1');
	});

	it('immediate creation throws: handled like a returned error -- series kept, logged, "from tomorrow morning"', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { e, inserts, rpcs } = event(
			{ startDate: '2026-10-12' },
			{
				rpc: () => {
					throw new Error('fetch failed');
				}
			}
		);
		const { result, location } = await run(e);

		expect(result).toBeNull();
		expect(inserts).toHaveLength(1);
		expect(rpcs).toHaveLength(1);
		expect(location).toBe(`${LIST}&visible=tomorrow`);
		expect(logged).toHaveBeenCalledTimes(1);
		expect(String(logged.mock.calls[0][1])).toContain('fetch failed');
	});

	it('no week was created (count 0, e.g. the database is not yet on the app\'s date): "from tomorrow morning", not "now"', async () => {
		for (const data of [0, null]) {
			const { e, inserts, rpcs } = event(
				{ startDate: '2026-10-12' },
				{ rpc: { data, error: null } }
			);
			const { location } = await run(e);
			expect(inserts).toHaveLength(1);
			expect(rpcs).toHaveLength(1);
			expect(location).toBe(`${LIST}&visible=tomorrow`);
		}
	});

	it('the series cannot be saved: fails, and no copy is asked for', async () => {
		const { e, rpcs } = event(
			{ startDate: '2026-10-12' },
			{ insert: { data: null, error: { message: 'denied' } } }
		);
		const { result, location } = await run(e);
		expect(location).toBeNull();
		expect(result).toMatchObject({ status: 400 });
		expect(rpcs).toEqual([]);
	});

	it('an invalid start date fails before anything is saved', async () => {
		const { e, inserts, rpcs } = event({ startDate: '2026-02-30' });
		const { result } = await run(e);
		expect(result).toMatchObject({ status: 400 });
		expect(inserts).toEqual([]);
		expect(rpcs).toEqual([]);
	});

	it('never sends the "New" notification for weekly homework (#92)', async () => {
		for (const startDate of ['2026-10-12', '2026-09-21', '2026-10-18']) {
			await run(event({ startDate }).e);
		}
		expect(announceHomework).not.toHaveBeenCalled();
	});
});
