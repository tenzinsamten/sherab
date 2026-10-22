import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';

const announceHomework = vi.fn();
vi.mock('$lib/server/push', () => ({
	announceHomework: (...args: unknown[]) => announceHomework(...args)
}));
// Per test: the roster, and the service role (the weekly path never uses it;
// the one-off rollback does).
const mocked = vi.hoisted(() => ({
	students: [] as { id: string; displayName: string }[],
	admin: null as null | (() => unknown)
}));
vi.mock('$lib/supabase/admin', () => ({
	createSupabaseAdminClient: () => {
		if (mocked.admin) return mocked.admin();
		throw new Error('the weekly path never uses the service role');
	}
}));
vi.mock('$lib/server/enrollments', () => ({
	loadClassRoster: async () => ({ students: mocked.students, error: null })
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

/**
 * #110: PDF files on the create form. They are checked before anything is
 * created; valid ones are attached once the homework exists. A fake client
 * that records inserts and storage uploads; a file row insert is awaited
 * directly (`.select('id')`), the homework and its copy through `.single()`.
 */
describe('createAssignment with PDF files (#110)', () => {
	const ASSIGNMENT = '22222222-2222-4222-8222-222222222222';

	function pdf(name: string, size = 1000): File {
		const bytes = new Uint8Array(size);
		bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
		return new File([bytes], name, { type: 'application/pdf' });
	}

	function fileEvent(
		mode: 'once' | 'weekly',
		files: File[],
		options: { fileInsertFails?: boolean; historyFails?: boolean } = {}
	) {
		const body = new FormData();
		body.set('mode', mode);
		body.set('title', 'Worksheet week');
		body.set('skillArea', 'language');
		body.set(
			'content',
			JSON.stringify({
				type: 'doc',
				content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Do it' }] }]
			})
		);
		body.set('contentLanguage', 'en');
		if (mode === 'weekly') {
			body.set('startDate', '2026-10-18');
			body.set('dueOffsetDays', '7');
		} else {
			body.set('dueDate', '2026-10-20');
			body.set('targetMode', 'all');
		}
		for (const file of files) body.append('files', file);

		const log: string[] = [];
		const supabase = {
			from: (table: string) => ({
				insert: (values: Record<string, unknown>) => {
					log.push(`${table}:insert`);
					const answer =
						table === 'homework_status_history'
							? options.historyFails
								? { data: null, error: { message: 'refused' } }
								: { data: null, error: null }
							: table === 'homework_assignment_files'
								? options.fileInsertFails
									? { data: null, error: { message: 'down' } }
									: { data: [{ id: 'file1' }], error: null }
								: {
										data: { id: table === 'homework_assignments' ? ASSIGNMENT : 'i1' },
										error: null
									};
					const result = {
						single: async () => answer,
						then: (resolve: (value: unknown) => unknown) => resolve(answer)
					};
					void values;
					// Awaited directly (status rows) or through .select().
					return { select: () => result, then: result.then };
				}
			}),
			rpc: async () => ({ data: 1, error: null }),
			storage: {
				from: (bucket: string) => ({
					upload: async (path: string) => {
						log.push(`storage:upload:${bucket}:${path}`);
						return { data: { path }, error: null };
					},
					remove: async (paths: string[]) => {
						log.push('storage:remove');
						return { data: paths.map((name) => ({ name })), error: null };
					}
				})
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
		return { e, log };
	}

	beforeEach(() => {
		announceHomework.mockReset();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		mocked.students = [];
		mocked.admin = null;
	});

	it('one-off with 2 valid PDFs: the homework is created, then both files are attached', async () => {
		const { e, log } = fileEvent('once', [pdf('a.pdf'), pdf('b.pdf')]);
		const { location } = await run(e);
		expect(location).toBe('/teacher/classes/c1/homework?created=0');
		expect(log.filter((line) => !line.startsWith('storage:'))).toEqual([
			'homework_assignments:insert',
			'homework_instances:insert',
			'homework_assignment_files:insert',
			'homework_assignment_files:insert'
		]);
		const uploads = log.filter((line) => line.startsWith('storage:upload:'));
		expect(uploads).toHaveLength(2);
		for (const line of uploads) {
			expect(line).toMatch(new RegExp(`^storage:upload:homework-files:c1/${ASSIGNMENT}/`));
		}
	});

	it('weekly with 2 valid PDFs: the series is created with both files', async () => {
		const { e, log } = fileEvent('weekly', [pdf('a.pdf'), pdf('b.pdf')]);
		const { location } = await run(e);
		expect(location).toBe('/teacher/classes/c1/homework?created=weekly&visible=2026-10-18');
		expect(log.filter((line) => line === 'homework_assignment_files:insert')).toHaveLength(2);
	});

	it('an invalid or over-5 MB file: nothing is created, the message is for the file field', async () => {
		for (const bad of [new File(['PK'], 'notes.docx'), pdf('big.pdf', 5_242_881)]) {
			const { e, log } = fileEvent('once', [pdf('a.pdf'), bad]);
			const { result } = await run(e);
			expect(result).toMatchObject({
				status: 400,
				data: { action: 'createAssignment', fileError: expect.stringContaining(bad.name) }
			});
			expect(log).toEqual([]);
		}
	});

	it('three files: nothing is created, the message names the limit of 2', async () => {
		const { e, log } = fileEvent('weekly', [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);
		const { result } = await run(e);
		expect(result).toMatchObject({
			status: 400,
			data: { fileError: m.homework_file_error_limit({ count: '2' }) }
		});
		expect(log).toEqual([]);
	});

	it('a valid file that cannot be stored after the create: the homework stays and the list names the file', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { e, log } = fileEvent('once', [pdf('Lyrics sheet.pdf')], { fileInsertFails: true });
		const { location } = await run(e);
		expect(location).toBe(
			`/teacher/classes/c1/homework?created=0&notAttached=${encodeURIComponent('Lyrics sheet.pdf')}`
		);
		expect(log).toContain('homework_assignments:insert');
		// The object without a row went again.
		expect(log).toContain('storage:remove');
	});

	it('every target fails: the homework is rolled back and no file is stored or recorded', async () => {
		mocked.students = [{ id: 'student1', displayName: 'Student 1' }];
		const deleted: string[] = [];
		mocked.admin = () => ({
			from: (table: string) => ({
				delete: () => ({
					eq: async (_column: string, id: string) => {
						deleted.push(`${table}:${id}`);
						return { error: null };
					}
				})
			})
		});
		const { e, log } = fileEvent('once', [pdf('Worksheet.pdf')], { historyFails: true });
		const { result } = await run(e);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.homework_error_create_failed(), action: 'createAssignment' }
		});
		expect(deleted).toEqual([`homework_assignments:${ASSIGNMENT}`]);
		expect(log.filter((line) => line.startsWith('storage:'))).toEqual([]);
		expect(log).not.toContain('homework_assignment_files:insert');
		expect(log).toContain('homework_status_history:insert');
		expect(announceHomework).not.toHaveBeenCalled();
	});
});
