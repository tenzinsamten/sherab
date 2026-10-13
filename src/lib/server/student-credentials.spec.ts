import { describe, expect, it, vi } from 'vitest';
import { isDuplicateEmailError, takenStudentUsernames } from './student-credentials';

function adminClient(data: { email: string }[] | null) {
	const ilike = vi.fn(() => Promise.resolve({ data, error: null }));
	const select = vi.fn(() => ({ ilike }));
	const from = vi.fn(() => ({ select }));
	return {
		client: { from } as unknown as Parameters<typeof takenStudentUsernames>[0],
		from,
		select,
		ilike
	};
}

describe('takenStudentUsernames (#100)', () => {
	it('returns the usernames of student addresses, without pending- placeholders', async () => {
		const { client, from, select, ilike } = adminClient([
			{ email: 'tenzin@students.internal.invalid' },
			{ email: 'tenzin2@students.internal.invalid' },
			{ email: 'pending-0b0e1c1e-0000-4000-8000-000000000000@students.internal.invalid' },
			{ email: 'someone@example.com' }
		]);

		expect(await takenStudentUsernames(client)).toEqual(new Set(['tenzin', 'tenzin2']));
		expect(from).toHaveBeenCalledWith('profiles');
		expect(select).toHaveBeenCalledWith('email');
		expect(ilike).toHaveBeenCalledWith('email', '%@students.internal.invalid');
	});

	it('returns an empty set when the scan gives nothing', async () => {
		expect(await takenStudentUsernames(adminClient(null).client)).toEqual(new Set());
	});
});

describe('isDuplicateEmailError (#100)', () => {
	it.each([
		{ code: 'email_exists', message: 'x' },
		{ code: '23505', message: 'x' },
		{ message: 'A user with this email address has already been registered' },
		{ message: 'duplicate key value violates unique constraint' }
	])('is true for %o', (error) => {
		expect(isDuplicateEmailError(error)).toBe(true);
	});

	it('is false for any other error', () => {
		expect(isDuplicateEmailError({ message: 'Database error creating new user' })).toBe(false);
		expect(isDuplicateEmailError({ code: 'unexpected_failure' })).toBe(false);
	});
});
