import { afterEach, describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { MAX_CONTENT_BYTES } from '$lib/rich-text';
import { actions, load } from './+page.server';

/**
 * /board (spec-parent-message-board story 3): the load and the `post`
 * action against a fake `locals.supabase`, one row of the I/O matrix each.
 */
type Result = { data?: unknown; error: unknown };
type Call = [string, ...unknown[]];

function fakeSupabase(
	options: {
		reader?: Result;
		poster?: Result;
		posts?: Result;
		names?: Result;
		insert?: Result;
		/** Story 4: the board_post_files read, and each file row insert. */
		files?: Result;
		fileInsert?: Result | (() => Result);
		upload?: Result;
	} = {}
) {
	const rpcCalls: { fn: string; args?: unknown }[] = [];
	const postCalls: Call[] = [];
	const inserted: unknown[] = [];
	const fileCalls: Call[] = [];
	const fileRows: unknown[] = [];
	// Every write in order, storage included (story 4).
	const log: string[] = [];
	const rpcResults: Record<string, Result> = {
		is_board_reader: options.reader ?? { data: true, error: null },
		is_board_poster: options.poster ?? { data: false, error: null },
		board_author_names: options.names ?? { data: [], error: null }
	};

	function chain(result: Result) {
		const record =
			(name: string) =>
			(...args: unknown[]) => {
				postCalls.push([name, ...args]);
				return c;
			};
		const c = {
			select: record('select'),
			lt: record('lt'),
			order: record('order'),
			limit: record('limit'),
			single: record('single'),
			insert: (row: unknown) => {
				inserted.push(row);
				log.push('board_posts:insert');
				postCalls.push(['insert', row]);
				return c;
			},
			then: (resolve: (value: Result) => unknown, reject?: (e: unknown) => unknown) =>
				Promise.resolve(result).then(resolve, reject)
		};
		return c;
	}

	const supabase = {
		rpc: (fn: string, args?: unknown) => {
			rpcCalls.push({ fn, args });
			return Promise.resolve(rpcResults[fn] ?? { data: null, error: null });
		},
		from: (table: string) => {
			if (table === 'board_post_files') return filesChain();
			if (table !== 'board_posts') throw new Error(`unexpected table ${table}`);
			// A test sets either the list's result or the insert's.
			return chain(options.posts ?? options.insert ?? { data: [], error: null });
		},
		storage: {
			from: (bucket: string) => ({
				upload: async (path: string) => {
					log.push(`storage:upload:${bucket}:${path}`);
					return options.upload ?? { data: { path }, error: null };
				},
				remove: async (paths: string[]) => {
					log.push(`storage:remove:${bucket}:${paths.join(',')}`);
					return { data: paths.map((name) => ({ name })), error: null };
				}
			})
		}
	};

	function filesChain() {
		let result: Result = options.files ?? { data: [], error: null };
		const record =
			(name: string) =>
			(...args: unknown[]) => {
				fileCalls.push([name, ...args]);
				return c;
			};
		const c = {
			select: record('select'),
			in: record('in'),
			order: record('order'),
			insert: (row: unknown) => {
				fileRows.push(row);
				log.push('board_post_files:insert');
				const answer = options.fileInsert ?? { data: [{ id: 'f-new' }], error: null };
				result = typeof answer === 'function' ? answer() : answer;
				return c;
			},
			then: (resolve: (value: Result) => unknown, reject?: (e: unknown) => unknown) =>
				Promise.resolve(result).then(resolve, reject)
		};
		return c;
	}
	return { supabase, rpcCalls, postCalls, inserted, fileCalls, fileRows, log };
}

const signedIn = { user: { id: 'u1' }, session: {} };

// Each test's console.error spy starts fresh.
afterEach(() => {
	vi.restoreAllMocks();
});

const consoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});

function loadEvent(fake: ReturnType<typeof fakeSupabase>, search = '', session = signedIn) {
	return {
		url: new URL(`http://localhost/board${search}`),
		locals: { supabase: fake.supabase, safeGetSession: async () => session }
	} as never;
}

function row(i: number, authorId: string | null = 'a1') {
	return {
		id: `p${i}`,
		author_id: authorId,
		content: {
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: `Post ${i}` }] }]
		},
		content_language: 'en',
		created_at: `2026-10-${String(30 - (i % 28)).padStart(2, '0')}T10:00:00.123456+00:00`
	};
}

