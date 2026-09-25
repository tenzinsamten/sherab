import { fail, redirect } from '@sveltejs/kit';
import { CLASS_MESSAGES, rowOr404 } from '$lib/server/class-access';
import * as m from '$lib/paraglide/messages.js';
import { listSyllabi } from '$lib/server/class-syllabus';
import {
	enrollStudent,
	loadClassRoster,
	loadEnrollableStudents,
	unenrollStudent
} from '$lib/server/enrollments';
import { currentSchoolYear } from '$lib/school-year';
import { loadAssignmentIndex } from '$lib/server/homework-view';
import { pickCurrentSkillStatuses, type SkillHistoryRow } from '$lib/server/skill-status';
import type { SkillArea, SkillLevel } from '$lib/supabase/database.types';
import type { Actions, PageServerLoad } from './$types';

const SKILL_AREAS: SkillArea[] = ['language', 'song', 'dance'];
const SKILL_LEVELS: SkillLevel[] = ['not_started', 'learning', 'confident'];

type StudentRow = { id: string; displayName: string };

type AttendanceRow = {
	id: string;
	studentId: string;
	present: boolean;
	notes: string | null;
	sessionDate: string;
	recordedAt: string;
};

/**
 * `YYYY-MM-DD`, and a real calendar date -- not just a truthy string. Guards
 * against e.g. "2026-02-31", which `new Date(...)` would otherwise silently
 * roll over to March rather than reject.
 */
function isValidSessionDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
	const { session } = await safeGetSession();
	if (!session) {
		throw redirect(303, '/login');
	}

	const classId = params.id;

	// RLS (classes_select_admin_or_assigned_teacher, from 0001) is the real
	// barrier here (AD-2) -- a teacher not assigned to this class gets zero
	// rows back, which this turns into a 404 rather than an empty-looking
	// roster (UX-only, matching the "RLS is the real barrier, this check is
	// UX-only" convention already used by requests/+page.server.ts).
	const cls = rowOr404(
		await supabase.from('classes').select('id, name, code').eq('id', classId).maybeSingle(),
		CLASS_MESSAGES
	);

	// Roster = the class's enrolled students (#42, class_enrollments), approved
	// only (Boundaries): Pending/Rejected students never appear here, matching
	// how requests/+page.server.ts is the only place that surfaces them.
	const [roster, enrollable] = await Promise.all([
		loadClassRoster(supabase, classId),
		loadEnrollableStudents(supabase, classId)
	]);
	const students: StudentRow[] = roster.students;
	const studentsError = roster.error;

	const studentIds = students.map((s) => s.id);

	let skillHistory: SkillHistoryRow[] = [];
	let attendance: AttendanceRow[] = [];
	let skillError = false;
	let attendanceError = false;

	if (studentIds.length > 0) {
		// Filtered by class_id, not just student_id -- a teacher assigned to
		// multiple classes must only see a student's history recorded under
		// *this* class, never history rows recorded under a different class
		// (RLS already scopes which classes this teacher can read at all, but
		// without this filter a multi-class teacher viewing Class A would also
		// see that student's Class B rows mixed in).
		const [skillResult, attendanceResult] = await Promise.all([
			supabase
				.from('skill_status_history')
				.select('id, student_id, skill_area, level, notes, recorded_at')
				.eq('class_id', classId)
				.in('student_id', studentIds)
				// Secondary sort by id: recorded_at alone has no deterministic
				// order between two rows with an exact-timestamp tie (a real
				// scenario given the spec's own concurrent-edit requirement) --
				// pickCurrentSkillStatuses picks the first row per key, so without
				// this the "current" pick could vary between reads of the same data.
				.order('recorded_at', { ascending: false })
				.order('id', { ascending: false }),
			supabase
				.from('attendance_records')
				.select('id, student_id, present, notes, session_date, recorded_at')
				.eq('class_id', classId)
				.in('student_id', studentIds)
				.order('recorded_at', { ascending: false })
		]);

		skillHistory = (skillResult.data ?? []).map((r) => ({
			id: r.id,
			studentId: r.student_id,
			skillArea: r.skill_area,
			level: r.level,
			notes: r.notes,
			recordedAt: r.recorded_at
		}));
		skillError = Boolean(skillResult.error);

		attendance = (attendanceResult.data ?? []).map((r) => ({
			id: r.id,
			studentId: r.student_id,
			present: r.present,
			notes: r.notes,
			sessionDate: r.session_date,
			recordedAt: r.recorded_at
		}));
		attendanceError = Boolean(attendanceResult.error);
	}

	// "Current" = the latest row per (student, skill_area) by recorded_at
	// (AD-5) -- see skill-status.ts (and its unit tests) for the dedup logic
	// itself. Every row still remains queryable as history below (no separate
	// screen -- inline "view history" expansion, per Intent).
	const currentSkills = pickCurrentSkillStatuses(skillHistory);

	// Homework card (#32): open / total, with the homework list's own
	// open-vs-archived rule.
	const today = new Date().toISOString().slice(0, 10);
	const [homeworkIndex, syllabusList] = await Promise.all([
		loadAssignmentIndex(supabase, classId, today),
		listSyllabi(supabase, classId)
	]);
	const currentYear = currentSchoolYear();

	return {
		class: cls,
		students,
		enrollable: enrollable.students,
		skillHistory,
		attendance,
		currentSkills,
		homeworkCounts: {
			open: homeworkIndex.entries.filter((e) => e.open).length,
			total: homeworkIndex.entries.length
		},
		syllabusCounts: {
			total: syllabusList.syllabi.length,
			hasCurrent: syllabusList.syllabi.some((s) => s.schoolYear === currentYear)
		},
		currentYear,
		loadError: Boolean(
			studentsError ||
			enrollable.error ||
			skillError ||
			attendanceError ||
			homeworkIndex.error ||
			syllabusList.error
		)
	};
};

