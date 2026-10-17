import { MENU_COOKIE, MENU_COLLAPSED } from '$lib/menu';
import { loadSickLeave } from '$lib/server/leave';
import { loadClassJoinRequests } from '$lib/server/class-join';
import { getCapabilities } from '$lib/server/capabilities';
import { shapeNewBadges, type NewBadge } from '$lib/server/badges';
import {
	ACTIVE_ROLE_COOKIE,
	activeRole,
	heldRoles,
	withoutLocale,
	type Role
} from '$lib/server/roles';
import type { LayoutServerLoad } from './$types';

/**
 * CAP-3: every profile field a consumer of the layout's `profile` reads
 * (this layout, +layout.svelte, and pages via `await parent()`). Kept in
 * step with `App.PageData.profile` in src/app.d.ts.
 */
const LAYOUT_PROFILE_COLUMNS =
	'id, role, status, display_name, email, email_confirmed_at, tours_seen';

export const load: LayoutServerLoad = async ({
	cookies,
	url,
	locals: { supabase, safeGetSession }
}) => {
	const { session, user } = await safeGetSession();
	// Read here so the menu is rendered expanded or collapsed from the start,
	// with no flash after hydration.
	const menuExpanded = cookies.get(MENU_COOKIE) !== MENU_COLLAPSED;

	if (!session || !user) {
		return {
			session: null,
			profile: null,
			pendingRequestsCount: 0,
			roles: [] as Role[],
			activeRole: null as Role | null,
			menuExpanded,
			newBadges: [] as NewBadge[],
			loadError: false
		};
	}

	// CAP-3: round 1 reads the profile and the capabilities together. RLS's
	// profiles_select_own policy scopes the profile to the caller's own row.
	//
	// B13 (#68): a login whose profile role isn't `parent` (in practice a
	// teacher or admin) may also hold an approved parents row; getCapabilities
	// is the single source for that. A parent-only login holds just `parent`,
	// so its capabilities are read alongside but ignored. A failed read falls
	// back to the profile role alone -- no switcher, and no load error for
	// what is only a preference.
	const [{ data: profile, error }, capabilities] = await Promise.all([
		supabase.from('profiles').select(LAYOUT_PROFILE_COLUMNS).eq('id', user.id).single(),
		getCapabilities(supabase, user.id)
	]);

	// #100: a student who is not approved yet has no menu. Reading the path
	// makes this load run again on every navigation while that lasts, so the
	// menu appears with the first page after approval, without a reload.
	if (profile?.role === 'student' && profile.status !== 'approved') {
		void url.pathname;
	}

	const parentStatus =
		profile && profile.role !== 'parent' ? (capabilities?.parentStatus ?? null) : null;
	const roles = heldRoles(profile?.role, parentStatus);
	// The URL is read only for a multi-role login, so a single-role login's
	// layout load keeps not re-running on every navigation; only the pathname
	// is read, so a query-string change never re-runs it. The cookie is a
	// preference only: activeRole() checks it against the held roles, and
	// guards / RLS never read it.
	const active =
		roles.length > 1
			? activeRole(roles, cookies.get(ACTIVE_ROLE_COOKIE), withoutLocale(url.pathname))
			: (roles[0] ?? null);

	const isStaff = Boolean(profile && (profile.role === 'admin' || profile.role === 'teacher'));
	const isAdmin = profile?.role === 'admin';
	// Badge detail CAP-9: badges the student has not seen celebrated yet, for
	// the "New badge!" dialog. Only the student's own signed-in view, and only
	// once approved -- a parent, teacher or admin never reads or consumes
	// them. RLS limits the rows to the caller's own anyway (student_id =
	// auth.uid() branch).
	const wantsBadges =
		active === 'student' && profile?.role === 'student' && profile.status === 'approved';

	// CAP-3: round 2 is one concurrent batch of every count plus the badge read.
	const [staffCounts, adminCounts, unseenBadges] = await Promise.all([
		// RLS's profiles_select_admin_or_teacher_of_student_class scopes the
		// student count to the caller's own assigned classes (or every class
		// for admin) -- same badge-count data feeding /requests' own load, kept
		// here too so the nav badge (Story 1-2 Component Patterns) stays live
		// everywhere. Story 7-5: pending Sick answers of the caller's classes
		// (every class for the admin) the caller may decide -- never their own
		// child's. B12b (#67): likewise pending class join requests.
		isStaff
			? Promise.all([
					supabase
						.from('profiles')
						.select('id', { count: 'exact', head: true })
						.eq('role', 'student')
						.eq('status', 'pending'),
					loadSickLeave(supabase),
					loadClassJoinRequests(supabase)
				])
			: null,
		// Story 7-1: pending parent accounts are admin-only requests.
		// parents_select_own_or_admin gives a teacher no rows anyway.
		// Story 7-6: pending deletion requests (admin-only queue), never the
		// admin's own child's -- only the child's parent submits, so those are
		// exactly the rows the admin requested.
		isAdmin
			? Promise.all([
					supabase
						.from('parents')
						.select('id', { count: 'exact', head: true })
						.eq('status', 'pending'),
					supabase
						.from('deletion_requests')
						.select('id', { count: 'exact', head: true })
						.eq('status', 'pending')
						.neq('requested_by', user.id)
				])
			: null,
		wantsBadges
			? supabase
					.from('badges_earned')
					.select('id, badge_subject, badge_type, milestone, earned_at')
					.eq('student_id', user.id)
					.is('seen_at', null)
			: null
	]);

	let pendingRequestsCount = 0;
	let countError = false;
	if (staffCounts) {
		const [{ count, error: countErr }, { sickPending, sickError }, { joinPending, joinError }] =
			staffCounts;
		pendingRequestsCount =
			(count ?? 0) +
			sickPending.filter((r) => !r.ownChild).length +
			joinPending.filter((r) => !r.ownChild).length;
		countError = Boolean(countErr) || sickError || joinError;
	}
	if (adminCounts) {
		const [
			{ count: parentCount, error: parentCountErr },
			{ count: deletionCount, error: deletionCountErr }
		] = adminCounts;
		pendingRequestsCount += (parentCount ?? 0) + (deletionCount ?? 0);
		countError = countError || Boolean(parentCountErr) || Boolean(deletionCountErr);
	}

	// A failed badge read shows nothing: no dialog, no error.
	let newBadges: NewBadge[] = [];
	if (unseenBadges) {
		const { data: unseen, error: unseenError } = unseenBadges;
		if (unseenError) {
			console.error(`Could not read new badges. ${unseenError.message}`);
		} else {
			try {
				newBadges = shapeNewBadges(unseen);
			} catch (shapeError) {
				console.error('Could not shape new badges.', shapeError);
			}
		}
	}

	return {
		session,
		profile: profile ?? null,
		pendingRequestsCount,
		roles,
		activeRole: active,
		menuExpanded,
		newBadges,
		loadError: Boolean(error || countError)
	};
};
