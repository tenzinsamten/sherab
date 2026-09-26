import { describe, expect, it } from 'vitest';
import { STUDENT_EMAIL_DOMAIN } from './temp-password';
import { escapeLikePattern, isValidParentEmail } from './parent-registration';

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