async function runLoad(fake: ReturnType<typeof fakeSupabase>, search = '', session = signedIn) {
	return (await load(loadEvent(fake, search, session))) as {
		canPost: boolean;
		posts: { id: string; authorName: string; createdAt: string; contentLanguage: string }[];
		olderBefore: string | null;
		paged: boolean;
		loadError: boolean;
	};
}

async function expectStatus(promise: unknown, status: number) {
	await expect(promise).rejects.toMatchObject({ status });
}

describe('/board load', () => {
	it('signed out: redirects to /login', async () => {
		const fake = fakeSupabase();
		await expect(
			load(loadEvent(fake, '', { user: null, session: null } as never))
		).rejects.toMatchObject({ status: 303, location: '/login' });
	});

	it('a reader who is not a poster (approved student): posts, no form', async () => {
		const fake = fakeSupabase({
			posts: { data: [row(1)], error: null },
			names: { data: [{ id: 'a1', display_name: 'Pema' }], error: null }
		});
		const data = await runLoad(fake);
		expect(data.canPost).toBe(false);
		expect(data.loadError).toBe(false);
		expect(data.posts).toEqual([
			expect.objectContaining({ id: 'p1', authorName: 'Pema', contentLanguage: 'en' })
		]);
	});

	it('a poster gets canPost', async () => {
		const fake = fakeSupabase({ poster: { data: true, error: null } });
		expect((await runLoad(fake)).canPost).toBe(true);
	});

	it('an is_board_poster error means canPost false', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({ poster: { data: true, error: { message: 'boom' } } });
		expect((await runLoad(fake)).canPost).toBe(false);
		expect(spy).toHaveBeenCalledWith('Could not check board posting. boom');
	});

	it('not a reader (pending parent): 403 with the localized message', async () => {
		const fake = fakeSupabase({ reader: { data: false, error: null } });
		await expect(load(loadEvent(fake))).rejects.toMatchObject({
			status: 403,
			body: { message: m.board_error_forbidden() }
		});
	});

	it('an is_board_reader error: 403', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({ reader: { data: null, error: { message: 'boom' } } });
		await expectStatus(load(loadEvent(fake)), 403);
		expect(spy).toHaveBeenCalledWith('Could not check board access. boom');
	});

	it('empty board: no posts, no older link, no names call', async () => {
		const fake = fakeSupabase({ posts: { data: [], error: null } });
		const data = await runLoad(fake);
		expect(data.posts).toEqual([]);
		expect(data.olderBefore).toBeNull();
		expect(fake.rpcCalls.map((c) => c.fn)).not.toContain('board_author_names');
	});

	it('orders newest first, by created_at then id, 30 plus one to see if more exist', async () => {
		const fake = fakeSupabase();
		await runLoad(fake);
		expect(fake.postCalls).toEqual([
			['select', 'id, author_id, content, content_language, created_at'],
			['order', 'created_at', { ascending: false }],
			['order', 'id', { ascending: false }],
			['limit', 31]
		]);
	});

	it('31 posts back: 30 shown, the older link uses the 30th post time', async () => {
		const rows = Array.from({ length: 31 }, (_, i) => row(i, `a${i}`));
		const fake = fakeSupabase({ posts: { data: rows, error: null } });
		const data = await runLoad(fake);
		expect(data.posts).toHaveLength(30);
		expect(data.posts.map((p) => p.id)).not.toContain('p30');
		expect(data.olderBefore).toBe(rows[29].created_at);
		// The extra row's author is not looked up.
		const ids = fake.rpcCalls.find((c) => c.fn === 'board_author_names')?.args as {
			p_ids: string[];
		};
		expect(ids.p_ids).not.toContain('a30');
	});

	it('exactly 30 posts back: no older link', async () => {
		const rows = Array.from({ length: 30 }, (_, i) => row(i));
		const fake = fakeSupabase({ posts: { data: rows, error: null } });
		const data = await runLoad(fake);
		expect(data.posts).toHaveLength(30);
		expect(data.olderBefore).toBeNull();
	});

	it('fewer than 30: no older link', async () => {
		const fake = fakeSupabase({ posts: { data: [row(1), row(2)], error: null } });
		expect((await runLoad(fake)).olderBefore).toBeNull();
	});

	it('a valid ?before= loads strictly older posts', async () => {
		const before = '2026-10-20T10:00:00.123456+00:00';
		const fake = fakeSupabase();
		const data = await runLoad(fake, `?before=${encodeURIComponent(before)}`);
		expect(fake.postCalls).toContainEqual(['lt', 'created_at', before]);
		expect(data.paged).toBe(true);
	});

	it('no ?before=: not paged', async () => {
		expect((await runLoad(fakeSupabase())).paged).toBe(false);
	});

	it('an invalid ?before= is ignored', async () => {
		for (const bad of [
			'yesterday',
			'2026-13-45T99:99:99Z',
			'2026-10-20',
			"'; drop",
			// Date.parse rolls these over; Postgres would reject them.
			'2026-02-30T10:00:00Z',
			'2026-04-31T10:00:00.123456+00:00'
		]) {
			const fake = fakeSupabase();
			const data = await runLoad(fake, `?before=${encodeURIComponent(bad)}`);
			expect(fake.postCalls.some(([name]) => name === 'lt')).toBe(false);
			expect(data.paged).toBe(false);
		}
	});

	it('one names call with the distinct non-null ids; unknown authors are "Former member"', async () => {
		const fake = fakeSupabase({
			posts: { data: [row(1, 'a1'), row(2, null), row(3, 'a1'), row(4, 'gone')], error: null },
			names: { data: [{ id: 'a1', display_name: 'Pema' }], error: null }
		});
		const data = await runLoad(fake);
		const names = fake.rpcCalls.filter((c) => c.fn === 'board_author_names');
		expect(names).toEqual([{ fn: 'board_author_names', args: { p_ids: ['a1', 'gone'] } }]);
		expect(data.posts.map((p) => p.authorName)).toEqual([
			'Pema',
			m.board_former_member(),
			'Pema',
			m.board_former_member()
		]);
	});

	it('a names error: posts still load, bylines are "Former member", the error is logged', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({
			posts: { data: [row(1, 'a1'), row(2, 'a2')], error: null },
			names: { data: null, error: { message: 'boom' } }
		});
		const data = await runLoad(fake);
		expect(data.loadError).toBe(false);
		expect(data.posts.map((p) => p.authorName)).toEqual([
			m.board_former_member(),
			m.board_former_member()
		]);
		expect(spy).toHaveBeenCalledWith('Could not load board author names. boom');
	});

	it('a posts load error still renders, with loadError', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({ posts: { data: null, error: { message: 'boom' } } });
		const data = await runLoad(fake);
		expect(data.loadError).toBe(true);
		expect(data.posts).toEqual([]);
		expect(spy).toHaveBeenCalledWith('Could not load board posts. boom');
	});
});

