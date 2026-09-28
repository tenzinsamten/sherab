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
	parent_id: string | null;
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
	const { data: parentRows, error: parentsError } = await supabase
		.from('parents')
		.select(PARENT_COLUMNS);

	if (parentsError) {
		console.error('admin parents load: parents failed', parentsError.message);
		return { parents: [], pendingCount: 0, loadError: true };
	}

	const rows = (parentRows ?? []) as unknown as ParentRow[];
	const ids = rows.map((r) => r.id);

	let childRows: ChildRow[] = [];
	if (ids.length > 0) {
		const { data, error } = await supabase
			.from('profiles')
			.select('id, parent_id, display_name, registration_name, status')
			.eq('role', 'student')
			.in('parent_id', ids);
		if (error) {
			console.error('admin parents load: children failed', error.message);
			return { parents: [], pendingCount: 0, loadError: true };
		}
		childRows = (data ?? []) as unknown as ChildRow[];
	}

	const childrenByParent = new Map<string, { id: string; name: string; status: ChildStatus }[]>();
	for (const child of childRows) {
		if (!child.parent_id) continue;
		const list = childrenByParent.get(child.parent_id) ?? [];
		list.push({
			id: child.id,
			name: child.display_name || child.registration_name || '',
			status: child.status
		});
		childrenByParent.set(child.parent_id, list);
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
