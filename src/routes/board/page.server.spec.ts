import { afterEach, describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { MAX_CONTENT_BYTES } from '$lib/rich-text';

// Story 6: the push announcement, replaced by a spy.
const { announceBoardPost } = vi.hoisted(() => ({
	announceBoardPost: vi.fn<(postId: string) => Promise<void>>(async () => {})
}));
vi.mock('$lib/server/push', () => ({ announceBoardPost }));

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
		/** Story 5: the edit's update, the delete, and the storage removal. */
		update?: Result;
		remove?: Result;
		del?: Result;
		/** Story 5: the delete's author read, and the caller's profile role. */
		target?: Result;
		profile?: Result;
		/** Story 9: the counts RPC and the caller's own reactions in the load. */
		counts?: Result;
		mineReactions?: Result;
		/** Story 9: the react action's read of the current reaction, and its writes. */
		reaction?: Result;
		reactionInsert?: Result;
		reactionUpdate?: Result;
		reactionDelete?: Result;
	} = {}
) {
	const rpcCalls: { fn: string; args?: unknown }[] = [];
	const postCalls: Call[] = [];
	const inserted: unknown[] = [];
	const fileCalls: Call[] = [];
	const fileRows: unknown[] = [];
	const uploadTypes: string[] = [];
	const signCalls: { bucket: string; paths: string[]; seconds: number }[] = [];
	// Every write in order, storage included (story 4).
	const log: string[] = [];
	const rpcResults: Record<string, Result> = {
		is_board_reader: options.reader ?? { data: true, error: null },
		is_board_poster: options.poster ?? { data: false, error: null },
		board_author_names: options.names ?? { data: [], error: null },
		board_reaction_counts: options.counts ?? { data: [], error: null }
	};
	const reactionCalls: Call[] = [];

	function chain(initial: Result) {
		let result = initial;
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
			eq: record('eq'),
			maybeSingle: () => {
				postCalls.push(['maybeSingle']);
				result = options.target ?? { data: { author_id: 'u1' }, error: null };
				return c;
			},
			update: (values: unknown) => {
				log.push('board_posts:update');
				postCalls.push(['update', values]);
				result = options.update ?? { data: [{ id: 'p' }], error: null };
				return c;
			},
			delete: () => {
				log.push('board_posts:delete');
				postCalls.push(['delete']);
				result = options.del ?? { data: [{ id: 'p' }], error: null };
				return c;
			},
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
			if (table === 'board_post_reactions') return reactionsChain();
			if (table === 'profiles') {
				const p = {
					select: () => p,
					eq: () => p,
					maybeSingle: () => Promise.resolve(options.profile ?? { data: null, error: null })
				};
				return p;
			}
			if (table !== 'board_posts') throw new Error(`unexpected table ${table}`);
			// A test sets either the list's result or the insert's.
			return chain(options.posts ?? options.insert ?? { data: [], error: null });
		},
		storage: {
			from: (bucket: string) => ({
				upload: async (path: string, _body: unknown, opts: { contentType?: string }) => {
					log.push(`storage:upload:${bucket}:${path}`);
					uploadTypes.push(opts?.contentType ?? '');
					return options.upload ?? { data: { path }, error: null };
				},
				createSignedUrls: async (paths: string[], seconds: number) => {
					signCalls.push({ bucket, paths, seconds });
					return { data: [], error: null };
				},
				remove: async (paths: string[]) => {
					log.push(`storage:remove:${bucket}:${paths.join(',')}`);
					return options.remove ?? { data: paths.map((name) => ({ name })), error: null };
				},
				exists: async () => ({ data: true, error: null })
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
			eq: record('eq'),
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
	function reactionsChain() {
		let result: Result = options.mineReactions ?? { data: [], error: null };
		const record =
			(name: string) =>
			(...args: unknown[]) => {
				reactionCalls.push([name, ...args]);
				return c;
			};
		const write = (name: string, answer: Result | undefined, fallback: Result) => {
			log.push(`board_post_reactions:${name}`);
			result = answer ?? fallback;
		};
		const c = {
			select: record('select'),
			in: record('in'),
			eq: record('eq'),
			maybeSingle: () => {
				reactionCalls.push(['maybeSingle']);
				result = options.reaction ?? { data: null, error: null };
				return c;
			},
			insert: (row: unknown) => {
				reactionCalls.push(['insert', row]);
				write('insert', options.reactionInsert, { data: null, error: null });
				return c;
			},
			update: (values: unknown) => {
				reactionCalls.push(['update', values]);
				write('update', options.reactionUpdate, { data: [{ value: 1 }], error: null });
				return c;
			},
			delete: () => {
				reactionCalls.push(['delete']);
				write('delete', options.reactionDelete, { data: null, error: null });
				return c;
			},
			then: (resolve: (value: Result) => unknown, reject?: (e: unknown) => unknown) =>
				Promise.resolve(result).then(resolve, reject)
		};
		return c;
	}

	return {
		supabase,
		rpcCalls,
		reactionCalls,
		postCalls,
		inserted,
		fileCalls,
		fileRows,
		log,
		uploadTypes,
		signCalls
	};
}

const signedIn = { user: { id: 'u1' }, session: {} };

// Each test's console.error spy starts fresh.
afterEach(() => {
	vi.restoreAllMocks();
	announceBoardPost.mockClear();
});

const consoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});

function loadEvent(
	fake: ReturnType<typeof fakeSupabase>,
	search = '',
	session = signedIn,
	role: string | null = 'student'
) {
	return {
		url: new URL(`http://localhost/board${search}`),
		parent: async () => ({ profile: role ? { role } : null }),
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
		created_at: `2026-10-${String(30 - (i % 28)).padStart(2, '0')}T10:00:00.123456+00:00`,
		updated_at: `2026-10-${String(30 - (i % 28)).padStart(2, '0')}T10:00:00.123456+00:00`
	};
}

async function runLoad(
	fake: ReturnType<typeof fakeSupabase>,
	search = '',
	session = signedIn,
	role: string | null = 'student'
) {
	return (await load(loadEvent(fake, search, session, role))) as {
		canPost: boolean;
		canModerate: boolean;
		posts: {
			id: string;
			title: string | null;
			authorName: string;
			createdAt: string;
			updatedAt: string;
			mine: boolean;
			contentLanguage: string;
		}[];
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
			names: { data: [{ id: 'a1', display_name: 'Pema', role: 'parent' }], error: null }
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
			['select', 'id, author_id, title, content, content_language, created_at, updated_at'],
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
			names: { data: [{ id: 'a1', display_name: 'Pema', role: 'parent' }], error: null }
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

	it('story 7: a nameless admin is "Sherab Admin", a teacher "Teacher", others "Former member"; a real name wins', async () => {
		const fake = fakeSupabase({
			posts: {
				data: [row(1, 'ad'), row(2, 't'), row(3, 'pa'), row(4, 'real'), row(5, null)],
				error: null
			},
			names: {
				data: [
					{ id: 'ad', display_name: null, role: 'admin' },
					{ id: 't', display_name: null, role: 'teacher' },
					{ id: 'pa', display_name: null, role: 'parent' },
					{ id: 'real', display_name: 'Pema', role: 'teacher' }
				],
				error: null
			}
		});
		const data = await runLoad(fake);
		expect(data.posts.map((p) => p.authorName)).toEqual([
			m.board_author_admin(),
			m.board_author_teacher(),
			m.board_former_member(),
			'Pema',
			m.board_former_member()
		]);
	});

	it('story 7: a post title is passed on; a post from before titles has none', async () => {
		const fake = fakeSupabase({
			posts: {
				data: [
					{ ...row(1), title: 'Picnic' },
					{ ...row(2), title: null }
				],
				error: null
			}
		});
		const data = await runLoad(fake);
		expect(data.posts.map((p) => p.title)).toEqual(['Picnic', null]);
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
	session: unknown = signedIn,
	platform?: unknown
) {
	const body = new FormData();
	// Story 7: every post has a title unless the test sets (or removes) one.
	for (const [k, v] of Object.entries({ title: 'Picnic', ...fields })) body.set(k, v);
	return {
		request: new Request('http://localhost/board?/post', { method: 'POST', body }),
		platform,
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
				title: 'Picnic',
				content: JSON.parse(doc('Picnic on Saturday')),
				content_language: 'bo'
			}
		]);
		expect(fake.postCalls).toContainEqual(['select', 'id']);
		expect(fake.postCalls).toContainEqual(['single']);
	});

	it('story 7: the title is trimmed and inserted', async () => {
		const fake = fakeSupabase({ insert: { data: { id: 'new' }, error: null } });
		const result = await post(
			postEvent(fake, { title: '  Picnic  ', content: doc('Hi'), contentLanguage: 'en' })
		);
		expect(result).toEqual({ posted: true, notAttached: [] });
		expect(fake.inserted).toEqual([expect.objectContaining({ title: 'Picnic' })]);
	});

	it('story 7: a missing, empty or blank title: 400 "Enter a title.", nothing inserted', async () => {
		const fake = fakeSupabase({ insert: { data: { id: 'new' }, error: null } });
		const missing = new FormData();
		missing.set('content', doc('Hi'));
		missing.set('contentLanguage', 'en');
		const results = [
			await post({
				request: new Request('http://localhost/board?/post', { method: 'POST', body: missing }),
				locals: { supabase: fake.supabase, safeGetSession: async () => signedIn }
			} as never)
		];
		for (const title of ['', '   ']) {
			results.push(
				await post(postEvent(fake, { title, content: doc('Hi'), contentLanguage: 'en' }))
			);
		}
		for (const result of results) {
			expect(result).toMatchObject({
				status: 400,
				data: { error: m.board_error_title_required() }
			});
		}
		expect(fake.inserted).toEqual([]);
	});

	it('story 7: line breaks and tabs collapse to one space; control and format characters go', async () => {
		const fake = fakeSupabase({ insert: { data: { id: 'new' }, error: null } });
		const result = await post(
			postEvent(fake, {
				title: ' Picnic\n\non\tSaturday\u200b\u0007 ',
				content: doc('Hi'),
				contentLanguage: 'en'
			})
		);
		expect(result).toEqual({ posted: true, notAttached: [] });
		expect(fake.inserted).toEqual([expect.objectContaining({ title: 'Picnic on Saturday' })]);
	});

	it('story 7: a title of only zero-width or control characters is required', async () => {
		const fake = fakeSupabase({ insert: { data: { id: 'new' }, error: null } });
		for (const title of ['\u200b\u200d\ufeff', '\u0007\u0000', '\n\t\u2060']) {
			const result = await post(
				postEvent(fake, { title, content: doc('Hi'), contentLanguage: 'en' })
			);
			expect(result).toMatchObject({
				status: 400,
				data: { error: m.board_error_title_required() }
			});
		}
		expect(fake.inserted).toEqual([]);
	});

	it('story 7: 120 characters pass, 121 are refused with 400', async () => {
		const fake = fakeSupabase({ insert: { data: { id: 'new' }, error: null } });
		const tooLong = await post(
			postEvent(fake, { title: 'x'.repeat(121), content: doc('Hi'), contentLanguage: 'en' })
		);
		expect(tooLong).toMatchObject({
			status: 400,
			data: { error: m.board_error_title_too_long() }
		});
		expect(fake.inserted).toEqual([]);
		// Tibetan stacks count as Postgres counts them (code points); 120 still pass.
		for (const title of ['x'.repeat(120), 'ཀ'.repeat(120)]) {
			const ok = await post(postEvent(fake, { title, content: doc('Hi'), contentLanguage: 'en' }));
			expect(ok).toEqual({ posted: true, notAttached: [] });
		}
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
 * Story 8 (story 4 before it): one image per post. Post ids here are
 * uuids, as the database gives them; the image goes to `<post_id>/` in
 * board-files.
 */
const POST_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '66666666-6666-4666-8666-666666666666';

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

function image(name: string, size = 1000, head = JPEG_HEAD, type = 'image/jpeg'): File {
	const bytes = new Uint8Array(size);
	bytes.set(head);
	return new File([bytes], name, { type });
}

function fileEvent(
	fake: ReturnType<typeof fakeSupabase>,
	files: File[],
	fields: Record<string, string> = { content: doc('Picnic'), contentLanguage: 'en' },
	headers: Record<string, string> = {}
) {
	const body = new FormData();
	for (const [k, v] of Object.entries({ title: 'Picnic', ...fields })) body.set(k, v);
	for (const file of files) body.append('image', file);
	return {
		request: new Request('http://localhost/board?/post', { method: 'POST', body, headers }),
		locals: { supabase: fake.supabase, safeGetSession: async () => signedIn }
	} as never;
}

type LoadedPost = {
	id: string;
	image: unknown;
	files: unknown[];
	long: boolean;
};

describe('/board load with images (story 8)', () => {
	const IMG = `${POST_ID}/77777777-7777-4777-8777-777777777777.jpg`;
	const PDF = `${OTHER_ID}/88888888-8888-4888-8888-888888888888.pdf`;

	it("one files query for the page's posts, nothing signed in the load; legacy PDFs stay files", async () => {
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
					{
						id: 'f1',
						post_id: POST_ID,
						object_path: IMG,
						file_name: 'Picnic.jpg',
						size_bytes: 2048
					},
					{
						id: 'f2',
						post_id: OTHER_ID,
						object_path: PDF,
						file_name: 'Flyer.pdf',
						size_bytes: 4096
					}
				],
				error: null
			}
		});
		const data = (await runLoad(fake)) as unknown as { posts: LoadedPost[] };
		expect(data.posts.map((p) => [p.id, p.image, p.files])).toEqual([
			[POST_ID, { id: 'f1', name: 'Picnic.jpg' }, []],
			[OTHER_ID, null, [{ id: 'f2', name: 'Flyer.pdf', size: 4096 }]]
		]);
		expect(fake.fileCalls).toEqual([
			['select', 'id, post_id, object_path, file_name, size_bytes'],
			['in', 'post_id', [POST_ID, OTHER_ID]],
			['order', 'created_at', { ascending: true }],
			['order', 'id', { ascending: true }]
		]);
		// The page signs through /files/board/[fileId], fresh on each request.
		expect(fake.signCalls).toEqual([]);
	});

	it('the files read fails: the posts still render without image or files, logged', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({
			posts: { data: [{ ...row(1), id: POST_ID }], error: null },
			files: { data: null, error: { message: 'boom' } }
		});
		const data = (await runLoad(fake)) as unknown as { posts: LoadedPost[]; loadError: boolean };
		expect(data.loadError).toBe(false);
		expect(data.posts).toEqual([expect.objectContaining({ id: POST_ID, image: null, files: [] })]);
		expect(spy).toHaveBeenCalledWith('board files could not be read: boom');
	});

	it('no posts: no files query', async () => {
		const fake = fakeSupabase();
		await runLoad(fake);
		expect(fake.fileCalls).toEqual([]);
	});

	it('long: over 200 characters of plain text, or more than 3 blocks', async () => {
		const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
		const withBody = (id: string, blocks: unknown[]) => ({
			...row(1),
			id,
			content: { type: 'doc', content: blocks }
		});
		const fake = fakeSupabase({
			posts: {
				data: [
					withBody('short', [para('x'.repeat(50))]),
					withBody('exact', [para('x'.repeat(200))]),
					withBody('chars', [para('x'.repeat(500))]),
					withBody('three', [para('a'), para('b'), para('c')]),
					withBody('four', [para('a'), para('b'), para('c'), para('d')])
				],
				error: null
			}
		});
		const data = (await runLoad(fake)) as unknown as { posts: LoadedPost[] };
		expect(data.posts.map((p) => [p.id, p.long])).toEqual([
			['short', false],
			['exact', false],
			['chars', true],
			['three', false],
			['four', true]
		]);
	});
});

