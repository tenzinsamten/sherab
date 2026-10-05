import { fail } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import * as m from '$lib/paraglide/messages.js';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import type { Database } from '$lib/supabase/database.types';
import { getCapabilities } from './capabilities';
import { studentDisplayName } from './enrollments';
import { generateStudentPin, studentEmailToUsername } from './temp-password';

/**
 * A new PIN for a student who forgot theirs (#88). Shared by the teacher
 * class page and /admin/classes/[id]/students (EnrollmentPanel's
 * `?/resetPin`). The PIN is generated as at approval
 * (requests/+page.server.ts), returned once in the action result and never
 * stored or logged.
 */

type Client = SupabaseClient<Database>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ActionContext = { request: Request; classId: string; supabase: Client; user: User | null };

export async function resetStudentPin({ request, classId, supabase, user }: ActionContext) {
	if (!user) return fail(401, { error: m.pin_reset_error_failed() });
	const studentId = String((await request.formData()).get('studentId') ?? '');
	if (!UUID_PATTERN.test(studentId) || !UUID_PATTERN.test(classId)) {
		return fail(400, { error: m.pin_reset_error_not_found() });
	}

	// Who may reset: the admin, or a teacher assigned to this class. Checked
	// here and not left to RLS alone: a parent can read their child's profile
	// and a student their own, so "the caller can read the row" proves
	// nothing. The role is the caller's own profile (RLS-scoped), the
	// assignment their own class_teachers row.
	const capabilities = await getCapabilities(supabase, user.id);
	let allowed = capabilities?.role === 'admin';
	if (capabilities?.role === 'teacher') {
		const { data: assignment, error: assignmentError } = await supabase
			.from('class_teachers')
			.select('class_id')
			.eq('class_id', classId)
			.eq('teacher_id', user.id)
			.maybeSingle();
		if (assignmentError) return fail(400, { error: m.pin_reset_error_failed() });
		allowed = Boolean(assignment);
	}
	if (!allowed) return fail(403, { error: m.pin_reset_error_not_allowed() });

	// The student id comes from the form: it must be an approved student
	// enrolled in this very class. Not found looks the same as not eligible.
	const [enrollment, profile] = await Promise.all([
		supabase
			.from('class_enrollments')
			.select('student_id')
			.eq('class_id', classId)
			.eq('student_id', studentId)
			.maybeSingle(),
		supabase
			.from('profiles')
			.select('id, email, display_name, registration_name')
			.eq('id', studentId)
			.eq('role', 'student')
			.eq('status', 'approved')
			.maybeSingle()
	]);
	if (enrollment.error || profile.error) return fail(400, { error: m.pin_reset_error_failed() });
	const student = profile.data;
	const username = student ? studentEmailToUsername(student.email) : null;
	if (!enrollment.data || !student || !username) {
		return fail(404, { error: m.pin_reset_error_not_found() });
	}

	// Privileged (RLS-bypassing) Auth Admin call, only after the checks above.
	// Supabase Auth ends every session of the user when an admin sets a new
	// password, so the student is signed out on all devices.
	const pin = generateStudentPin();
	const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(studentId, {
		password: pin
	});
	if (error) return fail(400, { error: m.pin_reset_error_failed() });

	return {
		success: true,
		action: 'pinReset' as const,
		studentId,
		studentName: studentDisplayName(student),
		username,
		pin
	};
}
