import { redirect } from '@sveltejs/kit';
import { roleHome } from '$lib/role-home';
import type { PageServerLoad } from './$types';

// `/` is the signed-out landing page only. Signed-in users land on their
// role's start page (admin dashboard, teacher classes, student homework),
// so login and every other redirect to `/` end up there too.
export const load: PageServerLoad = async ({ parent, url }) => {
	const { profile } = await parent();
	const home = roleHome(profile?.role);
	// Keep the query (e.g. signup's ?justSignedUp=1, whose toast the layout shows).
	if (home) throw redirect(303, `${home}${url.search}`);
	return {};
};
