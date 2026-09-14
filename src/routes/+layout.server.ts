import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { session, user } = await safeGetSession();

	if (!session || !user) {
		return { session: null, profile: null, loadError: false };
	}

	// RLS's profiles_select_own policy scopes this to the caller's own row.
	const { data: profile, error } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', user.id)
		.single();

	return { session, profile: profile ?? null, loadError: Boolean(error) };
};
