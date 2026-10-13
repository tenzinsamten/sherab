import { json } from '@sveltejs/kit';
import { isTourId } from '$lib/tours';
import type { RequestHandler } from './$types';

/**
 * Records that the signed-in account has seen one guided page tour (#101),
 * so it does not start by itself again, on any device. POST `{ tour }`.
 *
 * Which ids are tours is decided here (src/lib/tours.ts); mark_tour_seen()
 * (0044) adds the id to the caller's own row once.
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as { tour?: unknown } | null;
	const tour = body?.tour;
	if (!isTourId(tour)) return json({ error: 'invalid' }, { status: 400 });

	const { error } = await supabase.rpc('mark_tour_seen', { p_tour: tour });
	if (error) {
		console.error('tours: failed to mark a tour seen', error.message);
		return json({ error: 'failed' }, { status: 500 });
	}
	return json({ ok: true });
};
