import type { SupabaseClient, User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import type { Database } from '$lib/supabase/database.types';
import {
	MAX_FILE_BYTES,
	fileLimitMessage,
	fileTooLargeMessage,
	formatFileSize
} from '$lib/syllabus-files';
import {
	FILE_LIMIT_ERROR_CODE,
	cleanFileName,
	deleteFile,
	readPdfUpload,
	removeStoredFiles,
	replaceFile,
	signedFileUrl,
	uploadFile
} from './syllabus-files';

const CLASS = '11111111-1111-4111-8111-111111111111';
const SYLLABUS = '22222222-2222-4222-8222-222222222222';
const SECTION = '33333333-3333-4333-8333-333333333333';
const FILE = '44444444-4444-4444-8444-444444444444';
const OLD_PATH = `${CLASS}/${SECTION}/55555555-5555-4555-8555-555555555555.pdf`;
const NEW_PATH = new RegExp(`^${CLASS}/${SECTION}/[0-9a-f-]{36}\\.pdf$`);

/** A file whose content starts like a PDF, `size` bytes long. */
function pdf(name = 'Lyrics.pdf', size = 300 * 1024, type = 'application/pdf'): File {
	const bytes = new Uint8Array(size);
	bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
	return new File([bytes], name, { type });
}

describe('cleanFileName', () => {
	it('keeps the original name, Tibetan included', () => {
		expect(cleanFileName('Song 1 lyrics.pdf')).toBe('Song 1 lyrics.pdf');
		expect(cleanFileName('གཞས་ཚིག.PDF')).toBe('གཞས་ཚིག.pdf');
	});

	it('drops folders and control characters, so the name is never a path', () => {
		expect(cleanFileName('C:\\Users\\me\\notes.pdf')).toBe('notes.pdf');
		expect(cleanFileName('../../etc/passwd')).toBe('passwd.pdf');
		expect(cleanFileName('a\u0000b\r\n.pdf')).toBe('ab.pdf');
	});

	it('always ends in .pdf and is at most 200 characters', () => {
		expect(cleanFileName('worksheet')).toBe('worksheet.pdf');
		expect(cleanFileName('')).toBe('document.pdf');
		expect(cleanFileName('  .pdf ')).toBe('document.pdf');
		const long = cleanFileName(`${'ཀ'.repeat(400)}.pdf`);
		expect([...long]).toHaveLength(200);
		expect(long.endsWith('.pdf')).toBe(true);
	});
});

describe('readPdfUpload', () => {
	it('accepts a PDF of up to 1 MB, whatever its name or declared type', async () => {
		const exact = await readPdfUpload(pdf('a.pdf', MAX_FILE_BYTES));
		expect(exact).toMatchObject({ ok: true, value: { name: 'a.pdf' } });
		const odd = await readPdfUpload(pdf('notes.bin', 1000, 'application/octet-stream'));
		expect(odd).toMatchObject({ ok: true, value: { name: 'notes.bin.pdf' } });
		if (odd.ok) expect(odd.value.bytes.byteLength).toBe(1000);
	});

	it('refuses a file over 1 MB', async () => {
		expect(await readPdfUpload(pdf('a.pdf', MAX_FILE_BYTES + 1))).toEqual({
			ok: false,
			problem: 'size'
		});
	});

	it('refuses what is not a PDF by content: a .docx, and a .pdf that is not one', async () => {
		const docx = new File([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0])], 'a.docx');
		const fake = new File(['<html>%PDF-</html>'], 'a.pdf', { type: 'application/pdf' });
		const short = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
		for (const file of [docx, fake, short]) {
			expect(await readPdfUpload(file)).toEqual({ ok: false, problem: 'type' });
		}
	});

	it('refuses a post without a file', async () => {
		for (const entry of [null, '', 'text', new File([], '')]) {
			expect(await readPdfUpload(entry)).toEqual({ ok: false, problem: 'missing' });
		}
	});
});

