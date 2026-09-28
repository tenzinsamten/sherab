import { describe, expect, it } from 'vitest';
import { durationValue } from './ix-fields';

describe('durationValue', () => {
	it('is null (empty field) when there is no duration', () => {
		expect(durationValue(null)).toBeNull();
		expect(durationValue(undefined)).toBeNull();
		expect(durationValue('')).toBeNull();
	});

	it('is null for whitespace, not 0', () => {
		expect(durationValue(' ')).toBeNull();
		expect(durationValue('\t\n')).toBeNull();
	});

	it('is null for anything non-numeric', () => {
		expect(durationValue('abc')).toBeNull();
		expect(durationValue(Number.NaN)).toBeNull();
		expect(durationValue(Number.POSITIVE_INFINITY)).toBeNull();
	});

	it('keeps a number, from a number or a numeric string', () => {
		expect(durationValue(45)).toBe(45);
		expect(durationValue('90')).toBe(90);
		expect(durationValue(' 60 ')).toBe(60);
		expect(durationValue(0)).toBe(0);
	});
});
