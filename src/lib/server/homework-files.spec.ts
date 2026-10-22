import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import type { Database } from '$lib/supabase/database.types';
import {
	MAX_HOMEWORK_FILE_BYTES,
	homeworkFileLimitMessage,
	homeworkFileTooLargeMessage
} from '$lib/homework-files';
import { formatFileSize } from '$lib/pdf-files';
import {
	HOMEWORK_FILES_BUCKET,
	HOMEWORK_FILE_LIMIT_ERROR_CODE,
	MAX_CREATE_POST_BYTES,
	attachCreatedFiles,
	deleteFile,
	loadHomeworkFiles,
	readCreateFiles,
	readCreateForm,
	removeStoredFiles,
	replaceFile,
	signedFileUrl,
	uploadFile
} from './homework-files';

/**
 * #110: homework PDF files. The same fake client as syllabus-files.spec.ts:
 * every `table:operation` and `storage:<call>` is answered from `answers`
 * and recorded, so a test also proves what was never sent.
 */

const CLASS = '11111111-1111-4111-8111-111111111111';
const ASSIGNMENT = '22222222-2222-4222-8222-222222222222';
const FILE = '44444444-4444-4444-8444-444444444444';
const OLD_PATH = `${CLASS}/${ASSIGNMENT}/55555555-5555-4555-8555-555555555555.pdf`;
const NEW_PATH = new RegExp(`^${CLASS}/${ASSIGNMENT}/[0-9a-f-]{36}\\.pdf$`);

/** A file whose content starts like a PDF, `size` bytes long. */
function pdf(name = 'Worksheet.pdf', size = 300 * 1024, type = 'application/pdf'): File {
	const bytes = new Uint8Array(size);
	bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
	return new File([bytes], name, { type });
}

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Call = { target: string; op: string; values?: unknown; filters: Record<string, unknown> };

const ok = (data: unknown): Result => ({ data, error: null });
const broken = (code?: string): Result => ({ data: null, error: { message: 'broken', code } });

function fakeSupabase(answers: Record<string, Result | ((arg: unknown) => Result)>) {
	const calls: Call[] = [];
	const answer = (key: string, arg?: unknown, fallback?: Result): Result => {
		const found = answers[key] ?? fallback;
		if (!found) throw new Error(`unexpected call: ${key}`);
		return typeof found === 'function' ? found(arg) : found;
	};
	const storageCall = (op: string, values: unknown, fallback: Result) => {
		calls.push({ target: 'storage', op, values, filters: {} });
		return Promise.resolve(answer(`storage:${op}`, values, fallback));
	};
	const client = {
		from(table: string) {
			const call: Call = { target: table, op: 'select', filters: {} };
			calls.push(call);
			const chain = {
				select: () => chain,
				insert: (values: unknown) => ((call.op = 'insert'), (call.values = values), chain),
				update: (values: unknown) => ((call.op = 'update'), (call.values = values), chain),
				delete: () => ((call.op = 'delete'), chain),
				eq: (column: string, value: unknown) => ((call.filters[column] = value), chain),
				in: (column: string, value: unknown) => ((call.filters[column] = value), chain),
				order: () => chain,
				limit: () => chain,
				maybeSingle: () => chain,
				then: (resolve: (value: Result) => unknown) => resolve(answer(`${table}:${call.op}`, call))
			};
			return chain;
		},
		storage: {
			from: (bucket: string) => ({
				upload: (path: string, body: ArrayBuffer, options: unknown) =>
					storageCall('upload', { bucket, path, size: body.byteLength, options }, ok({ path })),
				remove: (paths: string[]) =>
					storageCall('remove', paths, ok(paths.map((name) => ({ name })))),
				exists: async (path: string) => {
					const result = await storageCall('exists', path, ok(false));
					if (result.error && result.data === null) throw new Error(result.error.message);
					return result;
				},
				createSignedUrl: (path: string, seconds: number) =>
					storageCall(
						'sign',
						{ bucket, path, seconds },
						ok({ signedUrl: `https://storage.example/${path}?token=t` })
					)
			})
		}
	};
	return { supabase: client as unknown as SupabaseClient<Database>, calls };
}

