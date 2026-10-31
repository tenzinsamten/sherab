import { error, fail, redirect, type ActionFailure } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import {
	isContentLanguage,
	MAX_CONTENT_BYTES,
	parseContent,
	readContent,
	readContentLanguage,
	type ContentLanguage,
	type RichTextDoc
} from '$lib/rich-text';
import type { BoardFile } from '$lib/board-files';
import {
	attachPostFiles,
	loadBoardFiles,
	readPostFiles,
	readPostForm,
	removePostObjects
} from '$lib/server/board-files';
import { FORM_OVERHEAD_BYTES, isUuid, readFileForm } from '$lib/server/pdf-files';
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
	/** Story 5: the last edit's time; "Edited" shows when it is over a minute after createdAt. */
	updatedAt: string;
	/** Story 5: the signed-in user wrote it (Edit while a poster, Delete always). */
	mine: boolean;
	/** Its PDF files, oldest first (story 4). */
	files: BoardFile[];
};

/**
 * The school message board (spec-parent-message-board story 3, CAP-1 and
 * CAP-2; story 4 adds up to 2 PDF files per post). RLS on board_posts is
 * the real barrier for reading and posting; the reader check only turns a
 * non-reader into a 403 page, and `canPost` only decides whether the form
 * renders.
 *
 * Story 5 (CAP-3): `mine` per post and `canModerate` (an admin or a teacher
 * by profile role, as RLS checks it) decide which Edit and Delete controls
 * render; RLS decides what an edit or a delete may change.
 */