export const actions: Actions = {
	enroll: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return enrollStudent({ request, classId: params.id, supabase, user });
	},

	unenroll: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return unenrollStudent({ request, classId: params.id, supabase, user });
	},

	setSkillStatus: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.roster_error_not_signed_in() });
		}

		const formData = await request.formData();
		const studentId = String(formData.get('studentId') ?? '');
		const skillArea = String(formData.get('skillArea') ?? '');
		const level = String(formData.get('level') ?? '');
		const notes = String(formData.get('notes') ?? '').trim();

		if (!studentId || !SKILL_AREAS.includes(skillArea as SkillArea)) {
			return fail(400, { error: m.roster_error_invalid_skill() });
		}
		if (!SKILL_LEVELS.includes(level as SkillLevel)) {
			return fail(400, { error: m.roster_error_invalid_level() });
		}

		// RLS (skill_status_history_insert_admin_or_assigned_teacher) is the
		// real barrier (AD-2) -- a teacher not assigned to this class has the
		// insert denied by Postgres regardless of this form having been
		// submitted at all. Always an INSERT, never an UPDATE (AD-5): two
		// teachers doing this at once both persist, with no clobbering.
		const { error: insertError } = await supabase.from('skill_status_history').insert({
			student_id: studentId,
			class_id: params.id,
			skill_area: skillArea as SkillArea,
			level: level as SkillLevel,
			notes: notes || null,
			recorded_by: user.id
		});

		if (insertError) {
			return fail(400, { error: m.roster_error_skill_save_failed() });
		}

		return { success: true, action: 'skillStatus' as const };
	},

	markAttendance: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.roster_error_not_signed_in() });
		}

		const formData = await request.formData();
		const sessionDate = String(formData.get('sessionDate') ?? '');
		const studentIds = formData.getAll('studentIds').map(String);

		if (!sessionDate) {
			return fail(400, { error: m.roster_error_session_date_required() });
		}
		if (!isValidSessionDate(sessionDate)) {
			return fail(400, { error: m.roster_error_invalid_session_date() });
		}
		if (studentIds.length === 0) {
			return fail(400, { error: m.roster_error_no_students() });
		}

		// RLS (attendance_records_insert_admin_or_assigned_teacher) is the real
		// barrier, as above. One append-only insert per roster student for the
		// chosen session date (AD-5) -- re-marking the same date later adds new
		// rows rather than overwriting, which is also what keeps two teachers
		// marking concurrently safe.
		//
		// Inserted one row at a time, not as a single multi-row insert: a
		// multi-row insert is all-or-nothing, so one student's WITH CHECK
		// failure (e.g. their status changed between page load and submit)
		// would silently discard the whole class's attendance along with it.
		// Per-row inserts let every other student's mark still land, and let
		// the failing student(s) be reported instead of masked by one generic
		// error.
		const failedStudentIds: string[] = [];
		for (const studentId of studentIds) {
			const { error: insertError } = await supabase.from('attendance_records').insert({
				student_id: studentId,
				class_id: params.id,
				present: formData.get(`present_${studentId}`) === 'on',
				session_date: sessionDate,
				recorded_by: user.id
			});
			if (insertError) {
				failedStudentIds.push(studentId);
			}
		}

		if (failedStudentIds.length === studentIds.length) {
			return fail(400, { error: m.roster_error_attendance_save_failed() });
		}

		return {
			success: true,
			action: 'attendance' as const,
			sessionDate,
			failedStudentIds
		};
	}
};