describe('/board post action with an image (story 8)', () => {
	const post = (event: never) => actions.post(event) as Promise<unknown>;
	const inserted = { data: { id: POST_ID }, error: null };

	it('a 2 MB JPEG: the post, then the object as <post_id>/<uuid>.jpg and its row', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post(fileEvent(fake, [image('Picnic.jpg', 2 * 1024 * 1024)]));
		expect(result).toEqual({ posted: true, notAttached: [] });
		expect(fake.log.map((line) => line.replace(/^(storage:upload:[^:]*):.*$/, '$1'))).toEqual([
			'board_posts:insert',
			'storage:upload:board-files',
			'board_post_files:insert'
		]);
		expect(fake.log[1]).toMatch(
			new RegExp(`^storage:upload:board-files:${POST_ID}/[0-9a-f-]{36}\\.jpg$`)
		);
		expect(fake.uploadTypes).toEqual(['image/jpeg']);
		expect(fake.fileRows).toEqual([
			expect.objectContaining({
				post_id: POST_ID,
				file_name: 'Picnic.jpg',
				size_bytes: 2 * 1024 * 1024,
				created_by: 'u1'
			})
		]);
	});

	it('a PNG and a WebP: stored as .png and .webp with their detected types', async () => {
		for (const [file, ext, type] of [
			[image('a.png', 100, PNG_HEAD, 'image/png'), 'png', 'image/png'],
			// The type sent does not count: the bytes are a WebP.
			[image('b.webp', 100, WEBP_HEAD, 'application/octet-stream'), 'webp', 'image/webp']
		] as const) {
			const fake = fakeSupabase({ insert: inserted });
			expect(await post(fileEvent(fake, [file]))).toEqual({ posted: true, notAttached: [] });
			expect(fake.log[1]).toMatch(new RegExp(`\\.${ext}$`));
			expect(fake.uploadTypes).toEqual([type]);
		}
	});

	it('an empty file field: the post only', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post(fileEvent(fake, [new File([], '')]));
		expect(result).toEqual({ posted: true, notAttached: [] });
		expect(fake.log).toEqual(['board_posts:insert']);
	});

	it('two files: 400 with the limit; nothing stored, no post', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post(fileEvent(fake, [image('a.jpg'), image('b.jpg')]));
		expect(result).toMatchObject({
			status: 400,
			data: {
				error: m.board_image_error_limit(),
				fileError: m.board_image_error_limit()
			}
		});
		expect(fake.log).toEqual([]);
	});

	it('PDF or GIF bytes, also named photo.jpg: 400 naming the types; no post', async () => {
		const pdfBytes = [...new TextEncoder().encode('%PDF-1.7\n')];
		const gifBytes = [...new TextEncoder().encode('GIF89a')];
		for (const bad of [
			image('flyer.pdf', 100, pdfBytes, 'application/pdf'),
			image('anim.gif', 100, gifBytes, 'image/gif'),
			image('photo.jpg', 100, pdfBytes, 'image/jpeg')
		]) {
			const fake = fakeSupabase({ insert: inserted });
			const result = await post(fileEvent(fake, [bad]));
			expect(result).toMatchObject({
				status: 400,
				data: { error: m.board_image_error_type(), fileError: m.board_image_error_type() }
			});
			expect(fake.log).toEqual([]);
		}
	});

	it('5,242,881 bytes: 400 too large; no post', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post(fileEvent(fake, [image('big.jpg', 5_242_881)]));
		expect(result).toMatchObject({
			status: 400,
			data: { fileError: m.board_image_error_too_large({ size: '5.0 MB' }) }
		});
		expect(fake.log).toEqual([]);
	});

	it('the content is checked before the image', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post(
			fileEvent(fake, [image('a.jpg'), image('b.jpg')], {
				content: '',
				contentLanguage: 'en'
			})
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.board_error_content_required() }
		});
	});

	it('a body over the cap: 413 naming the limits', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const result = await post(
			fileEvent(fake, [image('a.jpg')], undefined, {
				'content-length': String(20 * 1024 * 1024)
			})
		);
		expect(result).toMatchObject({
			status: 413,
			data: { error: m.board_image_error_post_too_large({ size: '5.0 MB' }) }
		});
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

	it('the post is refused (RLS): no image is stored', async () => {
		const fake = fakeSupabase({ insert: { data: null, error: { code: '42501', message: 'rls' } } });
		const result = await post(fileEvent(fake, [image('a.jpg')]));
		expect(result).toMatchObject({ status: 403 });
		expect(fake.log).toEqual(['board_posts:insert']);
	});

	it('the row insert fails (DB error or BF001): the object goes again, the post stays, notAttached', async () => {
		for (const code of ['XX000', 'BF001']) {
			consoleError();
			const fake = fakeSupabase({
				insert: inserted,
				fileInsert: { data: null, error: { code, message: 'no' } }
			});
			const result = await post(fileEvent(fake, [image('Picnic.jpg')]));
			expect(result).toEqual({ posted: true, notAttached: ['Picnic.jpg'] });
			expect(fake.log.at(-1)).toMatch(new RegExp(`^storage:remove:board-files:${POST_ID}/`));
			vi.restoreAllMocks();
		}
	});

	it('the store fails: the post stays, notAttached, no row', async () => {
		consoleError();
		const fake = fakeSupabase({
			insert: inserted,
			upload: { data: null, error: { message: 'down' } }
		});
		const result = await post(fileEvent(fake, [image('Picnic.jpg')]));
		expect(result).toEqual({ posted: true, notAttached: ['Picnic.jpg'] });
		expect(fake.fileRows).toEqual([]);
	});
});

