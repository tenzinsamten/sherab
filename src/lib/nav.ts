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
	| 'board'
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
	/** The href matches only on this exact path, not below it (a role's dashboard); `also` still applies. */
	exact?: boolean;
	/**
	 * #125: also active on and below these paths: pages that belong to the
	 * dashboard but have no tab of their own (a parent's child, a student's
	 * badges).
	 */
	also?: string[];
	/** #60: the Requests count pill; omitted at 0. */
	count?: number;
};

/** Opens the Help sheet instead of going to a page. */
export type NavHelp = { kind: 'help'; id: 'help'; label: string; icon: 'help' };

/** Admin and teacher below 80em: opens a sheet with the destinations that do not fit the bar. */
export type NavMore = { kind: 'more'; id: 'more'; label: string; icon: 'more'; items: NavEntry[] };

export type NavEntry = NavLink | NavHelp;
export type TabEntry = NavEntry | NavMore;

export type NavOptions = {
	/** Pending requests (the layout's `pendingRequestsCount`). */
	pendingRequests?: number;
	/** #100: a student not approved yet (pending or rejected) has no nav at all. */
	unapprovedStudent?: boolean;
	/**
	 * spec-parent-message-board story 3: a parent who is not approved yet
	 * can't read the board (is_board_reader() is false), so no Board link.
	 */
	boardHidden?: boolean;
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
	// Message board (spec-parent-message-board story 3): every role.
	const board = link('board', resolve('/board'), m.nav_board(), m.nav_board(), 'board');
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
	const dashboard = (href: string, also?: string[]) =>
		link('dashboard', href, m.nav_dashboard(), m.nav_dashboard(), 'dashboard', {
			exact: true,
			...(also ? { also } : {})
		});

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
			board,
			requests,
			leaderboard,
			help
		},
		teacher: {
			dashboard: dashboard(resolve('/teacher')),
			// #108: the class pages below it (/teacher/classes/<id>/...) keep it active.
			classes: link(
				'classes',
				resolve('/teacher/classes'),
				m.nav_classes(),
				m.nav_classes(),
				'classes'
			),
			calendar,
			board,
			requests,
			leaderboard,
			help
		},
		student: [
			dashboard(resolve('/student'), [resolve('/student/badges')]),
			link('classes', resolve('/student/classes'), m.nav_my_classes(), m.nav_classes(), 'classes'),
			link(
				'homework',
				resolve('/student/homework'),
				m.nav_my_homework(),
				m.nav_homework(),
				'homework'
			),
			calendar,
			board,
			{ ...leaderboard, entry: { ...leaderboard.entry, label: m.nav_team_leaderboard() } }
		],
		parent: [
			dashboard(resolve('/parent'), [resolve('/parent/children')]),
			link('homework', resolve('/parent/homework'), m.nav_homework(), m.nav_homework(), 'homework'),
			calendar,
			board,
			help
		]
	};
}

/** Drops Board when `boardHidden` is set (a parent not approved yet). */
function withoutBoard(items: Destination[], opts: NavOptions): Destination[] {
	return opts.boardHidden ? items.filter((d) => d.entry.id !== 'board') : items;
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
			a.board,
			a.requests,
			a.leaderboard,
			a.help
		].map((d) => d.entry);
	}
	if (role === 'teacher') {
		const t = all.teacher;
		return [t.dashboard, t.classes, t.calendar, t.board, t.requests, t.leaderboard, t.help].map(
			(d) => d.entry
		);
	}
	if (role === 'student' || role === 'parent') {
		return withoutBoard(all[role], opts).map((d) => d.entry);
	}
	return [];
}

/**
 * The bottom tab bar (below 80em), with the short labels. The admin's and
 * the teacher's destinations past the fourth go into a "More" sheet.
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
				items: [a.teachers, a.parents, a.teams, a.leaderboard, a.board, a.help].map((d) => d.entry)
			}
		];
	}
	if (role === 'teacher') {
		// #108: Leaderboard and Help go into More; Help there still opens the Help sheet.
		const t = all.teacher;
		return [
			...[t.dashboard, t.classes, t.calendar, t.requests].map(short),
			{
				kind: 'more',
				id: 'more',
				label: m.nav_more(),
				icon: 'more',
				items: [t.leaderboard, t.board, t.help].map((d) => d.entry)
			}
		];
	}
	if (role === 'student' || role === 'parent') {
		return withoutBoard(all[role], opts).map(short);
	}
	return [];
}

/** Whether `item` is the page at `pathname` (or, for a "More" tab, holds it). */
/** #125: `/account` is reached from the avatar menu and deliberately marks no tab. */
export function isActive(item: TabEntry, pathname: string): boolean {
	if (item.kind === 'help') return false;
	if (item.kind === 'more') return item.items.some((inner) => isActive(inner, pathname));
	const under = (path: string) => pathname === path || pathname.startsWith(path + '/');
	if (item.also?.some(under)) return true;
	return item.exact ? pathname === item.href : under(item.href);
}
