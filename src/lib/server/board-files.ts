import { fail } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as m from '$lib/paraglide/messages.js';
import { MAX_CONTENT_BYTES } from '$lib/rich-text';
import type { Database } from '$lib/supabase/database.types';
import {
	MAX_BOARD_FILE_BYTES,
	MAX_FILES_PER_POST,
	boardFileLimitMessage,
	boardFilePostTooLargeMessage,
	boardFileTooLargeMessage,
	type BoardFile
} from '$lib/board-files';
import {
	FORM_OVERHEAD_BYTES,
	isUuid,
	readFileForm,
	readPdfUpload,
	removeObjects,
	removeOrLog,
	signObject,
	storeObject,
	type PdfStore,
	type PdfUpload,
	type UploadProblem
} from './pdf-files';

/**
 * PDF files on a board post (spec-parent-message-board story 4, CAP-2,
 * 0061_message_board.sql). Every call uses the caller's own Supabase
 * client, so the table's and the bucket's policies decide: the post's
 * author, while a poster, adds files; every board reader reads them.
 *
 * A file is a row in board_post_files plus an object in the private bucket
 * `board-files`, stored as `<post_id>/<random uuid>.pdf`. The original name
 * lives in the row only. The steps are the homework create form's
 * (homework-files.ts), on the shared pdf-files.ts helpers.
 */

type Client = SupabaseClient<Database>;

export const BOARD_FILES_BUCKET = 'board-files';
const STORE: PdfStore = { bucket: BOARD_FILES_BUCKET, label: 'board file' };
/** SQLSTATE of the database's own "at most 2 files" check (0061). */
export const BOARD_FILE_LIMIT_ERROR_CODE = 'BF001';

/** The post form: up to 2 files, the rich-text body and the other fields. */
export const MAX_BOARD_POST_BYTES =
	MAX_FILES_PER_POST * MAX_BOARD_FILE_BYTES + MAX_CONTENT_BYTES + 2 * FORM_OVERHEAD_BYTES;

const problemMessages: Record<UploadProblem, () => string> = {
	missing: m.homework_file_error_missing,
	size: boardFileTooLargeMessage,
	type: m.homework_file_error_not_pdf
};

/**
 * Reads the post form up to MAX_BOARD_POST_BYTES: over it 413 (too many or
 * too large files in all), a body that is not a form 400.
 */
export function readPostForm(request: Request) {
	return readFileForm(request, MAX_BOARD_POST_BYTES, {
		tooLarge: () =>
			fail(413, {
				error: boardFilePostTooLargeMessage(),
				fileError: boardFilePostTooLargeMessage()
			}),
		broken: () => fail(400, { error: m.board_error_post_failed() })
	});
}

/**
 * The post form's files (`files`), checked before the post is inserted: at
 * most 2, each a PDF of at most 5 MB. An empty file input sends an empty,
 * unnamed file, which does not count. The message names the refused file.
 */
export async function readPostFiles(
	formData: FormData
): Promise<{ ok: true; files: PdfUpload[] } | { ok: false; message: string }> {
	const chosen = formData
		.getAll('files')
		.filter((entry): entry is File => entry instanceof Blob && entry.size > 0);
	if (chosen.length > MAX_FILES_PER_POST) {
		return { ok: false, message: boardFileLimitMessage() };
	}
	const files: PdfUpload[] = [];
	for (const entry of chosen) {
		const upload = await readPdfUpload(entry, MAX_BOARD_FILE_BYTES);
		if (!upload.ok) {
			// The name as chosen (not cleanFileName, which would add `.pdf` to a
			// Word file), without any folder or control characters.
			const name =
				typeof entry.name === 'string'
					? (entry.name
							.split(/[\\/]/)
							.pop()
							?.replace(/\p{Cc}/gu, '')
							.trim() ?? '')
					: '';
			const message = problemMessages[upload.problem]();
			return {
				ok: false,
				message: name ? m.homework_file_error_named({ name, message }) : message
			};
		}
		files.push(upload.value);
	}
	return { ok: true, files };
}

/**
 * Stores one checked PDF for the post and records it. If the row cannot be
 * written the object is removed again. 'limit': the database's BF001.
 */
