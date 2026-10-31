import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import type { Database } from '$lib/supabase/database.types';
import {
	MAX_BOARD_FILE_BYTES,
	MAX_FILES_PER_POST,
	boardFileLimitMessage,
	boardFilePostTooLargeMessage,
	boardFileTooLargeMessage
} from '$lib/board-files';
import {
	BOARD_FILES_BUCKET,
	BOARD_FILE_LIMIT_ERROR_CODE,
	MAX_BOARD_POST_BYTES,
	attachPostFiles,
	loadBoardFiles,
	readPostFiles,
	readPostForm,
	removePostObjects,
	signedBoardFileUrl
} from './board-files';
import { MAX_CONTENT_BYTES } from '$lib/rich-text';

/**
 * spec-parent-message-board story 4: board post PDF files. The fake client
 * of homework-files.spec.ts: every `table:operation` and `storage:<call>` is
 * answered from `answers` and recorded, so a test also proves what was
 * never sent.
 */

const POST = '33333333-3333-4333-8333-333333333333';
const FILE = '44444444-4444-4444-8444-444444444444';
const PATH = `${POST}/55555555-5555-4555-8555-555555555555.pdf`;

function pdf(name = 'Flyer.pdf', size = 1000): File {
	const bytes = new Uint8Array(size);
	bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
	return new File([bytes], name, { type: 'application/pdf' });
}

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Call = {
	target: string;
	op: string;
	values?: unknown;
	filters: Record<string, unknown>;
	orders: unknown[][];
	selected?: string;
};

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
		calls.push({ target: 'storage', op, values, filters: {}, orders: [] });
		return Promise.resolve(answer(`storage:${op}`, values, fallback));
	};
	const client = {
		from(table: string) {
			const call: Call = { target: table, op: 'select', filters: {}, orders: [] };
			calls.push(call);
			const chain = {
				select: (columns?: string) => ((call.selected ??= columns), chain),
				insert: (values: unknown) => ((call.op = 'insert'), (call.values = values), chain),
				eq: (column: string, value: unknown) => ((call.filters[column] = value), chain),
				in: (column: string, value: unknown) => ((call.filters[column] = value), chain),
				order: (...args: unknown[]) => (call.orders.push(args), chain),
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
				exists: async (path: string) => storageCall('exists', path, ok(false)),
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

const user = { id: 'parent-1' } as App.SessionUser;
const writes = (calls: Call[]) =>
	calls
		.filter((c) => !['select', 'exists', 'sign'].includes(c.op))
		.map((c) => `${c.target}:${c.op}`);
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('limits', () => {
	it('the homework rules: 5 MB each, 2 per post; the body cap holds both and the content', () => {
		expect(MAX_BOARD_FILE_BYTES).toBe(5_242_880);
		expect(MAX_FILES_PER_POST).toBe(2);
		expect(MAX_BOARD_POST_BYTES).toBeGreaterThan(2 * MAX_BOARD_FILE_BYTES + MAX_CONTENT_BYTES);
		expect(boardFileLimitMessage()).toBe(m.board_file_error_limit({ count: '2' }));
		expect(boardFilePostTooLargeMessage()).toBe(
			m.board_file_error_post_too_large({ count: '2', size: '5.0 MB' })
		);
	});
});

describe('readPostForm', () => {
	it('a body over the cap: 413', async () => {
		const request = new Request('http://localhost/board', {
			method: 'POST',
			body: new FormData(),
			headers: { 'content-length': String(MAX_BOARD_POST_BYTES + 1) }
		});
		expect(await readPostForm(request)).toMatchObject({
			refused: {
				status: 413,
				data: { error: boardFilePostTooLargeMessage(), fileError: boardFilePostTooLargeMessage() }
			}
		});
	});

	it('a body over the cap without a usable length: 413 once it passes the cap', async () => {
		const big = new Uint8Array(MAX_BOARD_POST_BYTES + 1);
		const request = new Request('http://localhost/board', {
			method: 'POST',
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(big);
					controller.close();
				}
			}),
			headers: { 'content-type': 'multipart/form-data; boundary=x' },
			duplex: 'half'
		} as RequestInit);
		expect(await readPostForm(request)).toMatchObject({ refused: { status: 413 } });
	});

	it('a body that is not a form: 400', async () => {
		const request = new Request('http://localhost/board', {
			method: 'POST',
			body: 'nope',
			headers: { 'content-type': 'multipart/form-data; boundary=x' }
		});
		expect(await readPostForm(request)).toMatchObject({
			refused: { status: 400, data: { error: m.board_error_post_failed() } }
		});
	});

	it('a form: its fields', async () => {
		const body = new FormData();
		body.set('content', 'x');
		body.append('files', pdf());
		const result = await readPostForm(
			new Request('http://localhost/board', { method: 'POST', body })
		);
		expect('formData' in result && result.formData.get('content')).toBe('x');
	});
});