const user = { id: 'teacher-1' } as App.SessionUser;

/** The homework as `assignmentFiles` reads it, holding `count` files (the first is FILE at OLD_PATH). */
const homeworkWith = (count: number) =>
	ok({
		id: ASSIGNMENT,
		homework_assignment_files: Array.from({ length: count }, (_, i) =>
			i === 0
				? { id: FILE, object_path: OLD_PATH }
				: { id: `file-${i}`, object_path: `${CLASS}/${ASSIGNMENT}/other-${i}.pdf` }
		)
	});

function context(
	answers: Record<string, Result | ((arg: unknown) => Result)>,
	fields: Record<string, string | File>,
	headers: Record<string, string> = {}
) {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) body.set(key, value);
	const { supabase, calls } = fakeSupabase(answers);
	return {
		calls,
		ctx: {
			request: new Request('http://localhost/x', {
				method: 'POST',
				body,
				headers: { 'content-length': '2000', ...headers }
			}),
			classId: CLASS,
			assignmentId: ASSIGNMENT,
			supabase,
			user: user as App.SessionUser | null
		}
	};
}

const writes = (calls: Call[]) =>
	calls
		.filter((c) => !['select', 'exists', 'sign'].includes(c.op))
		.map((c) => `${c.target}:${c.op}`);
const genericFailure = () => ({ status: 400, data: { error: m.homework_file_error_failed() } });
const fieldFailure = (message: string, fileId: string | null) => ({
	status: 400,
	data: { fileError: message, fileId }
});

describe('limits and sizes', () => {
	it("5 MB per file, named in the viewer's digits; 2 files per homework", () => {
		expect(MAX_HOMEWORK_FILE_BYTES).toBe(5_242_880);
		expect(formatFileSize(MAX_HOMEWORK_FILE_BYTES, 'en')).toBe('5.0 MB');
		// Never "1024 KB": from 1,048,064 bytes (rounds to 1024 KB) it is MB.
		expect(formatFileSize(1_048_063, 'en')).toBe('1023 KB');
		expect(formatFileSize(1_048_064, 'en')).toBe('1.0 MB');
		expect(formatFileSize(1_048_575, 'en')).toBe('1.0 MB');
		expect(formatFileSize(1_048_064, 'de')).toBe('1,0 MB');
		const original = getLocale;
		try {
			overwriteGetLocale(() => 'en');
			expect(homeworkFileTooLargeMessage()).toContain('5.0 MB');
			expect(homeworkFileLimitMessage()).toContain('2');
			overwriteGetLocale(() => 'bo');
			expect(homeworkFileTooLargeMessage()).toContain('༥.༠ MB');
			expect(homeworkFileTooLargeMessage()).not.toMatch(/[0-9]/);
			expect(homeworkFileLimitMessage()).toContain('༢');
			expect(homeworkFileLimitMessage()).not.toMatch(/[0-9]/);
		} finally {
			overwriteGetLocale(original);
		}
	});
});

