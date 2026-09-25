import { fail } from '@sveltejs/kit';
import {
	insertClassWithUniqueCode,
	isClassCodeCollision,
	UNIQUE_VIOLATION_CODE
} from '$lib/server/class-code';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const [
		{ data: classes, error },
		{ data: pending, error: pendingError },
		{ data: enrollments, error: enrollmentsError },
		{ data: syllabi, error: syllabiError }
	] = await Promise.all([
		supabase
			.from('classes')
			.select('id, name, code, created_at')
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
			syllabusCount: syllabusCounts.get(cls.id) ?? 0,
			approvedCount: counts.get(cls.id)?.approved ?? 0,
			pendingCount: counts.get(cls.id)?.pending ?? 0
		})),
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
		const name = String(formData.get('name') ?? '').trim();

		if (!name) {
			return fail(400, { error: m.classes_error_name_required(), name });
		}

		// The unique constraint on classes.code is the real guarantee (AD-2:
		// enforced in Postgres, not just here) -- insertClassWithUniqueCode only
		// smooths over the occasional (rare) generated-code collision.
		const { data: created, error } = await insertClassWithUniqueCode(async (code) => {
			const result = await supabase
				.from('classes')
				.insert({ name, code, created_by: user.id })
				.select('id, name, code, created_at')
				.single();
			return { data: result.data, error: result.error };
		});

		if (error) {
			// Any other unique violation is classes_name_unique_idx (0012): the
			// name is taken, and the DB is the real guarantee (AD-2).
			if (error.code === UNIQUE_VIOLATION_CODE && !isClassCodeCollision(error)) {
				return fail(400, { error: m.classes_error_duplicate_name({ name }), name });
			}
			// insertClassWithUniqueCode exhausts its retries with the last
			// code-collision error still attached -- that's a code-generation
			// failure, not a client-facing DB error, so it must map to the
			// friendly message too, not leak the raw Postgres text.
			const isCodeGenerationFailure = !error.code || isClassCodeCollision(error);
			return fail(isCodeGenerationFailure ? 500 : 400, {
				error: isCodeGenerationFailure ? m.classes_code_generation_failed() : error.message,
				name
			});
		}

		// `name` is echoed back too (not just `class`) so the create-class
		// form's re-rendered `value={form?.name ?? ''}` has the same shape to
		// read from on every branch of this action's return type.
		return { success: true, class: created, name };
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

		const { data: deleted, error } = await supabase
			.from('classes')
			.delete()
			.eq('id', classId)
			.select('id');
		if (error || !deleted?.length) {
			return fail(400, {
				error:
					error?.code === '23503'
						? m.classes_error_delete_has_students({ name: className })
						: m.classes_error_delete_failed()
			});
		}

		return { deleted: className };
	}
};
