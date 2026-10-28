import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { acceptInviteErrorMessage, type MyParentInvite } from '$lib/server/parent-invites';
import { loadStudentClasses } from '$lib/server/student-homework';
import type { Actions, PageServerLoad } from './$types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LinkedChild =
	| { id: string; name: string; status: 'pending' }
	| {
			id: string;
			name: string;
			status: 'approved';
			classes: string[];
			open: number;
			overdue: number;
	  };

/**
 * Parent landing (Stories 7-1, 7-2, 7-3). Shows the account's state:
 * unconfirmed, waiting for approval, not approved, or (approved) one card
 * per linked child. The children come from linked_children() (security
 * definer: pending and approved, name and status only). For each approved
 * child the classes (enrollments -> classes) and homework_counts() are read
 * with that child's explicit id; RLS (0025, is_parent_of) scopes them. A
 * pending child shows its name only.
 */
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { profile, parentStatus, session } = await parent();

	const emailConfirmed = Boolean(profile?.email_confirmed_at);
	const state = !emailConfirmed
		? ('unconfirmed' as const)
		: parentStatus === 'approved'
			? ('approved' as const)
			: parentStatus === 'rejected'
				? ('rejected' as const)
				: ('pending' as const);

	let children: LinkedChild[] = [];
	let loadError = false;
	// spec-second-parent story 3: the invites for this login's confirmed email
	// (list_my_parent_invites: approved parents only), even with no children.
	let invites: MyParentInvite[] = [];
	let invitesLoadError = false;
	if (state === 'approved') {
		const { data: inviteRows, error: invitesError } = await supabase.rpc('list_my_parent_invites');
		if (invitesError) {
			console.error('parent load: list_my_parent_invites failed', invitesError.message);
			invitesLoadError = true;
		}
		invites = (inviteRows ?? []).map((i) => ({
			id: i.id,
			childName: i.child_name || m.parent_invites_unnamed_child(),
			invitedBy: i.invited_by_name || null,
			expiresAt: i.expires_at
		}));

		const { data, error } = await supabase.rpc('linked_children');
		if (error) {
			console.error('parent load: linked_children failed', error.message);
			loadError = true;
		}
		const linked = (data ?? []).filter((c) => c.status === 'pending' || c.status === 'approved');

		children = await Promise.all(
			linked.map(async (c): Promise<LinkedChild> => {
				if (c.status !== 'approved') return { id: c.id, name: c.name, status: 'pending' };

				const [classes, counts] = await Promise.all([
					loadStudentClasses(supabase, c.id),
					supabase.rpc('homework_counts', { p_student_id: c.id })
				]);
				if (classes.error || counts.error) {
					console.error('parent load: child details failed', {
						childId: c.id,
						classes: classes.error ? 'classes query failed' : null,
						homeworkCounts: counts.error?.message ?? null
					});
					loadError = true;
				}
				const row = counts.data?.[0];
				return {
					id: c.id,
					name: c.name,
					status: 'approved',
					classes: classes.classes.map((cl) => cl.name),
					open: row?.open_count ?? 0,
					overdue: row?.overdue_count ?? 0
				};
			})
		);
	}

	return {
		state,
		email: profile?.email ?? session?.user.email ?? '',
		children,
		loadError,
		invites,
		invitesLoadError
	};
};

export const actions: Actions = {
	/**
	 * spec-second-parent story 3 (AD-16): the invitee accepts an invite
	 * (accept_parent_invite). The database re-checks everything and links the
	 * child; the reloaded page then lists it.
	 */
	acceptInvite: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/login');

		const formData = await request.formData();
		const inviteId = String(formData.get('inviteId') ?? '');
		if (!UUID_PATTERN.test(inviteId)) {
			return fail(400, { inviteId, acceptError: m.parent_invites_error_failed() });
		}

		const { error: rpcError } = await supabase.rpc('accept_parent_invite', {
			p_invite_id: inviteId
		});
		if (rpcError) {
			return fail(rpcError.code === '42501' ? 403 : 400, {
				inviteId,
				acceptError: acceptInviteErrorMessage(rpcError)
			});
		}
		return { action: 'acceptInvite' as const, success: true };
	}
};
