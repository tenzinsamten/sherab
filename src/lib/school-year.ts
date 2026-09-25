/**
 * School years (#37). A school year runs September to August and is stored
 * by its starting year: 2025 means 2025/26. 0015_class_syllabi.sql uses the
 * same rule when it moves the old single syllabus into the current year.
 */
export const SCHOOL_YEAR_START_MONTH = 9;

/** The school year `date` falls in (local calendar month, 1-12 compared to September). */
export function currentSchoolYear(date: Date = new Date()): number {
	const month = date.getMonth() + 1;
	return month >= SCHOOL_YEAR_START_MONTH ? date.getFullYear() : date.getFullYear() - 1;
}

/** 2025 -> "2025/26". */
export function formatSchoolYear(startYear: number): string {
	return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Years offered when adding a syllabus: two back, the current one and the
 * next, newest first, minus years the class already has.
 */
export function selectableSchoolYears(current: number, taken: Iterable<number>): number[] {
	const used = new Set(taken);
	const years: number[] = [];
	for (let y = current + 1; y >= current - 2; y--) {
		if (!used.has(y)) years.push(y);
	}
	return years;
}
