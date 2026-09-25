import { describe, expect, it } from 'vitest';
import {
	enrolledStudentIds,
	enrollmentCounts,
	enrollStudent,
	loadClassRoster,
	loadEnrollableStudents,
	unenrollStudent
} from './enrollments';
import { STUDENT_EMAIL_DOMAIN } from './temp-password';

type Result = { data?: unknown; error: unknown };

/** Chainable query stub resolving one queued result per table / rpc. */
function fakeSupabase(tables: Record<string, Result>, rpcs: Record<string, Result> = {}) {
	const calls: { rpc: string; args: unknown }[] = [];
	const chain = (result: Result) => {
		const c = {
			select: () => c,
			eq: () => c,
			in: () => c,
			then: (resolve: (value: Result) => unknown) => resolve(result)
		};
		return c;
	};
	const client = {
		from: (table: string) => chain(tables[table] ?? { data: [], error: null }),
		rpc: async (name: string, args: unknown) => {
			calls.push({ rpc: name, args });
			return rpcs[name] ?? { data: null, error: null };
		}
	};
	return { client: client as unknown as Parameters<typeof loadClassRoster>[0], calls };
}

function formRequest(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return new Request('http://localhost/', { method: 'POST', body });
}

const user = { id: 't1' } as Parameters<typeof enrollStudent>[0]['user'];

describe('enrolledStudentIds', () => {
	it('returns each student once across classes', async () => {
		const { client } = fakeSupabase({
			class_enrollments: {
				data: [{ student_id: 's1' }, { student_id: 's2' }, { student_id: 's1' }],
				error: null
			}
		});
		expect(await enrolledStudentIds(client, ['c1', 'c2'])).toEqual({
			ids: ['s1', 's2'],
			error: false
		});
	});

	it('skips the query for no classes', async () => {
		const { client } = fakeSupabase({ class_enrollments: { data: null, error: { message: 'x' } } });
		expect(await enrolledStudentIds(client, [])).toEqual({ ids: [], error: false });
	});
});

describe('enrollmentCounts', () => {
	it('counts enrolled students per class', async () => {
		const { client } = fakeSupabase({
			class_enrollments: {
				data: [{ class_id: 'c1' }, { class_id: 'c1' }, { class_id: 'c2' }],
				error: null
			}
		});
		const { counts } = await enrollmentCounts(client, ['c1', 'c2']);
		expect(Object.fromEntries(counts)).toEqual({ c1: 2, c2: 1 });
	});
});

describe('loadClassRoster', () => {
	it('returns enrolled students sorted by name, falling back to the registration name', async () => {
		const { client } = fakeSupabase({
			class_enrollments: { data: [{ student_id: 's1' }, { student_id: 's2' }], error: null },
			profiles: {
				data: [
					{ id: 's1', display_name: 'Tashi', registration_name: null },
					{ id: 's2', display_name: null, registration_name: 'Dolma' }
				],
				error: null
			}
		});
		expect(await loadClassRoster(client, 'c1')).toEqual({
			students: [
				{ id: 's2', displayName: 'Dolma' },
				{ id: 's1', displayName: 'Tashi' }
			],
			error: false
		});
	});

	it('reports an error when the enrollments query fails', async () => {
		const { client } = fakeSupabase({
			class_enrollments: { data: null, error: { message: 'boom' } }
		});
		expect(await loadClassRoster(client, 'c1')).toEqual({ students: [], error: true });
	});
});

describe('loadEnrollableStudents', () => {
	it('derives the username from the student email', async () => {
		const { client } = fakeSupabase(
			{},
			{
				list_enrollable_students: {
					data: [
						{
							id: 's1',
							display_name: 'Tashi',
							email: `tashi-d@${STUDENT_EMAIL_DOMAIN}`,
							class_names: 'Yaks'
						},
						{ id: 's2', display_name: null, email: null, class_names: '' }
					],
					error: null
				}
			}
		);
		const { students } = await loadEnrollableStudents(client, 'c1');
		expect(students).toEqual([
			{ id: 's1', displayName: 'Tashi', username: 'tashi-d', classNames: 'Yaks' },
			{ id: 's2', displayName: 's2', username: null, classNames: '' }
		]);
	});
});

describe('enrollStudent / unenrollStudent', () => {
	it('enrolls the chosen student', async () => {
		const { client, calls } = fakeSupabase({});
		const result = await enrollStudent({
			request: formRequest({ studentId: 's1' }),
			classId: 'c1',
			supabase: client,
			user
		});
		expect(result).toEqual({ success: true, action: 'enrolled' });
		expect(calls).toEqual([
			{ rpc: 'enroll_student', args: { p_class_id: 'c1', p_student_id: 's1' } }
		]);
	});

	it('fails without a student', async () => {
		const { client, calls } = fakeSupabase({});
		const result = await enrollStudent({
			request: formRequest({}),
			classId: 'c1',
			supabase: client,
			user
		});
		expect(result).toMatchObject({ status: 400 });
		expect(calls).toEqual([]);
	});

	it("explains when it is the student's only class", async () => {
		const { client } = fakeSupabase(
			{},
			{ unenroll_student: { data: null, error: { code: '23514', message: 'only class' } } }
		);
		const result = await unenrollStudent({
			request: formRequest({ studentId: 's1' }),
			classId: 'c1',
			supabase: client,
			user
		});
		expect(result).toMatchObject({
			status: 400,
			data: { error: expect.stringMatching(/only class/) }
		});
	});
});
