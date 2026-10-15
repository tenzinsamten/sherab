import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBadgePage } from '$lib/server/badges';
import { load } from './+page.server';

vi.mock('$lib/server/badges', () => ({
	loadBadgePage: vi.fn(async () => ({ sections: [], loadError: false }))
}));

/**
 * /teacher/classes/[id]/students/[studentId]/badges (badge detail story 4):
 * a fake client whose tables hold rows filtered by every eq().
 */
const TEACHER = 't1';
const CLASS = '11111111-2222-4333-8444-555555555555';
const OTHER_CLASS = '22222222-2222-4333-8444-555555555555';
const STUDENT = '33333333-2222-4333-8444-555555555555';
const OTHER_STUDENT = '44444444-2222-4333-8444-555555555555';

type Rows = Record<string, Record<string, unknown>[]>;

const baseRows = (): Rows => ({
	class_teachers: [{ class_id: CLASS, teacher_id: TEACHER }],
	class_enrollments: [
		{ class_id: CLASS, student_id: STUDENT },
		{ class_id: OTHER_CLASS, student_id: OTHER_STUDENT }
	],
	classes: [
		{ id: CLASS, name: 'Dance', name_bo: null, name_de: null },
		{ id: OTHER_CLASS, name: 'Other', name_bo: null, name_de: null }
	],
	profiles: [
		{ id: STUDENT, display_name: 'Pema', registration_name: null },
		{ id: OTHER_STUDENT, display_name: 'Nyima', registration_name: null }
	]
});

function runLoad(id: string, studentId: string, rows: Rows = baseRows(), failTable?: string) {
	const from = (table: string) => {
		let data = rows[table] ?? [];
		const c: Record<string, unknown> = {
			select: () => c,
			eq: (column: string, value: unknown) => {
				data = data.filter((row) => row[column] === value);
				return c;
			},
			maybeSingle: async () =>
				table === failTable
					? { data: null, error: { message: 'down' } }
					: { data: data[0] ?? null, error: null }
		};
		return c;
	};
	return load({
		params: { id, studentId },
		locals: {
			supabase: { from },
			safeGetSession: async () => ({ user: { id: TEACHER } })
		}
	} as unknown as Parameters<typeof load>[0]);
}

describe('/teacher/classes/[id]/students/[studentId]/badges load', () => {
	beforeEach(() => vi.mocked(loadBadgePage).mockClear());

	it("loads a student's badge page for a teacher of their class", async () => {
		const result = await runLoad(CLASS, STUDENT);
		expect(result).toEqual({
			class: { id: CLASS, name: 'Dance' },
			student: { id: STUDENT, name: 'Pema' },
			sections: [],
			loadError: false
		});
		expect(loadBadgePage).toHaveBeenCalledWith(expect.anything(), STUDENT);
	});

	it.each([
		['a class that is not theirs', OTHER_CLASS, OTHER_STUDENT],
		['a student not enrolled in the class', CLASS, OTHER_STUDENT],
		['a malformed class id', 'nope', STUDENT],
		['a malformed student id', CLASS, 'nope']
	])('404 for %s', async (_label, id, studentId) => {
		await expect(runLoad(id, studentId)).rejects.toMatchObject({ status: 404 });
		expect(loadBadgePage).not.toHaveBeenCalled();
	});

	it('a failed access read is a 500, not a 404', async () => {
		await expect(runLoad(CLASS, STUDENT, baseRows(), 'class_teachers')).rejects.toMatchObject({
			status: 500
		});
	});
});
