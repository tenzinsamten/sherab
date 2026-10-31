import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import type { Database } from '$lib/supabase/database.types';
import {
	MAX_BOARD_IMAGE_BYTES,
	MAX_IMAGES_PER_POST,
	boardImageLimitMessage,
	boardImagePostTooLargeMessage,
	boardImageProblem,
	boardImageTooLargeMessage,
	boardImageTypeMessage
} from '$lib/board-files';
import {
	BOARD_FILES_BUCKET,
	BOARD_FILE_LIMIT_ERROR_CODE,
	MAX_BOARD_POST_BYTES,
	attachPostImage,
	detectImageKind,
	loadBoardFiles,
	readPostImage,
	readPostForm,
	removePostObjects,
	signedBoardFileUrl,
	type ImageUpload
} from './board-files';
import { MAX_CONTENT_BYTES } from '$lib/rich-text';

/**
 * spec-parent-message-board story 4, story 8: the board post's image (and
 * legacy PDF rows). The fake client
 * of homework-files.spec.ts: every `table:operation` and `storage:<call>` is
 * answered from `answers` and recorded, so a test also proves what was
 * never sent.
 */

const POST = '33333333-3333-4333-8333-333333333333';
const FILE = '44444444-4444-4444-8444-444444444444';
const PATH = `${POST}/55555555-5555-4555-8555-555555555555.pdf`;

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const PDF_HEAD = [...new TextEncoder().encode('%PDF-1.7\n')];
const GIF_HEAD = [...new TextEncoder().encode('GIF89a')];

/** A file of `size` bytes that starts with `head`. */
function file(head: number[], name: string, size = 1000, type = 'image/jpeg'): File {
	const bytes = new Uint8Array(size);
	bytes.set(head);
	return new File([bytes], name, { type });
}
const jpeg = (name = 'photo.jpg', size = 1000) => file(JPEG_HEAD, name, size);

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
	it('one image of up to 5 MB; the body cap holds it and the content', () => {
		expect(MAX_BOARD_IMAGE_BYTES).toBe(5_242_880);
		expect(MAX_IMAGES_PER_POST).toBe(1);
		expect(MAX_BOARD_POST_BYTES).toBeGreaterThan(MAX_BOARD_IMAGE_BYTES + MAX_CONTENT_BYTES);
		expect(MAX_BOARD_POST_BYTES).toBeLessThan(2 * MAX_BOARD_IMAGE_BYTES);
		expect(boardImagePostTooLargeMessage()).toBe(
			m.board_image_error_post_too_large({ size: '5.0 MB' })
		);
		expect(boardImageTooLargeMessage()).toBe(m.board_image_error_too_large({ size: '5.0 MB' }));
		// The type message names the allowed types.
		expect(boardImageTypeMessage()).toMatch(/JPEG.*PNG.*WebP/);
	});
});

describe('boardImageProblem (the client check)', () => {
	it('6 MB or a GIF: refused; a JPEG, PNG or WebP of up to 5 MB: fine', () => {
		expect(boardImageProblem(file(JPEG_HEAD, 'big.jpg', 6 * 1024 * 1024))).toBe(
			boardImageTooLargeMessage()
		);
		expect(boardImageProblem(file(GIF_HEAD, 'a.gif', 100, 'image/gif'))).toBe(
			boardImageTypeMessage()
		);
		// The type is checked first: a 6 MB GIF is the wrong type.
		expect(boardImageProblem(file(GIF_HEAD, 'big.gif', 6 * 1024 * 1024, 'image/gif'))).toBe(
			boardImageTypeMessage()
		);
		// No type from the picker: left to the server's byte check (size still checked).
		expect(boardImageProblem(file(JPEG_HEAD, 'photo', 100, ''))).toBeNull();
		expect(boardImageProblem(file(JPEG_HEAD, 'photo', 6 * 1024 * 1024, ''))).toBe(
			boardImageTooLargeMessage()
		);
		for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
			expect(boardImageProblem(file(JPEG_HEAD, 'a', MAX_BOARD_IMAGE_BYTES, type))).toBeNull();
		}
	});
});