describe('formatFileSize', () => {
	it("shows KB below 1,048,576 bytes and MB from there, in the viewer's digits and separator", () => {
		expect(formatFileSize(300 * 1024, 'en')).toBe('300 KB');
		expect(formatFileSize(10, 'en')).toBe('1 KB');
		// Between 1,000,000 and 1,048,575 bytes it is still KB, never "1.0 MB" early.
		expect(formatFileSize(1_000_000, 'en')).toBe('977 KB');
		expect(formatFileSize(MAX_FILE_BYTES - 1, 'en')).toBe('1024 KB');
		expect(formatFileSize(MAX_FILE_BYTES, 'en')).toBe('1.0 MB');
		expect(formatFileSize(MAX_FILE_BYTES, 'de')).toBe('1,0 MB');
		expect(formatFileSize(300 * 1024, 'de')).toBe('300 KB');
		expect(formatFileSize(300 * 1024, 'bo')).toBe('༣༠༠ KB');
		expect(formatFileSize(MAX_FILE_BYTES, 'bo')).toBe('༡.༠ MB');
	});

	it("the messages that name a limit use the viewer's digits", () => {
		const original = getLocale;
		try {
			overwriteGetLocale(() => 'bo');
			expect(fileTooLargeMessage()).toContain('༡.༠ MB');
			expect(fileTooLargeMessage()).not.toMatch(/[0-9]/);
			expect(fileLimitMessage()).toContain('༥');
			expect(fileLimitMessage()).not.toMatch(/[0-9]/);
			overwriteGetLocale(() => 'de');
			expect(fileTooLargeMessage()).toContain('1,0 MB');
		} finally {
			overwriteGetLocale(original);
		}
	});
});

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Call = { target: string; op: string; values?: unknown; filters: Record<string, unknown> };

const ok = (data: unknown): Result => ({ data, error: null });
const broken = (code?: string): Result => ({ data: null, error: { message: 'broken', code } });

/**
 * A Supabase client that answers each `table:operation` and `storage:<call>`
 * from `answers` and records what was asked. A database call without an
 * answer throws, so a test also proves what was never sent. Storage answers
 * default to success; an answer may be a function of the call's argument.
 */
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
				// Like the real client: a lookup that fails throws.
				exists: async (path: string) => {
					const result = await storageCall('exists', path, ok(false));
					if (result.error && result.data === null) throw new Error(result.error.message);
					return result;
				},
				createSignedUrl: (path: string, seconds: number, options: unknown) =>
					storageCall(
						'sign',
						{ bucket, path, seconds, options },
						ok({ signedUrl: `https://storage.example/${path}?token=t` })
					)
			})
		}
	};
	return { supabase: client as unknown as SupabaseClient<Database>, calls };
}

const user = { id: 'teacher-1' } as User;

/** The section as `sectionFiles` reads it, holding `count` files (the first is FILE at OLD_PATH). */
const sectionWith = (count: number) =>
	ok({
		id: SECTION,
		class_syllabus_section_files: Array.from({ length: count }, (_, i) =>
			i === 0
				? { id: FILE, object_path: OLD_PATH }
				: { id: `file-${i}`, object_path: `${CLASS}/${SECTION}/other-${i}.pdf` }
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
			// A browser's form post always says how long it is.
			request: new Request('http://localhost/x', {
				method: 'POST',
				body,
				headers: { 'content-length': '2000', ...headers }
			}),
			classId: CLASS,
			syllabusId: SYLLABUS,
			supabase,
			user: user as User | null
		}
	};
}

/** Everything that changed something: database writes and storage uploads / removals. */
const writes = (calls: Call[]) =>
	calls
		.filter((c) => !['select', 'exists', 'sign'].includes(c.op))
		.map((c) => `${c.target}:${c.op}`);
const genericFailure = () => ({ status: 400, data: { error: m.syllabus_error_failed() } });
const fieldFailure = (message: string, fileId: string | null) => ({
	status: 400,
	data: { fileError: message, fileSectionId: SECTION, fileId }
});

