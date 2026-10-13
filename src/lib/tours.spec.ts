import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTourId, tourFor, tours } from './tours';

describe('tourFor', () => {
	it.each([
		['parent', '/parent', null, 'parent-home'],
		['parent', '/parent/children/[id]', null, 'parent-child-overview'],
		['parent', '/parent/children/[id]', 'overview', 'parent-child-overview'],
		['parent', '/parent/children/[id]', 'sessions', 'parent-child-sessions'],
		['teacher', '/teacher', null, 'teacher-home'],
		['teacher', '/teacher/classes/[id]', null, 'teacher-class'],
		['teacher', '/teacher/classes/[id]/homework', null, 'teacher-homework'],
		['teacher', '/teacher/classes/[id]/homework/new', null, 'teacher-homework-new'],
		['teacher', '/requests', null, 'teacher-requests']
	])('%s on %s (tab %s) gets %s', (role, routeId, tab, id) => {
		expect(tourFor(role, routeId, tab)?.id).toBe(id);
	});

	it('shows the Overview tour for an unknown tab, as the page shows Overview', () => {
		expect(tourFor('parent', '/parent/children/[id]', 'nonsense')?.id).toBe(
			'parent-child-overview'
		);
	});

	it('has no tour on a tab without one', () => {
		expect(tourFor('parent', '/parent/children/[id]', 'homework')).toBeNull();
		expect(tourFor('parent', '/parent/children/[id]', 'record')).toBeNull();
	});

	it('has no tour on a page without one', () => {
		expect(tourFor('teacher', '/calendar')).toBeNull();
		expect(tourFor('parent', '/parent/homework')).toBeNull();
		expect(tourFor('teacher', '/teacher/classes/[id]/homework/[assignmentId]')).toBeNull();
		expect(tourFor('teacher', null)).toBeNull();
	});

	it('ignores a tab on a page without tabs', () => {
		expect(tourFor('teacher', '/requests', 'sessions')?.id).toBe('teacher-requests');
	});

	it('gives the admin and a student no tour, on /requests either', () => {
		for (const role of ['admin', 'student', null, undefined, '']) {
			for (const tour of tours) {
				expect(tourFor(role, tour.routeId, tour.tab ?? null)).toBeNull();
			}
		}
		expect(tourFor('admin', '/requests')).toBeNull();
	});

	it("keeps each role to its own tours: a teacher acting as a parent gets the parent's", () => {
		expect(tourFor('parent', '/parent/children/[id]', 'sessions')?.role).toBe('parent');
		expect(tourFor('teacher', '/parent/children/[id]', 'sessions')).toBeNull();
		expect(tourFor('parent', '/teacher/classes/[id]')).toBeNull();
		expect(tourFor('parent', '/requests')).toBeNull();
	});
});

describe('the tours', () => {
	it('are the eight of #101, each found by its own role, page and tab', () => {
		expect(tours).toHaveLength(8);
		for (const tour of tours) {
			expect(tourFor(tour.role, tour.routeId, tour.tab ?? null)).toBe(tour);
		}
	});

	it('have ids the database accepts, each once', () => {
		const ids = tours.map((tour) => tour.id);
		expect(new Set(ids).size).toBe(ids.length);
		// The same pattern as mark_tour_seen() (0044).
		for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
	});

	it('have two to five steps, each with a target, a title and a body', () => {
		for (const tour of tours) {
			expect(tour.steps.length, tour.id).toBeGreaterThanOrEqual(2);
			expect(tour.steps.length, tour.id).toBeLessThanOrEqual(5);
			for (const step of tour.steps) {
				expect(step.target).toMatch(/^[a-z][a-z0-9-]*$/);
				expect(step.title().trim()).not.toBe('');
				expect(step.body().trim()).not.toBe('');
			}
		}
	});
});

describe('the targets', () => {
	/** Every Svelte file under `dir`, as text. */
	function svelteSources(dir: string): string {
		return readdirSync(dir, { recursive: true, encoding: 'utf8' })
			.filter((file) => file.endsWith('.svelte'))
			.map((file) => readFileSync(join(dir, file), 'utf8'))
			.join('\n');
	}

	it('each appear as a data-tour value in a page or a component', () => {
		const source = svelteSources('src/routes') + svelteSources('src/lib/components');
		for (const tour of tours) {
			for (const step of tour.steps) {
				// Written as `data-tour="x"`, or as `'x'` inside `data-tour={...}`.
				const found =
					source.includes(`data-tour="${step.target}"`) ||
					new RegExp(`data-tour=\\{[^}]*'${step.target}'[^}]*\\}`).test(source);
				expect(found, `${tour.id}: ${step.target}`).toBe(true);
			}
		}
	});
});

describe('isTourId', () => {
	it('accepts only the id of a tour', () => {
		expect(isTourId('teacher-class')).toBe(true);
		expect(isTourId('teacher-class ')).toBe(false);
		expect(isTourId('welcome')).toBe(false);
		expect(isTourId('')).toBe(false);
		expect(isTourId(null)).toBe(false);
		expect(isTourId(7)).toBe(false);
		expect(isTourId(['teacher-class'])).toBe(false);
	});
});