describe('uploadFile', () => {
	it("stores the PDF in the homework's folder of its class and records its name and size", async () => {
		const { ctx, calls } = context(
			{
				'homework_assignments:select': homeworkWith(1),
				'homework_assignment_files:insert': ok([{ id: FILE }])
			},
			{ file: pdf('Worksheet.pdf') }
		);
		expect(await uploadFile(ctx)).toEqual({ success: true, action: 'fileUploaded' });
		const read = calls.find((c) => c.target === 'homework_assignments')!;
		expect(read.filters).toMatchObject({ id: ASSIGNMENT, class_id: CLASS });
		const upload = calls.find((c) => c.op === 'upload')!.values as {
			bucket: string;
			path: string;
			size: number;
			options: unknown;
		};
		expect(upload.bucket).toBe(HOMEWORK_FILES_BUCKET);
		expect(upload.path).toMatch(NEW_PATH);
		expect(upload.options).toMatchObject({ contentType: 'application/pdf', upsert: false });
		expect(calls.find((c) => c.op === 'insert')!.values).toEqual({
			assignment_id: ASSIGNMENT,
			object_path: upload.path,
			file_name: 'Worksheet.pdf',
			size_bytes: 300 * 1024,
			created_by: 'teacher-1'
		});
	});

	it('a PDF of exactly 5 MB is accepted', async () => {
		const { ctx } = context(
			{
				'homework_assignments:select': homeworkWith(0),
				'homework_assignment_files:insert': ok([{ id: FILE }])
			},
			{ file: pdf('big.pdf', MAX_HOMEWORK_FILE_BYTES) }
		);
		ctx.request.headers.set('content-length', String(MAX_HOMEWORK_FILE_BYTES + 1000));
		expect(await uploadFile(ctx)).toMatchObject({ success: true });
	});

	it('too large, not a PDF, or no file: a message for the field and nothing stored', async () => {
		for (const [file, message] of [
			[pdf('big.pdf', MAX_HOMEWORK_FILE_BYTES + 1), homeworkFileTooLargeMessage()],
			[new File(['PK\u0003\u0004'], 'a.docx'), m.homework_file_error_not_pdf()],
			[
				new File(['<html>'], 'fake.pdf', { type: 'application/pdf' }),
				m.homework_file_error_not_pdf()
			],
			[new File([], ''), m.homework_file_error_missing()]
		] as const) {
			const { ctx, calls } = context({ 'homework_assignments:select': homeworkWith(0) }, { file });
			expect(await uploadFile(ctx)).toMatchObject(fieldFailure(message, null));
			expect(writes(calls)).toEqual([]);
		}
	});

	it('a post far over the limit is refused before it is read: 413', async () => {
		const { ctx, calls } = context(
			{},
			{ file: pdf() },
			{
				'content-length': String(20 * 1024 * 1024)
			}
		);
		expect(await uploadFile(ctx)).toMatchObject({
			status: 413,
			data: { error: homeworkFileTooLargeMessage() }
		});
		expect(calls).toEqual([]);
	});

	it('a third file is refused, naming the limit of 2, and nothing is stored', async () => {
		const { ctx, calls } = context(
			{ 'homework_assignments:select': homeworkWith(2) },
			{ file: pdf() }
		);
		expect(await uploadFile(ctx)).toMatchObject(fieldFailure(homeworkFileLimitMessage(), null));
		expect(writes(calls)).toEqual([]);
	});

	it("the database's own limit (two uploads at once): the object is removed again", async () => {
		const { ctx, calls } = context(
			{
				'homework_assignments:select': homeworkWith(1),
				'homework_assignment_files:insert': broken(HOMEWORK_FILE_LIMIT_ERROR_CODE)
			},
			{ file: pdf() }
		);
		expect(await uploadFile(ctx)).toMatchObject(fieldFailure(homeworkFileLimitMessage(), null));
		expect(writes(calls)).toEqual([
			'storage:upload',
			'homework_assignment_files:insert',
			'storage:remove'
		]);
	});

	it('wrong class or homework (no row, or no uuid): 400, generic error, nothing stored', async () => {
		const { ctx, calls } = context({ 'homework_assignments:select': ok(null) }, { file: pdf() });
		expect(await uploadFile(ctx)).toMatchObject(genericFailure());
		expect(writes(calls)).toEqual([]);

		const other = context({}, { file: pdf() });
		other.ctx.assignmentId = 'not-a-uuid';
		expect(await uploadFile(other.ctx)).toMatchObject(genericFailure());
		expect(other.calls).toEqual([]);
	});

	it('signed out: 401, nothing asked', async () => {
		const { ctx, calls } = context({}, { file: pdf() });
		ctx.user = null;
		expect(await uploadFile(ctx)).toMatchObject({ status: 401 });
		expect(calls).toEqual([]);
	});
});

