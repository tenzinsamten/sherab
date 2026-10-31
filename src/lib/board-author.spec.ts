import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { boardAuthorName } from './board-author';

describe('boardAuthorName (story 7)', () => {
	it('a real name always wins, trimmed', () => {
		expect(boardAuthorName({ displayName: ' Pema ', role: 'parent' })).toBe('Pema');
		expect(boardAuthorName({ displayName: 'Pema', role: 'admin' })).toBe('Pema');
		expect(boardAuthorName({ displayName: 'Dolma', role: 'teacher', email: 'd@x.org' })).toBe(
			'Dolma'
		);
	});

	it('an admin without a name (empty or the email) is "Sherab Admin"', () => {
		for (const displayName of [null, '', '  ', 'Admin@School.org']) {
			expect(boardAuthorName({ displayName, role: 'admin', email: 'admin@school.org' })).toBe(
				m.board_author_admin()
			);
		}
		expect(m.board_author_admin()).toBe('Sherab Admin');
	});

	it('a teacher without a name is "Teacher"', () => {
		expect(boardAuthorName({ displayName: null, role: 'teacher' })).toBe(m.board_author_teacher());
		expect(boardAuthorName({ displayName: 't@x.org', role: 'teacher', email: 't@x.org' })).toBe(
			m.board_author_teacher()
		);
	});

	it('anyone else without a name, or a deleted author, is "Former member"', () => {
		expect(boardAuthorName({ displayName: null, role: 'parent' })).toBe(m.board_former_member());
		expect(boardAuthorName({ displayName: '', role: 'student' })).toBe(m.board_former_member());
		expect(boardAuthorName({ displayName: null, role: null })).toBe(m.board_former_member());
		expect(boardAuthorName(null)).toBe(m.board_former_member());
	});

	it('takes a locale (the push writes each browser its own)', () => {
		expect(boardAuthorName({ displayName: null, role: 'teacher' }, 'de')).toBe('Lehrkraft');
		expect(boardAuthorName({ displayName: null, role: 'admin' }, 'de')).toBe('Sherab Admin');
		expect(boardAuthorName(null, 'de')).toBe('Ehemaliges Mitglied');
	});
});
