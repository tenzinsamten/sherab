import type { PageServerLoad } from './$types';

type ParentStatus = 'pending' | 'approved' | 'rejected';
type ChildStatus = 'pending' | 'approved' | 'rejected' | null;

type ParentRow = {
	id: string;
	status: ParentStatus;
	profiles: {
		display_name: string | null;
		email: string;
		email_confirmed_at: string | null;
	} | null;
};

/** An active student_parents link with its student embedded. */
type LinkRow = {
	parent_id: string;
	student_id: string;
	student: {
		display_name: string | null;
		registration_name: string | null;
		status: ChildStatus;
	} | null;
};

/** Embeds the linked student; student_parents -> profiles has four FK paths. */
const LINK_COLUMNS =
	'parent_id, student_id, student:profiles!student_parents_student_id_fkey ( display_name, registration_name, status )';

/**
 * #52: same embed shape as /requests' PARENT_COLUMNS. parents -> profiles has
 * two FK paths (id, reviewed_by), so the embed names its FK (PGRST201).
 */
const PARENT_COLUMNS =
	'id, status, profiles!parents_id_fkey ( display_name, email, email_confirmed_at )';

const byName = (a: { name: string }, b: { name: string }) =>
	a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

const STATUS_ORDER: Record<ParentStatus, number> = { pending: 0, approved: 1, rejected: 2 };

/**
 * Read-only admin list of every parent (#52). Rejection usually deletes the
 * login, but a rejected row stays for dual-role logins or when deleteUser
 * fails (requests rejectParent), so all three statuses can appear.
 * Admin-only via the admin layout guard; RLS (parents_select_own_or_admin,
 * profiles admin select) is the real barrier.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	// CAP-5: one round trip. The children are every active student_parents
	// link (spec-second-parent story 2, AD-12: a child with two parents is
	// listed under both), not `parent_id IN (<all ids>)`, which grows the URL
	// with each parent and fails at a few hundred. RLS (student_parents and
	// profiles admin select) still limits the rows; a child whose parent is
	// not listed is never shown.
	const [{ data: parentRows, error: parentsError }, { data: childData, error: childrenError }] =
		await Promise.all([
			supabase.from('parents').select(PARENT_COLUMNS),
			supabase.from('student_parents').select(LINK_COLUMNS).is('removed_at', null)
		]);

	if (parentsError) {
		console.error('admin parents load: parents failed', parentsError.message);
		return { parents: [], pendingCount: 0, loadError: true };
	}
	const rows = (parentRows ?? []) as unknown as ParentRow[];
	if (childrenError) {
		console.error('admin parents load: children failed', childrenError.message);
		// With no parents there are no children to show, so this is no load
		// error -- as before, when the children read was skipped then.
		if (rows.length > 0) return { parents: [], pendingCount: 0, loadError: true };
	}
	const linkRows = (childData ?? []) as unknown as LinkRow[];

	const childrenByParent = new Map<string, { id: string; name: string; status: ChildStatus }[]>();
	for (const link of linkRows) {
		if (!link.student) continue;
		const list = childrenByParent.get(link.parent_id) ?? [];
		list.push({
			id: link.student_id,
			name: link.student.display_name || link.student.registration_name || '',
			status: link.student.status
		});
		childrenByParent.set(link.parent_id, list);
	}

	const parents = rows
		.map((r) => ({
			id: r.id,
			status: r.status,
			name: r.profiles?.display_name || r.profiles?.email || '',
			email: r.profiles?.email ?? '',
			emailConfirmedAt: r.profiles?.email_confirmed_at ?? null,
			children: (childrenByParent.get(r.id) ?? []).sort(byName)
		}))
		.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byName(a, b));

	return {
		parents,
		pendingCount: parents.filter((p) => p.status === 'pending').length,
		loadError: false
	};
};
