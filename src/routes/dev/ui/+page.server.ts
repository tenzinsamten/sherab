import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Mobile-first redesign, story 1: a dev-only preview of the new component
 * system (Tailwind + shadcn-svelte) and its CSS isolation from iX. Not
 * reachable in a production build: `dev` is a build-time constant, so there
 * the load always answers 404.
 */
export const load: PageServerLoad = () => {
	if (!dev) error(404, 'Not found');
	return {};
};
