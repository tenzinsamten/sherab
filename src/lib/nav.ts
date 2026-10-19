import { resolve } from '$app/paths';
import * as m from '$lib/paraglide/messages.js';

/**
 * The signed-in navigation (mobile-first redesign, story 2): which
 * destinations each role reaches and in which order, for the desktop side
 * nav (`navItems`) and the phone / tablet bottom tab bar (`tabItems`). The
 * shell components only draw what these return.
 */

/** Icon names; the shell maps them to Lucide icons. */
export type NavIcon =
	| 'dashboard'
	| 'classes'
	| 'teachers'
	| 'parents'
	| 'teams'
	| 'calendar'
	| 'requests'
	| 'leaderboard'
	| 'homework'
	| 'help'
	| 'more';

export type NavLink = {
	kind: 'link';
	id: string;
	href: string;
	label: string;
	icon: NavIcon;
	/** Active only on this exact path (a role's dashboard), not below it. */
	exact?: boolean;
	/** #60: the Requests count pill; omitted at 0. */
	count?: number;
};

/** Opens the Help sheet instead of going to a page. */
export type NavHelp = { kind: 'help'; id: 'help'; label: string; icon: 'help' };

/** Admin below 80em: opens a sheet with the destinations that do not fit the bar. */
export type NavMore = { kind: 'more'; id: 'more'; label: string; icon: 'more'; items: NavEntry[] };

export type NavEntry = NavLink | NavHelp;
export type TabEntry = NavEntry | NavMore;

export type NavOptions = {
	/** Pending requests (the layout's `pendingRequestsCount`). */
	pendingRequests?: number;
	/** #100: a student not approved yet (pending or rejected) has no nav at all. */
	unapprovedStudent?: boolean;
};

/** One destination with both of its labels: the side nav's and the bar's short one. */
type Destination = { entry: NavEntry; short: string };

function destinations(opts: NavOptions) {
	const link = (
		id: string,
		href: string,
		label: string,
		short: string,
		icon: NavIcon,
		extra: Partial<NavLink> = {}
	): Destination => ({ entry: { kind: 'link', id, href, label, icon, ...extra }, short });

	const help: Destination = {
		entry: { kind: 'help', id: 'help', label: m.nav_help(), icon: 'help' },
		short: m.nav_help()
	};
	const calendar = link(
		'calendar',
		resolve('/calendar'),
		m.nav_calendar(),
		m.nav_calendar(),
		'calendar'
	);
	const requests = link(
		'requests',
		resolve('/requests'),
		m.nav_requests(),
		m.nav_requests(),
		'requests',
		opts.pendingRequests ? { count: opts.pendingRequests } : {}
	);
	const leaderboard = link(
		'leaderboard',
		resolve('/leaderboard'),
		m.nav_leaderboard(),
		m.nav_leaderboard(),
		'leaderboard'
	);
	const dashboard = (href: string) =>
		link('dashboard', href, m.nav_dashboard(), m.nav_dashboard(), 'dashboard', { exact: true });

	return {
		admin: {
			dashboard: dashboard(resolve('/admin')),
			classes: link(
				'classes',
				resolve('/admin/classes'),
				m.nav_classes(),
				m.nav_classes(),
				'classes'
			),
			teachers: link(
				'teachers',
				resolve('/admin/teachers'),
				m.nav_teachers(),
				m.nav_teachers(),
				'teachers'
			),
			parents: link(
				'parents',
				resolve('/admin/parents'),
				m.nav_parents(),
				m.nav_parents(),
				'parents'
			),
			teams: link('teams', resolve('/admin/teams'), m.nav_teams(), m.nav_teams(), 'teams'),
			calendar,
			requests,
			leaderboard,
			help
		},
		teacher: [dashboard(resolve('/teacher')), calendar, requests, leaderboard, help],
		student: [
			dashboard(resolve('/student')),
			link('classes', resolve('/student/classes'), m.nav_my_classes(), m.nav_classes(), 'classes'),
			link(
				'homework',
				resolve('/student/homework'),
				m.nav_my_homework(),
				m.nav_homework(),
				'homework'
			),
			calendar,
			{ ...leaderboard, entry: { ...leaderboard.entry, label: m.nav_team_leaderboard() } }
		],
		parent: [
			dashboard(resolve('/parent')),
			link('homework', resolve('/parent/homework'), m.nav_homework(), m.nav_homework(), 'homework'),
			calendar,
			help
		]
	};
}

/** With the bar's short label (`nav_*` keys) in place of the side nav's. */
function short({ entry, short }: Destination): NavEntry {
	return { ...entry, label: short };
}

/**
 * The side nav (from 80em), per role in the order of stack.md. A student's
 * Help is in the avatar menu instead.
 */
export function navItems(role: string | null | undefined, opts: NavOptions = {}): NavEntry[] {
	if (opts.unapprovedStudent) return [];
	const all = destinations(opts);
	if (role === 'admin') {
		const a = all.admin;
		return [
			a.dashboard,
			a.classes,
			a.teachers,
			a.parents,
			a.teams,
			a.calendar,
			a.requests,
			a.leaderboard,
			a.help
		].map((d) => d.entry);
	}
	if (role === 'teacher' || role === 'student' || role === 'parent') {
		return all[role].map((d) => d.entry);
	}
	return [];
}

/**
 * The bottom tab bar (below 80em), with the short labels. The admin's
 * destinations past the fourth go into a "More" sheet.
 */
export function tabItems(role: string | null | undefined, opts: NavOptions = {}): TabEntry[] {
	if (opts.unapprovedStudent) return [];
	const all = destinations(opts);
	if (role === 'admin') {
		const a = all.admin;
		return [
			...[a.dashboard, a.classes, a.requests, a.calendar].map(short),
			{
				kind: 'more',
				id: 'more',
				label: m.nav_more(),
				icon: 'more',
				items: [a.teachers, a.parents, a.teams, a.leaderboard, a.help].map((d) => d.entry)
			}
		];
	}
	if (role === 'teacher' || role === 'student' || role === 'parent') {
		return all[role].map(short);
	}
	return [];
}

/** Whether `item` is the page at `pathname` (or, for a "More" tab, holds it). */
export function isActive(item: TabEntry, pathname: string): boolean {
	if (item.kind === 'help') return false;
	if (item.kind === 'more') return item.items.some((inner) => isActive(inner, pathname));
	return item.exact
		? pathname === item.href
		: pathname === item.href || pathname.startsWith(item.href + '/');
}