describe('replaceFile', () => {
	it('same row with the new name and size; the old object is removed after the row points at the new one', async () => {
		const { ctx, calls } = context(
			{
				'homework_assignments:select': homeworkWith(2),
				'homework_assignment_files:update': ok([{ id: FILE }])
			},
			{ fileId: FILE, file: pdf('Version 2.pdf', 1000) }
		);
		expect(await replaceFile(ctx)).toEqual({ success: true, action: 'fileReplaced' });
		expect(writes(calls)).toEqual([
			'storage:upload',
			'homework_assignment_files:update',
			'storage:remove'
		]);
		const update = calls.find((c) => c.op === 'update')!;
		expect(update.values).toMatchObject({ file_name: 'Version 2.pdf', size_bytes: 1000 });
		expect(update.filters).toEqual({
			id: FILE,
			assignment_id: ASSIGNMENT,
			object_path: OLD_PATH
		});
		expect(calls.find((c) => c.op === 'remove')!.values).toEqual([OLD_PATH]);
	});

	it('an invalid file: the old one stays, with a message at that file', async () => {
		const { ctx, calls } = context(
			{ 'homework_assignments:select': homeworkWith(1) },
			{ fileId: FILE, file: new File(['nope'], 'x.pdf') }
		);
		expect(await replaceFile(ctx)).toMatchObject(
			fieldFailure(m.homework_file_error_not_pdf(), FILE)
		);
		expect(writes(calls)).toEqual([]);
	});

	it('the row cannot be changed: the new object goes again and the old one stays', async () => {
		const { ctx, calls } = context(
			{
				'homework_assignments:select': homeworkWith(1),
				'homework_assignment_files:update': ok([])
			},
			{ fileId: FILE, file: pdf() }
		);
		expect(await replaceFile(ctx)).toMatchObject(genericFailure());
		const removed = calls.find((c) => c.op === 'remove')!.values as string[];
		expect(removed).toHaveLength(1);
		expect(removed[0]).toMatch(NEW_PATH);
		expect(removed[0]).not.toBe(OLD_PATH);
	});

	it('a file id of another homework or class: 400, generic error, nothing changed', async () => {
		const { ctx, calls } = context(
			{ 'homework_assignments:select': homeworkWith(1) },
			{ fileId: '99999999-9999-4999-8999-999999999999', file: pdf() }
		);
		expect(await replaceFile(ctx)).toMatchObject(genericFailure());
		expect(writes(calls)).toEqual([]);
	});
});

describe('deleteFile', () => {
	it('removes the stored object, then the row', async () => {
		const { ctx, calls } = context(
			{
				'homework_assignments:select': homeworkWith(1),
				'homework_assignment_files:delete': ok([{ id: FILE }])
			},
			{ fileId: FILE }
		);
		expect(await deleteFile(ctx)).toEqual({ success: true, action: 'fileDeleted' });
		expect(writes(calls)).toEqual(['storage:remove', 'homework_assignment_files:delete']);
		expect(calls.find((c) => c.op === 'delete')!.filters).toEqual({
			id: FILE,
			assignment_id: ASSIGNMENT,
			object_path: OLD_PATH
		});
	});

	it('storage cannot remove the object: refused with an error and the row stays', async () => {
		const { ctx, calls } = context(
			{ 'homework_assignments:select': homeworkWith(1), 'storage:remove': broken() },
			{ fileId: FILE }
		);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await deleteFile(ctx)).toMatchObject({
			status: 400,
			data: { error: m.homework_file_error_storage() }
		});
		expect(writes(calls)).toEqual(['storage:remove']);
		vi.restoreAllMocks();
	});

	it('wrong class or unknown file: 400, "could not remove", nothing removed', async () => {
		for (const [answers, fileId] of [
			[{ 'homework_assignments:select': ok(null) }, FILE],
			[{ 'homework_assignments:select': homeworkWith(1) }, '99999999-9999-4999-8999-999999999999']
		] as const) {
			const { ctx, calls } = context(answers, { fileId });
			expect(await deleteFile(ctx)).toMatchObject({
				status: 400,
				data: { error: m.homework_file_error_remove_failed() }
			});
			expect(writes(calls)).toEqual([]);
		}
	});

	it('signed out: 401, "could not remove", nothing asked', async () => {
		const { ctx, calls } = context({}, { fileId: FILE });
		ctx.user = null;
		expect(await deleteFile(ctx)).toMatchObject({
			status: 401,
			data: { error: m.homework_file_error_remove_failed() }
		});
		expect(calls).toEqual([]);
	});

	it('the object is removed but the row cannot be deleted: told the file is half removed', async () => {
		for (const rowDelete of [ok([]), broken()]) {
			const { ctx, calls } = context(
				{
					'homework_assignments:select': homeworkWith(1),
					'homework_assignment_files:delete': rowDelete
				},
				{ fileId: FILE }
			);
			expect(await deleteFile(ctx)).toMatchObject({
				status: 400,
				data: { error: m.homework_file_error_remove_unfinished() }
			});
			expect(writes(calls)).toEqual(['storage:remove', 'homework_assignment_files:delete']);
		}
	});
});

