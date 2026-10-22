import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { isActive, navItems, tabItems, type TabEntry } from './nav';

const ids = (items: TabEntry[]) => items.map((item) => item.id);
const labels = (items: TabEntry[]) => items.map((item) => item.label);

describe('navItems: the side nav per role (stack.md)', () => {
	it('admin: all nine, Help last', () => {
		expect(ids(navItems('admin'))).toEqual([
			'dashboard',
			'classes',
			'teachers',
			'parents',
			'teams',
			'calendar',
			'requests',
			'leaderboard',
			'help'
		]);
	});

	it('teacher: Dashboard, Classes, Calendar, Requests, Leaderboard, Help (#108)', () => {
		const items = navItems('teacher');
		expect(ids(items)).toEqual([
			'dashboard',
			'classes',
			'calendar',
			'requests',
			'leaderboard',
			'help'
		]);
		expect(items[1]).toMatchObject({
			kind: 'link',
			href: '/teacher/classes',
			label: m.nav_classes(),
			icon: 'classes'
		});
	});

	it('student: Help is not in the nav (it is in the avatar menu); the long labels', () => {
		const items = navItems('student');
		expect(ids(items)).toEqual(['dashboard', 'classes', 'homework', 'calendar', 'leaderboard']);
		expect(labels(items)).toEqual([
			m.nav_dashboard(),
			m.nav_my_classes(),
			m.nav_my_homework(),
			m.nav_calendar(),
			m.nav_team_leaderboard()
		]);
	});

	it('parent: Dashboard, Homework, Calendar, Help', () => {
		expect(ids(navItems('parent'))).toEqual(['dashboard', 'homework', 'calendar', 'help']);
	});

	it('each role links to its own dashboard', () => {
		for (const role of ['admin', 'teacher', 'student', 'parent']) {
			const [first] = navItems(role);
			expect(first).toMatchObject({ kind: 'link', href: `/${role}`, exact: true });
		}
	});

	it('an unapproved student and an unknown role get nothing', () => {
		expect(navItems('student', { unapprovedStudent: true })).toEqual([]);
		expect(tabItems('student', { unapprovedStudent: true })).toEqual([]);
		expect(navItems(null)).toEqual([]);
		expect(tabItems(undefined)).toEqual([]);
	});

	it('Requests carries the pending count, none at 0', () => {
		const requests = (count: number) =>
			navItems('teacher', { pendingRequests: count }).find((item) => item.id === 'requests');
		expect(requests(3)).toMatchObject({ count: 3 });
		expect(requests(0)).not.toHaveProperty('count');
	});
});

describe('tabItems: the bottom bar per role, short labels', () => {
	it('admin: Dashboard, Classes, Requests, Calendar and More with the rest', () => {
		const items = tabItems('admin', { pendingRequests: 2 });
		expect(ids(items)).toEqual(['dashboard', 'classes', 'requests', 'calendar', 'more']);
		expect(items[2]).toMatchObject({ count: 2 });
		const more = items[4];
		expect(more.kind).toBe('more');
		if (more.kind !== 'more') return;
		expect(more.label).toBe(m.nav_more());
		expect(ids(more.items)).toEqual(['teachers', 'parents', 'teams', 'leaderboard', 'help']);
	});

	it('teacher: Dashboard, Classes, Calendar, Requests and More with Leaderboard, Help (#108)', () => {
		const items = tabItems('teacher', { pendingRequests: 3 });
		expect(ids(items)).toEqual(['dashboard', 'classes', 'calendar', 'requests', 'more']);
		expect(items[3]).toMatchObject({ count: 3 });
		const more = items[4];
		expect(more).not.toHaveProperty('count');
		expect(more.kind).toBe('more');
		if (more.kind !== 'more') return;
		expect(more.label).toBe(m.nav_more());
		expect(ids(more.items)).toEqual(['leaderboard', 'help']);
		expect(more.items[1].kind).toBe('help');
	});

	it('student: the short keys, no Help', () => {
		const items = tabItems('student');
		expect(ids(items)).toEqual(['dashboard', 'classes', 'homework', 'calendar', 'leaderboard']);
		expect(labels(items)).toEqual([
			m.nav_dashboard(),
			m.nav_classes(),
			m.nav_homework(),
			m.nav_calendar(),
			m.nav_leaderboard()
		]);
	});

	it('parent: Dashboard, Homework, Calendar, Help', () => {
		expect(ids(tabItems('parent'))).toEqual(['dashboard', 'homework', 'calendar', 'help']);
	});
});

describe('isActive', () => {
	it('a dashboard only on its own path, other links below theirs too', () => {
		const [dashboard, classes] = navItems('admin');
		expect(isActive(dashboard, '/admin')).toBe(true);
		expect(isActive(dashboard, '/admin/classes')).toBe(false);
		expect(isActive(classes, '/admin/classes')).toBe(true);
		expect(isActive(classes, '/admin/classes/abc')).toBe(true);
		expect(isActive(classes, '/admin/classesx')).toBe(false);
	});

	it('More is active on any page it holds; Help never', () => {
		const items = tabItems('admin');
		const more = items.find((item) => item.kind === 'more')!;
		expect(isActive(more, '/admin/teams')).toBe(true);
		expect(isActive(more, '/admin/classes')).toBe(false);
		const help = navItems('teacher').find((item) => item.kind === 'help')!;
		expect(isActive(help, '/teacher')).toBe(false);
	});

	it('teacher (#108): Classes on the list and every class page, Dashboard only on /teacher, More on Leaderboard', () => {
		const [dashboard, classes, , , more] = tabItems('teacher');
		expect(isActive(dashboard, '/teacher')).toBe(true);
		expect(isActive(dashboard, '/teacher/classes/x')).toBe(false);
		expect(isActive(classes, '/teacher/classes')).toBe(true);
		expect(isActive(classes, '/teacher/classes/x')).toBe(true);
		expect(isActive(classes, '/teacher/classes/x/homework')).toBe(true);
		expect(isActive(classes, '/teacher')).toBe(false);
		expect(isActive(more, '/leaderboard')).toBe(true);
		expect(isActive(more, '/teacher/classes/x')).toBe(false);
	});
});
