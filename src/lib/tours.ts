import * as m from '$lib/paraglide/messages.js';

/**
 * The guided page tours (#101): a short spotlight tour that starts by itself
 * the first time a parent or teacher opens a key page, and again from Help
 * ("Show me around this page"). Students and the admin get none.
 *
 * A tour belongs to one role and one page. A step points at the first element
 * on the page carrying `data-tour="<target>"`; a step whose element is not
 * there is left out (PageTour.svelte).
 */
export const TOUR_ROLES = ['parent', 'teacher'] as const;
export type TourRole = (typeof TOUR_ROLES)[number];

export type TourStep = {
	/** Value of the `data-tour` attribute the step points at. */
	target: string;
	title: () => string;
	body: () => string;
};

export type Tour = {
	/** Stored in profiles.tours_seen (0044): lower-case letters, digits and hyphens. */
	id: string;
	role: TourRole;
	/** SvelteKit route id of the page (`page.route.id`). */
	routeId: string;
	/** For a page with `?tab=`: the tab the tour belongs to. */
	tab?: string;
	steps: TourStep[];
};

/**
 * Pages that are one route with `?tab=`: their tabs, the first being the one
 * shown when the address names none or an unknown one.
 */
const ROUTE_TABS: Record<string, readonly string[]> = {
	'/parent/children/[id]': ['overview', 'homework', 'sessions', 'record']
};

export const tours: Tour[] = [
	{
		id: 'parent-home',
		role: 'parent',
		routeId: '/parent',
		steps: [
			{
				target: 'parent-child-card',
				title: m.tour_parent_home_1_title,
				body: m.tour_parent_home_1_body
			},
			{
				target: 'parent-child-name',
				title: m.tour_parent_home_2_title,
				body: m.tour_parent_home_2_body
			}
		]
	},
	{
		id: 'parent-child-overview',
		role: 'parent',
		routeId: '/parent/children/[id]',
		tab: 'overview',
		steps: [
			{
				target: 'child-tabs',
				title: m.tour_child_overview_1_title,
				body: m.tour_child_overview_1_body
			},
			{
				target: 'child-tab-sessions',
				title: m.tour_child_overview_2_title,
				body: m.tour_child_overview_2_body
			}
		]
	},
	{
		id: 'parent-child-sessions',
		role: 'parent',
		routeId: '/parent/children/[id]',
		tab: 'sessions',
		steps: [
			{
				target: 'session-row',
				title: m.tour_child_sessions_1_title,
				body: m.tour_child_sessions_1_body
			},
			{
				target: 'session-controls',
				title: m.tour_child_sessions_2_title,
				body: m.tour_child_sessions_2_body
			},
			{
				target: 'session-answer',
				title: m.tour_child_sessions_3_title,
				body: m.tour_child_sessions_3_body
			},
			{
				target: 'leave-range',
				title: m.tour_child_sessions_4_title,
				body: m.tour_child_sessions_4_body
			}
		]
	},
	{
		id: 'teacher-home',
		role: 'teacher',
		routeId: '/teacher',
		steps: [
			{
				target: 'teacher-class-card',
				title: m.tour_teacher_home_1_title,
				body: m.tour_teacher_home_1_body
			},
			{
				target: 'teacher-class-code',
				title: m.tour_teacher_home_2_title,
				body: m.tour_teacher_home_2_body
			},
			{
				target: 'teacher-class-open',
				title: m.tour_teacher_home_3_title,
				body: m.tour_teacher_home_3_body
			}
		]
	},
	{
		id: 'teacher-class',
		role: 'teacher',
		routeId: '/teacher/classes/[id]',
		steps: [
			{
				target: 'class-session',
				title: m.tour_teacher_class_1_title,
				body: m.tour_teacher_class_1_body
			},
			{
				target: 'class-attendance-save',
				title: m.tour_teacher_class_2_title,
				body: m.tour_teacher_class_2_body
			},
			{
				target: 'class-skills',
				title: m.tour_teacher_class_3_title,
				body: m.tour_teacher_class_3_body
			},
			{
				target: 'class-skill-student',
				title: m.tour_teacher_class_4_title,
				body: m.tour_teacher_class_4_body
			},
			{
				target: 'class-homework',
				title: m.tour_teacher_class_5_title,
				body: m.tour_teacher_class_5_body
			}
		]
	},
	{
		id: 'teacher-homework',
		role: 'teacher',
		routeId: '/teacher/classes/[id]/homework',
		steps: [
			{
				target: 'homework-create',
				title: m.tour_teacher_homework_1_title,
				body: m.tour_teacher_homework_1_body
			},
			{
				target: 'homework-filter',
				title: m.tour_teacher_homework_2_title,
				body: m.tour_teacher_homework_2_body
			},
			{
				target: 'homework-row',
				title: m.tour_teacher_homework_3_title,
				body: m.tour_teacher_homework_3_body
			}
		]
	},
	{
		id: 'teacher-homework-new',
		role: 'teacher',
		routeId: '/teacher/classes/[id]/homework/new',
		steps: [
			{
				target: 'homework-language',
				title: m.tour_teacher_homework_new_1_title,
				body: m.tour_teacher_homework_new_1_body
			},
			{
				target: 'homework-schedule',
				title: m.tour_teacher_homework_new_2_title,
				body: m.tour_teacher_homework_new_2_body
			},
			// In the order of the form: the due date comes before "Assign to".
			{
				target: 'homework-due',
				title: m.tour_teacher_homework_new_4_title,
				body: m.tour_teacher_homework_new_4_body
			},
			{
				target: 'homework-target',
				title: m.tour_teacher_homework_new_3_title,
				body: m.tour_teacher_homework_new_3_body
			}
		]
	},
	{
		id: 'teacher-requests',
		role: 'teacher',
		routeId: '/requests',
		steps: [
			{
				target: 'requests-registrations',
				title: m.tour_teacher_requests_1_title,
				body: m.tour_teacher_requests_1_body
			},
			{
				target: 'requests-sick',
				title: m.tour_teacher_requests_2_title,
				body: m.tour_teacher_requests_2_body
			},
			{
				target: 'requests-join',
				title: m.tour_teacher_requests_3_title,
				body: m.tour_teacher_requests_3_body
			}
		]
	}
];

/** Whether `value` is the id of a tour (what /api/tours/seen accepts). */
export function isTourId(value: unknown): value is string {
	return typeof value === 'string' && tours.some((tour) => tour.id === value);
}

/** Whether `role` (the active role) has tours at all. */
export function isTourRole(role: string | null | undefined): role is TourRole {
	return TOUR_ROLES.includes(role as TourRole);
}

/**
 * The tour of the page at `routeId` for the active `role`, or null. `tab` is
 * the address's `?tab=` value; it only matters on a page with tabs.
 */
export function tourFor(
	role: string | null | undefined,
	routeId: string | null | undefined,
	tab: string | null = null
): Tour | null {
	if (!isTourRole(role) || !routeId) return null;
	const tabs = ROUTE_TABS[routeId];
	const shown = tabs ? (tabs.includes(tab ?? '') ? tab : tabs[0]) : undefined;
	return (
		tours.find(
			(tour) => tour.role === role && tour.routeId === routeId && (!tabs || tour.tab === shown)
		) ?? null
	);
}

/** Where a role's tours are, said in Help on a page that has none. */
export const tourWhere: Record<TourRole, () => string> = {
	parent: m.tour_where_parent,
	teacher: m.tour_where_teacher
};
