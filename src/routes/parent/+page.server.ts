import { loadStudentClasses } from '$lib/server/student-homework';
import type { PageServerLoad } from './$types';

export type LinkedChild =
	| { id: string; name: string; status: 'pending' }
	| {
			id: string;
			name: string;
			status: 'approved';
			classes: string[];
			open: number;
			overdue: number;
	  };

/**
 * Parent landing (Stories 7-1, 7-2, 7-3). Shows the account's state:
 * unconfirmed, waiting for approval, not approved, or (approved) one card
 * per linked child. The children come from linked_children() (security
 * definer: pending and approved, name and status only). For each approved
 * child the classes (enrollments -> classes) and homework_counts() are read
 * with that child's explicit id; RLS (0025, is_parent_of) scopes them. A
 * pending child shows its name only.
 */
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { profile, parentStatus, session } = await parent();

	const emailConfirmed = Boolean(profile?.email_confirmed_at);
	const state = !emailConfirmed
		? ('unconfirmed' as const)
		: parentStatus === 'approved'
			? ('approved' as const)
			: parentStatus === 'rejected'
				? ('rejected' as const)
				: ('pending' as const);

	let children: LinkedChild[] = [];
	let loadError = false;
	if (state === 'approved') {
		const { data, error } = await supabase.rpc('linked_children');
		if (error) {
			console.error('parent load: linked_children failed', error.message);
			loadError = true;
		}
		const linked = (data ?? []).filter((c) => c.status === 'pending' || c.status === 'approved');

		children = await Promise.all(
			linked.map(async (c): Promise<LinkedChild> => {
				if (c.status !== 'approved') return { id: c.id, name: c.name, status: 'pending' };

				const [classes, counts] = await Promise.all([
					loadStudentClasses(supabase, c.id),
					supabase.rpc('homework_counts', { p_student_id: c.id })
				]);
				if (classes.error || counts.error) {
					console.error('parent load: child details failed', {
						childId: c.id,
						classes: classes.error ? 'classes query failed' : null,
						homeworkCounts: counts.error?.message ?? null
					});
					loadError = true;
				}
				const row = counts.data?.[0];
				return {
					id: c.id,
					name: c.name,
					status: 'approved',
					classes: classes.classes.map((cl) => cl.name),
					open: row?.open_count ?? 0,
					overdue: row?.overdue_count ?? 0
				};
			})
		);
	}

	return { state, email: profile?.email ?? session?.user.email ?? '', children, loadError };
};
