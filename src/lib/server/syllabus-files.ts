import { fail } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import * as m from '$lib/paraglide/messages.js';
import type { Database } from '$lib/supabase/database.types';
import {
	MAX_FILE_BYTES,
	MAX_FILES_PER_SECTION,
	fileLimitMessage,
	fileTooLargeMessage
} from '$lib/syllabus-files';

/**
 * PDF files attached to a syllabus section (0039_syllabus_section_files.sql).
 * Shared by the teacher and admin syllabus routes; every call uses the
 * caller's own Supabase client, so the table's and the bucket's policies
 * decide who may upload, replace, remove or read.
 *
 * A file is a row in class_syllabus_section_files plus an object in the
 * private bucket, stored as `<class_id>/<section_id>/<random uuid>.pdf`. The
 * original name lives in the row only. Objects cannot be deleted from SQL,
 * so whatever deletes rows (a file, its section, syllabus or class) removes
 * the objects here first: see `removeStoredFiles`.
 */

type Client = SupabaseClient<Database>;

export const SYLLABUS_FILES_BUCKET = 'syllabus-files';
/** How long a link made by `signedFileUrl` works. */
export const SIGNED_URL_SECONDS = 60;
/** SQLSTATE of the database's own "at most 5 files" check (0039). */
export const FILE_LIMIT_ERROR_CODE = 'SF001';
export const MAX_FILE_NAME_LENGTH = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `%PDF-`: how every PDF file starts. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
/** A multipart post is a little larger than the file it carries. */
const FORM_OVERHEAD_BYTES = 64 * 1024;
/** Objects per Storage API call, and rows per page, when removing. */
const REMOVE_BATCH = 100;

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID.test(value);
}

/**
 * The name shown and downloaded for an uploaded file: its own name without
 * any folder or control characters, at most 200 characters, ending in
 * `.pdf`. Never used as the storage path.
 */
export function cleanFileName(raw: string): string {
	const base = (raw.split(/[\\/]/).pop() ?? '').replace(/\p{Cc}/gu, '').trim();
	const stem = [...base.replace(/\.pdf$/i, '')]
		.slice(0, MAX_FILE_NAME_LENGTH - 4)
		.join('')
		.trim();
	return `${stem || 'document'}.pdf`;
}

export type UploadProblem = 'missing' | 'size' | 'type';
export type PdfUpload = { name: string; bytes: ArrayBuffer };

/**
 * Reads the posted `file` field. Accepts it only when it is at most 1 MB and
 * its content starts with `%PDF-`, whatever its name or declared type say.
 */
export async function readPdfUpload(
	entry: FormDataEntryValue | null
): Promise<{ ok: true; value: PdfUpload } | { ok: false; problem: UploadProblem }> {
	// A form posted with no file chosen sends an empty, unnamed file.
	if (!(entry instanceof Blob) || entry.size === 0) return { ok: false, problem: 'missing' };
	if (entry.size > MAX_FILE_BYTES) return { ok: false, problem: 'size' };
	const bytes = await entry.arrayBuffer();
	const head = new Uint8Array(bytes, 0, Math.min(PDF_MAGIC.length, bytes.byteLength));
	if (head.length < PDF_MAGIC.length || PDF_MAGIC.some((byte, i) => head[i] !== byte)) {
		return { ok: false, problem: 'type' };
	}
	const name = entry instanceof File ? entry.name : '';
	return { ok: true, value: { name: cleanFileName(name), bytes } };
}

const problemMessages = {
	missing: m.syllabus_file_error_missing,
	size: fileTooLargeMessage,
	type: m.syllabus_file_error_not_pdf
};

export type FileActionContext = {
	request: Request;
	classId: string;
	syllabusId: string;
	supabase: Client;
	user: User | null;
};

/** Wrong class, section or file, or no permission: one answer for all. */
const fileFailed = () => fail(400, { error: m.syllabus_error_failed() });

/** A problem with the chosen file, shown under the field it was chosen in. */
const fileProblem = (message: string, sectionId: string, fileId: string | null) =>
	fail(400, { fileError: message, fileSectionId: sectionId, fileId });

/** The largest post the file forms can honestly send: one file plus the form around it. */
const MAX_POST_BYTES = MAX_FILE_BYTES + FORM_OVERHEAD_BYTES;

const postTooLarge = () => fail(413, { error: fileTooLargeMessage() });

