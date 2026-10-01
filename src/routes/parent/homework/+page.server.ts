import { redirect } from '@sveltejs/kit';
import { todayInBerlin } from '$lib/berlin-date';
import { loadStudentHomework, type StudentHomeworkItem } from '$lib/server/student-homework';
import type { PageServerLoad } from './$types';

/** An approved child in the picker. */
export type HomeworkChild = { id: string; name: string };

/** One open homework row on the shared page: the item, its child and class name. */
export type ParentHomeworkItem = Pick<
	StudentHomeworkItem,
	'instanceId' | 'title' | 'contentLanguage' | 'dueDate' | 'overdue' | 'referenceLinks'
> & {
	childId: string;
	childName: string;
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
	today: string
): Promise<{ items: ParentHomeworkItem[]; error: boolean }> {
	const { data: enrollments, error: enrollmentsError } = await supabase
		.from('class_enrollments')
		.select('class_id')
		.eq('student_id', child.id);
	const classIds = (enrollments ?? []).map((e) => e.class_id);
	const enrolledClassIds = new Set(classIds);

	const [classesResult, open] = await Promise.all([
		classIds.length > 0
			? supabase.from('classes').select('id, name').in('id', classIds)
			: Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
		loadStudentHomework(supabase, child.id, { filter: 'todo', page: 1, enrolledClassIds, today })
	]);
	const classNames = new Map((classesResult.data ?? []).map((c) => [c.id, c.name]));

	return {
		items: open.items.map((item) => ({
			childId: child.id,
			childName: child.name,
			instanceId: item.instanceId,
			title: item.title,
			contentLanguage: item.contentLanguage,
			dueDate: item.dueDate,
			overdue: item.overdue,
			referenceLinks: item.referenceLinks,
			className: classNames.get(item.classId) ?? null
		})),
		error: Boolean(enrollmentsError || classesResult.error || open.error)
	};
}

/**
 * #59: every approved child's open homework in one list (read-only). The
 * children come from linked_children() (approved only); `?child=` narrows
 * to one of them, anything else shows all. Each child is read separately,
 * so one child's failure shows an error line and the others still show.
 * Done and Reviewed stay on each child's Homework tab.
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

	const today = todayInBerlin();
	const results = await Promise.all(inView.map((c) => loadChildOpen(supabase, c, today)));

	const failedChildren = inView.filter((_, i) => results[i].error);
	for (const c of failedChildren) {
		console.error('parent homework: child homework failed', { childId: c.id });
	}

	return {
		children,
		selectedChild,
		inView,
		items: results.flatMap((r) => r.items).sort(compareParentHomework),
		failedChildren,
		loadError: Boolean(linkedError)
	};
};
