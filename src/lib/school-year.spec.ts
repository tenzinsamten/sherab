import { describe, expect, it } from 'vitest';
import { currentSchoolYear, formatSchoolYear, selectableSchoolYears } from './school-year';

describe('currentSchoolYear', () => {
	it('starts the school year in September', () => {
		expect(currentSchoolYear(new Date(2026, 8, 1))).toBe(2026);
		expect(currentSchoolYear(new Date(2026, 7, 31))).toBe(2025);
		expect(currentSchoolYear(new Date(2026, 0, 15))).toBe(2025);
	});
});

describe('formatSchoolYear', () => {
	it('shows the starting year and the next year two-digit', () => {
		expect(formatSchoolYear(2025)).toBe('2025/26');
		expect(formatSchoolYear(2099)).toBe('2099/00');
	});
});

describe('selectableSchoolYears', () => {
	it('offers next, current and two previous years, newest first', () => {
		expect(selectableSchoolYears(2025, [])).toEqual([2026, 2025, 2024, 2023]);
	});

	it('leaves out years that already have a syllabus', () => {
		expect(selectableSchoolYears(2025, [2025, 2023])).toEqual([2026, 2024]);
	});
});
