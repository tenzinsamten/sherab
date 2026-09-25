import { describe, expect, it } from 'vitest';
import { checkNewPassword, MIN_PASSWORD_LENGTH } from './password-rules';

describe('checkNewPassword', () => {
	it('rejects a password shorter than the minimum', () => {
		const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
		expect(checkNewPassword(short, short)).toBe('length');
	});

	it('rejects a confirmation that does not match', () => {
		expect(checkNewPassword('correct horse', 'correct house')).toBe('mismatch');
	});

	it('checks the length before the match', () => {
		expect(checkNewPassword('abc', 'xyz')).toBe('length');
	});

	it('accepts a long-enough matching password', () => {
		const ok = 'a'.repeat(MIN_PASSWORD_LENGTH);
		expect(checkNewPassword(ok, ok)).toBeNull();
	});
});
