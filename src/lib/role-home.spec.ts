import { describe, expect, it } from 'vitest';
import { roleHome } from './role-home';

describe('roleHome', () => {
	it('sends each signed-in role to its own start page', () => {
		expect(roleHome('admin')).toBe('/admin');
		expect(roleHome('teacher')).toBe('/teacher');
		expect(roleHome('student')).toBe('/student');
	});

	it('returns null when signed out, so `/` shows the landing page', () => {
		expect(roleHome(null)).toBeNull();
		expect(roleHome(undefined)).toBeNull();
	});
});
