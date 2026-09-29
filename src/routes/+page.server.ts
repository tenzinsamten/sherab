import { redirect } from '@sveltejs/kit';
import { roleHome } from '$lib/role-home';
import type { PageServerLoad } from './$types';

// `/` is the signed-out landing page only. Signed-in users land on their
// active role's start page (admin dashboard, teacher classes, student
// homework, parent overview), so login and every other redirect to `/` end
// up there too. B13 (#68): a multi-role login lands on the role it last
// picked; everyone else on their only role.
export const load: PageServerLoad = async ({ parent, url }) => {
	const { profile, activeRole } = await parent();
	const home = roleHome(activeRole ?? profile?.role);
	// Keep the query string when forwarding to the role's start page.
	if (home) throw redirect(303, `${home}${url.search}`);
	return {};
};
