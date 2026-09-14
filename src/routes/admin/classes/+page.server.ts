import { fail } from '@sveltejs/kit';
import { insertClassWithUniqueCode, UNIQUE_VIOLATION_CODE } from '$lib/server/class-code';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const { data: classes, error } = await supabase
		.from('classes')
		.select('id, name, code, created_at')
		.order('created_at', { ascending: false });

	return { classes: classes ?? [], loadError: Boolean(error) };
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
			// insertClassWithUniqueCode exhausts its retries with the last
			// unique-violation (23505) error still attached -- that's a
			// code-generation failure, not a client-facing DB error, so it must
			// map to the friendly message too, not leak the raw Postgres text.
			const isCodeGenerationFailure = !error.code || error.code === UNIQUE_VIOLATION_CODE;
			return fail(isCodeGenerationFailure ? 500 : 400, {
				error: isCodeGenerationFailure ? m.classes_code_generation_failed() : error.message,
				name
			});
		}

		// `name` is echoed back too (not just `class`) so the create-class
		// form's re-rendered `value={form?.name ?? ''}` has the same shape to
		// read from on every branch of this action's return type.
		return { success: true, class: created, name };
	}
};
