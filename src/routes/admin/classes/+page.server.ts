import { fail } from '@sveltejs/kit';
import {
	insertClassWithUniqueCode,
	isClassCodeCollision,
	UNIQUE_VIOLATION_CODE
} from '$lib/server/class-code';
import { removeStoredFiles } from '$lib/server/syllabus-files';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import { todayInBerlin } from '$lib/berlin-date';
import {
	parseScheduleInput,
	scheduleErrorMessages,
	scheduleFormValues
} from '$lib/server/calendar';
import * as m from '$lib/paraglide/messages.js';
import { localizeName, localizedName } from '$lib/localized-name';
import {
	duplicateName,
	missingName,
	nameColumns,
	readNameFields,
	type NameFields
} from '$lib/server/localized-names';
import type { Actions, PageServerLoad } from './$types';

/** #76: English and Tibetan are required, German is optional. */
function nameRequiredMessage(names: NameFields): string | null {
	const missing = missingName(names);
	if (missing === 'en') return m.classes_error_name_required();
	if (missing === 'bo') return m.classes_error_name_bo_required();
	return null;
}

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const [
		{ data: classes, error },
		{ data: pending, error: pendingError },
		{ data: enrollments, error: enrollmentsError },
		{ data: syllabi, error: syllabiError }
	] = await Promise.all([
		supabase
			.from('classes')
			.select('id, name, name_bo, name_de, code, created_at')
			.order('created_at', { ascending: false }),
		// Pending = registrations into the class; approved = enrolled
		// students (#42), who may be in several classes.
		supabase.from('profiles').select('class_id').eq('role', 'student').eq('status', 'pending'),
		supabase.from('class_enrollments').select('class_id'),
		supabase.from('class_syllabi').select('class_id')
	]);

	const syllabusCounts = new Map<string, number>();
	for (const row of syllabi ?? []) {
		syllabusCounts.set(row.class_id, (syllabusCounts.get(row.class_id) ?? 0) + 1);
	}

	const counts = new Map<string, { approved: number; pending: number }>();
	const bump = (classId: string | null, key: 'approved' | 'pending') => {
		if (!classId) return;
		const c = counts.get(classId) ?? { approved: 0, pending: 0 };
		c[key] += 1;
		counts.set(classId, c);
	};
	for (const e of enrollments ?? []) bump(e.class_id, 'approved');
	for (const p of pending ?? []) bump(p.class_id, 'pending');

	return {
		classes: (classes ?? []).map((cls) => ({
			...cls,
			// The name in the viewer's language; the three names stay for the
			// edit form (#76).
			label: localizedName(cls),
			syllabusCount: syllabusCounts.get(cls.id) ?? 0,
			approvedCount: counts.get(cls.id)?.approved ?? 0,
			pendingCount: counts.get(cls.id)?.pending ?? 0
		})),
		// Default "From" of a new class's schedule (Story 6-4).
		today: todayInBerlin(),
		loadError: Boolean(error || pendingError || enrollmentsError || syllabiError)
	};
};

