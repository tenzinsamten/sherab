/**
 * spec-second-parent story 2 (AD-4): the admin's "own child" checks follow
 * has_link_to(), not who submitted a request. A student the caller has an
 * active student_parents link to is their own child, whichever parent asked.
 * The database refuses the decision anyway (deletion_requests_update_admin);
 * these helpers keep the buttons and counts in step with it.
 */
type Client = App.Locals['supabase'];

/** The ids of the students the caller is actively linked to (a parent's own children). */
export function readOwnLinkedStudentIds(supabase: Client, userId: string) {
	return supabase
		.from('student_parents')
		.select('student_id')
		.eq('parent_id', userId)
		.is('removed_at', null);
}

/** Turns readOwnLinkedStudentIds' result into a set (empty on a failed read). */
export function ownLinkedIds(result: { data: { student_id: string }[] | null }): Set<string> {
	return new Set((result.data ?? []).map((r) => r.student_id));
}

/**
 * Pending deletion requests the admin may decide: every pending one except
 * those for a student the admin is linked to. The two reads run at once.
 * Used by the nav badge (+layout.server.ts) and the dashboard tile. A failed
 * links read counts nothing (with the error), so an own child never counts.
 */
export async function countDecidableDeletions(
	supabase: Client,
	userId: string
): Promise<{ count: number; error: boolean }> {
	const [pending, links] = await Promise.all([
		supabase.from('deletion_requests').select('student_id').eq('status', 'pending'),
		readOwnLinkedStudentIds(supabase, userId)
	]);
	if (links.error) return { count: 0, error: true };
	const own = ownLinkedIds(links);
	const count = (pending.data ?? []).filter(
		(r) => r.student_id === null || !own.has(r.student_id)
	).length;
	return { count, error: Boolean(pending.error || links.error) };
}