describe('uploadFile', () => {
	it("stores the PDF under a random name in the section's folder and records its name and size", async () => {
		const { ctx, calls } = context(
			{
				'class_syllabus_sections:select': sectionWith(0),
				'class_syllabus_section_files:insert': ok([{ id: FILE }])
			},
			{ sectionId: SECTION, file: pdf('Song 1 lyrics.pdf', 300 * 1024) }
		);
		expect(await uploadFile(ctx)).toEqual({
			success: true,
			action: 'fileUploaded',
			fileSectionId: SECTION
		});
		// The section is tied to the route's syllabus and class by the query.
		expect(calls[0].filters).toEqual({
			id: SECTION,
			syllabus_id: SYLLABUS,
			'class_syllabi.class_id': CLASS
		});
		const upload = calls.find((c) => c.op === 'upload')!.values as {
			bucket: string;
			path: string;
			size: number;
			options: unknown;
		};
		expect(upload).toMatchObject({
			bucket: 'syllabus-files',
			size: 300 * 1024,
			options: { contentType: 'application/pdf', upsert: false }
		});
		expect(upload.path).toMatch(NEW_PATH);
		expect(upload.path).not.toContain('Song');
		expect(calls.find((c) => c.op === 'insert')!.values).toEqual({
			section_id: SECTION,
			object_path: upload.path,
			file_name: 'Song 1 lyrics.pdf',
			size_bytes: 300 * 1024,
			created_by: 'teacher-1'
		});
	});

	it('too large, not a PDF, or no file: a message for the field and nothing stored', async () => {
		const cases: [File | string, string][] = [
			[pdf('big.pdf', MAX_FILE_BYTES + 1), fileTooLargeMessage()],
			[new File(['PK not a pdf'], 'notes.docx'), m.syllabus_file_error_not_pdf()],
			[
				new File(['hello'], 'fake.pdf', { type: 'application/pdf' }),
				m.syllabus_file_error_not_pdf()
			],
			[new File([], ''), m.syllabus_file_error_missing()],
			['', m.syllabus_file_error_missing()]
		];
		for (const [file, message] of cases) {
			const { ctx, calls } = context(
				{ 'class_syllabus_sections:select': sectionWith(0) },
				{ sectionId: SECTION, file }
			);
			expect(await uploadFile(ctx), message).toMatchObject(fieldFailure(message, null));
			expect(writes(calls)).toEqual([]);
		}
		expect(fileTooLargeMessage()).toBe('The file is too large. A PDF can be up to 1.0 MB.');
		expect(m.syllabus_file_error_not_pdf()).toBe('PDF files only.');
	});

	it('a post far over the limit is refused before it is read', async () => {
		const { ctx, calls } = context(
			{},
			{ sectionId: SECTION, file: pdf() },
			{ 'content-length': String(30 * 1024 * 1024) }
		);
		expect(await uploadFile(ctx)).toMatchObject({
			status: 413,
			data: { error: fileTooLargeMessage() }
		});
		expect(calls).toEqual([]);
	});

	/** The form as a browser posts it, as bytes with its content type. */
	async function posted(fields: Record<string, string | File>) {
		const body = new FormData();
		for (const [key, value] of Object.entries(fields)) body.set(key, value);
		const whole = new Request('http://localhost/x', { method: 'POST', body });
		return {
			type: whole.headers.get('content-type')!,
			bytes: new Uint8Array(await whole.arrayBuffer())
		};
	}

	/** A post whose body arrives in pieces, with `length` as its Content-Length (null: none). */
	function streamed(type: string, pieces: Uint8Array[], length: string | null) {
		const state = { pulled: 0, cancelled: false };
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					if (state.pulled === pieces.length) return controller.close();
					controller.enqueue(pieces[state.pulled]);
					state.pulled += 1;
				},
				cancel() {
					state.cancelled = true;
				}
			},
			{ highWaterMark: 0 }
		);
		const request = new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { 'content-type': type, ...(length === null ? {} : { 'content-length': length }) },
			duplex: 'half'
		} as RequestInit);
		return { request, state };
	}

	it('a post that does not say how long it is still works when it is small enough', async () => {
		for (const length of [null, '', 'lots', '-5', '1e3']) {
			for (const [action, write] of [
				[uploadFile, 'insert'],
				[replaceFile, 'update']
			] as const) {
				const { supabase, calls } = fakeSupabase({
					'class_syllabus_sections:select': sectionWith(1),
					[`class_syllabus_section_files:${write}`]: ok([{ id: FILE }])
				});
				const form = await posted({ sectionId: SECTION, fileId: FILE, file: pdf('a.pdf', 5000) });
				// In two pieces, as a network delivers it.
				const { request } = streamed(
					form.type,
					[form.bytes.subarray(0, 100), form.bytes.subarray(100)],
					length
				);
				const ctx = { request, classId: CLASS, syllabusId: SYLLABUS, supabase, user };
				expect(await action(ctx), String(length)).toMatchObject({ success: true });
				expect(calls.find((c) => c.op === write)!.values).toMatchObject({
					file_name: 'a.pdf',
					size_bytes: 5000
				});
			}
		}
	});

	it('a large post that does not say how long it is is refused at the limit, without being read to the end', async () => {
		// 40 pieces of 100 KB: about 4 MB, of which a little over 1 MB may be read.
		const pieces = Array.from({ length: 40 }, () => new Uint8Array(100 * 1024));
		for (const action of [uploadFile, replaceFile]) {
			const { supabase, calls } = fakeSupabase({});
			const { request, state } = streamed('multipart/form-data; boundary=x', pieces, null);
			const ctx = { request, classId: CLASS, syllabusId: SYLLABUS, supabase, user };
			expect(await action(ctx)).toMatchObject({
				status: 413,
				data: { error: fileTooLargeMessage() }
			});
			expect(state.pulled).toBeLessThanOrEqual(12);
			expect(state.cancelled).toBe(true);
			expect(calls).toEqual([]);
		}
	});

	it('a post that is not a form: 400, nothing asked', async () => {
		const { supabase, calls } = fakeSupabase({});
		const { request } = streamed('multipart/form-data; boundary=x', [new Uint8Array(10)], null);
		const ctx = { request, classId: CLASS, syllabusId: SYLLABUS, supabase, user };
		expect(await uploadFile(ctx)).toMatchObject({
			status: 400,
			data: { error: m.syllabus_file_error_failed() }
		});
		expect(calls).toEqual([]);
	});

	it('a clean-up that fails names the object left behind in the server log', async () => {
		const logged: string[] = [];
		const spy = vi.spyOn(console, 'error').mockImplementation((text) => void logged.push(text));
		try {
			const { ctx, calls } = context(
				{
					'class_syllabus_sections:select': sectionWith(1),
					'class_syllabus_section_files:insert': ok([]),
					'storage:remove': broken()
				},
				{ sectionId: SECTION, file: pdf() }
			);
			expect(await uploadFile(ctx)).toMatchObject({ status: 400 });
			const uploaded = (calls.find((c) => c.op === 'upload')!.values as { path: string }).path;
			expect(logged.some((line) => line.includes('left behind') && line.includes(uploaded))).toBe(
				true
			);
		} finally {
			spy.mockRestore();
		}
	});

	it('a sixth file is refused, naming the limit, and nothing is stored', async () => {
		const { ctx, calls } = context(
			{ 'class_syllabus_sections:select': sectionWith(5) },
			{ sectionId: SECTION, file: pdf() }
		);
		expect(await uploadFile(ctx)).toMatchObject(fieldFailure(fileLimitMessage(), null));
		expect(fileLimitMessage()).toBe('A section can have at most 5 files.');
		expect(writes(calls)).toEqual([]);
	});

	it("the database's own limit (two uploads at once): the object is removed again", async () => {
		const { ctx, calls } = context(
			{
				'class_syllabus_sections:select': sectionWith(4),
				'class_syllabus_section_files:insert': broken(FILE_LIMIT_ERROR_CODE)
			},
			{ sectionId: SECTION, file: pdf() }
		);
		expect(await uploadFile(ctx)).toMatchObject(fieldFailure(fileLimitMessage(), null));
		const uploaded = (calls.find((c) => c.op === 'upload')!.values as { path: string }).path;
		expect(calls.find((c) => c.op === 'remove')!.values).toEqual([uploaded]);
	});

	it('a row that cannot be inserted leaves no object behind', async () => {
		const { ctx, calls } = context(
			{
				'class_syllabus_sections:select': sectionWith(1),
				'class_syllabus_section_files:insert': ok([])
			},
			{ sectionId: SECTION, file: pdf() }
		);
		expect(await uploadFile(ctx)).toMatchObject({
			status: 400,
			data: { error: m.syllabus_file_error_failed() }
		});
		expect(writes(calls)).toEqual([
			'storage:upload',
			'class_syllabus_section_files:insert',
			'storage:remove'
		]);
	});

	it('storage refuses the upload: no row', async () => {
		const { ctx, calls } = context(
			{ 'class_syllabus_sections:select': sectionWith(0), 'storage:upload': broken() },
			{ sectionId: SECTION, file: pdf() }
		);
		expect(await uploadFile(ctx)).toMatchObject({
			status: 400,
			data: { error: m.syllabus_file_error_failed() }
		});
		expect(writes(calls)).toEqual(['storage:upload']);
	});

	it('wrong class, syllabus or section (no row, or no uuid): 400, generic error, nothing stored', async () => {
		const missing = context(
			{ 'class_syllabus_sections:select': ok(null) },
			{ sectionId: SECTION, file: pdf() }
		);
		expect(await uploadFile(missing.ctx)).toMatchObject(genericFailure());
		expect(writes(missing.calls)).toEqual([]);

		const noId = context({}, { sectionId: 'nonsense', file: pdf() });
		expect(await uploadFile(noId.ctx)).toMatchObject(genericFailure());
		expect(noId.calls).toEqual([]);
	});

	it('signed out: 401, nothing asked', async () => {
		const { ctx, calls } = context({}, { sectionId: SECTION, file: pdf() });
		expect(await uploadFile({ ...ctx, user: null })).toMatchObject({ status: 401 });
		expect(calls).toEqual([]);
	});
});

