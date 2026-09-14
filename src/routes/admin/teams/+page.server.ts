import { fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const { data: teams, error } = await supabase
		.from('teams')
		.select('id, name, created_at')
		.order('created_at', { ascending: false });

	return { teams: teams ?? [], loadError: Boolean(error) };
};

export const actions: Actions = {
	create: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const name = String(formData.get('name') ?? '').trim();

		if (!name) {
			return fail(400, { error: m.teams_error_name_required(), name });
		}

		// RLS's teams_insert_admin policy is the real barrier (AD-2) -- this
		// route is also gated by admin/+layout.server.ts, but that is UX-level
		// only, matching every other admin/** route in this codebase.
		const { data: created, error } = await supabase
			.from('teams')
			.insert({ name })
			.select('id, name, created_at')
			.single();

		if (error) {
			return fail(400, { error: error.message, name });
		}

		return { success: true, team: created, name };
	}
};
