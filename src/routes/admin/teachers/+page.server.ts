import { fail } from '@sveltejs/kit';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import { generateTempPassword } from '$lib/server/temp-password';
import { diffClassIds } from '$lib/server/teacher-classes';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const [
		{ data: classes, error: classesError },
		{ data: teachers, error: teachersError },
		{ data: assignments, error: assignmentsError }
	] = await Promise.all([
		supabase.from('classes').select('id, name, code').order('name'),
		supabase
			.from('profiles')
			.select('id, email, display_name, created_at')
			.eq('role', 'teacher')
			.order('created_at', { ascending: false }),
		supabase.from('class_teachers').select('class_id, teacher_id, classes ( id, name, code )')
	]);

	const classesByTeacher = new Map<string, { id: string; name: string; code: string }[]>();
	for (const row of assignments ?? []) {
		const cls = row.classes as unknown as { id: string; name: string; code: string } | null;
		if (!cls) continue;
		const list = classesByTeacher.get(row.teacher_id) ?? [];
		list.push(cls);
		classesByTeacher.set(row.teacher_id, list);
	}

	const teachersWithClasses = (teachers ?? []).map((teacher) => ({
		...teacher,
		classes: classesByTeacher.get(teacher.id) ?? []
	}));

	return {
		classes: classes ?? [],
		teachers: teachersWithClasses,
		loadError: Boolean(classesError || teachersError || assignmentsError)
	};
};

export const actions: Actions = {
	create: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const email = String(formData.get('email') ?? '').trim();
		const displayName = String(formData.get('displayName') ?? '').trim();
		// Deduped: a repeated value here would self-collide on class_teachers'
		// composite (class_id, teacher_id) PK and fail the whole insert batch.
		const classIds = [...new Set(formData.getAll('classIds').map(String).filter(Boolean))];

		if (!email) {
			return fail(400, { error: m.teachers_error_email_required(), email, displayName, classIds });
		}
		if (classIds.length === 0) {
			return fail(400, {
				error: m.teachers_error_class_required(),
				email,
				displayName,
				classIds
			});
		}

		const tempPassword = generateTempPassword();
		const adminClient = createSupabaseAdminClient();

		const { data: created, error: createError } = await adminClient.auth.admin.createUser({
			email,
			password: tempPassword,
			email_confirm: true,
			user_metadata: {
				role: 'teacher',
				display_name: displayName || email
			}
		});

		if (createError || !created.user) {
			const isDuplicate =
				createError?.code === 'email_exists' ||
				/already.*registered|exists/i.test(createError?.message ?? '');
			return fail(400, {
				error: isDuplicate
					? m.teachers_error_duplicate()
					: (createError?.message ?? m.teachers_error_create_failed()),
				email,
				displayName,
				classIds
			});
		}

		// Runs through the request-scoped (RLS-enforced) client, not the
		// admin client -- so this insert is independently checked against
		// is_admin() too (AD-2 defense in depth), not just trusted because
		// the layout guard let the request through.
		const { error: assignError } = await supabase
			.from('class_teachers')
			.insert(classIds.map((classId) => ({ class_id: classId, teacher_id: created.user!.id })));

		if (assignError) {
			// The auth user (and its one-time temp password) already exists at
			// this point -- include tempPassword here too, or it's shown nowhere
			// and the account becomes unrecoverable without a password reset.
			return fail(400, {
				error: m.teachers_error_assign_failed({ message: assignError.message }),
				email,
				displayName,
				classIds,
				tempPassword
			});
		}

		// displayName/classIds are echoed back too (not just email/tempPassword)
		// so every branch of this action's return type has the same shape for
		// the form's re-rendered field values to read from.
		return { success: true, email, tempPassword, displayName, classIds };
	},

	updateClasses: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const teacherId = String(formData.get('teacherId') ?? '');
		const selected = formData.getAll('classIds').map(String);

		const teacher = await findTeacher(supabase, teacherId);
		if (!teacher) {
			return fail(404, { error: m.teachers_error_not_found() });
		}

		const { data: current, error: currentError } = await supabase
			.from('class_teachers')
			.select('class_id')
			.eq('teacher_id', teacherId);
		if (currentError) {
			return fail(400, {
				error: m.teachers_error_update_failed({ message: currentError.message })
			});
		}

		// Request-scoped client: class_teachers_insert_admin /
		// class_teachers_delete_admin (0001_init.sql) re-check is_admin().
		const { toAdd, toRemove } = diffClassIds(
			current.map((row) => row.class_id),
			selected
		);
		if (toAdd.length > 0) {
			const { error } = await supabase
				.from('class_teachers')
				.insert(toAdd.map((classId) => ({ class_id: classId, teacher_id: teacherId })));
			if (error) {
				return fail(400, { error: m.teachers_error_update_failed({ message: error.message }) });
			}
		}
		if (toRemove.length > 0) {
			const { error } = await supabase
				.from('class_teachers')
				.delete()
				.eq('teacher_id', teacherId)
				.in('class_id', toRemove);
			if (error) {
				return fail(400, { error: m.teachers_error_update_failed({ message: error.message }) });
			}
		}

		return { updated: teacher.display_name ?? teacher.email };
	},

	resetPassword: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const teacherId = String(formData.get('teacherId') ?? '');

		// RLS-gated read first: proves the caller is an admin who can see this
		// teacher before the privileged (RLS-bypassing) Auth Admin call.
		const teacher = await findTeacher(supabase, teacherId);
		if (!teacher) {
			return fail(404, { error: m.teachers_error_not_found() });
		}

		const tempPassword = generateTempPassword();
		const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(teacherId, {
			password: tempPassword
		});
		if (error) {
			return fail(400, { error: m.teachers_error_reset_failed() });
		}

		return { reset: true, email: teacher.email, tempPassword };
	},

	remove: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const teacherId = String(formData.get('teacherId') ?? '');

		const teacher = await findTeacher(supabase, teacherId);
		if (!teacher) {
			return fail(404, { error: m.teachers_error_not_found() });
		}

		// Deleting the auth user cascades to profiles and class_teachers;
		// attendance/homework/skill rows they recorded keep the row with
		// recorded_by/created_by set to null (FKs in 0001/0003/0004).
		const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(teacherId);
		if (error) {
			return fail(400, { error: m.teachers_error_remove_failed() });
		}

		return { removed: teacher.display_name ?? teacher.email };
	}
};

async function findTeacher(supabase: App.Locals['supabase'], teacherId: string) {
	if (!teacherId) return null;
	const { data } = await supabase
		.from('profiles')
		.select('id, email, display_name')
		.eq('id', teacherId)
		.eq('role', 'teacher')
		.maybeSingle();
	return data;
}
