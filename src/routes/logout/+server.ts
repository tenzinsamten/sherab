import { redirect } from '@sveltejs/kit';
import { ACTIVE_ROLE_COOKIE } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, locals: { supabase } }) => {
	await supabase.auth.signOut();
	// B13: the next login on a shared browser must not inherit the role pick.
	cookies.delete(ACTIVE_ROLE_COOKIE, { path: '/' });
	throw redirect(303, '/login');
};
