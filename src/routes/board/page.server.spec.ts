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
	} = {}
) {
	const rpcCalls: { fn: string; args?: unknown }[] = [];
	const postCalls: Call[] = [];
	const inserted: unknown[] = [];
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
			if (table !== 'board_posts') throw new Error(`unexpected table ${table}`);
			// A test sets either the list's result or the insert's.
			return chain(options.posts ?? options.insert ?? { data: [], error: null });
		}
	};
	return { supabase, rpcCalls, postCalls, inserted };
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
		expect(result).toEqual({ posted: true });
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
