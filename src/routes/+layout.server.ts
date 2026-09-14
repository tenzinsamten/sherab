import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { session, user } = await safeGetSession();

	if (!session || !user) {
		return { session: null, profile: null, pendingRequestsCount: 0, loadError: false };
	}

	// RLS's profiles_select_own policy scopes this to the caller's own row.
	const { data: profile, error } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', user.id)
		.single();

	let pendingRequestsCount = 0;
	let countError = false;
	if (profile && (profile.role === 'admin' || profile.role === 'teacher')) {
		// RLS's profiles_select_admin_or_teacher_of_student_class scopes this
		// to the caller's own assigned classes (or every class for admin) --
		// same badge-count data feeding /requests' own load, kept here too so
		// the nav badge (Story 1-2 Component Patterns) stays live everywhere.
		const { count, error: countErr } = await supabase
			.from('profiles')
			.select('id', { count: 'exact', head: true })
			.eq('role', 'student')
			.eq('status', 'pending');
		pendingRequestsCount = count ?? 0;
		countError = Boolean(countErr);
	}

	return {
		session,
		profile: profile ?? null,
		pendingRequestsCount,
		loadError: Boolean(error || countError)
	};
};
