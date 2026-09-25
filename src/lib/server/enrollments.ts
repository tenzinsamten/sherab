import { fail } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import * as m from '$lib/paraglide/messages.js';
import type { Database } from '$lib/supabase/database.types';
import { studentEmailToUsername } from './temp-password';

/**
 * Class membership (#42, 0016_class_enrollments.sql). A student can be in
 * several classes; class_enrollments is the roster, profiles.class_id only
 * says which class they registered into. Shared by the teacher class page
 * and /admin/classes/[id]/students; RLS and the enroll/unenroll functions
 * decide who may do what.
 */

type Client = SupabaseClient<Database>;

/** unenroll_student() (0016) raises this when it's the student's only class. */
const LAST_CLASS_CODE = '23514';

export type RosterStudent = { id: string; displayName: string };

export type EnrollableStudent = {
	id: string;
	displayName: string;
	username: string | null;
	classNames: string;
};

export function studentDisplayName(row: {
	id: string;
	display_name: string | null;
	registration_name?: string | null;
}): string {
	return row.display_name ?? row.registration_name ?? row.id;
}

/** Ids of the students enrolled in any of the classes (each id once). */
export async function enrolledStudentIds(
	supabase: Client,
	classIds: string[]
): Promise<{ ids: string[]; error: boolean }> {
	if (classIds.length === 0) return { ids: [], error: false };
	const { data, error } = await supabase
		.from('class_enrollments')
		.select('student_id')
		.in('class_id', classIds);
	return {
		ids: Array.from(new Set((data ?? []).map((r) => r.student_id))),
		error: Boolean(error)
	};
}

/** Enrolled students per class. */
export async function enrollmentCounts(
	supabase: Client,
	classIds: string[]
): Promise<{ counts: Map<string, number>; error: boolean }> {
	const counts = new Map<string, number>();
	if (classIds.length === 0) return { counts, error: false };
	const { data, error } = await supabase
		.from('class_enrollments')
		.select('class_id')
		.in('class_id', classIds);
	for (const row of data ?? []) counts.set(row.class_id, (counts.get(row.class_id) ?? 0) + 1);
	return { counts, error: Boolean(error) };
}

/** A class's approved, enrolled students, sorted by name. */
export async function loadClassRoster(
	supabase: Client,
	classId: string
): Promise<{ students: RosterStudent[]; error: boolean }> {
	const { ids, error: idsError } = await enrolledStudentIds(supabase, [classId]);
	if (idsError) return { students: [], error: true };
	if (ids.length === 0) return { students: [], error: false };

	const { data, error } = await supabase
		.from('profiles')
		.select('id, display_name, registration_name')
		.in('id', ids)
		.eq('role', 'student')
		.eq('status', 'approved');

	const students = (data ?? [])
		.map((s) => ({ id: s.id, displayName: studentDisplayName(s) }))
		.sort((a, b) => a.displayName.localeCompare(b.displayName));
	return { students, error: Boolean(error) };
}

/** Approved students not in the class yet, for the "Add to class" picker. */
export async function loadEnrollableStudents(
	supabase: Client,
	classId: string
): Promise<{ students: EnrollableStudent[]; error: boolean }> {
	const { data, error } = await supabase.rpc('list_enrollable_students', { p_class_id: classId });
	const students = (data ?? []).map((s) => ({
		id: s.id,
		displayName: s.display_name ?? s.id,
		username: s.email ? studentEmailToUsername(s.email) : null,
		classNames: s.class_names
	}));
	return { students, error: Boolean(error) };
}

type ActionContext = { request: Request; classId: string; supabase: Client; user: User | null };

export async function enrollStudent({ request, classId, supabase, user }: ActionContext) {
	if (!user) return fail(401, { error: m.enroll_error_failed() });
	const studentId = String((await request.formData()).get('studentId') ?? '');
	if (!studentId) return fail(400, { error: m.enroll_error_pick() });

	const { error } = await supabase.rpc('enroll_student', {
		p_class_id: classId,
		p_student_id: studentId
	});
	if (error) return fail(400, { error: m.enroll_error_failed() });

	return { success: true, action: 'enrolled' as const };
}

export async function unenrollStudent({ request, classId, supabase, user }: ActionContext) {
	if (!user) return fail(401, { error: m.unenroll_error_failed() });
	const studentId = String((await request.formData()).get('studentId') ?? '');
	if (!studentId) return fail(400, { error: m.unenroll_error_failed() });

	const { error } = await supabase.rpc('unenroll_student', {
		p_class_id: classId,
		p_student_id: studentId
	});
	if (error) {
		return fail(400, {
			error:
				error.code === LAST_CLASS_CODE ? m.unenroll_error_last_class() : m.unenroll_error_failed()
		});
	}

	return { success: true, action: 'unenrolled' as const };
}
