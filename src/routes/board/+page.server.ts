import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import {
	isContentLanguage,
	parseContent,
	readContent,
	readContentLanguage,
	type ContentLanguage,
	type RichTextDoc
} from '$lib/rich-text';
import type { Actions, PageServerLoad } from './$types';

/** Posts per page; a full page shows the "Older posts" link. */
const BOARD_PAGE_SIZE = 30;

const INSUFFICIENT_PRIVILEGE = '42501';

/** An ISO 8601 timestamp with a time zone, as `created_at` comes back. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

/**
 * The `before` cursor, or null when it is missing or not a valid ISO
 * timestamp. The date part must be a real calendar date: Date.parse rolls
 * `2026-02-30` over to March, which Postgres would then reject.
 */
function parseBefore(value: string | null): string | null {
	if (!value || !ISO_TIMESTAMP.test(value)) return null;
	if (Number.isNaN(Date.parse(value))) return null;
	const day = value.slice(0, 10);
	return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day ? value : null;
}

export type BoardPost = {
	id: string;
	authorName: string;
	content: RichTextDoc | null;
	contentLanguage: ContentLanguage;
	createdAt: string;
};

/**
 * The school message board (spec-parent-message-board story 3, CAP-1 and
 * CAP-2, text only). RLS on board_posts is the real barrier for reading and
 * posting; the reader check only turns a non-reader into a 403 page, and
 * `canPost` only decides whether the form renders.
 */
export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	const before = parseBefore(url.searchParams.get('before'));

	let postsQuery = supabase
		.from('board_posts')
		.select('id, author_id, content, content_language, created_at');
	if (before) postsQuery = postsQuery.lt('created_at', before);

	const [readerResult, posterResult, postsResult] = await Promise.all([
		supabase.rpc('is_board_reader'),
		supabase.rpc('is_board_poster'),
		postsQuery
			.order('created_at', { ascending: false })
			.order('id', { ascending: false })
			// One extra row tells whether older posts exist.
			.limit(BOARD_PAGE_SIZE + 1)
	]);

	if (readerResult.error || readerResult.data !== true) {
		if (readerResult.error) {
			console.error(`Could not check board access. ${readerResult.error.message}`);
		}
		throw error(403, m.board_error_forbidden());
	}

	if (posterResult.error) {
		console.error(`Could not check board posting. ${posterResult.error.message}`);
	}
	const canPost = !posterResult.error && posterResult.data === true;

	if (postsResult.error) {
		console.error(`Could not load board posts. ${postsResult.error.message}`);
		return {
			canPost,
			posts: [] as BoardPost[],
			olderBefore: null,
			paged: before !== null,
			loadError: true
		};
	}

	const fetched = postsResult.data ?? [];
	const rows = fetched.slice(0, BOARD_PAGE_SIZE);
	const authorIds = [
		...new Set(rows.map((row) => row.author_id).filter((id): id is string => id !== null))
	];

	const names = new Map<string, string>();
	if (authorIds.length > 0) {
		const { data: nameRows, error: namesError } = await supabase.rpc('board_author_names', {
			p_ids: authorIds
		});
		if (namesError) {
			console.error(`Could not load board author names. ${namesError.message}`);
		}
		for (const row of nameRows ?? []) {
			if (row.display_name) names.set(row.id, row.display_name);
		}
	}

	const posts: BoardPost[] = rows.map((row) => ({
		id: row.id,
		authorName: (row.author_id && names.get(row.author_id)) || m.board_former_member(),
		content: readContent(row.content),
		contentLanguage: readContentLanguage(row.content_language),
		createdAt: row.created_at
	}));

	const olderBefore =
		fetched.length > BOARD_PAGE_SIZE ? (rows[rows.length - 1]?.created_at ?? null) : null;

	// `paged`: an older page (a valid `before`), which links back to the newest posts.
	return { canPost, posts, olderBefore, paged: before !== null, loadError: false };
};

export const actions: Actions = {
	post: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.board_error_not_signed_in() });
		}

		const formData = await request.formData();
		const content = parseContent(formData.get('content'));
		if (!content.ok) {
			return fail(400, {
				error:
					content.reason === 'required'
						? m.board_error_content_required()
						: content.reason === 'too_large'
							? m.board_error_content_too_large()
							: m.board_error_content_invalid()
			});
		}
		const language = formData.get('contentLanguage');
		if (!isContentLanguage(language)) {
			return fail(400, { error: m.board_error_content_language() });
		}

		// The author is always the signed-in user, never a posted field.
		const { error: insertError } = await supabase
			.from('board_posts')
			.insert({ author_id: user.id, content: content.value, content_language: language })
			.select('id')
			.single();

		if (insertError) {
			if (insertError.code === INSUFFICIENT_PRIVILEGE) {
				return fail(403, { error: m.board_error_not_allowed() });
			}
			console.error(`Could not insert a board post. ${insertError.message}`);
			return fail(500, { error: m.board_error_post_failed() });
		}

		return { posted: true };
	}
};