function doc(text: string) {
	return JSON.stringify({
		type: 'doc',
		content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }]
	});
}

function postEvent(
	fake: ReturnType<typeof fakeSupabase>,
	fields: Record<string, string>,
	session: unknown = signedIn
) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://localhost/board?/post', { method: 'POST', body }),
		locals: { supabase: fake.supabase, safeGetSession: async () => session }
	} as never;
}

describe('/board post action', () => {
	const post = (event: never) => actions.post(event) as Promise<unknown>;

	it('not signed in: 401', async () => {
		const fake = fakeSupabase();
		const result = await post(
			postEvent(fake, { content: doc('Hi'), contentLanguage: 'en' }, { user: null })
		);
		expect(result).toMatchObject({ status: 401 });
		expect(fake.inserted).toEqual([]);
	});

	it('inserts as the signed-in user, ignoring a posted author', async () => {
		const fake = fakeSupabase({ insert: { data: { id: 'new' }, error: null } });
		const result = await post(
			postEvent(fake, {
				content: doc('Picnic on Saturday'),
				contentLanguage: 'bo',
				author_id: 'someone-else',
				authorId: 'someone-else'
			})
		);
		expect(result).toEqual({ posted: true, notAttached: [] });
		expect(fake.inserted).toEqual([
			{
				author_id: 'u1',
				content: JSON.parse(doc('Picnic on Saturday')),
				content_language: 'bo'
			}
		]);
		expect(fake.postCalls).toContainEqual(['select', 'id']);
		expect(fake.postCalls).toContainEqual(['single']);
	});

	it('empty body: 400 required', async () => {
		const fake = fakeSupabase();
		for (const content of ['', doc('')]) {
			const result = await post(postEvent(fake, { content, contentLanguage: 'en' }));
			expect(result).toMatchObject({
				status: 400,
				data: { error: m.board_error_content_required() }
			});
		}
		expect(fake.inserted).toEqual([]);
	});

	it('too large: 400 too_large', async () => {
		const fake = fakeSupabase();
		const result = await post(
			postEvent(fake, { content: doc('x'.repeat(MAX_CONTENT_BYTES + 1)), contentLanguage: 'en' })
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.board_error_content_too_large() }
		});
	});

	it('not a document: 400 invalid', async () => {
		const fake = fakeSupabase();
		const result = await post(postEvent(fake, { content: '{nope', contentLanguage: 'en' }));
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.board_error_content_invalid() }
		});
	});

	it('bad language: 400', async () => {
		const fake = fakeSupabase();
		const result = await post(postEvent(fake, { content: doc('Hi'), contentLanguage: 'fr' }));
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.board_error_content_language() }
		});
		expect(fake.inserted).toEqual([]);
	});

	it('refused by RLS (42501, grant revoked meanwhile): 403', async () => {
		const fake = fakeSupabase({ insert: { data: null, error: { code: '42501', message: 'rls' } } });
		const result = await post(postEvent(fake, { content: doc('Hi'), contentLanguage: 'en' }));
		expect(result).toMatchObject({ status: 403, data: { error: m.board_error_not_allowed() } });
	});

	it('any other error: 500', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({ insert: { data: null, error: { code: 'XX000', message: 'x' } } });
		const result = await post(postEvent(fake, { content: doc('Hi'), contentLanguage: 'en' }));
		expect(result).toMatchObject({ status: 500, data: { error: m.board_error_post_failed() } });
		expect(spy).toHaveBeenCalledWith('Could not insert a board post. x');
	});
});

