import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The parent routes' child check: an approved parent, a well-formed id, and
 * one of the caller's approved children (linked_children(), the same rule as
 * is_parent_of). Anything else is a 404. UX only: RLS is the real barrier
 * for every read (AD-2).
 */
export async function loadLinkedChild(
	supabase: SupabaseClient<Database>,
	parentStatus: string | null,
	childId: string
): Promise<{ id: string; name: string }> {
	if (parentStatus !== 'approved' || !UUID_PATTERN.test(childId)) {
		throw error(404, 'Not found');
	}
	const { data: linked } = await supabase.rpc('linked_children');
	const child = (linked ?? []).find((c) => c.id === childId && c.status === 'approved');
	if (!child) {
		throw error(404, 'Not found');
	}
	return { id: child.id, name: child.name };
}
