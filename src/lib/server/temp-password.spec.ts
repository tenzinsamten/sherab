import { describe, expect, it } from 'vitest';
import {
	generateStudentPin,
	generateTempPassword,
	generateUniqueStudentUsername,
	slugifyRegistrationName,
	studentEmailToUsername,
	studentUsernameToEmail
} from './temp-password';

describe('generateTempPassword', () => {
	it('generates a password of the expected default length', () => {
		expect(generateTempPassword()).toHaveLength(12);
	});

	it('respects a custom length', () => {
		expect(generateTempPassword(20)).toHaveLength(20);
	});

	it('is not the same on every call', () => {
		const passwords = new Set(Array.from({ length: 100 }, () => generateTempPassword()));
		expect(passwords.size).toBe(100);
	});
});

describe('generateStudentPin', () => {
	it('generates a 4-digit numeric PIN by default', () => {
		const pin = generateStudentPin();
		expect(pin).toHaveLength(4);
		expect(pin).toMatch(/^[0-9]{4}$/);
	});

	it('respects a custom length', () => {
		expect(generateStudentPin(6)).toMatch(/^[0-9]{6}$/);
	});

	it('is not the same on every call (statistically distinct)', () => {
		const pins = new Set(Array.from({ length: 200 }, () => generateStudentPin(6)));
		expect(pins.size).toBeGreaterThan(190);
	});
});

describe('studentUsernameToEmail / studentEmailToUsername', () => {
	it('round-trips a username through the synthesized email', () => {
		const email = studentUsernameToEmail('tenzin');
		expect(email).toBe('tenzin@students.internal.invalid');
		expect(studentEmailToUsername(email)).toBe('tenzin');
	});

	it('returns null for an email outside the student domain', () => {
		expect(studentEmailToUsername('teacher@example.com')).toBeNull();
	});
});

describe('slugifyRegistrationName', () => {
	it('lowercases and strips non-alphanumeric characters', () => {
		expect(slugifyRegistrationName('Tenzin Dolma')).toBe('tenzindolma');
	});

	it('strips diacritics', () => {
		expect(slugifyRegistrationName('Tenzin Dölma')).toBe('tenzindolma');
	});

	it('collapses a name with no Latin characters to an empty string', () => {
		expect(slugifyRegistrationName('བསྟན་འཛིན')).toBe('');
	});
});

describe('generateUniqueStudentUsername', () => {
	it('returns the plain slug when it is not taken', () => {
		expect(generateUniqueStudentUsername('Tenzin Dolma', new Set())).toBe('tenzindolma');
	});

	it('appends the smallest free numeric suffix on collision', () => {
		const existing = new Set(['tenzindolma', 'tenzindolma2']);
		expect(generateUniqueStudentUsername('Tenzin Dolma', existing)).toBe('tenzindolma3');
	});

	it('falls back to a generic base for a name with no Latin characters', () => {
		expect(generateUniqueStudentUsername('བསྟན་འཛིན', new Set())).toBe('student');
	});

	it('dedupes the fallback base too', () => {
		const existing = new Set(['student', 'student2']);
		expect(generateUniqueStudentUsername('བསྟན་འཛིན', existing)).toBe('student3');
	});
});