describe('detectImageKind', () => {
	const buf = (head: number[]) => new Uint8Array([...head, 0, 0, 0, 0]).buffer;
	it('by magic bytes only', () => {
		expect(detectImageKind(buf(JPEG_HEAD))).toBe('jpg');
		expect(detectImageKind(buf(PNG_HEAD))).toBe('png');
		expect(detectImageKind(buf(WEBP_HEAD))).toBe('webp');
		expect(detectImageKind(buf(PDF_HEAD))).toBeNull();
		expect(detectImageKind(buf(GIF_HEAD))).toBeNull();
		// RIFF but not WEBP (a WAV file).
		expect(
			detectImageKind(buf([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))
		).toBeNull();
		expect(detectImageKind(new Uint8Array([0xff, 0xd8]).buffer)).toBeNull();
	});
});

describe('readPostForm', () => {
	it('a body over the cap: 413 naming the limits', async () => {
		const request = new Request('http://localhost/board', {
			method: 'POST',
			body: new FormData(),
			headers: { 'content-length': String(MAX_BOARD_POST_BYTES + 1) }
		});
		expect(await readPostForm(request)).toMatchObject({
			refused: {
				status: 413,
				data: {
					error: boardImagePostTooLargeMessage(),
					fileError: boardImagePostTooLargeMessage()
				}
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

	it('a form with a 5 MB image: its fields', async () => {
		const body = new FormData();
		body.set('content', 'x');
		body.append('image', jpeg('a.jpg', MAX_BOARD_IMAGE_BYTES));
		const result = await readPostForm(
			new Request('http://localhost/board', { method: 'POST', body })
		);
		expect('formData' in result && result.formData.get('content')).toBe('x');
	});
});

describe('readPostImage', () => {
	const form = (...files: File[]) => {
		const data = new FormData();
		for (const f of files) data.append('image', f);
		return data;
	};

	it('none chosen (an empty input sends an empty file): no image, fine', async () => {
		expect(await readPostImage(new FormData())).toEqual({ ok: true, image: null });
		expect(await readPostImage(form(new File([], '')))).toEqual({ ok: true, image: null });
	});

	it('a JPEG (2 MB), PNG, WebP, and one of exactly 5 MB: the detected type and name', async () => {
		const cases: [File, string, string][] = [
			[file(JPEG_HEAD, 'photo.jpg', 2 * 1024 * 1024), 'jpg', 'image/jpeg'],
			[file(PNG_HEAD, 'pic.png', 100, 'image/png'), 'png', 'image/png'],
			[file(WEBP_HEAD, 'pic.webp', 100, 'image/webp'), 'webp', 'image/webp'],
			// The declared type and the name do not matter, only the bytes.
			[file(PNG_HEAD, 'odd.png', 100, 'application/pdf'), 'png', 'image/png'],
			[file(JPEG_HEAD, 'max.jpg', MAX_BOARD_IMAGE_BYTES), 'jpg', 'image/jpeg']
		];
		for (const [entry, kind, contentType] of cases) {
			const result = await readPostImage(form(entry));
			expect(result).toMatchObject({
				ok: true,
				image: { name: entry.name, kind, contentType }
			});
			expect(result.ok && result.image?.bytes.byteLength).toBe(entry.size);
		}
	});

	it('the stored name: without folder or control characters; an empty one is image.<ext>', async () => {
		const named = await readPostImage(form(jpeg('C:\\me\\ph\u0000oto.jpg')));
		expect(named.ok && named.image?.name).toBe('photo.jpg');
		const unnamed = await readPostImage(form(new File([new Uint8Array(PNG_HEAD)], '')));
		expect(unnamed.ok && unnamed.image?.name).toBe('image.png');
	});

	it('the stored extension follows the detected type: PNG bytes named odd.jpg are odd.png', async () => {
		const renamed = await readPostImage(form(file(PNG_HEAD, 'odd.jpg', 100, 'image/jpeg')));
		expect(renamed.ok && renamed.image?.name).toBe('odd.png');
		const bare = await readPostImage(form(file(WEBP_HEAD, 'holiday', 100, 'image/webp')));
		expect(bare.ok && bare.image?.name).toBe('holiday.webp');
	});

	it('a 300-character name is stored as 200 characters, extension kept', async () => {
		const result = await readPostImage(form(jpeg(`${'a'.repeat(296)}.jpg`)));
		const name = result.ok ? (result.image?.name ?? '') : '';
		expect([...name]).toHaveLength(200);
		expect(name).toBe(`${'a'.repeat(196)}.jpg`);
	});

	it('two files: the limit of one', async () => {
		expect(await readPostImage(form(jpeg('a.jpg'), jpeg('b.jpg')))).toEqual({
			ok: false,
			message: boardImageLimitMessage()
		});
	});

	it('a PDF, a GIF, or photo.jpg with PDF bytes: refused naming the types', async () => {
		for (const entry of [
			file(PDF_HEAD, 'flyer.pdf', 100, 'application/pdf'),
			file(GIF_HEAD, 'a.gif', 100, 'image/gif'),
			file(PDF_HEAD, 'photo.jpg', 100, 'image/jpeg')
		]) {
			expect(await readPostImage(form(entry))).toEqual({
				ok: false,
				message: boardImageTypeMessage()
			});
		}
	});

	it('5,242,881 bytes: too large', async () => {
		expect(await readPostImage(form(jpeg('big.jpg', 5_242_881)))).toEqual({
			ok: false,
			message: boardImageTooLargeMessage()
		});
	});
});

describe('attachPostImage', () => {
	const image: ImageUpload = {
		name: 'photo.png',
		bytes: new ArrayBuffer(10),
		kind: 'png',
		contentType: 'image/png'
	};

	it("stores the image in the post's folder with its type, then records it", async () => {
		const { supabase, calls } = fakeSupabase({
			'board_post_files:insert': ok([{ id: FILE }])
		});
		expect(await attachPostImage(supabase, user, POST, image)).toEqual([]);
		expect(writes(calls)).toEqual(['storage:upload', 'board_post_files:insert']);
		const upload = calls.find((c) => c.op === 'upload')!;
		expect(upload.values).toMatchObject({
			bucket: BOARD_FILES_BUCKET,
			path: expect.stringMatching(new RegExp(`^${POST}/[0-9a-f-]{36}\\.png$`)),
			options: { contentType: 'image/png', upsert: false }
		});
		expect(calls.find((c) => c.op === 'insert')!.values).toEqual({
			post_id: POST,
			object_path: (upload.values as { path: string }).path,
			file_name: 'photo.png',
			size_bytes: 10,
			created_by: 'parent-1'
		});
	});

	it('the row fails (DB error or BF001): the object is removed and the image is named', async () => {
		for (const code of [undefined, BOARD_FILE_LIMIT_ERROR_CODE]) {
			const spy = quiet();
			const { supabase, calls } = fakeSupabase({
				'board_post_files:insert': broken(code)
			});
			expect(await attachPostImage(supabase, user, POST, image)).toEqual(['photo.png']);
			expect(writes(calls)).toEqual([
				'storage:upload',
				'board_post_files:insert',
				'storage:remove'
			]);
			expect(spy).toHaveBeenCalledWith(
				`board post ${POST}: image not attached (${code ? 'limit' : 'failed'})`
			);
			vi.restoreAllMocks();
		}
	});

	it('storage refuses the upload: no row, the image is named', async () => {
		quiet();
		const { supabase, calls } = fakeSupabase({ 'storage:upload': broken() });
		expect(await attachPostImage(supabase, user, POST, image)).toEqual(['photo.png']);
		expect(writes(calls)).toEqual(['storage:upload']);
	});
});

describe('loadBoardFiles', () => {
	const other = '66666666-6666-4666-8666-666666666666';
	const IMG = `${POST}/77777777-7777-4777-8777-777777777777.jpg`;
	const IMG2 = `${other}/88888888-8888-4888-8888-888888888888.webp`;

	it('one query, nothing signed: the image per post, legacy PDFs as files', async () => {
		const { supabase, calls } = fakeSupabase({
			'board_post_files:select': ok([
				{ id: 'f1', post_id: POST, object_path: IMG, file_name: 'a.jpg', size_bytes: 10 },
				{ id: 'f2', post_id: other, object_path: IMG2, file_name: 'c.webp', size_bytes: 30 },
				{ id: 'f3', post_id: other, object_path: PATH, file_name: 'old.pdf', size_bytes: 20 }
			])
		});
		const { images, files, error } = await loadBoardFiles(supabase, [
			POST,
			other,
			POST,
			'not-a-uuid'
		]);
		expect(error).toBe(false);
		expect(images.get(POST)).toEqual({ id: 'f1', name: 'a.jpg' });
		expect(images.get(other)).toEqual({ id: 'f2', name: 'c.webp' });
		expect(files.get(other)).toEqual([{ id: 'f3', name: 'old.pdf', size: 20 }]);
		expect(files.get(POST)).toBeUndefined();
		// The page signs through /files/board/[fileId], fresh on each request.
		expect(calls).toHaveLength(1);
		expect(calls[0].selected).toBe('id, post_id, object_path, file_name, size_bytes');
		expect(calls[0].filters).toEqual({ post_id: [POST, other] });
		expect(calls[0].orders[0]).toEqual(['created_at', { ascending: true }]);
	});

	it('no posts: nothing asked', async () => {
		const { supabase, calls } = fakeSupabase({});
		expect((await loadBoardFiles(supabase, [])).images.size).toBe(0);
		expect(calls).toEqual([]);
	});

	it('a read error: nothing, error, logged', async () => {
		const spy = quiet();
		const { supabase } = fakeSupabase({ 'board_post_files:select': broken() });
		const result = await loadBoardFiles(supabase, [POST]);
		expect(result.error).toBe(true);
		expect(result.images.size).toBe(0);
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
