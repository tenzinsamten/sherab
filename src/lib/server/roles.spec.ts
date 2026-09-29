import { describe, expect, it } from 'vitest';
import { activeRole, heldRoles, isRole, roleForPath, withoutLocale } from './roles';

describe('heldRoles', () => {
	it('is just the profile role for a single-role login', () => {
		expect(heldRoles('teacher', null)).toEqual(['teacher']);
		expect(heldRoles('admin', null)).toEqual(['admin']);
		expect(heldRoles('student', null)).toEqual(['student']);
	});

	it('adds parent for an approved parents row, staff role first', () => {
		expect(heldRoles('teacher', 'approved')).toEqual(['teacher', 'parent']);
		expect(heldRoles('admin', 'approved')).toEqual(['admin', 'parent']);
	});

	it('leaves a pending or rejected parent out', () => {
		expect(heldRoles('teacher', 'pending')).toEqual(['teacher']);
		expect(heldRoles('teacher', 'rejected')).toEqual(['teacher']);
	});

	it('never lists parent twice for a parent-only login', () => {
		expect(heldRoles('parent', 'approved')).toEqual(['parent']);
		expect(heldRoles('parent', 'pending')).toEqual(['parent']);
	});

	it('is empty without a profile', () => {
		expect(heldRoles(null, 'approved')).toEqual([]);
	});
});

describe('roleForPath', () => {
	it('maps a role area to its role', () => {
		expect(roleForPath('/parent')).toBe('parent');
		expect(roleForPath('/parent/homework')).toBe('parent');
		expect(roleForPath('/teacher/classes/abc')).toBe('teacher');
		expect(roleForPath('/admin')).toBe('admin');
		expect(roleForPath('/student/homework')).toBe('student');
	});

	it('is null on shared routes', () => {
		expect(roleForPath('/')).toBeNull();
		expect(roleForPath('/calendar')).toBeNull();
		expect(roleForPath('/requests')).toBeNull();
		expect(roleForPath('/parents')).toBeNull();
	});
});

describe('activeRole', () => {
	const dual = heldRoles('teacher', 'approved');

	it('defaults to the staff role without a cookie', () => {
		expect(activeRole(dual, undefined, '/calendar')).toBe('teacher');
	});

	it('uses a held cookie role on shared routes', () => {
		expect(activeRole(dual, 'parent', '/calendar')).toBe('parent');
		expect(activeRole(dual, 'parent', '/')).toBe('parent');
	});

	it('lets the URL win over the cookie', () => {
		expect(activeRole(dual, 'parent', '/teacher/classes/c1')).toBe('teacher');
		expect(activeRole(dual, 'teacher', '/parent/homework')).toBe('parent');
	});

	it('ignores a forged or unknown cookie', () => {
		expect(activeRole(dual, 'admin', '/calendar')).toBe('teacher');
		expect(activeRole(dual, 'nonsense', '/calendar')).toBe('teacher');
	});

	it('ignores a URL role the login does not hold', () => {
		expect(activeRole(dual, 'parent', '/admin')).toBe('parent');
	});

	it('ignores a parent cookie for a pending parent', () => {
		expect(activeRole(heldRoles('teacher', 'pending'), 'parent', '/calendar')).toBe('teacher');
	});

	it('is the only role for a single-role login, whatever the cookie', () => {
		expect(activeRole(['parent'], 'teacher', '/teacher')).toBe('parent');
		expect(activeRole(['teacher'], 'parent', '/parent')).toBe('teacher');
	});

	it('is null without roles', () => {
		expect(activeRole([], 'parent', '/parent')).toBeNull();
	});
});

describe('isRole', () => {
	it('accepts only user roles', () => {
		expect(isRole('parent')).toBe(true);
		expect(isRole('root')).toBe(false);
		expect(isRole(undefined)).toBe(false);
	});
});

describe('withoutLocale', () => {
	it('drops a leading locale segment only', () => {
		expect(withoutLocale('/de/parent/homework')).toBe('/parent/homework');
		expect(withoutLocale('/bo')).toBe('/');
		expect(withoutLocale('/teacher')).toBe('/teacher');
		expect(withoutLocale('/debug/x')).toBe('/debug/x');
	});
});