/** Story 5 (CAP-3): who may edit and delete, and the edit and delete actions. */
describe('/board load: edit and delete controls (story 5)', () => {
	const rows = () => ({
		data: [
			{ ...row(1, 'u1'), updated_at: '2026-10-29T11:00:00.000000+00:00' },
			row(2, 'a2'),
			row(3, null)
		],
		error: null
	});

	it('mine is true only for the signed-in author; updatedAt is exposed', async () => {
		const data = await runLoad(fakeSupabase({ posts: rows() }));
		expect(data.posts.map((p) => p.mine)).toEqual([true, false, false]);
		expect(data.posts[0].updatedAt).toBe('2026-10-29T11:00:00.000000+00:00');
	});

	it('canModerate for an admin or a teacher by profile role; not for a parent or student', async () => {
		for (const [role, expected] of [
			['admin', true],
			['teacher', true],
			['parent', false],
			['student', false],
			[null, false]
		] as const) {
			const data = await runLoad(fakeSupabase(), '', signedIn, role);
			expect(data.canModerate).toBe(expected);
		}
	});

	it('canModerate is given with a posts load error too', async () => {
		consoleError();
		const fake = fakeSupabase({ posts: { data: null, error: { message: 'boom' } } });
		const data = await runLoad(fake, '', signedIn, 'teacher');
		expect(data.canModerate).toBe(true);
	});
});

