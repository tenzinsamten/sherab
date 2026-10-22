import { fail } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as m from '$lib/paraglide/messages.js';
import type { Database } from '$lib/supabase/database.types';
import {
	MAX_FILE_BYTES,
	MAX_FILES_PER_SECTION,
	fileLimitMessage,
	fileTooLargeMessage
} from '$lib/syllabus-files';
import {
	FORM_OVERHEAD_BYTES,
	MAX_FILE_NAME_LENGTH,
	REMOVE_BATCH,
	SIGNED_URL_SECONDS,
	cleanFileName,
	isUuid,
	readFileForm as readSharedFileForm,
	readPdfUpload as readSharedPdfUpload,
	removeObjects as removeSharedObjects,
	removeOrLog as removeSharedOrLog,
	signObject,
	storeObject as storeSharedObject,
	type PdfStore,
	type PdfUpload,
	type UploadProblem
} from './pdf-files';

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
 * the objects here first: see `removeStoredFiles`. The steps shared with
 * homework files (reading the post, checking the PDF, storing, removing,
 * signing) are in pdf-files.ts.
 */

type Client = SupabaseClient<Database>;

export const SYLLABUS_FILES_BUCKET = 'syllabus-files';
const STORE: PdfStore = { bucket: SYLLABUS_FILES_BUCKET, label: 'syllabus file' };
export { SIGNED_URL_SECONDS, MAX_FILE_NAME_LENGTH, isUuid, cleanFileName };
export type { UploadProblem, PdfUpload };
/** SQLSTATE of the database's own "at most 5 files" check (0039). */
export const FILE_LIMIT_ERROR_CODE = 'SF001';

/**
 * Reads the posted `file` field. Accepts it only when it is at most 1 MB and
 * its content starts with `%PDF-`, whatever its name or declared type say.
 */
export function readPdfUpload(entry: FormDataEntryValue | null) {
	return readSharedPdfUpload(entry, MAX_FILE_BYTES);
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
	user: App.SessionUser | null;
};

/** Wrong class, section or file, or no permission: one answer for all. */
const fileFailed = () => fail(400, { error: m.syllabus_error_failed() });

/** A problem with the chosen file, shown under the field it was chosen in. */
const fileProblem = (message: string, sectionId: string, fileId: string | null) =>
	fail(400, { fileError: message, fileSectionId: sectionId, fileId });

/** The largest post the file forms can honestly send: one file plus the form around it. */
const MAX_POST_BYTES = MAX_FILE_BYTES + FORM_OVERHEAD_BYTES;

const formRefusals = {
	tooLarge: () => fail(413, { error: fileTooLargeMessage() }),
	broken: () => fail(400, { error: m.syllabus_file_error_failed() })
};

/** Reads a file form up to one file plus the form around it (see `readFileForm` in pdf-files.ts). */
const readFileForm = (request: Request) =>
	readSharedFileForm(request, MAX_POST_BYTES, formRefusals);

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
const storeObject = (supabase: Client, classId: string, sectionId: string, bytes: ArrayBuffer) =>
	storeSharedObject(supabase, STORE, `${classId}/${sectionId}`, bytes);

/** For an object the app could not remove after a failed step: names it in the server log. */
const removeOrLog = (supabase: Client, path: string) => removeSharedOrLog(supabase, STORE, path);

/**
 * Removes objects from the bucket. True only when none of them is left
 * (see `removeObjects` in pdf-files.ts).
 */
export const removeObjects = (supabase: Client, paths: string[]) =>
	removeSharedObjects(supabase, STORE, paths);

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

	return signObject(supabase, STORE, file.object_path, file.file_name, download);
}
