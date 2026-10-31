import { fail } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as m from '$lib/paraglide/messages.js';
import { MAX_CONTENT_BYTES } from '$lib/rich-text';
import type { Database } from '$lib/supabase/database.types';
import {
	MAX_BOARD_IMAGE_BYTES,
	MAX_IMAGES_PER_POST,
	boardImageLimitMessage,
	boardImagePostTooLargeMessage,
	boardImageTooLargeMessage,
	boardImageTypeMessage,
	type BoardFile,
	type BoardImage
} from '$lib/board-files';
import {
	FORM_OVERHEAD_BYTES,
	MAX_FILE_NAME_LENGTH,
	isUuid,
	readFileForm,
	removeObjects,
	removeOrLog,
	signObject,
	type PdfStore
} from './pdf-files';

/**
 * The image on a board post (spec-parent-message-board story 8, CAP-2,
 * 0064_board_images.sql; story 4 had up to 2 PDFs). Every call uses the
 * caller's own Supabase client, so the table's and the bucket's policies
 * decide: the post's author, while a poster, adds the image; every board
 * reader reads it.
 *
 * An image is a row in board_post_files plus an object in the private
 * bucket `board-files`, stored as `<post_id>/<random uuid>.(jpg|png|webp)`.
 * The original name lives in the row only. Rows from before story 8 may be
 * PDFs (`.pdf`); they are still listed, removed and opened through
 * /files/board/[fileId].
 */

type Client = SupabaseClient<Database>;

export const BOARD_FILES_BUCKET = 'board-files';
const STORE: PdfStore = { bucket: BOARD_FILES_BUCKET, label: 'board file' };
/** SQLSTATE of the database's own "at most 1 file" check (0064). */
export const BOARD_FILE_LIMIT_ERROR_CODE = 'BF001';

/** The post form: one image, the rich-text body and the other fields. */
export const MAX_BOARD_POST_BYTES =
	MAX_IMAGES_PER_POST * MAX_BOARD_IMAGE_BYTES + MAX_CONTENT_BYTES + 2 * FORM_OVERHEAD_BYTES;

export type BoardImageKind = 'jpg' | 'png' | 'webp';
export type ImageUpload = {
	name: string;
	bytes: ArrayBuffer;
	kind: BoardImageKind;
	contentType: string;
};

const CONTENT_TYPES: Record<BoardImageKind, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
};

const IMAGE_PATH = /\.(jpg|png|webp)$/;

/**
 * The image's type from its first bytes, whatever its name or declared type
 * say: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF????WEBP`.
 */
export function detectImageKind(bytes: ArrayBuffer): BoardImageKind | null {
	const head = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
	const starts = (sig: number[], at = 0) =>
		head.length >= at + sig.length && sig.every((byte, i) => head[at + i] === byte);
	if (starts([0xff, 0xd8, 0xff])) return 'jpg';
	if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
	if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
	return null;
}

/** The chosen name without any folder or control characters, for messages. */
function chosenName(entry: Blob): string {
	return entry instanceof File && typeof entry.name === 'string'
		? (entry.name
				.split(/[\\/]/)
				.pop()
				?.replace(/\p{Cc}/gu, '')
				.trim() ?? '')
		: '';
}

/**
 * The name stored in the row: the chosen one, at most 200 characters, its
 * extension replaced by (or given) the detected type's, or `image.<ext>`.
 */
function imageName(entry: Blob, kind: BoardImageKind): string {
	const suffix = `.${kind}`;
	const stem = [...chosenName(entry).replace(/\.(jpe?g|png|webp|gif|pdf)$/i, '')]
		.slice(0, MAX_FILE_NAME_LENGTH - suffix.length)
		.join('')
		.trim();
	return `${stem || 'image'}${suffix}`;
}

/**
 * Reads the post form up to MAX_BOARD_POST_BYTES: over it 413 (naming the
 * limits), a body that is not a form 400.
 */
export function readPostForm(request: Request) {
	return readFileForm(request, MAX_BOARD_POST_BYTES, {
		tooLarge: () =>
			fail(413, {
				error: boardImagePostTooLargeMessage(),
				fileError: boardImagePostTooLargeMessage()
			}),
		broken: () => fail(400, { error: m.board_error_post_failed() })
	});
}

/**
 * The post form's image (`image`), checked before the post is inserted: at
 * most 1, a JPEG, PNG or WebP (by its bytes) of at most 5 MB. An empty file
 * input sends an empty, unnamed file, which does not count.
 */
