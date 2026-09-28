import { describe, expect, it } from 'vitest';
import { initials } from './initials';

describe('initials', () => {
	it('takes the first letters of the first and last word', () => {
		expect(initials('Tenzin Samten')).toBe('TS');
		expect(initials('  anna maria  schmidt ')).toBe('AS');
	});

	it('uses one letter for a single-word name', () => {
		expect(initials('Pema')).toBe('P');
	});

	it('keeps whole code points (non-Latin scripts, emoji)', () => {
		expect(initials('བསྟན་འཛིན')).toBe('བ');
		expect(initials('😀 Smile')).toBe('😀S');
	});

	it('keeps whole graphemes (decomposed accents, joined emoji)', () => {
		expect(initials('E\u0301mile Zola')).toBe('E\u0301Z');
		expect(initials('👨‍👩‍👧 Family')).toBe('👨‍👩‍👧F');
	});

	it('keeps a letter whose upper case would grow (ß)', () => {
		expect(initials('ßeta Test')).toBe('ßT');
	});

	it('is empty without a name', () => {
		expect(initials(null)).toBe('');
		expect(initials(undefined)).toBe('');
		expect(initials('   ')).toBe('');
	});
});
