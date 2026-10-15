import { redirect } from '@sveltejs/kit';
import { loadBadgePage } from '$lib/server/badges';
import type { PageServerLoad } from './$types';

/**
 * The student's own badge page (badge detail CAP-7): every badge of their
 * subjects, earned and locked. RLS scopes every read to the caller.
 */
export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();

	// Student-facing only -- UX, not the real barrier (AD-2).
	if (!profile || profile.role !== 'student') {
		throw redirect(303, '/');
	}

	return await loadBadgePage(supabase, user.id);
};