function formEvent(
	fake: ReturnType<typeof fakeSupabase>,
	action: string,
	fields: Record<string, string>,
	session: unknown = signedIn
) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request(`http://localhost/board?/${action}`, { method: 'POST', body }),
		locals: { supabase: fake.supabase, safeGetSession: async () => session }
	} as never;
}

describe('/board edit action (story 5)', () => {
	const edit = (event: never) => actions.edit(event) as Promise<unknown>;
	const fields = (extra: Record<string, string> = {}) => ({
		postId: POST_ID,
		title: 'Picnic on Sunday',
		content: doc('Picnic moved to Sunday'),
		contentLanguage: 'de',
		...extra
	});

	it('not signed in: 401, nothing sent', async () => {
		const fake = fakeSupabase();
		const result = await edit(formEvent(fake, 'edit', fields(), { user: null }));
		expect(result).toMatchObject({ status: 401, data: { error: m.board_error_not_signed_in() } });
		expect(fake.log).toEqual([]);
	});

	it('a bad id: 400', async () => {
		const fake = fakeSupabase();
		for (const postId of ['', 'p1', "'; drop"]) {
			const result = await edit(formEvent(fake, 'edit', fields({ postId })));
			expect(result).toMatchObject({
				status: 400,
				data: { error: m.board_edit_error_invalid() }
			});
		}
		expect(fake.log).toEqual([]);
	});

	it('updates the title, the body, its language and updated_at by id, with select id; files untouched', async () => {
		const fake = fakeSupabase({ update: { data: [{ id: POST_ID }], error: null } });
		const before = Date.now();
		const result = await edit(formEvent(fake, 'edit', fields()));
		expect(result).toEqual({ edited: POST_ID });
		const update = fake.postCalls.find(([name]) => name === 'update')?.[1] as {
			title: string;
			content: unknown;
			content_language: string;
			updated_at: string;
		};
		expect(update.content).toEqual(JSON.parse(doc('Picnic moved to Sunday')));
		expect(update.content_language).toBe('de');
		expect(update.title).toBe('Picnic on Sunday');
		expect(Date.parse(update.updated_at)).toBeGreaterThanOrEqual(before - 1000);
		expect(Object.keys(update).sort()).toEqual([
			'content',
			'content_language',
			'title',
			'updated_at'
		]);
		expect(fake.postCalls).toContainEqual(['eq', 'id', POST_ID]);
		expect(fake.postCalls).toContainEqual(['eq', 'author_id', 'u1']);
		expect(fake.postCalls).toContainEqual(['select', 'id']);
		expect(fake.log).toEqual(['board_posts:update']);
	});

	it('empty, too large, not a document, bad language: 400 with the post messages', async () => {
		const fake = fakeSupabase();
		for (const [extra, message] of [
			[{ title: '' }, m.board_error_title_required()],
			[{ title: '   ' }, m.board_error_title_required()],
			[{ title: 'x'.repeat(121) }, m.board_error_title_too_long()],
			[{ content: doc('') }, m.board_error_content_required()],
			[{ content: '' }, m.board_error_content_required()],
			[{ content: doc('x'.repeat(MAX_CONTENT_BYTES + 1)) }, m.board_error_content_too_large()],
			[{ content: '{nope' }, m.board_error_content_invalid()],
			[{ contentLanguage: 'fr' }, m.board_error_content_language()]
		] as const) {
			const result = await edit(formEvent(fake, 'edit', fields(extra)));
			expect(result).toMatchObject({ status: 400, data: { error: message } });
		}
		expect(fake.log).toEqual([]);
	});

	it('0 rows (not the author, grant revoked, or gone) or 42501: 403', async () => {
		for (const update of [
			{ data: [], error: null },
			{ data: null, error: { code: '42501', message: 'rls' } }
		]) {
			const fake = fakeSupabase({ update });
			const result = await edit(formEvent(fake, 'edit', fields()));
			expect(result).toMatchObject({
				status: 403,
				data: { error: m.board_edit_error_not_allowed() }
			});
		}
	});

	it('any other error: 500, logged', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({ update: { data: null, error: { code: 'XX000', message: 'x' } } });
		const result = await edit(formEvent(fake, 'edit', fields()));
		expect(result).toMatchObject({ status: 500, data: { error: m.board_edit_error_failed() } });
		expect(spy).toHaveBeenCalledWith(`Could not edit board post ${POST_ID}. x`);
	});
});

