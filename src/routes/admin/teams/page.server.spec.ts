import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { actions } from './+page.server';

/**
 * /admin/teams `create` and `rename` (#76): a team has a name per language.
 * English and Tibetan are required, German is optional. FormData event + a
 * fake `locals.supabase` recording what would be written.
 */
type DbError = { code?: string; message: string } | null;
type TeamRow = { id: string; name: string; name_bo: string | null; name_de: string | null };

function fakeSupabase(result: { row?: TeamRow | null; error?: DbError } = {}) {
	const row = result.row === undefined ? saved : result.row;
	const error = result.error ?? null;
	const inserted: unknown[] = [];
	const updates: { values: unknown; id: unknown }[] = [];
	return {
		inserted,
		updates,
		client: {
			from: () => ({
				insert: (values: unknown) => ({
					select: () => ({
						single: async () => {
							inserted.push(values);
							return { data: error ? null : row, error };
						}
					})
				}),
				update: (values: unknown) => ({
					eq: (_column: string, id: unknown) => ({
						select: async () => {
							updates.push({ values, id });
							return { data: error ? null : row ? [row] : [], error };
						}
					})
				})
			})
		}
	};
}

function event(
	fields: Record<string, string>,
	supabase: ReturnType<typeof fakeSupabase>['client']
) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.append(k, v);
	return {
		request: new Request('http://localhost/admin/teams', { method: 'POST', body }),
		locals: { supabase }
	} as unknown as Parameters<typeof actions.create>[0];
}

const saved: TeamRow = { id: 't1', name: 'Yaks', name_bo: 'གཡག', name_de: null };
const duplicate = (index: string) => ({
	code: '23505',
	message: `duplicate key value violates unique constraint "${index}"`
});

describe('admin teams create (#76)', () => {
	it('inserts the three names (an empty German name as NULL)', async () => {
		const fake = fakeSupabase();
		const result = await actions.create(
			event({ name: ' Yaks ', nameBo: ' གཡག ', nameDe: '' }, fake.client)
		);
		expect(fake.inserted).toEqual([{ name: 'Yaks', name_bo: 'གཡག', name_de: null }]);
		expect(result).toEqual({
			success: true,
			team: { id: 't1', name: 'Yaks' },
			name: 'Yaks',
			nameBo: 'གཡག',
			nameDe: ''
		});
	});

	it('requires the English and the Tibetan name; nothing is inserted', async () => {
		for (const [fields, error] of [
			[{ name: ' ', nameBo: 'གཡག' }, m.teams_error_name_required()],
			[{ name: 'Yaks', nameDe: 'Yaks' }, m.teams_error_name_bo_required()]
		] as const) {
			const fake = fakeSupabase();
			expect(await actions.create(event(fields, fake.client))).toMatchObject({
				status: 400,
				data: { error }
			});
			expect(fake.inserted).toEqual([]);
		}
	});

	it('a name taken in one language: that name is reported and the names are kept', async () => {
		const fake = fakeSupabase({ error: duplicate('teams_name_bo_unique_idx') });
		expect(
			await actions.create(event({ name: 'Yaks', nameBo: 'གཡག', nameDe: 'Yaks' }, fake.client))
		).toMatchObject({
			status: 400,
			data: {
				error: m.teams_error_duplicate_name({ name: 'གཡག' }),
				name: 'Yaks',
				nameBo: 'གཡག',
				nameDe: 'Yaks'
			}
		});
	});
});

describe('admin teams rename (#76)', () => {
	const names = { name: 'Yaks', nameBo: 'གཡག', nameDe: 'Yaks DE' };

	it('saves the three names of the team', async () => {
		const fake = fakeSupabase({ row: { ...saved, name_de: 'Yaks DE' } });
		expect(await actions.rename(event({ teamId: 't1', ...names }, fake.client))).toEqual({
			renamed: 'Yaks'
		});
		expect(fake.updates).toEqual([
			{ values: { name: 'Yaks', name_bo: 'གཡག', name_de: 'Yaks DE' }, id: 't1' }
		]);
	});

	it('without a Tibetan name: fail 400, nothing written, the names kept', async () => {
		const fake = fakeSupabase();
		expect(
			await actions.rename(event({ teamId: 't1', name: 'Yaks', nameBo: '' }, fake.client))
		).toMatchObject({
			status: 400,
			data: {
				error: m.teams_error_name_bo_required(),
				renameId: 't1',
				renameValues: { name: 'Yaks', nameBo: '', nameDe: '' }
			}
		});
		expect(fake.updates).toEqual([]);
	});

	it('a name another team has in that language: the duplicate is named', async () => {
		const fake = fakeSupabase({ error: duplicate('teams_name_de_unique_idx') });
		expect(await actions.rename(event({ teamId: 't1', ...names }, fake.client))).toMatchObject({
			status: 400,
			data: { error: m.teams_error_duplicate_name({ name: 'Yaks DE' }), renameId: 't1' }
		});
	});

	it('a save that changes no row (RLS, or the team is gone): fail 400', async () => {
		const fake = fakeSupabase({ row: null });
		expect(await actions.rename(event({ teamId: 't1', ...names }, fake.client))).toMatchObject({
			status: 400,
			data: { error: m.teams_error_rename_failed() }
		});
	});
});
