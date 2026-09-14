import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/**
 * UX-level gate only (AD-2: the real barrier is Postgres RLS -- every query
 * these admin pages make is also independently checked by `is_admin()`
 * policies, so a tampered client still can't read/write another role's
 * data even if this redirect were bypassed).
 */
export const load: LayoutServerLoad = async ({ parent }) => {
	const { session, profile } = await parent();

	if (!session) {
		throw redirect(303, '/login');
	}
	if (!profile || profile.role !== 'admin') {
		throw error(403, 'Admin access only.');
	}

	return {};
};
