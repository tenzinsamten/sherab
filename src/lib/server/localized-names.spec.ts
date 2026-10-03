import { describe, expect, it } from 'vitest';
import { duplicateName, missingName, nameColumns, readNameFields } from './localized-names';

function form(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.append(k, v);
	return body;
}

describe('readNameFields', () => {
	it('trims the three names and treats a missing field as empty', () => {
		expect(readNameFields(form({ name: ' Yaks ', nameBo: ' གཡག ' }))).toEqual({
			name: 'Yaks',
			nameBo: 'གཡག',
			nameDe: ''
		});
	});
});

describe('missingName', () => {
	it('requires English, then Tibetan; German is optional', () => {
		expect(missingName({ name: '', nameBo: '', nameDe: 'Yaks' })).toBe('en');
		expect(missingName({ name: 'Yaks', nameBo: '', nameDe: 'Yaks' })).toBe('bo');
		expect(missingName({ name: 'Yaks', nameBo: 'གཡག', nameDe: '' })).toBeNull();
	});
});

describe('nameColumns', () => {
	it('stores an empty optional name as NULL', () => {
		expect(nameColumns({ name: 'Yaks', nameBo: 'གཡག', nameDe: '' })).toEqual({
			name: 'Yaks',
			name_bo: 'གཡག',
			name_de: null
		});
	});
});

describe('duplicateName', () => {
	const fields = { name: 'Yaks', nameBo: 'གཡག', nameDe: 'Yaks DE' };
	const violation = (index: string) => ({
		code: '23505',
		message: `duplicate key value violates unique constraint "${index}"`
	});

	it('names the language whose index was violated', () => {
		expect(duplicateName(violation('classes_name_unique_idx'), fields)).toBe('Yaks');
		expect(duplicateName(violation('classes_name_bo_unique_idx'), fields)).toBe('གཡག');
		expect(duplicateName(violation('teams_name_de_unique_idx'), fields)).toBe('Yaks DE');
	});

	it('falls back to the English name', () => {
		expect(duplicateName({ code: '23505', message: 'duplicate' }, fields)).toBe('Yaks');
	});
});
