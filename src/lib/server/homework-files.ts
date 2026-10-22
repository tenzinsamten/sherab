import { fail } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as m from '$lib/paraglide/messages.js';
import { MAX_CONTENT_BYTES } from '$lib/rich-text';
import type { Database } from '$lib/supabase/database.types';
import {
	MAX_FILES_PER_HOMEWORK,
	MAX_HOMEWORK_FILE_BYTES,
	homeworkFileLimitMessage,
	homeworkFileTooLargeMessage,
	type HomeworkFile
} from '$lib/homework-files';
import {
	FORM_OVERHEAD_BYTES,
	REMOVE_BATCH,
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
 * PDF files attached to a homework (#110, 0053_homework_files.sql). Every
 * call uses the caller's own Supabase client, so the table's and the
 * bucket's policies decide who may upload, replace, remove or read: the
 * admin and the class's teachers change them; students the homework is set
 * for and their approved parents read them.
 *
 * A file is a row in homework_assignment_files plus an object in the private
 * bucket, stored as `<class_id>/<assignment_id>/<random uuid>.pdf`. It
 * belongs to the homework (assignment), so every copy of a weekly homework
 * shows it. The original name lives in the row only. Objects cannot be
 * deleted from SQL, so whatever deletes rows (a file, a class) removes the
 * objects here first: see `removeStoredFiles`. The steps shared with
 * syllabus files are in pdf-files.ts.
 */

type Client = SupabaseClient<Database>;

export const HOMEWORK_FILES_BUCKET = 'homework-files';
const STORE: PdfStore = { bucket: HOMEWORK_FILES_BUCKET, label: 'homework file' };
/** SQLSTATE of the database's own "at most 2 files" check (0053). */
export const HOMEWORK_FILE_LIMIT_ERROR_CODE = 'HF001';

/** The homework page's file forms: one file plus the form around it. */
export const MAX_FILE_POST_BYTES = MAX_HOMEWORK_FILE_BYTES + FORM_OVERHEAD_BYTES;
/**
 * The create form: up to 2 files, the rich-text content (at most
 * MAX_CONTENT_BYTES) and the other fields.
 */
export const MAX_CREATE_POST_BYTES =
	MAX_FILES_PER_HOMEWORK * MAX_HOMEWORK_FILE_BYTES + MAX_CONTENT_BYTES + 2 * FORM_OVERHEAD_BYTES;

const problemMessages: Record<UploadProblem, () => string> = {
	missing: m.homework_file_error_missing,
	size: homeworkFileTooLargeMessage,
	type: m.homework_file_error_not_pdf
};

export type HomeworkFileActionContext = {
	request: Request;
	classId: string;
	assignmentId: string;
	supabase: Client;
	user: App.SessionUser | null;
};

/** Wrong class, homework or file, or no permission: one answer for all. */
const fileFailed = () => fail(400, { error: m.homework_file_error_failed() });

/** A problem with the chosen file, shown at the field it was chosen in. */
const fileProblem = (message: string, fileId: string | null) =>
	fail(400, { fileError: message, fileId });

const fileFormRefusals = {
	tooLarge: () => fail(413, { error: homeworkFileTooLargeMessage() }),
	broken: () => fail(400, { error: m.homework_file_error_failed() })
};

type StoredFile = { id: string; object_path: string };

/**
 * The homework's files, when the homework is in the route's class and the
 * caller may read it; null otherwise. Every file action starts here, so an
 * id from another class changes nothing.
 */
async function assignmentFiles(
	supabase: Client,
	classId: string,
	assignmentId: string
): Promise<StoredFile[] | null> {
	if (!isUuid(classId) || !isUuid(assignmentId)) return null;
	const { data, error } = await supabase
		.from('homework_assignments')
		.select('id, homework_assignment_files(id, object_path)')
		.eq('id', assignmentId)
		.eq('class_id', classId)
		.maybeSingle();
	if (error || !data) return null;
	return data.homework_assignment_files ?? [];
}

/**
 * Stores one checked PDF for the homework and records it. The file's id, or
 * the reason it was not attached ('limit': the homework already has 2).
 */
async function attachOne(
	supabase: Client,
	user: App.SessionUser,
	classId: string,
	assignmentId: string,
	upload: PdfUpload
): Promise<{ ok: true; id: string } | { ok: false; reason: 'limit' | 'failed' }> {
	const path = await storeObject(supabase, STORE, `${classId}/${assignmentId}`, upload.bytes);
	if (!path) return { ok: false, reason: 'failed' };

	const { data, error } = await supabase
		.from('homework_assignment_files')
		.insert({
			assignment_id: assignmentId,
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
			reason: error?.code === HOMEWORK_FILE_LIMIT_ERROR_CODE ? 'limit' : 'failed'
		};
	}
	return { ok: true, id: data[0].id };
}

/** Adds the posted PDF (`file`) to the homework. */
export async function uploadFile({
	request,
	classId,
	assignmentId,
	supabase,
	user
}: HomeworkFileActionContext) {
	if (!user) return fail(401, { error: m.homework_file_error_failed() });
	const form = await readFileForm(request, MAX_FILE_POST_BYTES, fileFormRefusals);
	if ('refused' in form) return form.refused;
	const upload = await readPdfUpload(form.formData.get('file'), MAX_HOMEWORK_FILE_BYTES);

	const existing = await assignmentFiles(supabase, classId, assignmentId);
	if (!existing) return fileFailed();
	if (!upload.ok) return fileProblem(problemMessages[upload.problem](), null);
	if (existing.length >= MAX_FILES_PER_HOMEWORK) {
		return fileProblem(homeworkFileLimitMessage(), null);
	}

	const attached = await attachOne(supabase, user, classId, assignmentId, upload.value);
	if (!attached.ok) {
		return attached.reason === 'limit'
			? fileProblem(homeworkFileLimitMessage(), null)
			: fail(400, { error: m.homework_file_error_failed() });
	}
	return { success: true, action: 'fileUploaded' as const };
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
	assignmentId,
	supabase,
	user
}: HomeworkFileActionContext) {
	if (!user) return fail(401, { error: m.homework_file_error_failed() });
	const form = await readFileForm(request, MAX_FILE_POST_BYTES, fileFormRefusals);
	if ('refused' in form) return form.refused;
	const fileId = String(form.formData.get('fileId') ?? '');
	const upload = await readPdfUpload(form.formData.get('file'), MAX_HOMEWORK_FILE_BYTES);

	const existing = await assignmentFiles(supabase, classId, assignmentId);
	const old = existing?.find((file) => file.id === fileId);
	if (!old) return fileFailed();
	if (!upload.ok) return fileProblem(problemMessages[upload.problem](), fileId);

	const path = await storeObject(supabase, STORE, `${classId}/${assignmentId}`, upload.value.bytes);
	if (!path) return fail(400, { error: m.homework_file_error_failed() });

	// .select() + row check: RLS turns a forbidden update into zero rows.
	const { data, error } = await supabase
		.from('homework_assignment_files')
		.update({
			object_path: path,
			file_name: upload.value.name,
			size_bytes: upload.value.bytes.byteLength,
			updated_at: new Date().toISOString()
		})
		.eq('id', fileId)
		.eq('assignment_id', assignmentId)
		// Still the object that was read: of two replaces at once (or a
		// replace and a remove), the later one changes no row.
		.eq('object_path', old.object_path)
		.select('id');

	if (error || !data || data.length === 0) {
		// The old file stays; the new object has no row and goes again.
		await removeOrLog(supabase, STORE, path);
		return fail(400, { error: m.homework_file_error_failed() });
	}

	// The replacement is saved either way. An old object that could not be
	// removed is no longer reachable from the app; it is logged for cleaning
	// up by hand.
	await removeOrLog(supabase, STORE, old.object_path);

	return { success: true, action: 'fileReplaced' as const };
}

/** Removes the file `fileId`: its stored object first, then its row. */
export async function deleteFile({
	request,
	classId,
	assignmentId,
	supabase,
	user
}: HomeworkFileActionContext) {
	if (!user) return fail(401, { error: m.homework_file_error_remove_failed() });

	const formData = await request.formData();
	const fileId = String(formData.get('fileId') ?? '');

	const existing = await assignmentFiles(supabase, classId, assignmentId);
	const file = existing?.find((other) => other.id === fileId);
	if (!file) return fail(400, { error: m.homework_file_error_remove_failed() });

	// Object first: if the row then stays, removing it again still works
	// (an object that is already gone counts as removed).
	if (!(await removeObjects(supabase, STORE, [file.object_path]))) {
		return fail(400, { error: m.homework_file_error_storage() });
	}

	const { data, error } = await supabase
		.from('homework_assignment_files')
		.delete()
		.eq('id', fileId)
		.eq('assignment_id', assignmentId)
		// Still the object that was removed: a replace in between keeps its row.
		.eq('object_path', file.object_path)
		.select('id');

	// The object is gone but the row stayed: the file is half removed. Removing
	// it again finishes it (an object already gone counts as removed).
	if (error || !data || data.length === 0) {
		return fail(400, { error: m.homework_file_error_remove_unfinished() });
	}

	return { success: true, action: 'fileDeleted' as const };
}

/**
 * The create form's files (`files`, any number of inputs), checked before
 * the homework is created: at most 2, each a PDF of at most 5 MB. A file
 * input left empty sends an empty, unnamed file, which does not count.
 * The message names the file that was refused.
 */
export async function readCreateFiles(
	formData: FormData
): Promise<{ ok: true; files: PdfUpload[] } | { ok: false; message: string }> {
	const chosen = formData
		.getAll('files')
		.filter((entry): entry is File => entry instanceof Blob && entry.size > 0);
	if (chosen.length > MAX_FILES_PER_HOMEWORK) {
		return { ok: false, message: homeworkFileLimitMessage() };
	}
	const files: PdfUpload[] = [];
	for (const entry of chosen) {
		const upload = await readPdfUpload(entry, MAX_HOMEWORK_FILE_BYTES);
		if (!upload.ok) {
			const name = typeof entry.name === 'string' && entry.name ? entry.name : '';
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
 * Attaches checked files to a homework that was just created. The homework
 * stays whatever happens here; the names of the files that could not be
 * attached are returned, for the teacher to add on the homework page.
 */
export async function attachCreatedFiles(
	supabase: Client,
	user: App.SessionUser,
	classId: string,
	assignmentId: string,
	files: PdfUpload[]
): Promise<string[]> {
	const notAttached: string[] = [];
	for (const file of files) {
		const attached = await attachOne(supabase, user, classId, assignmentId, file);
		if (!attached.ok) {
			console.error(`homework ${assignmentId}: file not attached (${attached.reason})`);
			notAttached.push(file.name);
		}
	}
	return notAttached;
}

/**
 * The files of each homework in `assignmentIds` that the caller may read,
 * oldest first. A homework without files (or that the caller may not read)
 * has no entry. `error` is true when they could not be read.
 */
export async function loadHomeworkFiles(
	supabase: Client,
	assignmentIds: string[]
): Promise<{ files: Map<string, HomeworkFile[]>; error: boolean }> {
	const files = new Map<string, HomeworkFile[]>();
	const ids = Array.from(new Set(assignmentIds.filter(isUuid)));
	if (ids.length === 0) return { files, error: false };
	const { data, error } = await supabase
		.from('homework_assignment_files')
		.select('id, assignment_id, file_name, size_bytes, created_at')
		.in('assignment_id', ids)
		.order('created_at', { ascending: true })
		.order('id', { ascending: true });
	if (error) {
		console.error(`homework files could not be read: ${error.message}`);
		return { files, error: true };
	}
	for (const row of data ?? []) {
		const list = files.get(row.assignment_id) ?? [];
		list.push({ id: row.id, name: row.file_name, size: row.size_bytes });
		files.set(row.assignment_id, list);
	}
	return { files, error: false };
}

/**
 * Removes the stored objects, and then the rows, of every homework file in
 * a class. Call it before deleting the class: the delete cascades to the
 * rows but cannot reach the bucket. `ok` is false when something could not
 * be removed; the caller then refuses its delete. `removed` counts the
 * files that are gone, also when it stopped half way.
 */
export async function removeStoredFiles(
	supabase: Client,
	scope: { classId: string }
): Promise<{ ok: boolean; removed: number }> {
	let removed = 0;
	// An id that is no id matches no file: nothing to remove.
	if (!isUuid(scope.classId)) return { ok: true, removed };
	// Each round removes what it read, so the next one reads the rest.
	for (let round = 0; round < 1000; round += 1) {
		const { data, error } = await supabase
			.from('homework_assignment_files')
			.select('id, object_path, homework_assignments!inner(class_id)')
			.eq('homework_assignments.class_id', scope.classId)
			.limit(REMOVE_BATCH);
		if (error) {
			console.error(`homework files could not be listed: ${error.message}`);
			return { ok: false, removed };
		}
		if (!data || data.length === 0) return { ok: true, removed };

		if (
			!(await removeObjects(
				supabase,
				STORE,
				data.map((file) => file.object_path)
			))
		) {
			return { ok: false, removed };
		}
		const ids = data.map((file) => file.id);
		const { data: deleted, error: deleteError } = await supabase
			.from('homework_assignment_files')
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

/**
 * A link to the stored file that works for about a minute, for a caller who
 * may read the file's row (row level security: the admin, the class's
 * teachers, the students the homework is set for and their approved
 * parents). Null for everyone else, for an unknown id, and when storage
 * refuses. `download` makes the browser save the file under its original
 * name instead of showing it.
 */
export async function signedFileUrl(
	supabase: Client,
	fileId: string,
	download: boolean
): Promise<string | null> {
	if (!isUuid(fileId)) return null;
	const { data: file, error } = await supabase
		.from('homework_assignment_files')
		.select('object_path, file_name')
		.eq('id', fileId)
		.maybeSingle();
	if (error || !file) return null;
	return signObject(supabase, STORE, file.object_path, file.file_name, download);
}

/**
 * Reads the create form (#110: it may carry up to 2 files besides the
 * homework's own fields) up to MAX_CREATE_POST_BYTES.
 */
export function readCreateForm(request: Request) {
	return readFileForm(request, MAX_CREATE_POST_BYTES, {
		tooLarge: () =>
			fail(413, {
				error: homeworkFileTooLargeMessage(),
				fileError: homeworkFileTooLargeMessage(),
				action: 'createAssignment' as const
			}),
		broken: () =>
			fail(400, { error: m.homework_error_create_failed(), action: 'createAssignment' as const })
	});
}