/**
 * Reads a file form without ever holding more than one acceptable post in
 * memory, and returns its fields or the refusal to answer with.
 *
 * - A post that says it is over the limit (`Content-Length`) is refused at
 *   once. Its body is read and thrown away piece by piece, because an unread
 *   body makes some servers drop the connection instead of delivering the
 *   answer; its length is known, so that ends.
 * - Any other post -- also one without a usable `Content-Length`, which a
 *   host in front of the app may not pass on -- is read up to the limit. One
 *   byte more and it is refused there, without reading the rest.
 */
async function readFileForm(
	request: Request
): Promise<{ formData: FormData } | { refused: ReturnType<typeof postTooLarge> }> {
	const header = request.headers.get('content-length')?.trim() ?? '';
	const reader = request.body?.getReader();
	if (/^\d+$/.test(header) && Number(header) > MAX_POST_BYTES) {
		try {
			while (reader && !(await reader.read()).done);
		} catch {
			// The sender gave up: nothing left to read.
		}
		return { refused: postTooLarge() };
	}

	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const next = reader ? await reader.read() : { done: true as const, value: undefined };
			if (next.done) break;
			size += next.value.byteLength;
			if (size > MAX_POST_BYTES) {
				await reader?.cancel().catch(() => {});
				return { refused: postTooLarge() };
			}
			chunks.push(next.value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		// The same form, from the bytes that were read.
		const formData = await new Response(bytes, {
			headers: { 'content-type': request.headers.get('content-type') ?? '' }
		}).formData();
		return { formData };
	} catch {
		// Not a form, or the post broke off.
		return { refused: fail(400, { error: m.syllabus_file_error_failed() }) };
	}
}

type StoredFile = { id: string; object_path: string };

/**
 * The section's files, when the section is in the syllabus, the syllabus in
 * the route's class and the caller may read them; null otherwise. Every file
 * action starts here, so an id from another class changes nothing.
 */
async function sectionFiles(
	supabase: Client,
	classId: string,
	syllabusId: string,
	sectionId: string
): Promise<StoredFile[] | null> {
	if (!isUuid(classId) || !isUuid(syllabusId) || !isUuid(sectionId)) return null;
	const { data, error } = await supabase
		.from('class_syllabus_sections')
		.select('id, class_syllabi!inner(class_id), class_syllabus_section_files(id, object_path)')
		.eq('id', sectionId)
		.eq('syllabus_id', syllabusId)
		.eq('class_syllabi.class_id', classId)
		.maybeSingle();
	if (error || !data) return null;
	return data.class_syllabus_section_files ?? [];
}

/** Stores the PDF under a new random name in the section's folder; null when storage refuses it. */
async function storeObject(
	supabase: Client,
	classId: string,
	sectionId: string,
	bytes: ArrayBuffer
): Promise<string | null> {
	const path = `${classId}/${sectionId}/${crypto.randomUUID()}.pdf`.toLowerCase();
	// The bytes, not the posted File: the declared type is then ours, since
	// the content was checked to be a PDF whatever the browser called it.
	const { error } = await supabase.storage
		.from(SYLLABUS_FILES_BUCKET)
		.upload(path, bytes, { contentType: 'application/pdf', upsert: false });
	if (error) {
		console.error(`syllabus file upload failed: ${error.message}`);
		return null;
	}
	return path;
}

/**
 * True only when storage says the object is not there. The client answers
 * that with `data: false` and a 400 / 404 error, and throws for any other
 * failure (network, 5xx): those count as "still there".
 */
async function isGone(supabase: Client, path: string): Promise<boolean> {
	try {
		const { data, error } = await supabase.storage.from(SYLLABUS_FILES_BUCKET).exists(path);
		if (data !== false) return false;
		if (!error) return true;
		const e = error as { status?: number; originalError?: { status?: number } };
		const status = e.status ?? e.originalError?.status;
		return status === 400 || status === 404;
	} catch {
		return false;
	}
}

/** For an object the app could not remove after a failed step: names it in the server log. */
async function removeOrLog(supabase: Client, path: string) {
	if (!(await removeObjects(supabase, [path]))) {
		console.error(`syllabus file left behind in the bucket: ${path}`);
	}
}

/**
 * Removes objects from the bucket. True only when none of them is left:
 * the Storage API answers a refused removal with "nothing removed" rather
 * than an error, so objects it did not report are looked up again.
 */