export async function readPostImage(
	formData: FormData
): Promise<{ ok: true; image: ImageUpload | null } | { ok: false; message: string }> {
	const chosen = formData
		.getAll('image')
		.filter((entry): entry is File => entry instanceof Blob && entry.size > 0);
	if (chosen.length > MAX_IMAGES_PER_POST) {
		return { ok: false, message: boardImageLimitMessage() };
	}
	const entry = chosen[0];
	if (!entry) return { ok: true, image: null };
	if (entry.size > MAX_BOARD_IMAGE_BYTES) {
		return { ok: false, message: boardImageTooLargeMessage() };
	}
	const bytes = await entry.arrayBuffer();
	const kind = detectImageKind(bytes);
	if (!kind) return { ok: false, message: boardImageTypeMessage() };
	return {
		ok: true,
		image: { name: imageName(entry, kind), bytes, kind, contentType: CONTENT_TYPES[kind] }
	};
}

/**
 * Stores the checked image under a new random name in the post's folder,
 * with the detected type (never the one sent); the object's path, or null
 * when storage refuses it.
 */
async function storeBoardImage(
	supabase: Client,
	postId: string,
	image: ImageUpload
): Promise<string | null> {
	const path = `${postId}/${crypto.randomUUID()}.${image.kind}`.toLowerCase();
	const { error } = await supabase.storage
		.from(BOARD_FILES_BUCKET)
		.upload(path, image.bytes, { contentType: image.contentType, upsert: false });
	if (error) {
		console.error(`board image upload failed: ${error.message}`);
		return null;
	}
	return path;
}

/**
 * Attaches the checked image to a post that was just inserted, and records
 * it; if the row cannot be written the object is removed again. The post
 * stays whatever happens here: the image's name is returned when it could
 * not be attached, for the page's warning.
 */
export async function attachPostImage(
	supabase: Client,
	user: App.SessionUser,
	postId: string,
	image: ImageUpload
): Promise<string[]> {
	const path = await storeBoardImage(supabase, postId, image);
	if (!path) {
		console.error(`board post ${postId}: image not attached (failed)`);
		return [image.name];
	}

	const { data, error } = await supabase
		.from('board_post_files')
		.insert({
			post_id: postId,
			object_path: path,
			file_name: image.name,
			size_bytes: image.bytes.byteLength,
			created_by: user.id
		})
		.select('id');

	if (error || !data || data.length === 0) {
		// No row, so no object either.
		await removeOrLog(supabase, STORE, path);
		const reason = error?.code === BOARD_FILE_LIMIT_ERROR_CODE ? 'limit' : 'failed';
		console.error(`board post ${postId}: image not attached (${reason})`);
		return [image.name];
	}
	return [];
}

/**
 * The image (and any legacy PDF files) of each post in `postIds` that the
 * caller may read, in one query. Nothing is signed here: the page shows an
 * image through /files/board/[fileId], which signs a fresh link on every
 * request, so a page left open never holds an expired link. A post without
 * an image has no entry in `images`. `error` is true (and logged) when the
 * rows could not be read.
 */
export async function loadBoardFiles(
	supabase: Client,
	postIds: string[]
): Promise<{ images: Map<string, BoardImage>; files: Map<string, BoardFile[]>; error: boolean }> {
	const images = new Map<string, BoardImage>();
	const files = new Map<string, BoardFile[]>();
	const ids = Array.from(new Set(postIds.filter(isUuid)));
	if (ids.length === 0) return { images, files, error: false };
	const { data, error } = await supabase
		.from('board_post_files')
		.select('id, post_id, object_path, file_name, size_bytes')
		.in('post_id', ids)
		.order('created_at', { ascending: true })
		.order('id', { ascending: true });
	if (error) {
		console.error(`board files could not be read: ${error.message}`);
		return { images, files, error: true };
	}

	for (const row of data ?? []) {
		if (IMAGE_PATH.test(row.object_path)) {
			// One image per post; a second row cannot exist (BF001).
			if (!images.has(row.post_id)) images.set(row.post_id, { id: row.id, name: row.file_name });
			continue;
		}
		const list = files.get(row.post_id) ?? [];
		list.push({ id: row.id, name: row.file_name, size: row.size_bytes });
		files.set(row.post_id, list);
	}
	return { images, files, error: false };
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
 * under its original name instead of showing it. Works for any row: images
 * and legacy PDFs.
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
