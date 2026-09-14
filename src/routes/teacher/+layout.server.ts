import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** UX-level gate only -- see admin/+layout.server.ts for the AD-2 rationale. */
export const load: LayoutServerLoad = async ({ parent }) => {
	const { session, profile } = await parent();

	if (!session) {
		throw redirect(303, '/login');
	}
	if (!profile || profile.role !== 'teacher') {
		throw error(403, 'Teacher access only.');
	}

	return {};
};
