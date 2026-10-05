import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HELP_ROLES, helpFaq, helpGuides, helpImageSrc, helpRoleFor } from './help';

describe('helpRoleFor', () => {
	it('uses the requested guide when it exists', () => {
		expect(helpRoleFor('teacher', 'parent')).toBe('teacher');
	});

	it("falls back to the visitor's own role", () => {
		expect(helpRoleFor(null, 'student')).toBe('student');
		expect(helpRoleFor('nonsense', 'teacher')).toBe('teacher');
	});

	it('shows the parent guide to an admin or a signed-out visitor', () => {
		expect(helpRoleFor(null, 'admin')).toBe('parent');
		expect(helpRoleFor('admin', null)).toBe('parent');
		expect(helpRoleFor(null, undefined)).toBe('parent');
	});
});

describe('help content', () => {
	it('has a title and a body for every step and question', () => {
		const entries = [...HELP_ROLES.flatMap((role) => helpGuides[role]), ...helpFaq];
		expect(entries.length).toBeGreaterThan(0);
		for (const entry of entries) {
			expect(entry.title().trim()).not.toBe('');
			expect(entry.body().trim()).not.toBe('');
		}
	});

	it('has every screenshot in every language', () => {
		const images = HELP_ROLES.flatMap((role) => helpGuides[role])
			.map((entry) => entry.image)
			.filter((image) => image !== undefined);
		expect(images.length).toBeGreaterThan(0);
		for (const image of images) {
			for (const locale of ['en', 'de', 'bo']) {
				const file = `static${helpImageSrc(image, locale)}`;
				expect(existsSync(file), file).toBe(true);
			}
		}
	});
});
