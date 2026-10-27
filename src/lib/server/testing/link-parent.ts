/**
 * Test-only fixture helper (spec-second-parent, AD-10): links a student to a
 * parent with the service role. The first link (slot 1) also sets
 * profiles.registered_by_parent_id, as the sign-up does; a second link goes
 * to slot 2 and leaves that column alone. registered_by_parent_id is never
 * read for access: every parent check reads the student_parents link.
 *
 * The parent must already have a parents row. Never imported by app code.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';

export async function linkParent(
	service: SupabaseClient<Database>,
	studentId: string,
	parentId: string
): Promise<void> {
	const { data: active, error: readError } = await service
		.from('student_parents')
		.select('parent_id, slot')
		.eq('student_id', studentId)
		.is('removed_at', null);
	if (readError) throw new Error(`linkParent: read links: ${readError.message}`);
	if (active?.some((l) => l.parent_id === parentId)) return;

	const used = new Set(active?.map((l) => l.slot));
	if (used.has(1) && used.has(2)) {
		throw new Error(`linkParent: student ${studentId} already has two parents`);
	}
	if (!active?.length) {
		const { error: profileError } = await service
			.from('profiles')
			.update({ registered_by_parent_id: parentId })
			.eq('id', studentId);
		if (profileError) throw new Error(`linkParent: profile: ${profileError.message}`);
	}

	const slot = used.has(1) ? 2 : 1;
	const { error: linkError } = await service
		.from('student_parents')
		.insert({ student_id: studentId, parent_id: parentId, slot });
	if (linkError) throw new Error(`linkParent: link: ${linkError.message}`);
}
