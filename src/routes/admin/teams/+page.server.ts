import { fail } from '@sveltejs/kit';
import { UNIQUE_VIOLATION_CODE } from '$lib/server/class-code';
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
	if (missing === 'en') return m.teams_error_name_required();
	if (missing === 'bo') return m.teams_error_name_bo_required();
	return null;
}

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const { data: teams, error } = await supabase
		.from('teams')
		.select('id, name, name_bo, name_de, created_at, profiles(count)')
		.order('created_at', { ascending: false });

	return {
		teams: (teams ?? []).map(({ profiles, ...team }) => ({
			...team,
			// The name in the viewer's language; the three names stay for the
			// edit form (#76).
			label: localizedName(team),
			memberCount: profiles[0]?.count ?? 0
		})),
		loadError: Boolean(error)
	};
};

export const actions: Actions = {
	create: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const names = readNameFields(formData);

		const nameError = nameRequiredMessage(names);
		if (nameError) {
			return fail(400, { error: nameError, ...names });
		}

		// RLS's teams_insert_admin policy is the real barrier (AD-2) -- this
		// route is also gated by admin/+layout.server.ts, but that is UX-level
		// only, matching every other admin/** route in this codebase.
		const { data: created, error } = await supabase
			.from('teams')
			.insert(nameColumns(names))
			.select('id, name, name_bo, name_de, created_at')
			.single();

		if (error?.code === UNIQUE_VIOLATION_CODE) {
			return fail(400, {
				error: m.teams_error_duplicate_name({ name: duplicateName(error, names) }),
				...names
			});
		}
		if (error) {
			return fail(400, { error: m.teams_error_create_failed(), ...names });
		}

		return { success: true, team: localizeName(created), ...names };
	},

	/** #76: saves a team's names; the same rules as at creation. */
	rename: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const renameId = String(formData.get('teamId') ?? '');
		const names = readNameFields(formData);

		const nameError = nameRequiredMessage(names);
		if (nameError) {
			return fail(400, { error: nameError, renameId, renameValues: names });
		}

		// RLS's teams_update_admin policy (0036) is the real barrier (AD-2).
		const { data: renamed, error } = await supabase
			.from('teams')
			.update(nameColumns(names))
			.eq('id', renameId)
			.select('id, name, name_bo, name_de');

		if (error?.code === UNIQUE_VIOLATION_CODE) {
			return fail(400, {
				error: m.teams_error_duplicate_name({ name: duplicateName(error, names) }),
				renameId,
				renameValues: names
			});
		}
		if (error || !renamed?.length) {
			return fail(400, { error: m.teams_error_rename_failed(), renameId, renameValues: names });
		}

		return { renamed: localizedName(renamed[0]) };
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