async function attachOne(
	supabase: Client,
	user: App.SessionUser,
	postId: string,
	upload: PdfUpload
): Promise<{ ok: true; id: string } | { ok: false; reason: 'limit' | 'failed' }> {
	const path = await storeObject(supabase, STORE, postId, upload.bytes);
	if (!path) return { ok: false, reason: 'failed' };

	const { data, error } = await supabase
		.from('board_post_files')
		.insert({
			post_id: postId,
			object_path: path,
			file_name: upload.name,
			size_bytes: upload.bytes.byteLength,
			created_by: user.id
		})
		.select('id');

	if (error || !data || data.length === 0) {
		// No row, so no object either.
		await removeOrLog(supabase, STORE, path);
		return {
			ok: false,
			reason: error?.code === BOARD_FILE_LIMIT_ERROR_CODE ? 'limit' : 'failed'
		};
	}
	return { ok: true, id: data[0].id };
}

/**
 * Attaches checked files to a post that was just inserted. The post stays
 * whatever happens here; the names of the files that could not be attached
 * are returned, for the page's warning.
 */
export async function attachPostFiles(
	supabase: Client,
	user: App.SessionUser,
	postId: string,
	files: PdfUpload[]
): Promise<string[]> {
	const notAttached: string[] = [];
	for (const file of files) {
		const attached = await attachOne(supabase, user, postId, file);
		if (!attached.ok) {
			console.error(`board post ${postId}: file not attached (${attached.reason})`);
			notAttached.push(file.name);
		}
	}
	return notAttached;
}

/**
 * The files of each post in `postIds` that the caller may read, oldest
 * first, in one query. A post without files has no entry. `error` is true
 * (and logged) when they could not be read.
 */
export async function loadBoardFiles(
	supabase: Client,
	postIds: string[]
): Promise<{ files: Map<string, BoardFile[]>; error: boolean }> {
	const files = new Map<string, BoardFile[]>();
	const ids = Array.from(new Set(postIds.filter(isUuid)));
	if (ids.length === 0) return { files, error: false };
	const { data, error } = await supabase
		.from('board_post_files')
		.select('id, post_id, file_name, size_bytes')
		.in('post_id', ids)
		.order('created_at', { ascending: true })
		.order('id', { ascending: true });
	if (error) {
		console.error(`board files could not be read: ${error.message}`);
		return { files, error: true };
	}
	for (const row of data ?? []) {
		const list = files.get(row.post_id) ?? [];
		list.push({ id: row.id, name: row.file_name, size: row.size_bytes });
		files.set(row.post_id, list);
	}
	return { files, error: false };
}

/**
 * Story 5 (CAP-3): removes the stored objects of a post's files, before the
 * post is deleted (stored objects cannot be deleted from SQL, and the file
 * rows cascade with the post). True only when every object is confirmed
 * gone, or the post has no files; false (logged) when the rows cannot be
 * read or storage does not confirm a removal, so the post is kept and no
 * object is left without its row. The bucket's delete policy decides: the
 * post's author, an admin or a teacher.
 */
export async function removePostObjects(supabase: Client, postId: string): Promise<boolean> {
	if (!isUuid(postId)) return false;
	const { data, error } = await supabase
		.from('board_post_files')
		.select('object_path')
		.eq('post_id', postId);
	if (error) {
		console.error(`board post ${postId}: files could not be read: ${error.message}`);
		return false;
	}
	const paths = (data ?? []).map((row) => row.object_path);
	if (paths.length === 0) return true;
	if (!(await removeObjects(supabase, STORE, paths))) {
		console.error(`board post ${postId}: files not removed`);
		return false;
	}
	return true;
}

/**
 * A link to the stored file that works for about a minute, for a caller
 * who may read the file's row (row level security: every board reader).
 * 'notFound' for everyone else, an unknown id or no uuid; 'failed' when the
 * row cannot be read or storage refuses to sign. `download` saves the file
 * under its original name instead of showing it.
 */
export async function signedBoardFileUrl(
	supabase: Client,
	fileId: string,
	download: boolean
): Promise<{ url: string } | { problem: 'notFound' | 'failed' }> {
	if (!isUuid(fileId)) return { problem: 'notFound' };
	const { data: file, error } = await supabase
		.from('board_post_files')
		.select('object_path, file_name')
		.eq('id', fileId)
		.maybeSingle();
	if (error) {
		console.error(`board file could not be read: ${error.message}`);
		return { problem: 'failed' };
	}
	if (!file) return { problem: 'notFound' };
	const url = await signObject(supabase, STORE, file.object_path, file.file_name, download);
	if (!url) {
		console.error(`board file could not be signed: ${fileId}`);
		return { problem: 'failed' };
	}
	return { url };
}