describe('/board delete action (story 5)', () => {
	const del = (event: never) => actions.delete(event) as Promise<unknown>;
	// Story 8: an image, and a legacy PDF.
	const PATH_A = `${POST_ID}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
	const PATH_B = `${POST_ID}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf`;
	const twoFiles = {
		data: [{ object_path: PATH_A }, { object_path: PATH_B }],
		error: null
	};

	it('not signed in: 401, nothing sent', async () => {
		const fake = fakeSupabase({ files: twoFiles });
		const result = await del(formEvent(fake, 'delete', { postId: POST_ID }, { user: null }));
		expect(result).toMatchObject({ status: 401, data: { error: m.board_error_not_signed_in() } });
		expect(fake.log).toEqual([]);
		expect(fake.fileCalls).toEqual([]);
	});

	it('a bad id: 400, nothing sent', async () => {
		const fake = fakeSupabase({ files: twoFiles });
		for (const postId of ['', 'p1']) {
			const result = await del(formEvent(fake, 'delete', { postId }));
			expect(result).toMatchObject({
				status: 400,
				data: { error: m.board_delete_error_invalid() }
			});
		}
		expect(fake.log).toEqual([]);
		expect(fake.fileCalls).toEqual([]);
	});

	it("2 files: the post's objects are removed first, then the post", async () => {
		const fake = fakeSupabase({ files: twoFiles, del: { data: [{ id: POST_ID }], error: null } });
		const result = await del(formEvent(fake, 'delete', { postId: POST_ID }));
		expect(result).toEqual({ deleted: POST_ID });
		expect(fake.fileCalls).toEqual([
			['select', 'object_path'],
			['eq', 'post_id', POST_ID]
		]);
		expect(fake.log).toEqual([
			`storage:remove:board-files:${PATH_A},${PATH_B}`,
			'board_posts:delete'
		]);
		expect(fake.postCalls).toContainEqual(['eq', 'id', POST_ID]);
		expect(fake.postCalls).toContainEqual(['select', 'id']);
	});

	it('a non-author, non-moderator on a post with files: 403, storage untouched', async () => {
		for (const role of ['parent', 'student', null]) {
			const fake = fakeSupabase({
				files: twoFiles,
				target: { data: { author_id: 'someone-else' }, error: null },
				profile: { data: role ? { role } : null, error: null }
			});
			const result = await del(formEvent(fake, 'delete', { postId: POST_ID }));
			expect(result).toMatchObject({
				status: 403,
				data: { error: m.board_delete_error_not_allowed() }
			});
			expect(fake.log).toEqual([]);
			expect(fake.fileCalls).toEqual([]);
		}
	});

	it('the post is missing (gone, or not readable): 403, storage untouched', async () => {
		const fake = fakeSupabase({ files: twoFiles, target: { data: null, error: null } });
		const result = await del(formEvent(fake, 'delete', { postId: POST_ID }));
		expect(result).toMatchObject({ status: 403 });
		expect(fake.log).toEqual([]);
		expect(fake.fileCalls).toEqual([]);
	});

	it("an admin or a teacher on someone else's post: files, then the post", async () => {
		for (const role of ['admin', 'teacher']) {
			const fake = fakeSupabase({
				files: twoFiles,
				target: { data: { author_id: 'someone-else' }, error: null },
				profile: { data: { role }, error: null }
			});
			const result = await del(formEvent(fake, 'delete', { postId: POST_ID }));
			expect(result).toEqual({ deleted: POST_ID });
			expect(fake.log).toEqual([
				`storage:remove:board-files:${PATH_A},${PATH_B}`,
				'board_posts:delete'
			]);
		}
	});

	it('the author read fails: 500, storage untouched', async () => {
		consoleError();
		const fake = fakeSupabase({
			files: twoFiles,
			target: { data: null, error: { message: 'boom' } }
		});
		const result = await del(formEvent(fake, 'delete', { postId: POST_ID }));
		expect(result).toMatchObject({ status: 500, data: { error: m.board_delete_error_failed() } });
		expect(fake.log).toEqual([]);
	});

	it('a body over the cap: 413 for edit and delete', async () => {
		for (const action of ['edit', 'delete'] as const) {
			const fake = fakeSupabase();
			const body = new FormData();
			body.set('postId', POST_ID);
			const result = await (actions[action]({
				request: new Request(`http://localhost/board?/${action}`, {
					method: 'POST',
					body,
					headers: { 'content-length': String(MAX_CONTENT_BYTES + 128 * 1024) }
				}),
				locals: { supabase: fake.supabase, safeGetSession: async () => signedIn }
			} as never) as Promise<unknown>);
			expect(result).toMatchObject({ status: 413 });
			expect(fake.log).toEqual([]);
		}
	});

	it('no files: the post only', async () => {
		const fake = fakeSupabase({ files: { data: [], error: null } });
		const result = await del(formEvent(fake, 'delete', { postId: POST_ID }));
		expect(result).toEqual({ deleted: POST_ID });
		expect(fake.log).toEqual(['board_posts:delete']);
	});

	it('the removal fails: 500 and the post is kept', async () => {
		consoleError();
		const fake = fakeSupabase({
			files: twoFiles,
			remove: { data: null, error: { message: 'down' } }
		});
		const result = await del(formEvent(fake, 'delete', { postId: POST_ID }));
		expect(result).toMatchObject({ status: 500, data: { error: m.board_delete_error_files() } });
		expect(fake.log).not.toContain('board_posts:delete');
	});

	it('the removal is not confirmed (an object still there): 500 and the post is kept', async () => {
		consoleError();
		// Storage reports nothing removed and the object still exists.
		const fake = fakeSupabase({ files: twoFiles, remove: { data: [], error: null } });
		const result = await del(formEvent(fake, 'delete', { postId: POST_ID }));
		expect(result).toMatchObject({ status: 500 });
		expect(fake.log).not.toContain('board_posts:delete');
	});

	it("the files can't be read: 500 and the post is kept", async () => {
		consoleError();
		const fake = fakeSupabase({ files: { data: null, error: { message: 'boom' } } });
		const result = await del(formEvent(fake, 'delete', { postId: POST_ID }));
		expect(result).toMatchObject({ status: 500, data: { error: m.board_delete_error_files() } });
		expect(fake.log).toEqual([]);
	});

	it('0 rows (another parent, or already gone) or 42501: 403', async () => {
		for (const deleted of [
			{ data: [], error: null },
			{ data: null, error: { code: '42501', message: 'rls' } }
		]) {
			const fake = fakeSupabase({ files: { data: [], error: null }, del: deleted });
			const result = await del(formEvent(fake, 'delete', { postId: POST_ID }));
			expect(result).toMatchObject({
				status: 403,
				data: { error: m.board_delete_error_not_allowed() }
			});
		}
	});

	it('any other error: 500, logged', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({
			files: { data: [], error: null },
			del: { data: null, error: { code: 'XX000', message: 'x' } }
		});
		const result = await del(formEvent(fake, 'delete', { postId: POST_ID }));
		expect(result).toMatchObject({ status: 500, data: { error: m.board_delete_error_failed() } });
		expect(spy).toHaveBeenCalledWith(`Could not delete board post ${POST_ID}. x`);
	});
});

