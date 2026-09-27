import { describe, expect, it } from 'vitest';
import { STUDENT_EMAIL_DOMAIN } from './temp-password';
import { approvedParentExists, escapeLikePattern, isValidParentEmail } from './parent-registration';

describe('escapeLikePattern', () => {
	it('escapes like wildcards so the email matches literally', () => {
		expect(escapeLikePattern('a_b%c\\d@x.de')).toBe('a\\_b\\%c\\\\d@x.de');
		expect(escapeLikePattern('plain@example.com')).toBe('plain@example.com');
	});
});

describe('isValidParentEmail', () => {
	it('accepts a normal email', () => {
		expect(isValidParentEmail('pema@example.com')).toBe(true);
	});

	it('refuses malformed emails and the student login domain', () => {
		expect(isValidParentEmail('pema')).toBe(false);
		expect(isValidParentEmail('pema@example')).toBe(false);
		expect(isValidParentEmail('a b@example.com')).toBe(false);
		expect(isValidParentEmail(`kid@${STUDENT_EMAIL_DOMAIN}`)).toBe(false);
	});
});

describe('approvedParentExists', () => {
	type Result = { data: { id: string }[] | null; error: { message: string } | null };

	function fakeClient(profiles: Result, parents: Result) {
		const calls: { table: string; method: string; args: unknown[] }[] = [];
		const client = {
			from: (table: string) => {
				const result = table === 'profiles' ? profiles : parents;
				const chain: Record<string, unknown> = {};
				for (const method of ['select', 'ilike', 'in', 'eq', 'limit']) {
					chain[method] = (...args: unknown[]) => {
						calls.push({ table, method, args });
						return chain;
					};
				}
				chain.then = (resolve: (r: Result) => unknown) => resolve(result);
				return chain;
			}
		};
		return { client: client as unknown as Parameters<typeof approvedParentExists>[0], calls };
	}

	it('is true for an approved parent, matching the trimmed, escaped email', async () => {
		const { client, calls } = fakeClient(
			{ data: [{ id: 'p1' }], error: null },
			{ data: [{ id: 'p1' }], error: null }
		);
		expect(await approvedParentExists(client, '  Pema_M@Example.com ')).toBe(true);
		expect(calls).toContainEqual({
			table: 'profiles',
			method: 'ilike',
			args: ['email', 'Pema\\_M@Example.com']
		});
		expect(calls).toContainEqual({ table: 'parents', method: 'eq', args: ['status', 'approved'] });
	});

	it('is false when no login has the email, without reading parents', async () => {
		const { client, calls } = fakeClient({ data: [], error: null }, { data: [], error: null });
		expect(await approvedParentExists(client, 'nobody@example.com')).toBe(false);
		expect(calls.some((c) => c.table === 'parents')).toBe(false);
	});

	it('is false when the login is not an approved parent', async () => {
		const { client } = fakeClient({ data: [{ id: 'p1' }], error: null }, { data: [], error: null });
		expect(await approvedParentExists(client, 'pending@example.com')).toBe(false);
	});

	it('is false for a blank email and throws on a read error', async () => {
		const { client } = fakeClient(
			{ data: null, error: { message: 'boom' } },
			{ data: [], error: null }
		);
		expect(await approvedParentExists(client, '   ')).toBe(false);
		await expect(approvedParentExists(client, 'x@example.com')).rejects.toThrow('boom');
	});
});