export async function removeObjects(supabase: Client, paths: string[]): Promise<boolean> {
	const bucket = supabase.storage.from(SYLLABUS_FILES_BUCKET);
	for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
		const batch = paths.slice(i, i + REMOVE_BATCH);
		const { data, error } = await bucket.remove(batch);
		if (error) {
			console.error(`syllabus file removal failed: ${error.message}`);
			return false;
		}
		const removed = new Set((data ?? []).map((object) => object.name));
		for (const path of batch) {
			if (removed.has(path)) continue;
			// Not reported: already gone (fine) or not removed (not fine). Only
			// a clear "not there" counts as gone; a lookup that fails does not.
			if (!(await isGone(supabase, path))) {
				console.error(`syllabus file not removed: ${path}`);
				return false;
			}
		}
	}
	return true;
}

/**
 * Removes the stored objects, and then the rows, of every file in a section,
 * a syllabus or a class. Call it before deleting that section, syllabus or
 * class: the delete cascades to the rows but cannot reach the bucket. The
 * scope names its parents, so a section of another syllabus or class matches
 * nothing. `ok` is false when something could not be removed; the caller
 * then refuses its delete. `removed` counts the files that are gone, also
 * when it stopped half way, so the caller can say so if its own delete fails.
 */
export async function removeStoredFiles(
	supabase: Client,
	scope: { classId: string; syllabusId?: string; sectionId?: string }
): Promise<{ ok: boolean; removed: number }> {
	let removed = 0;
	// An id that is no id matches no file: nothing to remove.
	if (
		![scope.classId, scope.syllabusId ?? scope.classId, scope.sectionId ?? scope.classId].every(
			isUuid
		)
	) {
		return { ok: true, removed };
	}
	// Each round removes what it read, so the next one reads the rest.
	for (let round = 0; round < 1000; round += 1) {
		let query = supabase
			.from('class_syllabus_section_files')
			.select('id, object_path, class_syllabus_sections!inner(id, class_syllabi!inner(id))')
			.eq('class_syllabus_sections.class_syllabi.class_id', scope.classId);
		if (scope.syllabusId) query = query.eq('class_syllabus_sections.syllabus_id', scope.syllabusId);
		if (scope.sectionId) query = query.eq('section_id', scope.sectionId);
		const { data, error } = await query.limit(REMOVE_BATCH);
		if (error) {
			console.error(`syllabus files could not be listed: ${error.message}`);
			return { ok: false, removed };
		}
		if (!data || data.length === 0) return { ok: true, removed };

		if (
			!(await removeObjects(
				supabase,
				data.map((file) => file.object_path)
			))
		) {
			return { ok: false, removed };
		}
		const ids = data.map((file) => file.id);
		const { data: deleted, error: deleteError } = await supabase
			.from('class_syllabus_section_files')
			.delete()
			.in('id', ids)
			.select('id');
		// Fewer rows than read (row level security refused): stop, or the
		// next round would read the same rows for ever.
		removed += (deleted ?? []).length;
		if (deleteError || (deleted ?? []).length !== ids.length) return { ok: false, removed };
	}
	return { ok: false, removed };
}

/** Adds the posted PDF (`file`) to the section `sectionId`. */
export async function uploadFile({
	request,
	classId,
	syllabusId,
	supabase,
	user
}: FileActionContext) {
	if (!user) return fail(401, { error: m.syllabus_error_failed() });
	const form = await readFileForm(request);
	if ('refused' in form) return form.refused;
	const { formData } = form;
	const sectionId = String(formData.get('sectionId') ?? '');
	const upload = await readPdfUpload(formData.get('file'));

	const existing = await sectionFiles(supabase, classId, syllabusId, sectionId);
	if (!existing) return fileFailed();
	if (!upload.ok) return fileProblem(problemMessages[upload.problem](), sectionId, null);
	if (existing.length >= MAX_FILES_PER_SECTION) {
		return fileProblem(fileLimitMessage(), sectionId, null);
	}

	const path = await storeObject(supabase, classId, sectionId, upload.value.bytes);
	if (!path) return fail(400, { error: m.syllabus_file_error_failed() });

	const { data, error } = await supabase
		.from('class_syllabus_section_files')
		.insert({
			section_id: sectionId,
			object_path: path,
			file_name: upload.value.name,
			size_bytes: upload.value.bytes.byteLength,
			created_by: user.id
		})
		.select('id');

	if (error || !data || data.length === 0) {
		// No row, so no object either.
		await removeOrLog(supabase, path);
		return error?.code === FILE_LIMIT_ERROR_CODE
			? fileProblem(fileLimitMessage(), sectionId, null)
			: fail(400, { error: m.syllabus_file_error_failed() });
	}

	return { success: true, action: 'fileUploaded' as const, fileSectionId: sectionId };
}

