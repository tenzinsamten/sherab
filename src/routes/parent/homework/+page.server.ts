import { localizedName, type LocalizedNames } from '$lib/localized-name';
import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { todayInBerlin } from '$lib/berlin-date';
import type { HomeworkFile } from '$lib/homework-files';
import { loadHomeworkFiles } from '$lib/server/homework-files';
import {
	loadStudentHomework,
	markHomeworkDone,
	type StudentHomeworkItem
} from '$lib/server/student-homework';
import type { Actions, PageServerLoad } from './$types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An approved child in the picker. */
export type HomeworkChild = { id: string; name: string };

/** One open homework row on the shared page: the item, its child and class name. */
export type ParentHomeworkItem = Pick<
	StudentHomeworkItem,
	| 'instanceId'
	| 'assignmentId'
	| 'title'
	| 'contentLanguage'
	| 'dueDate'
	| 'overdue'
	| 'referenceLinks'
> & {
	/** #110: the homework's PDF files (the parent of a targeted child may open them). */
	files: HomeworkFile[];
	childId: string;
	childName: string;
	/**
	 * spec-parent-managed-homework story 4: the child is parent-managed, so
	 * the row offers Mark done (false when the flags could not be read).
	 */
	childManaged: boolean;
	/** null: the class name could not be read. */
	className: string | null;
};

type Client = App.Locals['supabase'];

/**
 * Overdue first, then soonest due, then title (child name and instance id
 * keep the order stable when two children share an item).
 */
function compareParentHomework(a: ParentHomeworkItem, b: ParentHomeworkItem): number {
	if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
	return (
		a.dueDate.localeCompare(b.dueDate) ||
		a.title.localeCompare(b.title) ||
		a.childName.localeCompare(b.childName) ||
		a.instanceId.localeCompare(b.instanceId)
	);
}

/**
 * One child's open homework, read with the child's explicit id: the same
 * loader and To-do rule as the child's Homework tab and the /parent card
 * (enrolled classes only, look-ahead window, overdue).
 */
async function loadChildOpen(
	supabase: Client,
	child: HomeworkChild,
	today: string,
	childManaged: boolean
): Promise<{ items: ParentHomeworkItem[]; error: boolean }> {
	const { data: enrollments, error: enrollmentsError } = await supabase
		.from('class_enrollments')
		.select('class_id')
		.eq('student_id', child.id);
	const classIds = (enrollments ?? []).map((e) => e.class_id);
	const enrolledClassIds = new Set(classIds);

	const [classesResult, open] = await Promise.all([
		classIds.length > 0
			? supabase.from('classes').select('id, name, name_bo, name_de').in('id', classIds)
			: Promise.resolve({ data: [] as ({ id: string } & LocalizedNames)[], error: null }),
		loadStudentHomework(supabase, child.id, { filter: 'todo', page: 1, enrolledClassIds, today })
	]);
	const classNames = new Map((classesResult.data ?? []).map((c) => [c.id, localizedName(c)]));

	return {
		items: open.items.map((item) => ({
			childId: child.id,
			childName: child.name,
			childManaged,
			instanceId: item.instanceId,
			assignmentId: item.assignmentId,
			title: item.title,
			contentLanguage: item.contentLanguage,
			dueDate: item.dueDate,
			overdue: item.overdue,
			referenceLinks: item.referenceLinks,
			files: [],
			className: classNames.get(item.classId) ?? null
		})),
		error: Boolean(enrollmentsError || classesResult.error || open.error)
	};
}

/**
 * #59: every approved child's open homework in one list. The
 * children come from linked_children() (approved only); `?child=` narrows
 * to one of them, anything else shows all. Each child is read separately,
 * so one child's failure shows an error line and the others still show.
 * Done and Reviewed stay on each child's Homework tab.
 * spec-parent-managed-homework story 4: rows of a parent-managed child
 * carry `childManaged` (one profiles read for the children in view) and
 * get Mark done.
 */
export const load: PageServerLoad = async ({ url, parent, locals: { supabase } }) => {
	const { parentStatus, profile } = await parent();
	// Not yet approved (or unconfirmed): the landing page shows that state.
	if (parentStatus !== 'approved' || !profile?.email_confirmed_at) {
		throw redirect(303, '/parent');
	}

	const { data: linked, error: linkedError } = await supabase.rpc('linked_children');
	if (linkedError) {
		console.error('parent homework: linked_children failed', linkedError.message);
	}
	const children: HomeworkChild[] = (linked ?? [])
		.filter((c) => c.status === 'approved')
		.map((c) => ({ id: c.id, name: c.name }))
		.sort((a, b) => a.name.localeCompare(b.name));

	const childParam = url.searchParams.get('child');
	const selectedChild = children.some((c) => c.id === childParam) ? childParam : null;
	const inView = selectedChild ? children.filter((c) => c.id === selectedChild) : children;

	// One read of the parent-managed flags; a failure shows no Mark done.
	const managed = new Set<string>();
	if (inView.length > 0) {
		const { data: flags, error: flagsError } = await supabase
			.from('profiles')
			.select('id, parent_managed')
			.in(
				'id',
				inView.map((c) => c.id)
			);
		if (flagsError) {
			console.error('parent homework: parent_managed read failed', flagsError.message);
		} else {
			for (const f of flags ?? []) if (f.parent_managed) managed.add(f.id);
		}
	}

	const today = todayInBerlin();
	const results = await Promise.all(
		inView.map((c) => loadChildOpen(supabase, c, today, managed.has(c.id)))
	);

	const failedChildren = inView.filter((_, i) => results[i].error);
	for (const c of failedChildren) {
		console.error('parent homework: child homework failed', { childId: c.id });
	}

	// #110: every listed homework's PDF files, in one read.
	const items = results.flatMap((r) => r.items).sort(compareParentHomework);
	const homeworkFiles = await loadHomeworkFiles(
		supabase,
		items.map((item) => item.assignmentId)
	);
	for (const item of items) item.files = homeworkFiles.files.get(item.assignmentId) ?? [];

	return {
		children,
		selectedChild,
		inView,
		items,
		failedChildren,
		loadError: Boolean(linkedError),
		filesError: homeworkFiles.error
	};
};

export const actions: Actions = {
	/**
	 * spec-parent-managed-homework story 4 (CAP-2): Mark done on a row. The
	 * child comes from the form (`childId`); markHomeworkDone records the
	 * parent and RLS refuses it unless the child is parent-managed and
	 * linked to the caller (42501 -> 403).
	 */
	markDone: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/login');
		// A clone: markHomeworkDone reads the body (instanceId) itself.
		const formData = await request.clone().formData();
		const childId = String(formData.get('childId') ?? '');
		if (!UUID_PATTERN.test(childId)) {
			return fail(400, { error: m.student_homework_error_mark_failed() });
		}
		return markHomeworkDone({ request, supabase, user, studentId: childId });
	}
};