/** Story 6 (CAP-5): a new post is announced once; nothing else is. */
describe('/board push on a new post (story 6)', () => {
	const post = (event: never) => actions.post(event) as Promise<unknown>;
	const inserted = { data: { id: POST_ID }, error: null };

	it('a new post is announced with its id, after its image is attached', async () => {
		const fake = fakeSupabase({ insert: inserted });
		announceBoardPost.mockImplementationOnce(async () => {
			fake.log.push('announce');
		});
		const result = await post(fileEvent(fake, [image('Flyer.jpg')]));
		expect(result).toEqual({ posted: true, notAttached: [] });
		expect(announceBoardPost).toHaveBeenCalledTimes(1);
		expect(announceBoardPost).toHaveBeenCalledWith(POST_ID);
		expect(fake.log.at(-1)).toBe('announce');
		expect(fake.log.indexOf('board_post_files:insert')).toBeLessThan(fake.log.indexOf('announce'));
	});

	it('on Cloudflare the announcement runs after the reply', async () => {
		const fake = fakeSupabase({ insert: inserted });
		const waitUntil = vi.fn();
		await post(
			postEvent(fake, { content: doc('Hi'), contentLanguage: 'en' }, signedIn, {
				ctx: { waitUntil }
			})
		);
		expect(announceBoardPost).toHaveBeenCalledWith(POST_ID);
		expect(waitUntil).toHaveBeenCalledTimes(1);
	});

	it('a refused or failed post is not announced', async () => {
		const spy = consoleError();
		for (const insert of [
			{ data: null, error: { code: '42501', message: 'rls' } },
			{ data: null, error: { code: 'XX000', message: 'x' } }
		]) {
			const fake = fakeSupabase({ insert });
			await post(postEvent(fake, { content: doc('Hi'), contentLanguage: 'en' }));
		}
		await post(postEvent(fakeSupabase(), { content: doc(''), contentLanguage: 'en' }));
		expect(announceBoardPost).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('an edit or a delete is never announced', async () => {
		const edited = await actions.edit(
			formEvent(fakeSupabase(), 'edit', {
				postId: POST_ID,
				title: 'Picnic',
				content: doc('Picnic moved to Sunday'),
				contentLanguage: 'en'
			})
		);
		expect(edited).toEqual({ edited: POST_ID });
		const deleted = await actions.delete(formEvent(fakeSupabase(), 'delete', { postId: POST_ID }));
		expect(deleted).toEqual({ deleted: POST_ID });
		expect(announceBoardPost).not.toHaveBeenCalled();
	});
});

describe('/board reactions in the load (story 9)', () => {
	type Loaded = { posts: { id: string; reactions: unknown }[] };

	it('one counts call and one own-reactions read for the page; counts and mine per post', async () => {
		const fake = fakeSupabase({
			posts: { data: [row(1), row(2), row(3)], error: null },
			counts: {
				data: [
					{ post_id: 'p1', up_count: 3, down_count: 1 },
					{ post_id: 'p2', up_count: 0, down_count: 2 }
				],
				error: null
			},
			mineReactions: { data: [{ post_id: 'p2', value: -1 }], error: null }
		});
		const data = (await runLoad(fake)) as unknown as Loaded;
		expect(data.posts.map((p) => [p.id, p.reactions])).toEqual([
			['p1', { up: 3, down: 1, mine: null }],
			['p2', { up: 0, down: 2, mine: -1 }],
			['p3', { up: 0, down: 0, mine: null }]
		]);
		const counts = fake.rpcCalls.filter((c) => c.fn === 'board_reaction_counts');
		expect(counts).toEqual([{ fn: 'board_reaction_counts', args: { p_ids: ['p1', 'p2', 'p3'] } }]);
		expect(fake.reactionCalls).toEqual([
			['select', 'post_id, value'],
			['eq', 'user_id', 'u1'],
			['in', 'post_id', ['p1', 'p2', 'p3']]
		]);
	});

	it('no posts: no reactions read', async () => {
		const fake = fakeSupabase({ posts: { data: [], error: null } });
		const data = (await runLoad(fake)) as unknown as { reactionsError: boolean };
		expect(data.reactionsError).toBe(false);
		expect(fake.rpcCalls.map((c) => c.fn)).not.toContain('board_reaction_counts');
		expect(fake.reactionCalls).toEqual([]);
	});

	it('the counts read fails: zero counts, no own reaction, logged; the page renders', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({
			posts: { data: [row(1)], error: null },
			counts: { data: null, error: { message: 'boom' } },
			mineReactions: { data: [{ post_id: 'p1', value: 1 }], error: null }
		});
		const data = (await runLoad(fake)) as unknown as Loaded & {
			loadError: boolean;
			reactionsError: boolean;
		};
		expect(data.loadError).toBe(false);
		expect(data.reactionsError).toBe(true);
		expect(data.posts[0].reactions).toEqual({ up: 0, down: 0, mine: null });
		expect(spy).toHaveBeenCalledWith(expect.stringContaining('board reactions'));
	});

	it('the own-reactions read fails: zero counts, no own reaction, logged', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({
			posts: { data: [row(1)], error: null },
			counts: { data: [{ post_id: 'p1', up_count: 2, down_count: 0 }], error: null },
			mineReactions: { data: null, error: { message: 'boom' } }
		});
		const data = (await runLoad(fake)) as unknown as Loaded & { reactionsError: boolean };
		expect(data.reactionsError).toBe(true);
		expect(data.posts[0].reactions).toEqual({ up: 0, down: 0, mine: null });
		expect(spy).toHaveBeenCalledWith(expect.stringContaining('board reactions'));
	});
});

