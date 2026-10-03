import { error, redirect } from '@sveltejs/kit';
import { getCapabilities } from '$lib/server/capabilities';
import { ACTIVE_ROLE_COOKIE, heldRoles, isRole } from '$lib/server/roles';
import { roleHome } from '$lib/role-home';
import type { RequestHandler } from './$types';

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * B13 (#68): switch a multi-role login's active role. The requested role is
 * checked against the roles the login really holds (profile role + approved
 * parents row) before the cookie is set; the cookie only picks the view on
 * shared routes and never grants access.
 */
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw redirect(303, '/login');

	let role: FormDataEntryValue | null;
	try {
		role = (await request.formData()).get('role');
	} catch {
		throw error(400, 'Expected a form.');
	}
	const capabilities = await getCapabilities(locals.supabase, user.id);
	if (!capabilities) throw error(503, 'Could not read your roles.');
	const held = heldRoles(capabilities.role, capabilities.parentStatus);
	if (!isRole(role) || !held.includes(role)) {
		throw error(403, 'Role not held.');
	}

	cookies.set(ACTIVE_ROLE_COOKIE, role, {
		path: '/',
		sameSite: 'lax',
		httpOnly: true,
		maxAge: ONE_YEAR
	});
	throw redirect(303, roleHome(role) ?? '/');
};