describe('replaceFile', () => {
	it('same row with the new name and size; the old object is removed after the row points at the new one', async () => {
		const { ctx, calls } = context(
			{
				'class_syllabus_sections:select': sectionWith(2),
				'class_syllabus_section_files:update': ok([{ id: FILE }])
			},
			{ sectionId: SECTION, fileId: FILE, file: pdf('Lyrics v2.pdf', 2048) }
		);
		expect(await replaceFile(ctx)).toEqual({
			success: true,
			action: 'fileReplaced',
			fileSectionId: SECTION
		});
		expect(writes(calls)).toEqual([
			'storage:upload',
			'class_syllabus_section_files:update',
			'storage:remove'
		]);
		const uploaded = (calls.find((c) => c.op === 'upload')!.values as { path: string }).path;
		expect(uploaded).toMatch(NEW_PATH);
		expect(uploaded).not.toBe(OLD_PATH);
		const update = calls.find((c) => c.op === 'update')!;
		expect(update.filters).toEqual({ id: FILE, section_id: SECTION, object_path: OLD_PATH });
		expect(update.values).toMatchObject({
			object_path: uploaded,
			file_name: 'Lyrics v2.pdf',
			size_bytes: 2048
		});
		// created_at is not touched: the file keeps its place in the list.
		expect(update.values).not.toHaveProperty('created_at');
		expect(calls.find((c) => c.op === 'remove')!.values).toEqual([OLD_PATH]);
	});

	it('an invalid file: the old one stays, with a message at that file', async () => {
		const cases: [File, string][] = [
			[pdf('big.pdf', MAX_FILE_BYTES + 1), fileTooLargeMessage()],
			[new File(['PK'], 'notes.docx'), m.syllabus_file_error_not_pdf()],
			[new File([], ''), m.syllabus_file_error_missing()]
		];
		for (const [file, message] of cases) {
			const { ctx, calls } = context(
				{ 'class_syllabus_sections:select': sectionWith(1) },
				{ sectionId: SECTION, fileId: FILE, file }
			);
			expect(await replaceFile(ctx)).toMatchObject(fieldFailure(message, FILE));
			expect(writes(calls)).toEqual([]);
		}
	});

	it('the row cannot be changed: the new object goes again and the old one stays', async () => {
		const { ctx, calls } = context(
			{
				'class_syllabus_sections:select': sectionWith(1),
				'class_syllabus_section_files:update': ok([])
			},
			{ sectionId: SECTION, fileId: FILE, file: pdf() }
		);
		expect(await replaceFile(ctx)).toMatchObject({ status: 400 });
		const uploaded = (calls.find((c) => c.op === 'upload')!.values as { path: string }).path;
		expect(calls.filter((c) => c.op === 'remove').map((c) => c.values)).toEqual([[uploaded]]);
	});

	it("two replaces at once: the later one matches no row (the object it read is no longer the row's) and removes only its own new object", async () => {
		const { ctx, calls } = context(
			{
				'class_syllabus_sections:select': sectionWith(1),
				// The first replace already pointed the row at another object.
				'class_syllabus_section_files:update': (call) =>
					ok((call as Call).filters.object_path === OLD_PATH ? [] : [{ id: FILE }])
			},
			{ sectionId: SECTION, fileId: FILE, file: pdf() }
		);
		expect(await replaceFile(ctx)).toMatchObject({
			status: 400,
			data: { error: m.syllabus_file_error_failed() }
		});
		const uploaded = (calls.find((c) => c.op === 'upload')!.values as { path: string }).path;
		expect(calls.filter((c) => c.op === 'remove').map((c) => c.values)).toEqual([[uploaded]]);
	});

	it('the old object cannot be removed after the row changed: still replaced, and the object is named in the log', async () => {
		const logged: string[] = [];
		const spy = vi.spyOn(console, 'error').mockImplementation((text) => void logged.push(text));
		try {
			const { ctx } = context(
				{
					'class_syllabus_sections:select': sectionWith(1),
					'class_syllabus_section_files:update': ok([{ id: FILE }]),
					'storage:remove': broken()
				},
				{ sectionId: SECTION, fileId: FILE, file: pdf() }
			);
			expect(await replaceFile(ctx)).toMatchObject({ success: true, action: 'fileReplaced' });
			expect(logged.some((line) => line.includes('left behind') && line.includes(OLD_PATH))).toBe(
				true
			);
		} finally {
			spy.mockRestore();
		}
	});

	it('a file id of another section or class: 400, generic error, nothing changed', async () => {
		for (const answers of [
			{ 'class_syllabus_sections:select': sectionWith(0) },
			{ 'class_syllabus_sections:select': ok(null) }
		]) {
			const { ctx, calls } = context(answers, { sectionId: SECTION, fileId: FILE, file: pdf() });
			expect(await replaceFile(ctx)).toMatchObject(genericFailure());
			expect(writes(calls)).toEqual([]);
		}
	});
});