describe('/board react action (story 9)', () => {
	const react = (event: never) => actions.react(event) as Promise<unknown>;
	const fields = (value: string, postId = POST_ID) => ({ postId, value });
	const writes = (fake: ReturnType<typeof fakeSupabase>) =>
		fake.log.filter((entry) => entry.startsWith('board_post_reactions:'));

	it('not signed in: 401, nothing sent', async () => {
		const fake = fakeSupabase();
		const result = await react(formEvent(fake, 'react', fields('up'), { user: null }));
		expect(result).toMatchObject({ status: 401, data: { error: m.board_error_not_signed_in() } });
		expect(fake.reactionCalls).toEqual([]);
	});

	it('bad input (value=love, a bad id, nothing): 400, nothing sent', async () => {
		const fake = fakeSupabase();
		for (const f of [
			fields('love'),
			fields('up', 'p1'),
			fields('', POST_ID),
			{ postId: POST_ID }
		]) {
			const result = await react(formEvent(fake, 'react', f));
			expect(result).toMatchObject({
				status: 400,
				data: { error: m.board_react_error_invalid() }
			});
		}
		expect(fake.reactionCalls).toEqual([]);
	});

	it('first 👍: inserts {post_id, user_id: the signed-in user, value: 1}', async () => {
		const fake = fakeSupabase();
		const result = await react(formEvent(fake, 'react', { ...fields('up'), user_id: 'forged' }));
		expect(result).toEqual({ reacted: true });
		expect(fake.reactionCalls).toContainEqual([
			'insert',
			{ post_id: POST_ID, user_id: 'u1', value: 1 }
		]);
		expect(writes(fake)).toEqual(['board_post_reactions:insert']);
		expect(fake.reactionCalls.slice(0, 4)).toEqual([
			['select', 'value'],
			['eq', 'post_id', POST_ID],
			['eq', 'user_id', 'u1'],
			['maybeSingle']
		]);
	});

	it('👍 again while mine is 1: deletes the own row', async () => {
		const fake = fakeSupabase({
			reaction: { data: { value: 1 }, error: null },
			reactionDelete: { data: [{ value: 1 }], error: null }
		});
		const result = await react(formEvent(fake, 'react', fields('up')));
		expect(result).toEqual({ reacted: true });
		expect(writes(fake)).toEqual(['board_post_reactions:delete']);
		// Only while it still has this value (another tab may have switched it).
		expect(fake.reactionCalls.slice(-5)).toEqual([
			['delete'],
			['eq', 'post_id', POST_ID],
			['eq', 'user_id', 'u1'],
			['eq', 'value', 1],
			['select', 'value']
		]);
	});

	it('👍 again, but another tab switched it to 👎 meanwhile: nothing deleted, set to 👍', async () => {
		const fake = fakeSupabase({
			reaction: { data: { value: 1 }, error: null },
			reactionDelete: { data: [], error: null },
			reactionUpdate: { data: [{ value: 1 }], error: null }
		});
		const result = await react(formEvent(fake, 'react', fields('up')));
		expect(result).toEqual({ reacted: true });
		expect(writes(fake)).toEqual(['board_post_reactions:delete', 'board_post_reactions:update']);
		expect(fake.reactionCalls).toContainEqual(['update', { value: 1 }]);
	});

	it('the delete fails: mapped like any refusal (42501 403, other 500)', async () => {
		const spy = consoleError();
		for (const [error, status] of [
			[{ code: '42501', message: 'rls' }, 403],
			[{ message: 'down' }, 500]
		] as const) {
			const fake = fakeSupabase({
				reaction: { data: { value: 1 }, error: null },
				reactionDelete: { data: null, error }
			});
			const result = await react(formEvent(fake, 'react', fields('up')));
			expect(result).toMatchObject({ status });
			expect(writes(fake)).toEqual(['board_post_reactions:delete']);
		}
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('the switch update fails: mapped like any refusal (42501 403, other 500)', async () => {
		const spy = consoleError();
		for (const [error, status, message] of [
			[{ code: '42501', message: 'rls' }, 403, m.board_react_error_not_allowed()],
			[{ message: 'down' }, 500, m.board_react_error_failed()]
		] as const) {
			const fake = fakeSupabase({
				reaction: { data: { value: 1 }, error: null },
				reactionUpdate: { data: null, error }
			});
			const result = await react(formEvent(fake, 'react', fields('down')));
			expect(result).toMatchObject({ status, data: { error: message } });
			expect(writes(fake)).toEqual(['board_post_reactions:update']);
		}
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('the switch update matches no row (removed in another tab): inserts it again', async () => {
		const fake = fakeSupabase({
			reaction: { data: { value: 1 }, error: null },
			reactionUpdate: { data: [], error: null }
		});
		const result = await react(formEvent(fake, 'react', fields('down')));
		expect(result).toEqual({ reacted: true });
		expect(writes(fake)).toEqual(['board_post_reactions:update', 'board_post_reactions:insert']);
		expect(fake.reactionCalls).toContainEqual([
			'insert',
			{ post_id: POST_ID, user_id: 'u1', value: -1 }
		]);
	});

	it('23505, then the retry update matches no row: 409', async () => {
		const fake = fakeSupabase({
			reactionInsert: { data: null, error: { code: '23505', message: 'dup' } },
			reactionUpdate: { data: [], error: null }
		});
		const result = await react(formEvent(fake, 'react', fields('up')));
		expect(result).toMatchObject({ status: 409, data: { error: m.board_react_error_failed() } });
		expect(writes(fake)).toEqual(['board_post_reactions:insert', 'board_post_reactions:update']);
	});

	it('switch: 👎 while mine is 1 updates the value to -1', async () => {
		const fake = fakeSupabase({ reaction: { data: { value: 1 }, error: null } });
		const result = await react(formEvent(fake, 'react', fields('down')));
		expect(result).toEqual({ reacted: true });
		expect(writes(fake)).toEqual(['board_post_reactions:update']);
		expect(fake.reactionCalls).toContainEqual(['update', { value: -1 }]);
		expect(fake.reactionCalls).toContainEqual(['eq', 'user_id', 'u1']);
	});

	it('added meanwhile in another tab (23505): switches by update', async () => {
		const fake = fakeSupabase({
			reactionInsert: { data: null, error: { code: '23505', message: 'dup' } },
			reactionUpdate: { data: [{ value: -1 }], error: null }
		});
		const result = await react(formEvent(fake, 'react', fields('down')));
		expect(result).toEqual({ reacted: true });
		expect(writes(fake)).toEqual(['board_post_reactions:insert', 'board_post_reactions:update']);
	});

	it('a non-reader (42501): 403 with a localized message', async () => {
		const fake = fakeSupabase({
			reactionInsert: { data: null, error: { code: '42501', message: 'rls' } }
		});
		const result = await react(formEvent(fake, 'react', fields('up')));
		expect(result).toMatchObject({
			status: 403,
			data: { error: m.board_react_error_not_allowed() }
		});
	});

	it('a deleted post (23503): 404 with a localized message', async () => {
		const fake = fakeSupabase({
			reactionInsert: { data: null, error: { code: '23503', message: 'fk' } }
		});
		const result = await react(formEvent(fake, 'react', fields('up')));
		expect(result).toMatchObject({
			status: 404,
			data: { error: m.board_react_error_not_found() }
		});
	});

	it('any other error: 500, logged', async () => {
		const spy = consoleError();
		const fake = fakeSupabase({ reaction: { data: null, error: { message: 'down' } } });
		const result = await react(formEvent(fake, 'react', fields('up')));
		expect(result).toMatchObject({ status: 500, data: { error: m.board_react_error_failed() } });
		expect(writes(fake)).toEqual([]);
		expect(spy).toHaveBeenCalled();
	});

	it('never announces a push', async () => {
		const fake = fakeSupabase();
		await react(formEvent(fake, 'react', fields('up')));
		expect(announceBoardPost).not.toHaveBeenCalled();
	});
});
