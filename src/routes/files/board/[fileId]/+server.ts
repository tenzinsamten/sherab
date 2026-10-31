import { error } from '@sveltejs/kit';
import { signedBoardFileUrl } from '$lib/server/board-files';
import type { RequestHandler } from './$types';

/**
 * Opens a board post's PDF file (spec-parent-message-board story 4, 0061).
 * The file's row is read with the caller's own client, so row level
 * security decides: every board reader is sent on to a signed storage link
 * that works for about a minute; everyone else, signed in or not, gets "not
 * found" -- the same answer as for a file that does not exist or an id that
 * is no uuid. A link storage refuses to sign is a 500. The file never
 * passes through this server. `?download` saves it under its original name
 * instead of showing it. The same shape as /files/homework/[fileId].
 */
export const GET: RequestHandler = async ({
	params,
	url,
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	if (!user) throw error(404, 'File not found.');
	const target = await signedBoardFileUrl(
		supabase,
		params.fileId,
		url.searchParams.has('download')
	);
	if ('problem' in target) {
		if (target.problem === 'notFound') throw error(404, 'File not found.');
		throw error(500, 'The file could not be opened.');
	}

	// Not `redirect()`: the answer differs per caller and per minute, so it
	// must never be kept by a cache.
	return new Response(null, {
		status: 303,
		headers: {
			location: target.url,
			'cache-control': 'no-store',
			'referrer-policy': 'no-referrer'
		}
	});
};
