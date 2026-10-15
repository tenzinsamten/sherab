import { error, redirect } from '@sveltejs/kit';
import { localizeName } from '$lib/localized-name';
import { loadBadgePage } from '$lib/server/badges';
import { CLASS_MESSAGES, rowOr404 } from '$lib/server/class-access';
import { studentDisplayName } from '$lib/server/enrollments';
import type { PageServerLoad } from './$types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A teacher's view of one student's badge page (badge detail CAP-8), reached
 * from the class roster. 404 unless the class is the caller's own
 * (class_teachers) and the student is enrolled in it (class_enrollments).
 * UX only: RLS and badge_progress are the real barrier (AD-2).
 */
export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}
	if (!UUID_PATTERN.test(params.id) || !UUID_PATTERN.test(params.studentId)) {
		throw error(404, 'Not found');
	}

	const [assignment, enrollment, cls, student] = await Promise.all([
		supabase
			.from('class_teachers')
			.select('class_id')
			.eq('class_id', params.id)
			.eq('teacher_id', user.id)
			.maybeSingle(),
		supabase
			.from('class_enrollments')
			.select('student_id')
			.eq('class_id', params.id)
			.eq('student_id', params.studentId)
			.maybeSingle(),
		supabase.from('classes').select('id, name, name_bo, name_de').eq('id', params.id).maybeSingle(),
		supabase
			.from('profiles')
			.select('id, display_name, registration_name')
			.eq('id', params.studentId)
			.maybeSingle()
	]);

	// No row (another teacher's class, a student not in it) is a 404.
	const notFound = { notFound: 'Not found', failed: CLASS_MESSAGES.failed };
	rowOr404(assignment, CLASS_MESSAGES);
	rowOr404(enrollment, notFound);
	const classRow = localizeName(rowOr404(cls, CLASS_MESSAGES));
	const studentRow = rowOr404(student, notFound);

	return {
		class: { id: classRow.id, name: classRow.name },
		student: { id: studentRow.id, name: studentDisplayName(studentRow) },
		...(await loadBadgePage(supabase, params.studentId))
	};
};
