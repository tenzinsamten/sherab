import { error, redirect } from '@sveltejs/kit';
import { getCapabilities } from '$lib/server/capabilities';
import type { LayoutServerLoad } from './$types';

/**
 * UX-level gate only (AD-2: RLS is the real barrier). Reads getCapabilities()
 * rather than profiles.role, so only a login with a parents row (any status)
 * gets in; the page itself shows what that status allows.
 */
export const load: LayoutServerLoad = async ({ parent, locals: { supabase } }) => {
	const { session } = await parent();
	if (!session) {
		throw redirect(303, '/login');
	}

	const capabilities = await getCapabilities(supabase, session.user.id);
	if (!capabilities || capabilities.parentStatus === null) {
		throw error(403, 'Parent access only.');
	}

	return { parentStatus: capabilities.parentStatus };
};
