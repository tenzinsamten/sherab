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

type ChildRow = {
	id: string;
	registered_by_parent_id: string | null;
	display_name: string | null;
	registration_name: string | null;
	status: ChildStatus;
};

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
	// CAP-5: one round trip. The children are every student with a parent,
	// not `registered_by_parent_id IN (<all ids>)`, which grows the URL with each parent
	// and fails at a few hundred. RLS (profiles admin select) still limits
	// the rows; a child whose parent is not listed is never shown.
	const [{ data: parentRows, error: parentsError }, { data: childData, error: childrenError }] =
		await Promise.all([
			supabase.from('parents').select(PARENT_COLUMNS),
			supabase
				.from('profiles')
				.select('id, registered_by_parent_id, display_name, registration_name, status')
				.eq('role', 'student')
				.not('registered_by_parent_id', 'is', null)
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
	const childRows = (childData ?? []) as unknown as ChildRow[];

	const childrenByParent = new Map<string, { id: string; name: string; status: ChildStatus }[]>();
	for (const child of childRows) {
		if (!child.registered_by_parent_id) continue;
		const list = childrenByParent.get(child.registered_by_parent_id) ?? [];
		list.push({
			id: child.id,
			name: child.display_name || child.registration_name || '',
			status: child.status
		});
		childrenByParent.set(child.registered_by_parent_id, list);
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