describe('deleteFile', () => {
	it('removes the stored object, then the row', async () => {
		const { ctx, calls } = context(
			{
				'class_syllabus_sections:select': sectionWith(2),
				'class_syllabus_section_files:delete': ok([{ id: FILE }])
			},
			{ sectionId: SECTION, fileId: FILE }
		);
		expect(await deleteFile(ctx)).toEqual({
			success: true,
			action: 'fileDeleted',
			fileSectionId: SECTION
		});
		expect(writes(calls)).toEqual(['storage:remove', 'class_syllabus_section_files:delete']);
		expect(calls.find((c) => c.op === 'remove')!.values).toEqual([OLD_PATH]);
		expect(calls.find((c) => c.op === 'delete')!.filters).toEqual({
			id: FILE,
			section_id: SECTION,
			object_path: OLD_PATH
		});
	});

	it('storage cannot remove the object: refused with an error and the row stays', async () => {
		const failing = context(
			{ 'class_syllabus_sections:select': sectionWith(1), 'storage:remove': broken() },
			{ sectionId: SECTION, fileId: FILE }
		);
		expect(await deleteFile(failing.ctx)).toMatchObject({
			status: 400,
			data: { error: m.syllabus_file_error_storage() }
		});
		expect(writes(failing.calls)).toEqual(['storage:remove']);

		// Storage answers "nothing removed" (how it refuses) and the object is still there.
		const silent = context(
			{
				'class_syllabus_sections:select': sectionWith(1),
				'storage:remove': ok([]),
				'storage:exists': ok(true)
			},
			{ sectionId: SECTION, fileId: FILE }
		);
		expect(await deleteFile(silent.ctx)).toMatchObject({ status: 400 });
		expect(writes(silent.calls)).toEqual(['storage:remove']);
	});

	it('storage does not report the object removed and the lookup fails: not removed, the row stays', async () => {
		const { ctx, calls } = context(
			{
				'class_syllabus_sections:select': sectionWith(1),
				'storage:remove': ok([]),
				'storage:exists': broken()
			},
			{ sectionId: SECTION, fileId: FILE }
		);
		expect(await deleteFile(ctx)).toMatchObject({
			status: 400,
			data: { error: m.syllabus_file_error_storage() }
		});
		expect(writes(calls)).toEqual(['storage:remove']);

		// A lookup answered with an error that is not "not there" does not count as gone either.
		const odd = context(
			{
				'class_syllabus_sections:select': sectionWith(1),
				'storage:remove': ok([]),
				'storage:exists': { data: false, error: { message: 'boom', status: 500 } } as never
			},
			{ sectionId: SECTION, fileId: FILE }
		);
		expect(await deleteFile(odd.ctx)).toMatchObject({ status: 400 });
		expect(writes(odd.calls)).toEqual(['storage:remove']);
	});

	it('a remove racing a replace: the row now points at another object, so it stays; generic failure', async () => {
		const { ctx, calls } = context(
			{
				'class_syllabus_sections:select': sectionWith(1),
				'class_syllabus_section_files:delete': (call) =>
					ok((call as Call).filters.object_path === OLD_PATH ? [] : [{ id: FILE }])
			},
			{ sectionId: SECTION, fileId: FILE }
		);
		expect(await deleteFile(ctx)).toMatchObject(genericFailure());
		expect(calls.find((c) => c.op === 'remove')!.values).toEqual([OLD_PATH]);
	});

	it('an object that is already gone does not block removing its row', async () => {
		const { ctx, calls } = context(
			{
				'class_syllabus_sections:select': sectionWith(1),
				'storage:remove': ok([]),
				// How the real client says "not there".
				'storage:exists': { data: false, error: { message: 'Not found', status: 404 } } as never,
				'class_syllabus_section_files:delete': ok([{ id: FILE }])
			},
			{ sectionId: SECTION, fileId: FILE }
		);
		expect(await deleteFile(ctx)).toMatchObject({ success: true });
		expect(writes(calls)).toEqual(['storage:remove', 'class_syllabus_section_files:delete']);
	});

	it('wrong class or unknown file: 400, generic error, nothing removed', async () => {
		for (const answers of [
			{ 'class_syllabus_sections:select': ok(null) },
			{ 'class_syllabus_sections:select': sectionWith(0) }
		]) {
			const { ctx, calls } = context(answers, { sectionId: SECTION, fileId: FILE });
			expect(await deleteFile(ctx)).toMatchObject(genericFailure());
			expect(writes(calls)).toEqual([]);
		}
	});
});