/**
 * Puts the posted PDF in the place of the file `fileId`: same row, so the
 * same place in the list, with the new name and size. The old object is
 * removed once the row points at the new one; an invalid file changes
 * nothing.
 */
export async function replaceFile({
	request,
	classId,
	syllabusId,
	supabase,
	user
}: FileActionContext) {
	if (!user) return fail(401, { error: m.syllabus_error_failed() });
	const form = await readFileForm(request);
	if ('refused' in form) return form.refused;
	const { formData } = form;
	const sectionId = String(formData.get('sectionId') ?? '');
	const fileId = String(formData.get('fileId') ?? '');
	const upload = await readPdfUpload(formData.get('file'));

	const existing = await sectionFiles(supabase, classId, syllabusId, sectionId);
	const old = existing?.find((file) => file.id === fileId);
	if (!old) return fileFailed();
	if (!upload.ok) return fileProblem(problemMessages[upload.problem](), sectionId, fileId);

	const path = await storeObject(supabase, classId, sectionId, upload.value.bytes);
	if (!path) return fail(400, { error: m.syllabus_file_error_failed() });

	// .select() + row check: RLS turns a forbidden update into zero rows.
	const { data, error } = await supabase
		.from('class_syllabus_section_files')
		.update({
			object_path: path,
			file_name: upload.value.name,
			size_bytes: upload.value.bytes.byteLength,
			updated_at: new Date().toISOString()
		})
		.eq('id', fileId)
		.eq('section_id', sectionId)
		// Still the object that was read: of two replaces at once (or a
		// replace and a remove), the later one changes no row.
		.eq('object_path', old.object_path)
		.select('id');

	if (error || !data || data.length === 0) {
		// The old file stays; the new object has no row and goes again.
		await removeOrLog(supabase, path);
		return fail(400, { error: m.syllabus_file_error_failed() });
	}

	// The replacement is saved either way. An old object that could not be
	// removed is no longer reachable from the app; it is logged for cleaning
	// up by hand.
	await removeOrLog(supabase, old.object_path);

	return { success: true, action: 'fileReplaced' as const, fileSectionId: sectionId };
}

/** Removes the file `fileId`: its stored object first, then its row. */
export async function deleteFile({
	request,
	classId,
	syllabusId,
	supabase,
	user
}: FileActionContext) {
	if (!user) return fail(401, { error: m.syllabus_error_failed() });

	const formData = await request.formData();
	const sectionId = String(formData.get('sectionId') ?? '');
	const fileId = String(formData.get('fileId') ?? '');

	const existing = await sectionFiles(supabase, classId, syllabusId, sectionId);
	const file = existing?.find((other) => other.id === fileId);
	if (!file) return fileFailed();

	// Object first: if the row then stays, removing it again still works
	// (an object that is already gone counts as removed).
	if (!(await removeObjects(supabase, [file.object_path]))) {
		return fail(400, { error: m.syllabus_file_error_storage() });
	}

	const { data, error } = await supabase
		.from('class_syllabus_section_files')
		.delete()
		.eq('id', fileId)
		.eq('section_id', sectionId)
		// Still the object that was removed: a replace in between keeps its row.
		.eq('object_path', file.object_path)
		.select('id');

	if (error || !data || data.length === 0) return fileFailed();

	return { success: true, action: 'fileDeleted' as const, fileSectionId: sectionId };
}

/**
 * A link to the stored file that works for about a minute, for a caller who
 * may read the file's row (row level security: the admin, the class's
 * teachers and enrolled students). Null for everyone else, for an unknown
 * id, and when storage refuses. `download` makes the browser save the file
 * under its original name instead of showing it.
 */
export async function signedFileUrl(
	supabase: Client,
	fileId: string,
	download: boolean
): Promise<string | null> {
	if (!isUuid(fileId)) return null;
	const { data: file, error } = await supabase
		.from('class_syllabus_section_files')
		.select('object_path, file_name')
		.eq('id', fileId)
		.maybeSingle();
	if (error || !file) return null;

	const { data, error: signError } = await supabase.storage
		.from(SYLLABUS_FILES_BUCKET)
		.createSignedUrl(file.object_path, SIGNED_URL_SECONDS);
	if (signError || !data?.signedUrl) return null;
	// `download` is added here, not through createSignedUrl's option: the
	// client library encodes it twice, so a name with Tibetan letters would
	// be saved as "%E0%BD%82...". Storage reads it from the address either way.
	return download
		? `${data.signedUrl}&download=${encodeURIComponent(file.file_name)}`
		: data.signedUrl;
}
