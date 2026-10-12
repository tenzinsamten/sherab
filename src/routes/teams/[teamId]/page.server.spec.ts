import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import { load } from './+page.server';

/**
 * The team page's load (#97) with a mocked `locals`: what it does with each
 * answer of team_students() (0041). Who gets which answer is the database's
 * decision, covered in rls.spec.ts.
 */
const TEAM_ID = '11111111-2222-4333-8444-555555555555';

type RpcResult = { data: unknown; error: unknown };

function run(
	rpcResult: RpcResult,
	{ user = { id: 'u1' } as { id: string } | null, teamId = TEAM_ID } = {}
) {
	const rpc = vi.fn(async () => rpcResult);
	const result = load({
		params: { teamId },
		locals: { supabase: { rpc }, safeGetSession: async () => ({ user }) }
	} as unknown as Parameters<typeof load>[0]);
	return { rpc, result };
}

const row = (student_name: string | null) => ({
	team_name: 'Snow Lions',
	team_name_bo: 'གངས་སེང་།',
	team_name_de: 'Schneelöwen',
	student_name
});

afterEach(() => vi.restoreAllMocks());

describe('team page load', () => {
	it("returns the team's name and the students' names in the order the database gave", async () => {
		const { rpc, result } = run({
			data: [row('Anna'), row('Bkra shis'), row('Chodon')],
			error: null
		});

		expect(await result).toEqual({
			team: { name: 'Snow Lions' },
			students: ['Anna', 'Bkra shis', 'Chodon']
		});
		expect(rpc).toHaveBeenCalledWith('team_students', { p_team_id: TEAM_ID });
	});

	it('a team without students: the name and an empty list', async () => {
		const { result } = run({ data: [row(null)], error: null });

		expect(await result).toEqual({ team: { name: 'Snow Lions' }, students: [] });
	});

	it('a refusal (42501) is "not found", with no names', async () => {
		const { result } = run({ data: null, error: { code: '42501', message: 'not allowed' } });

		await expect(result).rejects.toMatchObject({
			status: 404,
			body: { message: 'Team not found.' }
		});
	});

	it('an unknown team (no rows) is "not found"', async () => {
		const { result } = run({ data: [], error: null });

		await expect(result).rejects.toMatchObject({ status: 404 });
	});

	it('a malformed id is "not found" without asking the database', async () => {
		const { rpc, result } = run({ data: [], error: null }, { teamId: 'not-a-uuid' });

		await expect(result).rejects.toMatchObject({ status: 404 });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('another database error is a 500, not "not found"', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { result } = run({ data: null, error: { code: '57014', message: 'timeout' } });

		await expect(result).rejects.toMatchObject({ status: 500 });
	});

	it('signed out: redirected to the sign-in page without asking the database', async () => {
		const { rpc, result } = run({ data: null, error: null }, { user: null });

		await expect(result).rejects.toMatchObject({ status: 303, location: '/login' });
		expect(rpc).not.toHaveBeenCalled();
	});
});

describe("team page load in the viewer's language", () => {
	const original = getLocale;
	afterEach(() => overwriteGetLocale(original));

	it('Tibetan: the Tibetan name', async () => {
		overwriteGetLocale(() => 'bo');
		const { result } = run({ data: [row('Anna')], error: null });

		expect(await result).toMatchObject({ team: { name: 'གངས་སེང་།' } });
	});

	it('German: the German name', async () => {
		overwriteGetLocale(() => 'de');
		const { result } = run({ data: [row('Anna')], error: null });

		expect(await result).toMatchObject({ team: { name: 'Schneelöwen' } });
	});

	it.each(['bo', 'de'] as const)(
		'%s without a name in that language: the English name',
		async (locale) => {
			overwriteGetLocale(() => locale);
			const { result } = run({
				data: [{ ...row('Anna'), team_name_bo: null, team_name_de: '  ' }],
				error: null
			});

			expect(await result).toMatchObject({ team: { name: 'Snow Lions' } });
		}
	);
});
