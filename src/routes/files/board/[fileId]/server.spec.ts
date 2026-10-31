import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

/**
 * /files/board/[fileId] (spec-parent-message-board story 4): the row is
 * read under RLS with the caller's client, signed for 60 s and redirected
 * to; everything a non-reader could ask about is a 404.
 */

const FILE = '44444444-4444-4444-8444-444444444444';
const PATH = '33333333-3333-4333-8333-333333333333/55555555-5555-4555-8555-555555555555.pdf';

type Result = { data: unknown; error: { message: string } | null };

function fake(
	row: Result,
	sign: Result = { data: { signedUrl: 'https://s.example/x?token=t' }, error: null }
) {
	const asked: string[] = [];
	const supabase = {
		from: (table: string) => {
			asked.push(table);
			const chain = {
				select: () => chain,
				eq: () => chain,
				maybeSingle: async () => row
			};
			return chain;
		},
		storage: {
			from: (bucket: string) => ({
				createSignedUrl: async (path: string, seconds: number) => {
					asked.push(`sign:${bucket}:${path}:${seconds}`);
					return sign;
				}
			})
		}
	};
	return { supabase, asked };
}

async function get(
	fileId: string,
	supabase: unknown,
	options: { download?: boolean; signedIn?: boolean } = {}
) {
	const url = new URL(
		`http://localhost/files/board/${fileId}${options.download ? '?download' : ''}`
	);
	return Promise.resolve()
		.then(() =>
			GET({
				params: { fileId },
				url,
				locals: {
					supabase,
					safeGetSession: async () =>
						options.signedIn === false ? { user: null } : { user: { id: 'u1' } }
				}
			} as unknown as Parameters<typeof GET>[0])
		)
		.then(
			(response) => ({ response, thrown: null }),
			(thrown: { status: number }) => ({ response: null, thrown })
		);
}

afterEach(() => {
	vi.restoreAllMocks();
});

const row = { data: { object_path: PATH, file_name: 'Flyer.pdf' }, error: null };

describe('GET /files/board/[fileId]', () => {
	it('story 8: an image row: 303 to a freshly signed link for its object, each request', async () => {
		const IMAGE = '33333333-3333-4333-8333-333333333333/66666666-6666-4666-8666-666666666666.jpg';
		const { supabase, asked } = fake({
			data: { object_path: IMAGE, file_name: 'Picnic.jpg' },
			error: null
		});
		for (let i = 0; i < 2; i += 1) {
			const { response } = await get(FILE, supabase);
			expect(response!.status).toBe(303);
			expect(response!.headers.get('location')).toBe('https://s.example/x?token=t');
			expect(response!.headers.get('cache-control')).toBe('no-store');
		}
		expect(asked.filter((a) => a.startsWith('sign:'))).toEqual([
			`sign:board-files:${IMAGE}:60`,
			`sign:board-files:${IMAGE}:60`
		]);
	});

	it('a reader: 303 to a 60 s signed link, never cached', async () => {
		const { supabase, asked } = fake(row);
		const { response } = await get(FILE, supabase);
		expect(response!.status).toBe(303);
		expect(response!.headers.get('location')).toBe('https://s.example/x?token=t');
		expect(response!.headers.get('cache-control')).toBe('no-store');
		expect(response!.headers.get('referrer-policy')).toBe('no-referrer');
		expect(asked).toEqual(['board_post_files', `sign:board-files:${PATH}:60`]);
	});

	it('?download: the link saves the file under its name', async () => {
		const { supabase } = fake(row);
		const { response } = await get(FILE, supabase, { download: true });
		expect(response!.headers.get('location')).toBe(
			'https://s.example/x?token=t&download=Flyer.pdf'
		);
	});

	it('no row (a non-reader under RLS, or an unknown id): 404', async () => {
		const { supabase, asked } = fake({ data: null, error: null });
		expect((await get(FILE, supabase)).thrown).toMatchObject({ status: 404 });
		expect(asked).toEqual(['board_post_files']);
	});

	it('not a uuid: 404, nothing asked', async () => {
		const { supabase, asked } = fake(row);
		expect((await get('nope', supabase)).thrown).toMatchObject({ status: 404 });
		expect(asked).toEqual([]);
	});

	it('signed out: 404, nothing asked', async () => {
		const { supabase, asked } = fake(row);
		expect((await get(FILE, supabase, { signedIn: false })).thrown).toMatchObject({
			status: 404
		});
		expect(asked).toEqual([]);
	});

	it('storage refuses to sign: 500', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { supabase } = fake(row, { data: null, error: { message: 'down' } });
		expect((await get(FILE, supabase)).thrown).toMatchObject({ status: 500 });
	});
});
