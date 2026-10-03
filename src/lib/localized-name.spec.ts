import { describe, expect, it } from 'vitest';
import { localizeName, localizedName, pickLocalized } from './localized-name';

const names = { name: 'Alphabet', name_bo: 'ཀ་ཁ།', name_de: 'Alphabet DE' };

describe('localizedName', () => {
	it("returns the locale's own name", () => {
		expect(localizedName(names, 'en')).toBe('Alphabet');
		expect(localizedName(names, 'bo')).toBe('ཀ་ཁ།');
		expect(localizedName(names, 'de')).toBe('Alphabet DE');
	});

	it('falls back to the English name when the language has none', () => {
		expect(localizedName({ name: 'Alphabet' }, 'bo')).toBe('Alphabet');
		expect(localizedName({ name: 'Alphabet', name_bo: null, name_de: null }, 'de')).toBe(
			'Alphabet'
		);
		expect(localizedName({ name: 'Alphabet', name_de: '   ' }, 'de')).toBe('Alphabet');
	});

	it('uses the English name for an unknown locale', () => {
		expect(localizedName(names, 'fr')).toBe('Alphabet');
	});

	it('defaults to the current locale (English in tests)', () => {
		expect(localizedName(names)).toBe('Alphabet');
	});
});

describe('localizeName', () => {
	it('keeps the other fields and drops the per-language names', () => {
		expect(localizeName({ id: 'c1', code: 'ABC234', ...names }, 'bo')).toEqual({
			id: 'c1',
			code: 'ABC234',
			name: 'ཀ་ཁ།'
		});
	});
});

describe('pickLocalized', () => {
	it('picks from separate columns', () => {
		expect(pickLocalized('Yaks', 'གཡག', null, 'bo')).toBe('གཡག');
		expect(pickLocalized('Yaks', 'གཡག', null, 'de')).toBe('Yaks');
	});
});
