import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * #100: the only page of a student who is not approved yet -- the waiting
 * message, or the not-accepted message for a rejected registration. The
 * hook (handleUnapprovedStudent) sends every other request here. An approved
 * student has no business here and goes to the dashboard.
 */
export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	// RLS's profiles_select_own scopes this to the caller's own row.
	const { data: profile, error } = await supabase
		.from('profiles')
		.select('role, status, registration_name')
		.eq('id', user.id)
		.maybeSingle();

	if (profile && profile.role !== 'student') {
		throw redirect(303, '/');
	}
	if (profile?.status === 'approved') {
		throw redirect(303, '/student');
	}

	return {
		state: profile?.status === 'rejected' ? ('rejected' as const) : ('pending' as const),
		name: profile?.registration_name ?? '',
		loadError: Boolean(error) || !profile
	};
};