export const actions: Actions = {
	create: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: 'Not signed in.' });
		}

		const formData = await request.formData();
		const names = readNameFields(formData);
		// Story 6-4: the class's schedule is part of the create form; an
		// invalid one creates nothing.
		const schedule = scheduleFormValues(formData);

		// Names and schedule are validated together, so every problem shows at once.
		const nameError = nameRequiredMessage(names);
		const parsed = parseScheduleInput(schedule);
		if (nameError || !parsed.ok) {
			return fail(400, {
				...(nameError ? { error: nameError } : {}),
				...(parsed.ok ? {} : { scheduleErrors: scheduleErrorMessages(parsed.errors) }),
				...names,
				schedule
			});
		}

		// The schedule goes into the insert itself: the insert trigger then
		// creates the class's sessions on every class day it matches, earlier
		// ones included when "From" is in the past.
		const { weekdays, startTime, durationMinutes, startsOn, endsOn, intervalWeeks } = parsed.value;

		// The unique constraint on classes.code is the real guarantee (AD-2:
		// enforced in Postgres, not just here) -- insertClassWithUniqueCode only
		// smooths over the occasional (rare) generated-code collision.
		const { data: created, error } = await insertClassWithUniqueCode(async (code) => {
			const result = await supabase
				.from('classes')
				.insert({
					...nameColumns(names),
					code,
					created_by: user.id,
					schedule_weekdays: weekdays,
					schedule_starts_on: startsOn,
					schedule_ends_on: endsOn,
					schedule_interval_weeks: intervalWeeks,
					default_start_time: startTime,
					default_duration_minutes: durationMinutes
				})
				.select('id, name, name_bo, name_de, code, created_at')
				.single();
			return { data: result.data, error: result.error };
		});

		if (error) {
			// Any other unique violation is a name index (0012, 0036): that
			// name is taken, and the DB is the real guarantee (AD-2).
			if (error.code === UNIQUE_VIOLATION_CODE && !isClassCodeCollision(error)) {
				return fail(400, {
					error: m.classes_error_duplicate_name({ name: duplicateName(error, names) }),
					...names,
					schedule
				});
			}
			// insertClassWithUniqueCode exhausts its retries with the last
			// code-collision error still attached -- that's a code-generation
			// failure, not a client-facing DB error, so it must map to the
			// friendly message too, not leak the raw Postgres text.
			const isCodeGenerationFailure = !error.code || isClassCodeCollision(error);
			return fail(isCodeGenerationFailure ? 500 : 400, {
				error: isCodeGenerationFailure ? m.classes_code_generation_failed() : error.message,
				...names,
				schedule
			});
		}

		// The names are echoed back too (not just `class`) so the create-class
		// form has the same shape to read from on every branch of this
		// action's return type.
		return { success: true, class: created ? localizeName(created) : created, ...names };
	},

	/** #76: saves a class's names; the same rules as at creation. */
	rename: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const renameId = String(formData.get('classId') ?? '');
		const names = readNameFields(formData);

		const nameError = nameRequiredMessage(names);
		if (nameError) {
			return fail(400, { error: nameError, renameId, renameValues: names });
		}

		// RLS's classes_update_admin policy is the real barrier (AD-2).
		const { data: renamed, error } = await supabase
			.from('classes')
			.update(nameColumns(names))
			.eq('id', renameId)
			.select('id, name, name_bo, name_de');

		if (error?.code === UNIQUE_VIOLATION_CODE) {
			return fail(400, {
				error: m.classes_error_duplicate_name({ name: duplicateName(error, names) }),
				renameId,
				renameValues: names
			});
		}
		if (error || !renamed?.length) {
			return fail(400, { error: m.classes_error_rename_failed(), renameId, renameValues: names });
		}

		return { renamed: localizedName(renamed[0]) };
	},

	delete: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const classId = String(formData.get('classId') ?? '');
		const className = String(formData.get('className') ?? '');

		// RLS-gated reads (admins see every student row): the friendly check
		// before the privileged cleanup below. The real guarantee that no
		// enrolled or pending student is orphaned is the
		// classes_prevent_delete_with_students trigger (0011, 0016).
		const [
			{ data: students, error: studentsError },
			{ count: enrolledCount, error: enrolledError }
		] = await Promise.all([
			supabase.from('profiles').select('id, status').eq('role', 'student').eq('class_id', classId),
			supabase
				.from('class_enrollments')
				.select('student_id', { count: 'exact', head: true })
				.eq('class_id', classId)
		]);
		if (studentsError || enrolledError) {
			return fail(400, { error: m.classes_error_delete_failed() });
		}
		if ((enrolledCount ?? 0) > 0 || students.some((s) => s.status === 'pending')) {
			return fail(400, { error: m.classes_error_delete_has_students({ name: className }) });
		}

		// Rejected registrations don't block the delete, but would be left
		// pointing at no class -- remove them the same way the requests
		// page's clearRejected does (auth user delete cascades to profiles).
		const adminClient = createSupabaseAdminClient();
		for (const rejected of students.filter((s) => s.status === 'rejected')) {
			const { error } = await adminClient.auth.admin.deleteUser(rejected.id);
			if (error) {
				return fail(400, { error: m.classes_error_delete_failed() });
			}
		}

		// The class's syllabus files (0039): deleting the class cascades to
		// their rows but cannot reach the storage bucket.
		const files = await removeStoredFiles(supabase, { classId });
		if (!files.ok) return fail(400, { error: m.syllabus_file_error_storage() });

		const { data: deleted, error } = await supabase
			.from('classes')
			.delete()
			.eq('id', classId)
			.select('id');
		if (error || !deleted?.length) {
			// When the class's files were removed above, the message says so.
			const filesGone = files.removed > 0;
			return fail(400, {
				error:
					error?.code === '23503'
						? filesGone
							? m.classes_error_delete_has_students_files_removed({ name: className })
							: m.classes_error_delete_has_students({ name: className })
						: filesGone
							? m.syllabus_file_error_delete_unfinished()
							: m.classes_error_delete_failed()
			});
		}

		return { deleted: className };
	}
};