export const load: PageServerLoad = async ({
	url,
	parent,
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	const before = parseBefore(url.searchParams.get('before'));

	let postsQuery = supabase
		.from('board_posts')
		.select('id, author_id, content, content_language, created_at, updated_at');
	if (before) postsQuery = postsQuery.lt('created_at', before);

	const [readerResult, posterResult, postsResult, { profile }] = await Promise.all([
		supabase.rpc('is_board_reader'),
		supabase.rpc('is_board_poster'),
		postsQuery
			.order('created_at', { ascending: false })
			.order('id', { ascending: false })
			// One extra row tells whether older posts exist.
			.limit(BOARD_PAGE_SIZE + 1),
		parent()
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
	// The profile role, not the active role: RLS's delete policy checks profiles.role.
	const canModerate = profile?.role === 'admin' || profile?.role === 'teacher';

	if (postsResult.error) {
		console.error(`Could not load board posts. ${postsResult.error.message}`);
		return {
			canPost,
			canModerate,
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

	// The names and (story 4) the posts' files, one query each. A files
	// error is logged there; the posts then show without files.
	const [namesResult, filesResult] = await Promise.all([
		authorIds.length > 0
			? supabase.rpc('board_author_names', { p_ids: authorIds })
			: Promise.resolve(null),
		loadBoardFiles(
			supabase,
			rows.map((row) => row.id)
		)
	]);

	const names = new Map<string, string>();
	if (namesResult) {
		if (namesResult.error) {
			console.error(`Could not load board author names. ${namesResult.error.message}`);
		}
		for (const row of namesResult.data ?? []) {
			if (row.display_name) names.set(row.id, row.display_name);
		}
	}

	const posts: BoardPost[] = rows.map((row) => ({
		id: row.id,
		authorName: (row.author_id && names.get(row.author_id)) || m.board_former_member(),
		content: readContent(row.content),
		contentLanguage: readContentLanguage(row.content_language),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		mine: row.author_id === user.id,
		files: filesResult.files.get(row.id) ?? []
	}));

	const olderBefore =
		fetched.length > BOARD_PAGE_SIZE ? (rows[rows.length - 1]?.created_at ?? null) : null;

	// `paged`: an older page (a valid `before`), which links back to the newest posts.
	return { canPost, canModerate, posts, olderBefore, paged: before !== null, loadError: false };
};

/**
 * The post body and its language, checked the same way for a new post and
 * an edit (story 5): a 400 with a localized message when either is not valid.
 */
function readBody(
	formData: FormData
):
	| { ok: true; content: RichTextDoc; language: ContentLanguage }
	| { ok: false; refused: ActionFailure<{ error: string }> } {
	const content = parseContent(formData.get('content'));
	if (!content.ok) {
		return {
			ok: false,
			refused: fail(400, {
				error:
					content.reason === 'required'
						? m.board_error_content_required()
						: content.reason === 'too_large'
							? m.board_error_content_too_large()
							: m.board_error_content_invalid()
			})
		};
	}
	const language = formData.get('contentLanguage');
	if (!isContentLanguage(language)) {
		return { ok: false, refused: fail(400, { error: m.board_error_content_language() }) };
	}
	return { ok: true, content: content.value, language };
}

/** A form without files (edit, delete): the body and its fields, read with a size cap. */
const MAX_TEXT_FORM_BYTES = MAX_CONTENT_BYTES + FORM_OVERHEAD_BYTES;

/** Reads an edit or delete form up to MAX_TEXT_FORM_BYTES: over it 413, not a form 400. */
function readTextForm(request: Request, broken: () => string) {
	return readFileForm(request, MAX_TEXT_FORM_BYTES, {
		tooLarge: () => fail(413, { error: m.board_error_content_too_large() }),
		broken: () => fail(400, { error: broken() })
	});
}

export const actions: Actions = {
	post: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.board_error_not_signed_in() });
		}

		// Story 4: the form may carry up to 2 PDF files, so it is read with a size cap.
		const form = await readPostForm(request);
		if ('refused' in form) return form.refused;
		const { formData } = form;
		const body = readBody(formData);
		if (!body.ok) return body.refused;
		const { content, language } = body;

		// Story 4: the files are checked before anything is stored. A refused
		// file inserts no post; the message is shown at the file field too.
		const files = await readPostFiles(formData);
		if (!files.ok) {
			return fail(400, { error: files.message, fileError: files.message });
		}

		// The author is always the signed-in user, never a posted field.
		const { data: inserted, error: insertError } = await supabase
			.from('board_posts')
			.insert({ author_id: user.id, content, content_language: language })
			.select('id')
			.single();

		if (insertError || !inserted) {
			if (insertError?.code === INSUFFICIENT_PRIVILEGE) {
				return fail(403, { error: m.board_error_not_allowed() });
			}
			console.error(`Could not insert a board post. ${insertError?.message ?? 'no row'}`);
			return fail(500, { error: m.board_error_post_failed() });
		}

		// The post stays whatever happens to its files; the page names the
		// ones that were not attached.
		const notAttached =
			files.files.length > 0 ? await attachPostFiles(supabase, user, inserted.id, files.files) : [];

		return { posted: true, notAttached };
	},

	/**
	 * Story 5 (CAP-3): the author changes the body and its language in place.
	 * RLS lets only the author, while still a poster, update the row; files
	 * are not touched.
	 */
	edit: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.board_error_not_signed_in() });
		}
		const form = await readTextForm(request, m.board_edit_error_failed);
		if ('refused' in form) return form.refused;
		const { formData } = form;
		const postId = formData.get('postId');
		if (!isUuid(postId)) {
			return fail(400, { error: m.board_edit_error_invalid() });
		}
		const body = readBody(formData);
		if (!body.ok) return body.refused;

		const { data, error: updateError } = await supabase
			.from('board_posts')
			.update({
				content: body.content,
				content_language: body.language,
				updated_at: new Date().toISOString()
			})
			.eq('id', postId)
			// Defense in depth: only the author's own post, whatever RLS allows.
			.eq('author_id', user.id)
			.select('id');

		if (updateError?.code === INSUFFICIENT_PRIVILEGE || (!updateError && !data?.length)) {
			return fail(403, { error: m.board_edit_error_not_allowed() });
		}
		if (updateError) {
			console.error(`Could not edit board post ${postId}. ${updateError.message}`);
			return fail(500, { error: m.board_edit_error_failed() });
		}
		return { edited: postId };
	},

	/**
	 * Story 5 (CAP-3): the author, an admin or a teacher deletes a post. Its
	 * stored files go first: the post is deleted only once every object is
	 * confirmed gone (the file rows then cascade), so no object is orphaned.
	 */
	delete: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.board_error_not_signed_in() });
		}
		const form = await readTextForm(request, m.board_delete_error_failed);
		if ('refused' in form) return form.refused;
		const { formData } = form;
		const postId = formData.get('postId');
		if (!isUuid(postId)) {
			return fail(400, { error: m.board_delete_error_invalid() });
		}

		// Checked before storage: the bucket's policy silently skips objects the
		// caller may not remove, which would read as a failed removal (500).
		// Actions have no parent(): the profile role (as RLS checks it) is read
		// only when the caller is not the author.
		const { data: target, error: readError } = await supabase
			.from('board_posts')
			.select('author_id')
			.eq('id', postId)
			.maybeSingle();
		if (readError) {
			console.error(`Could not read board post ${postId}. ${readError.message}`);
			return fail(500, { error: m.board_delete_error_failed() });
		}
		if (!target) return fail(403, { error: m.board_delete_error_not_allowed() });
		if (target.author_id !== user.id) {
			const { data: profile, error: profileError } = await supabase
				.from('profiles')
				.select('role')
				.eq('id', user.id)
				.maybeSingle();
			if (profileError) {
				console.error(`Could not read the profile role. ${profileError.message}`);
				return fail(500, { error: m.board_delete_error_failed() });
			}
			if (profile?.role !== 'admin' && profile?.role !== 'teacher') {
				return fail(403, { error: m.board_delete_error_not_allowed() });
			}
		}

		if (!(await removePostObjects(supabase, postId))) {
			return fail(500, { error: m.board_delete_error_files() });
		}

		const { data, error: deleteError } = await supabase
			.from('board_posts')
			.delete()
			.eq('id', postId)
			.select('id');

		if (deleteError?.code === INSUFFICIENT_PRIVILEGE || (!deleteError && !data?.length)) {
			return fail(403, { error: m.board_delete_error_not_allowed() });
		}
		if (deleteError) {
			console.error(`Could not delete board post ${postId}. ${deleteError.message}`);
			return fail(500, { error: m.board_delete_error_failed() });
		}
		return { deleted: postId };
	}
};
