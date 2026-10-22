import { error } from '@sveltejs/kit';
import { signedFileUrl } from '$lib/server/homework-files';
import type { RequestHandler } from './$types';

/**
 * Opens a homework's PDF file (#110, 0053). The file's row is read with the
 * caller's own client, so row level security decides: the admin, the
 * class's teachers, the students the homework is set for and their approved
 * parents are sent on to a signed storage link that works for about a
 * minute; everyone else, signed in or not, gets "not found" -- the same
 * answer as for a file that does not exist. The file never passes through
 * this server. `?download` saves it under its original name instead of
 * showing it. The same shape as /files/syllabus/[fileId].
 */
export const GET: RequestHandler = async ({
	params,
	url,
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	const target = user
		? await signedFileUrl(supabase, params.fileId, url.searchParams.has('download'))
		: null;
	if (!target) throw error(404, 'File not found.');

	// Not `redirect()`: the answer differs per caller and per minute, so it
	// must never be kept by a cache.
	return new Response(null, {
		status: 303,
		headers: { location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }
	});
};
