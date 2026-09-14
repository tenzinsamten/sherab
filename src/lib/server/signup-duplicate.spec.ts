import { describe, expect, it } from 'vitest';
import { isDuplicateSignup } from './signup-duplicate';

describe('isDuplicateSignup', () => {
	it('detects the autoconfirm-enabled shape: a 422 error', () => {
		const error = { status: 422, message: 'User already registered' };
		expect(isDuplicateSignup(error, null)).toBe(true);
	});

	it('detects a duplicate by message even without status 422', () => {
		const error = { status: 400, message: 'Email already registered' };
		expect(isDuplicateSignup(error, null)).toBe(true);
	});

	it('detects the email-confirmation-required shape: success with empty identities', () => {
		const user = { identities: [] } as never;
		expect(isDuplicateSignup(null, user)).toBe(true);
	});

	it('does not treat a genuine new signup (non-empty identities, no error) as duplicate', () => {
		const user = { identities: [{ id: 'x' }] } as never;
		expect(isDuplicateSignup(null, user)).toBe(false);
	});

	it('does not treat an unrelated error as duplicate', () => {
		const error = { status: 500, message: 'Internal error' };
		expect(isDuplicateSignup(error, null)).toBe(false);
	});

	it('does not treat a null user with no error as duplicate', () => {
		expect(isDuplicateSignup(null, null)).toBe(false);
	});
});
