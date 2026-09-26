import type { PageServerLoad } from './$types';

/**
 * Parent landing (Story 7-1). Shows the account's state only: unconfirmed,
 * waiting for approval, not approved, or (approved) the children list,
 * which stays empty until Story 7-2 links students. No student data is read.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { profile, parentStatus, session } = await parent();

	const emailConfirmed = Boolean(profile?.email_confirmed_at);
	const state = !emailConfirmed
		? ('unconfirmed' as const)
		: parentStatus === 'approved'
			? ('approved' as const)
			: parentStatus === 'rejected'
				? ('rejected' as const)
				: ('pending' as const);

	return { state, email: profile?.email ?? session?.user.email ?? '' };
};