/**
 * Story 4: PDF files on posts. Post ids here are uuids, as the database
 * gives them; the files go to `<post_id>/` in board-files.
 */
const POST_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '66666666-6666-4666-8666-666666666666';

function pdf(name: string, size = 1000): File {
	const bytes = new Uint8Array(size);
	bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
	return new File([bytes], name, { type: 'application/pdf' });
}

function fileEvent(
	fake: ReturnType<typeof fakeSupabase>,
	files: File[],
	fields: Record<string, string> = { content: doc('Picnic'), contentLanguage: 'en' },
	headers: Record<string, string> = {}
) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	for (const file of files) body.append('files', file);
	return {
		request: new Request('http://localhost/board?/post', { method: 'POST', body, headers }),
		locals: { supabase: fake.supabase, safeGetSession: async () => signedIn }
	} as never;
}

describe('/board load with files (story 4)', () => {
	it("one files query for the page's posts; each post gets its files, oldest first", async () => {
		const fake = fakeSupabase({
			posts: {
				data: [
					{ ...row(1), id: POST_ID },
					{ ...row(2), id: OTHER_ID }
				],
				error: null
			},
			files: {
				data: [
					{ id: 'f1', post_id: POST_ID, file_name: 'Flyer.pdf', size_bytes: 2048 },
					{ id: 'f2', post_id: POST_ID, file_name: 'Letter.pdf', size_bytes: 4096 }
				],
				error: null
			}
		});
		const data = (await runLoad(fake)) as unknown as {
			posts: { id: string; files: unknown[] }[];
		};
		expect(data.posts.map((p) => [p.id, p.files])).toEqual([
			[
				POST_ID,
				[
					{ id: 'f1', name: 'Flyer.pdf', size: 2048 },
					{ id: 'f2', name: 'Letter.pdf', size: 4096 }
				]
			],
			[OTHER_ID, []]
		]);
		expect(fake.fileCalls).toEqual([
			['select', 'id, post_id, file_name, size_bytes'],
			['in', 'post_id', [POST_ID, OTHER_ID]],
			['order', 'created_at', { ascending: true }],
			['order', 'id', { ascending: true }]
		]);
	});

	it('the files read fails: the posts still render without files, the error is logged', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({
			posts: { data: [{ ...row(1), id: POST_ID }], error: null },
			files: { data: null, error: { message: 'boom' } }
		});
		const data = (await runLoad(fake)) as unknown as {
			loadError: boolean;
			posts: { id: string; files: unknown[] }[];
		};
		expect(data.loadError).toBe(false);
		expect(data.posts).toEqual([expect.objectContaining({ id: POST_ID, files: [] })]);
		expect(spy).toHaveBeenCalledWith('board files could not be read: boom');
	});

	it('no posts: no files query', async () => {
		const fake = fakeSupabase();
		await runLoad(fake);
		expect(fake.fileCalls).toEqual([]);
	});
});