describe('readCreateFiles (create form)', () => {
	const form = (...files: File[]) => {
		const data = new FormData();
		for (const file of files) data.append('files', file);
		return data;
	};

	it('none chosen (an empty input sends an empty file): no files, fine', async () => {
		expect(await readCreateFiles(new FormData())).toEqual({ ok: true, files: [] });
		expect(await readCreateFiles(form(new File([], '')))).toEqual({ ok: true, files: [] });
	});

	it('two valid PDFs: both, with their names', async () => {
		const result = await readCreateFiles(form(pdf('a.pdf', 1000), pdf('b.pdf', 2000)));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.files.map((f) => [f.name, f.bytes.byteLength])).toEqual([
				['a.pdf', 1000],
				['b.pdf', 2000]
			]);
		}
	});

	it('three files: refused with the limit of 2', async () => {
		expect(await readCreateFiles(form(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')))).toEqual({
			ok: false,
			message: homeworkFileLimitMessage()
		});
	});

	it('a file over 5 MB or not a PDF: refused, the message names the file', async () => {
		expect(
			await readCreateFiles(form(pdf('a.pdf'), pdf('huge.pdf', MAX_HOMEWORK_FILE_BYTES + 1)))
		).toEqual({
			ok: false,
			message: m.homework_file_error_named({
				name: 'huge.pdf',
				message: homeworkFileTooLargeMessage()
			})
		});
		expect(await readCreateFiles(form(new File(['PK'], 'notes.docx')))).toEqual({
			ok: false,
			message: m.homework_file_error_named({
				name: 'notes.docx',
				message: m.homework_file_error_not_pdf()
			})
		});
	});

	it('the create post may carry two 5 MB files and the content, and no more', async () => {
		expect(MAX_CREATE_POST_BYTES).toBeGreaterThan(2 * MAX_HOMEWORK_FILE_BYTES + 1_000_000);
		const request = new Request('http://localhost/x', {
			method: 'POST',
			body: new FormData(),
			headers: { 'content-length': String(MAX_CREATE_POST_BYTES + 1) }
		});
		expect(await readCreateForm(request)).toMatchObject({
			refused: {
				status: 413,
				data: {
					error: homeworkFileTooLargeMessage(),
					fileError: homeworkFileTooLargeMessage(),
					action: 'createAssignment'
				}
			}
		});
	});
});

