import { fail } from '@sveltejs/kit';
import { UNIQUE_VIOLATION_CODE } from '$lib/server/class-code';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const { data: teams, error } = await supabase
		.from('teams')
		.select('id, name, created_at, profiles(count)')
		.order('created_at', { ascending: false });

	return {
		teams: (teams ?? []).map(({ profiles, ...team }) => ({
			...team,
			memberCount: profiles[0]?.count ?? 0
		})),
		loadError: Boolean(error)
	};
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

		if (error?.code === UNIQUE_VIOLATION_CODE) {
			return fail(400, { error: m.teams_error_duplicate_name({ name }), name });
		}
		if (error) {
			return fail(400, { error: m.teams_error_create_failed(), name });
		}

		return { success: true, team: created, name };
	},

	delete: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const teamId = String(formData.get('teamId') ?? '');
		const teamName = String(formData.get('teamName') ?? '');

		// Friendly pre-check only: the real barrier is the DB, where
		// enforce_team_id_set_once() blocks the on-delete-set-null cascade
		// for a team that still has students (0010_team_names_and_delete.sql).
		const { count, error: countError } = await supabase
			.from('profiles')
			.select('id', { count: 'exact', head: true })
			.eq('team_id', teamId);
		if (countError) {
			return fail(400, { error: m.teams_error_delete_failed() });
		}
		if (count) {
			return fail(400, { error: m.teams_error_delete_has_members({ name: teamName, count }) });
		}

		const { data: deleted, error } = await supabase
			.from('teams')
			.delete()
			.eq('id', teamId)
			.select('id');
		if (error || !deleted?.length) {
			return fail(400, { error: m.teams_error_delete_failed() });
		}

		return { deleted: teamName };
	}
};
