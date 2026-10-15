import { loadBadgePage } from '$lib/server/badges';
import { loadLinkedChild } from '$lib/server/linked-child';
import type { PageServerLoad } from './$types';

/**
 * A linked parent's view of their child's badge page (badge detail CAP-8):
 * the same content as the student's own. Not one of the caller's approved
 * children is a 404, as on the child page; RLS is the real barrier.
 */
export const load: PageServerLoad = async ({ params, parent, locals: { supabase } }) => {
	const { parentStatus } = await parent();
	const child = await loadLinkedChild(supabase, parentStatus, params.id);
	return { child, ...(await loadBadgePage(supabase, child.id)) };
};