describe('readPostFiles', () => {
	const form = (...files: File[]) => {
		const data = new FormData();
		for (const file of files) data.append('files', file);
		return data;
	};

	it('none chosen (an empty input sends an empty file): no files, fine', async () => {
		expect(await readPostFiles(new FormData())).toEqual({ ok: true, files: [] });
		expect(await readPostFiles(form(new File([], '')))).toEqual({ ok: true, files: [] });
	});

	it('two valid PDFs, one of exactly 5 MB: both, with their names', async () => {
		const result = await readPostFiles(
			form(pdf('a.pdf', 1000), pdf('b.pdf', MAX_BOARD_FILE_BYTES))
		);
		expect(result.ok && result.files.map((f) => [f.name, f.bytes.byteLength])).toEqual([
			['a.pdf', 1000],
			['b.pdf', MAX_BOARD_FILE_BYTES]
		]);
	});

	it('three files: the limit of 2', async () => {
		expect(await readPostFiles(form(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')))).toEqual({
			ok: false,
			message: boardFileLimitMessage()
		});
	});

	it('not a PDF (magic bytes, whatever the name), or over 5 MB: the message names the file', async () => {
		expect(await readPostFiles(form(new File(['PK'], 'notes.docx')))).toEqual({
			ok: false,
			message: m.homework_file_error_named({
				name: 'notes.docx',
				message: m.homework_file_error_not_pdf()
			})
		});
		expect(await readPostFiles(form(new File(['PK'], 'fake.pdf')))).toMatchObject({ ok: false });
		// Without any folder or control characters.
		expect(await readPostFiles(form(new File(['PK'], 'C:\\me\\no\u0000tes.docx')))).toEqual({
			ok: false,
			message: m.homework_file_error_named({
				name: 'notes.docx',
				message: m.homework_file_error_not_pdf()
			})
		});
		expect(await readPostFiles(form(pdf('a.pdf'), pdf('big.pdf', 5_242_881)))).toEqual({
			ok: false,
			message: m.homework_file_error_named({
				name: 'big.pdf',
				message: boardFileTooLargeMessage()
			})
		});
	});
});

describe('attachPostFiles', () => {
	const files = [
		{ name: 'a.pdf', bytes: new ArrayBuffer(10) },
		{ name: 'b.pdf', bytes: new ArrayBuffer(20) }
	];

	it("stores each file in the post's folder of board-files, then records it", async () => {
		const { supabase, calls } = fakeSupabase({
			'board_post_files:insert': ok([{ id: FILE }])
		});
		expect(await attachPostFiles(supabase, user, POST, files)).toEqual([]);
		expect(writes(calls)).toEqual([
			'storage:upload',
			'board_post_files:insert',
			'storage:upload',
			'board_post_files:insert'
		]);
		const uploads = calls.filter((c) => c.op === 'upload');
		for (const upload of uploads) {
			expect(upload.values).toMatchObject({
				bucket: BOARD_FILES_BUCKET,
				path: expect.stringMatching(new RegExp(`^${POST}/[0-9a-f-]{36}\\.pdf$`)),
				options: { contentType: 'application/pdf', upsert: false }
			});
		}
		const rows = calls.filter((c) => c.op === 'insert').map((c) => c.values);
		expect(rows).toEqual([
			{
				post_id: POST,
				object_path: (uploads[0].values as { path: string }).path,
				file_name: 'a.pdf',
				size_bytes: 10,
				created_by: 'parent-1'
			},
			{
				post_id: POST,
				object_path: (uploads[1].values as { path: string }).path,
				file_name: 'b.pdf',
				size_bytes: 20,
				created_by: 'parent-1'
			}
		]);
	});

	it('the row fails (DB error or BF001): the object is removed and the file is named', async () => {
		for (const code of [undefined, BOARD_FILE_LIMIT_ERROR_CODE]) {
			const spy = quiet();
			let inserts = 0;
			const { supabase, calls } = fakeSupabase({
				'board_post_files:insert': () => ((inserts += 1) === 1 ? ok([{ id: FILE }]) : broken(code))
			});
			expect(await attachPostFiles(supabase, user, POST, files)).toEqual(['b.pdf']);
			expect(writes(calls)).toEqual([
				'storage:upload',
				'board_post_files:insert',
				'storage:upload',
				'board_post_files:insert',
				'storage:remove'
			]);
			expect(spy).toHaveBeenCalledWith(
				`board post ${POST}: file not attached (${code ? 'limit' : 'failed'})`
			);
			vi.restoreAllMocks();
		}
	});

	it('storage refuses the upload: no row, the file is named', async () => {
		quiet();
		const { supabase, calls } = fakeSupabase({ 'storage:upload': broken() });
		expect(await attachPostFiles(supabase, user, POST, files.slice(0, 1))).toEqual(['a.pdf']);
		expect(writes(calls)).toEqual(['storage:upload']);
	});
});

describe('loadBoardFiles', () => {
	it("one query for every post; groups each post's files in created_at order", async () => {
		const other = '66666666-6666-4666-8666-666666666666';
		const { supabase, calls } = fakeSupabase({
			'board_post_files:select': ok([
				{ id: 'f1', post_id: POST, file_name: 'a.pdf', size_bytes: 10 },
				{ id: 'f2', post_id: other, file_name: 'c.pdf', size_bytes: 30 },
				{ id: 'f3', post_id: POST, file_name: 'b.pdf', size_bytes: 20 }
			])
		});
		const { files, error } = await loadBoardFiles(supabase, [POST, other, POST, 'not-a-uuid']);
		expect(error).toBe(false);
		expect(files.get(POST)).toEqual([
			{ id: 'f1', name: 'a.pdf', size: 10 },
			{ id: 'f3', name: 'b.pdf', size: 20 }
		]);
		expect(files.get(other)).toEqual([{ id: 'f2', name: 'c.pdf', size: 30 }]);
		expect(calls).toHaveLength(1);
		expect(calls[0].selected).toBe('id, post_id, file_name, size_bytes');
		expect(calls[0].filters).toEqual({ post_id: [POST, other] });
		expect(calls[0].orders[0]).toEqual(['created_at', { ascending: true }]);
	});

	it('no posts: nothing asked', async () => {
		const { supabase, calls } = fakeSupabase({});
		expect((await loadBoardFiles(supabase, [])).files.size).toBe(0);
		expect(calls).toEqual([]);
	});

	it('a read error: no files, error, logged', async () => {
		const spy = quiet();
		const { supabase } = fakeSupabase({ 'board_post_files:select': broken() });
		const result = await loadBoardFiles(supabase, [POST]);
		expect(result.error).toBe(true);
		expect(result.files.size).toBe(0);
		expect(spy).toHaveBeenCalledWith('board files could not be read: broken');
	});
});

describe('signedBoardFileUrl', () => {
	it('a link valid for 60 s; download carries the original name', async () => {
		const { supabase, calls } = fakeSupabase({
			'board_post_files:select': ok({ object_path: PATH, file_name: 'གཞས་ཚིག.pdf' })
		});
		expect(await signedBoardFileUrl(supabase, FILE, false)).toEqual({
			url: `https://storage.example/${PATH}?token=t`
		});
		expect(await signedBoardFileUrl(supabase, FILE, true)).toEqual({
			url: `https://storage.example/${PATH}?token=t&download=${encodeURIComponent('གཞས་ཚིག.pdf')}`
		});
		expect(calls.find((c) => c.op === 'sign')!.values).toEqual({
			bucket: BOARD_FILES_BUCKET,
			path: PATH,
			seconds: 60
		});
		expect(calls[0].filters).toEqual({ id: FILE });
	});

	it('no row (not a reader, or unknown), or no uuid: notFound, no link asked for', async () => {
		const { supabase, calls } = fakeSupabase({ 'board_post_files:select': ok(null) });
		expect(await signedBoardFileUrl(supabase, FILE, false)).toEqual({ problem: 'notFound' });
		expect(await signedBoardFileUrl(supabase, 'nope', false)).toEqual({ problem: 'notFound' });
		expect(calls.filter((c) => c.op === 'sign')).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it('storage refuses to sign: failed', async () => {
		quiet();
		const { supabase } = fakeSupabase({
			'board_post_files:select': ok({ object_path: PATH, file_name: 'a.pdf' }),
			'storage:sign': broken()
		});
		expect(await signedBoardFileUrl(supabase, FILE, false)).toEqual({ problem: 'failed' });
	});
});

describe('removePostObjects (story 5)', () => {
	const OTHER_PATH = `${POST}/66666666-6666-4666-8666-666666666666.pdf`;

	it("reads the post's object paths, then removes them from board-files: true", async () => {
		const { supabase, calls } = fakeSupabase({
			'board_post_files:select': ok([{ object_path: PATH }, { object_path: OTHER_PATH }])
		});
		expect(await removePostObjects(supabase, POST)).toBe(true);
		expect(calls[0]).toMatchObject({
			target: 'board_post_files',
			selected: 'object_path',
			filters: { post_id: POST }
		});
		expect(calls.filter((c) => c.op === 'remove').map((c) => c.values)).toEqual([
			[PATH, OTHER_PATH]
		]);
	});

	it('no files: true, nothing removed', async () => {
		const { supabase, calls } = fakeSupabase({ 'board_post_files:select': ok([]) });
		expect(await removePostObjects(supabase, POST)).toBe(true);
		expect(writes(calls)).toEqual([]);
	});

	it('storage refuses: false, logged', async () => {
		const spy = quiet();
		const { supabase } = fakeSupabase({
			'board_post_files:select': ok([{ object_path: PATH }]),
			'storage:remove': broken()
		});
		expect(await removePostObjects(supabase, POST)).toBe(false);
		expect(spy).toHaveBeenCalledWith(`board post ${POST}: files not removed`);
	});

	it('an object not reported removed and still there: false', async () => {
		quiet();
		const { supabase } = fakeSupabase({
			'board_post_files:select': ok([{ object_path: PATH }]),
			'storage:remove': ok([]),
			'storage:exists': ok(true)
		});
		expect(await removePostObjects(supabase, POST)).toBe(false);
	});

	it('the rows cannot be read: false, nothing removed', async () => {
		const spy = quiet();
		const { supabase, calls } = fakeSupabase({ 'board_post_files:select': broken() });
		expect(await removePostObjects(supabase, POST)).toBe(false);
		expect(writes(calls)).toEqual([]);
		expect(spy).toHaveBeenCalledWith(`board post ${POST}: files could not be read: broken`);
	});

	it('no uuid: false, nothing asked', async () => {
		const { supabase, calls } = fakeSupabase({});
		expect(await removePostObjects(supabase, 'nope')).toBe(false);
		expect(calls).toEqual([]);
	});
});
