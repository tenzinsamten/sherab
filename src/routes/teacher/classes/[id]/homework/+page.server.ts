import { redirect } from '@sveltejs/kit';
import { CLASS_MESSAGES, rowOr404 } from '$lib/server/class-access';
import {
	ASSIGNMENT_COLUMNS,
	buildAssignmentViews,
	fetchInstancesAndHistory,
	loadAssignmentIndex,
	summarise,
	type AssignmentRow
} from '$lib/server/homework-view';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 10;
const FILTERS = ['open', 'archived', 'all'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Homework list (#33): one summary row per assignment, newest first, 10 per
 * page, filtered Open / Archived / All. Create lives at ./new and each row
 * opens ./[assignmentId]. Filtering needs every assignment's open/archived
 * state, so a light index is read first and only the current page's
 * instances and statuses are loaded.
 */
export const load: PageServerLoad = async ({
	params,
	url,
	locals: { supabase, safeGetSession }
}) => {
	const { session } = await safeGetSession();
	if (!session) {
		throw redirect(303, '/login');
	}

	// RLS (classes_select_admin_or_assigned_teacher) is the real barrier (AD-2).
	const cls = rowOr404(
		await supabase.from('classes').select('id, name, code').eq('id', params.id).maybeSingle(),
		CLASS_MESSAGES
	);

	const filterParam = url.searchParams.get('filter');
	const filter: Filter = FILTERS.includes(filterParam as Filter) ? (filterParam as Filter) : 'open';

	const today = new Date().toISOString().slice(0, 10);
	const index = await loadAssignmentIndex(supabase, params.id, today);

	const counts = {
		open: index.entries.filter((e) => e.open).length,
		archived: index.entries.filter((e) => !e.open).length,
		all: index.entries.length
	};
	const filtered = index.entries.filter((e) =>
		filter === 'all' ? true : filter === 'open' ? e.open : !e.open
	);

	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
	const page = Number.isFinite(requestedPage) ? Math.min(Math.max(requestedPage, 1), pageCount) : 1;
	const pageEntries = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
	const pageIds = pageEntries.map((e) => e.id);
	const openById = new Map(pageEntries.map((e) => [e.id, e.open]));

	let rows: AssignmentRow[] = [];
	let rowsError = false;
	if (pageIds.length > 0) {
		const { data, error: assignmentsError } = await supabase
			.from('homework_assignments')
			.select(ASSIGNMENT_COLUMNS)
			.in('id', pageIds);
		rows = (data ?? []) as AssignmentRow[];
		rowsError = Boolean(assignmentsError);
	}
	const details = await fetchInstancesAndHistory(supabase, pageIds);

	// Keep the index's newest-first order (an `.in()` select doesn't).
	const order = new Map(pageIds.map((id, i) => [id, i]));
	const views = buildAssignmentViews(rows, details.instances, details.history, new Map(), today);
	const items = views
		.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
		.map((view) => summarise(view, openById.get(view.id) ?? true, today));

	return {
		class: cls,
		items,
		filter,
		counts,
		page,
		pageCount,
		loadError: index.error || rowsError || details.error
	};
};
