import type { PageServerLoad } from './$types';

export type LinkedChild = {
	id: string;
	name: string;
	status: 'pending' | 'approved';
};

/**
 * Parent landing (Stories 7-1, 7-2). Shows the account's state: unconfirmed,
 * waiting for approval, not approved, or (approved) the linked children.
 * The children come only from linked_children() (security definer: the
 * caller's pending and approved children, name and status only). No other
 * child data is read here (that is Story 7-3).
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
	if (state === 'approved') {
		const { data, error } = await supabase.rpc('linked_children');
		if (error) {
			console.error('parent load: linked_children failed', error.message);
			loadError = true;
		}
		children = (data ?? [])
			.filter((c) => c.status === 'pending' || c.status === 'approved')
			.map((c) => ({ id: c.id, name: c.name, status: c.status as LinkedChild['status'] }));
	}

	return { state, email: profile?.email ?? session?.user.email ?? '', children, loadError };
};