describe('removeStoredFiles', () => {
	/** File rows that are gone once deleted, read `perPage` at a time. */
	function store(total: number, perPage = 100) {
		let rows = Array.from({ length: total }, (_, i) => ({
			id: `f${i}`,
			object_path: `${CLASS}/${SECTION}/${i}.pdf`
		}));
		return {
			'class_syllabus_section_files:select': () => ok(rows.slice(0, perPage)),
			'class_syllabus_section_files:delete': (call: unknown) => {
				const ids = (call as Call).filters.id as string[];
				rows = rows.filter((row) => !ids.includes(row.id));
				return ok(ids.map((id) => ({ id })));
			}
		};
	}

	it("a class: every file's object and row, however many there are", async () => {
		const { supabase, calls } = fakeSupabase(store(250));
		expect(await removeStoredFiles(supabase, { classId: CLASS })).toEqual({
			ok: true,
			removed: 250
		});
		const removed = calls.filter((c) => c.op === 'remove').flatMap((c) => c.values as string[]);
		expect(removed).toHaveLength(250);
		expect(new Set(removed).size).toBe(250);
		expect(calls[0].filters).toEqual({ 'class_syllabus_sections.class_syllabi.class_id': CLASS });
	});

	it('nothing stored: true, and nothing is removed', async () => {
		const { supabase, calls } = fakeSupabase(store(0));
		expect(await removeStoredFiles(supabase, { classId: CLASS, syllabusId: SYLLABUS })).toEqual({
			ok: true,
			removed: 0
		});
		expect(calls.map((c) => c.op)).toEqual(['select']);
	});

	it('false when the files cannot be listed, removed, or their rows deleted', async () => {
		const unlisted = fakeSupabase({ 'class_syllabus_section_files:select': broken() });
		expect(await removeStoredFiles(unlisted.supabase, { classId: CLASS })).toMatchObject({
			ok: false
		});

		const stuck = fakeSupabase({ ...store(3), 'storage:remove': broken() });
		expect(await removeStoredFiles(stuck.supabase, { classId: CLASS })).toEqual({
			ok: false,
			removed: 0
		});
		expect(stuck.calls.some((c) => c.op === 'delete')).toBe(false);

		const rowsStay = fakeSupabase({
			...store(3),
			'class_syllabus_section_files:delete': ok([])
		});
		expect(await removeStoredFiles(rowsStay.supabase, { classId: CLASS })).toMatchObject({
			ok: false
		});
	});

	it('an id that is no id matches nothing and asks nothing', async () => {
		const { supabase, calls } = fakeSupabase({});
		expect(await removeStoredFiles(supabase, { classId: 'nonsense' })).toEqual({
			ok: true,
			removed: 0
		});
		expect(calls).toEqual([]);
	});
});

