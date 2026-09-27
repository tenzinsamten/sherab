import { MENU_COOKIE, MENU_COLLAPSED } from '$lib/menu';
import { loadSickLeave } from '$lib/server/leave';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, locals: { supabase, safeGetSession } }) => {
	const { session, user } = await safeGetSession();
	// Read here so the menu is rendered expanded or collapsed from the start,
	// with no flash after hydration.
	const menuExpanded = cookies.get(MENU_COOKIE) !== MENU_COLLAPSED;

	if (!session || !user) {
		return {
			session: null,
			profile: null,
			pendingRequestsCount: 0,
			menuExpanded,
			loadError: false
		};
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

		// Story 7-5: pending Sick answers of the caller's classes (every class
		// for the admin) the caller may decide -- never their own child's.
		const { sickPending, sickError } = await loadSickLeave(supabase);
		pendingRequestsCount += sickPending.filter((r) => !r.ownChild).length;
		countError = countError || sickError;
	}
	if (profile?.role === 'admin') {
		// Story 7-1: pending parent accounts are admin-only requests.
		// parents_select_own_or_admin gives a teacher no rows anyway.
		const { count, error: parentCountErr } = await supabase
			.from('parents')
			.select('id', { count: 'exact', head: true })
			.eq('status', 'pending');
		pendingRequestsCount += count ?? 0;
		countError = countError || Boolean(parentCountErr);
	}

	return {
		session,
		profile: profile ?? null,
		pendingRequestsCount,
		menuExpanded,
		loadError: Boolean(error || countError)
	};
};
