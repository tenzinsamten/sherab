import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most badge ids one call may mark (one celebration's worth, with room). */
const MAX_SEEN_IDS = 50;

function isIdList(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.length <= MAX_SEEN_IDS &&
		value.every((id) => typeof id === 'string' && UUID.test(id))
	);
}

/**
 * Records that the signed-in student has seen the "New badge!" celebration
 * for these badges (badge detail CAP-9), so it does not show again, on any
 * device. POST `{ ids }` (badges_earned ids, at most 50).
 *
 * mark_badges_seen() (0050) sets seen_at only on the caller's own unseen
 * rows; another student's ids change nothing and still answer 200.
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
	const ids = body?.ids;
	if (!isIdList(ids)) return json({ error: 'invalid' }, { status: 400 });

	const { error } = await supabase.rpc('mark_badges_seen', { p_ids: ids });
	if (error) {
		console.error('badges: failed to mark badges seen', error.message);
		return json({ error: 'failed' }, { status: 500 });
	}
	return json({ ok: true });
};