describe('/board post action with files (story 4)', () => {
	const post = (event: never) => actions.post(event) as Promise<unknown>;
	const inserted = { data: { id: POST_ID }, error: null };

	it('2 PDFs: the post, then each object in <post_id>/ and its row', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post(fileEvent(fake, [pdf('Flyer.pdf', 2048), pdf('Letter.pdf', 4096)]));
		expect(result).toEqual({ posted: true, notAttached: [] });
		expect(fake.log.map((line) => line.replace(/^(storage:upload:[^:]*):.*$/, '$1'))).toEqual([
			'board_posts:insert',
			'storage:upload:board-files',
			'board_post_files:insert',
			'storage:upload:board-files',
			'board_post_files:insert'
		]);
		for (const line of fake.log.filter((l) => l.startsWith('storage:upload'))) {
			expect(line).toMatch(
				new RegExp(`^storage:upload:board-files:${POST_ID}/[0-9a-f-]{36}\\.pdf$`)
			);
		}
		expect(fake.fileRows).toEqual([
			expect.objectContaining({
				post_id: POST_ID,
				file_name: 'Flyer.pdf',
				size_bytes: 2048,
				created_by: 'u1'
			}),
			expect.objectContaining({
				post_id: POST_ID,
				file_name: 'Letter.pdf',
				size_bytes: 4096,
				created_by: 'u1'
			})
		]);
	});

	it('an empty file field: the post only', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post(fileEvent(fake, [new File([], '')]));
		expect(result).toEqual({ posted: true, notAttached: [] });
		expect(fake.log).toEqual(['board_posts:insert']);
	});

	it('3 files: 400 with the limit; nothing stored, no post', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post(fileEvent(fake, [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]));
		expect(result).toMatchObject({
			status: 400,
			data: {
				error: m.board_file_error_limit({ count: '2' }),
				fileError: m.board_file_error_limit({ count: '2' })
			}
		});
		expect(fake.log).toEqual([]);
	});

	it('not a PDF, or over 5 MB: 400 naming the file; no post', async () => {
		for (const bad of [new File(['PK'], 'notes.docx'), pdf('big.pdf', 5_242_881)]) {
			const fake = fakeSupabase({ insert: inserted });
			const result = await post(fileEvent(fake, [pdf('a.pdf'), bad]));
			expect(result).toMatchObject({
				status: 400,
				data: { fileError: expect.stringContaining(bad.name) }
			});
			expect(fake.log).toEqual([]);
		}
	});

	it('the content is checked before the files', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post(
			fileEvent(fake, [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')], {
				content: '',
				contentLanguage: 'en'
			})
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.board_error_content_required() }
		});
	});

	it('a body over the cap: 413', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post(
			fileEvent(fake, [pdf('a.pdf')], undefined, { 'content-length': String(20 * 1024 * 1024) })
		);
		expect(result).toMatchObject({ status: 413 });
		expect(fake.log).toEqual([]);
	});

	it('a broken body: 400', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post({
			request: new Request('http://localhost/board?/post', {
				method: 'POST',
				body: 'nope',
				headers: { 'content-type': 'multipart/form-data; boundary=x' }
			}),
			locals: { supabase: fake.supabase, safeGetSession: async () => signedIn }
		} as never);
		expect(result).toMatchObject({ status: 400, data: { error: m.board_error_post_failed() } });
		expect(fake.log).toEqual([]);
	});

	it('the post is refused (RLS): no file is stored', async () => {
		const fake = fakeSupabase({ insert: { data: null, error: { code: '42501', message: 'rls' } } });
		const result = await post(fileEvent(fake, [pdf('a.pdf')]));
		expect(result).toMatchObject({ status: 403 });
		expect(fake.log).toEqual(['board_posts:insert']);
	});

	it('a row insert fails (DB error or BF001): the object goes again, the post stays, notAttached names it', async () => {
		for (const code of ['XX000', 'BF001']) {
			consoleError();
			let inserts = 0;
			const fake = fakeSupabase({
				insert: inserted,
				fileInsert: () =>
					(inserts += 1) === 1
						? { data: [{ id: 'f1' }], error: null }
						: { data: null, error: { code, message: 'no' } }
			});
			const result = await post(fileEvent(fake, [pdf('Flyer.pdf'), pdf('Letter.pdf')]));
			expect(result).toEqual({ posted: true, notAttached: ['Letter.pdf'] });
			expect(fake.log.at(-1)).toMatch(new RegExp(`^storage:remove:board-files:${POST_ID}/`));
			vi.restoreAllMocks();
		}
	});

	it('the store fails: the post stays, notAttached names it, no row', async () => {
		consoleError();
		const fake = fakeSupabase({
			insert: inserted,
			upload: { data: null, error: { message: 'down' } }
		});
		const result = await post(fileEvent(fake, [pdf('Flyer.pdf')]));
		expect(result).toEqual({ posted: true, notAttached: ['Flyer.pdf'] });
		expect(fake.fileRows).toEqual([]);
	});
});
