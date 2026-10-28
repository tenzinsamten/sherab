import { fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { ownLinkedIds, readOwnLinkedStudentIds } from '$lib/server/own-children';
import { removeParentLinkErrorMessage } from '$lib/server/parent-links';
import type { Actions, PageServerLoad } from './$types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

type PersonEmbed = { display_name: string | null; email: string | null } | null;

/** An active student_parents link with its student, parent and inviter embedded. */
type LinkRow = {
	parent_id: string;
	student_id: string;
	linked_at: string;
	student: {
		display_name: string | null;
		registration_name: string | null;
		status: ChildStatus;
	} | null;
	parent: PersonEmbed;
	inviter: PersonEmbed;
};

/** One child row under a parent (spec-second-parent story 4). */
export type ParentChild = {
	id: string;
	name: string;
	status: ChildStatus;
	/** student_parents.linked_at. */
	linkedAt: string;
	/** The inviter's name or email; null = the parent registered the child (invited_by is null). */
	invitedBy: string | null;
	/** The child's other active parent, by name or email; null when there is none. */
	coParent: string | null;
	/** Two active links and the admin is not linked to the child (AD-4). */
	canRemove: boolean;
};

/**
 * Embeds the linked student, the parent and the inviter. student_parents ->
 * profiles has four FK paths, so each embed names its FK (PGRST201).
 */
const LINK_COLUMNS =
	'parent_id, student_id, linked_at, student:profiles!student_parents_student_id_fkey ( display_name, registration_name, status ), parent:profiles!student_parents_parent_id_fkey ( display_name, email ), inviter:profiles!student_parents_invited_by_fkey ( display_name, email )';

/**
 * #52: same embed shape as /requests' PARENT_COLUMNS. parents -> profiles has
 * two FK paths (id, reviewed_by), so the embed names its FK (PGRST201).
 */
const PARENT_COLUMNS =
	'id, status, profiles!parents_id_fkey ( display_name, email, email_confirmed_at )';

const byName = (a: { name: string }, b: { name: string }) =>
	a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

const STATUS_ORDER: Record<ParentStatus, number> = { pending: 0, approved: 1, rejected: 2 };

/** display_name || email, as this page shows parents; null when neither is known. */
const personName = (p: PersonEmbed) => p?.display_name || p?.email || null;

/**
 * Admin list of every parent (#52) with each child's links (spec-second-parent
 * story 4, CAP-4): who invited the parent and when they were linked, the
 * co-parent, and a Remove for a child with two parents. Rejection usually
 * deletes the login, but a rejected row stays for dual-role logins or when
 * deleteUser fails (requests rejectParent), so all three statuses can appear.
 * Admin-only via the admin layout guard; RLS (parents_select_own_or_admin,
 * profiles admin select) is the real barrier.
 */
export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	// CAP-5: one round trip. The children are every active student_parents
	// link (spec-second-parent story 2, AD-12: a child with two parents is
	// listed under both), not `parent_id IN (<all ids>)`, which grows the URL
	// with each parent and fails at a few hundred. RLS (student_parents and
	// profiles admin select) still limits the rows; a child whose parent is
	// not listed is never shown.
	const [
		{ data: parentRows, error: parentsError },
		{ data: childData, error: childrenError },
		ownLinks
	] = await Promise.all([
		supabase.from('parents').select(PARENT_COLUMNS),
		supabase.from('student_parents').select(LINK_COLUMNS).is('removed_at', null),
		user ? readOwnLinkedStudentIds(supabase, user.id) : Promise.resolve(null)
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

	// AD-4: no Remove for the admin's own child. Unknown (no user, or the read
	// failed): no Remove anywhere -- the function refuses anyway.
	const ownKnown = ownLinks !== null && !ownLinks.error;
	const own = ownKnown ? ownLinkedIds(ownLinks) : new Set<string>();

	const linksByStudent = new Map<string, LinkRow[]>();
	for (const link of linkRows) {
		const list = linksByStudent.get(link.student_id) ?? [];
		list.push(link);
		linksByStudent.set(link.student_id, list);
	}

	const childrenByParent = new Map<string, ParentChild[]>();
	for (const link of linkRows) {
		if (!link.student) continue;
		const siblings = linksByStudent.get(link.student_id) ?? [];
		const other = siblings.find((l) => l.parent_id !== link.parent_id) ?? null;
		const list = childrenByParent.get(link.parent_id) ?? [];
		list.push({
			id: link.student_id,
			name: link.student.display_name || link.student.registration_name || '',
			status: link.student.status,
			linkedAt: link.linked_at,
			invitedBy: personName(link.inviter),
			coParent: other ? (personName(other.parent) ?? '') : null,
			canRemove: siblings.length >= 2 && ownKnown && !own.has(link.student_id)
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

export const actions: Actions = {
	/**
	 * spec-second-parent story 4 (CAP-4): end one parent's link to one child.
	 * remove_parent_link (0057) refuses anyone but the admin, the admin's own
	 * child, an already removed link and a child's last link.
	 */
	removeParentLink: async ({ request, locals: { supabase, safeGetSession } }) => {
		const formData = await request.formData();
		const studentId = String(formData.get('studentId') ?? '');
		const parentId = String(formData.get('parentId') ?? '');

		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.requests_error_not_signed_in() });
		}
		if (!UUID_PATTERN.test(studentId) || !UUID_PATTERN.test(parentId)) {
			return fail(400, { error: m.parents_link_error_not_allowed() });
		}

		const { error } = await supabase.rpc('remove_parent_link', {
			p_student_id: studentId,
			p_parent_id: parentId
		});
		if (error) {
			return fail(error.code === '42501' ? 403 : 400, {
				error: removeParentLinkErrorMessage(error)
			});
		}

		return { linkRemoved: true as const };
	}
};