describe('attachCreatedFiles', () => {
	it('stores and records each file; returns the names that could not be attached', async () => {
		let inserts = 0;
		const { supabase, calls } = fakeSupabase({
			'homework_assignment_files:insert': () =>
				(inserts += 1) === 1 ? ok([{ id: 'f1' }]) : broken()
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const files = [
			{ name: 'a.pdf', bytes: new ArrayBuffer(10) },
			{ name: 'b.pdf', bytes: new ArrayBuffer(20) }
		];
		expect(await attachCreatedFiles(supabase, user, CLASS, ASSIGNMENT, files)).toEqual(['b.pdf']);
		vi.restoreAllMocks();
		// The second object had no row, so it was removed again.
		expect(writes(calls)).toEqual([
			'storage:upload',
			'homework_assignment_files:insert',
			'storage:upload',
			'homework_assignment_files:insert',
			'storage:remove'
		]);
	});
});

describe('loadHomeworkFiles', () => {
	it("groups each homework's files in order, as name and size", async () => {
		const { supabase, calls } = fakeSupabase({
			'homework_assignment_files:select': ok([
				{ id: 'f1', assignment_id: ASSIGNMENT, file_name: 'a.pdf', size_bytes: 10 },
				{ id: 'f2', assignment_id: ASSIGNMENT, file_name: 'b.pdf', size_bytes: 20 }
			])
		});
		const { files, error } = await loadHomeworkFiles(supabase, [ASSIGNMENT, ASSIGNMENT]);
		expect(error).toBe(false);
		expect(files.get(ASSIGNMENT)).toEqual([
			{ id: 'f1', name: 'a.pdf', size: 10 },
			{ id: 'f2', name: 'b.pdf', size: 20 }
		]);
		expect(calls[0].filters).toEqual({ assignment_id: [ASSIGNMENT] });
	});

	it('no homework: nothing asked', async () => {
		const { supabase, calls } = fakeSupabase({});
		expect((await loadHomeworkFiles(supabase, [])).files.size).toBe(0);
		expect(calls).toEqual([]);
	});
});

describe('removeStoredFiles (class delete)', () => {
	it("a class: every file's object, then its row", async () => {
		let reads = 0;
		const { supabase, calls } = fakeSupabase({
			'homework_assignment_files:select': () =>
				(reads += 1) === 1 ? ok([{ id: FILE, object_path: OLD_PATH }]) : ok([]),
			'homework_assignment_files:delete': ok([{ id: FILE }])
		});
		expect(await removeStoredFiles(supabase, { classId: CLASS })).toEqual({
			ok: true,
			removed: 1
		});
		expect(calls[0].filters).toEqual({ 'homework_assignments.class_id': CLASS });
		expect(writes(calls)).toEqual(['storage:remove', 'homework_assignment_files:delete']);
	});

	it('false when the objects cannot be removed; the rows stay', async () => {
		const { supabase, calls } = fakeSupabase({
			'homework_assignment_files:select': ok([{ id: FILE, object_path: OLD_PATH }]),
			'storage:remove': broken()
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await removeStoredFiles(supabase, { classId: CLASS })).toEqual({
			ok: false,
			removed: 0
		});
		vi.restoreAllMocks();
		expect(writes(calls)).toEqual(['storage:remove']);
	});
});

describe('signedFileUrl', () => {
	it('a link valid for about a minute; ?download carries the original name', async () => {
		const { supabase, calls } = fakeSupabase({
			'homework_assignment_files:select': ok({ object_path: OLD_PATH, file_name: 'གཞས་ཚིག.pdf' })
		});
		expect(await signedFileUrl(supabase, FILE, false)).toBe(
			`https://storage.example/${OLD_PATH}?token=t`
		);
		expect(await signedFileUrl(supabase, FILE, true)).toBe(
			`https://storage.example/${OLD_PATH}?token=t&download=${encodeURIComponent('གཞས་ཚིག.pdf')}`
		);
		expect(calls.find((c) => c.op === 'sign')!.values).toEqual({
			bucket: HOMEWORK_FILES_BUCKET,
			path: OLD_PATH,
			seconds: 60
		});
	});

	it('no row (not allowed, or unknown), or no uuid: null, no link asked for', async () => {
		const { supabase, calls } = fakeSupabase({ 'homework_assignment_files:select': ok(null) });
		expect(await signedFileUrl(supabase, FILE, false)).toBeNull();
		expect(await signedFileUrl(supabase, 'nope', false)).toBeNull();
		expect(calls.filter((c) => c.op === 'sign')).toEqual([]);
	});
});
