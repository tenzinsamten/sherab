import { error } from '@sveltejs/kit';
import { signedFileUrl } from '$lib/server/syllabus-files';
import type { RequestHandler } from './$types';

/**
 * Opens a syllabus section's PDF file (0039). The file's row is read with
 * the caller's own client, so row level security decides: the admin, the
 * class's teachers and its enrolled students are sent on to a signed storage
 * link that works for about a minute; everyone else, signed in or not, gets
 * "not found" -- the same answer as for a file that does not exist. The file
 * never passes through this server. `?download` saves it under its original
 * name instead of showing it.
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