describe('signedFileUrl', () => {
	const row = ok({ object_path: OLD_PATH, file_name: 'Song 1 lyrics.pdf' });

	it('a link valid for about a minute; ?download carries the original name', async () => {
		const shown = fakeSupabase({ 'class_syllabus_section_files:select': row });
		expect(await signedFileUrl(shown.supabase, FILE, false)).toBe(
			`https://storage.example/${OLD_PATH}?token=t`
		);
		expect(shown.calls.find((c) => c.op === 'sign')!.values).toEqual({
			bucket: 'syllabus-files',
			path: OLD_PATH,
			seconds: 60,
			options: undefined
		});

		// The name is added to the address once, encoded once (Tibetan stays readable).
		const tibetan = fakeSupabase({
			'class_syllabus_section_files:select': ok({ object_path: OLD_PATH, file_name: 'གཞས་ 1.pdf' })
		});
		expect(await signedFileUrl(tibetan.supabase, FILE, true)).toBe(
			`https://storage.example/${OLD_PATH}?token=t&download=${encodeURIComponent('གཞས་ 1.pdf')}`
		);
		expect(tibetan.calls.find((c) => c.op === 'sign')!.values).toMatchObject({
			options: undefined
		});
	});

	it('no row (not in the class, or unknown): no link is asked for', async () => {
		const { supabase, calls } = fakeSupabase({ 'class_syllabus_section_files:select': ok(null) });
		expect(await signedFileUrl(supabase, FILE, false)).toBeNull();
		expect(calls.some((c) => c.target === 'storage')).toBe(false);
	});

	it('an id that is no id, or storage refusing: null', async () => {
		const none = fakeSupabase({});
		expect(await signedFileUrl(none.supabase, "x' or 1=1", false)).toBeNull();
		expect(none.calls).toEqual([]);

		const refused = fakeSupabase({
			'class_syllabus_section_files:select': row,
			'storage:sign': broken()
		});
		expect(await signedFileUrl(refused.supabase, FILE, false)).toBeNull();
	});
});
