import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';

type Role = Database['public']['Enums']['user_role'];
export type ParentStatus = Database['public']['Enums']['parent_status'];

/**
 * What a login may do (Story 7-1, AD-4): its primary role plus its parent
 * status. Parent capability comes only from the caller's `parents` row
 * (approved = is_parent() in SQL), never from `profiles.role` alone, so
 * route guards read this instead of the role.
 */
export type Capabilities = {
	role: Role;
	parentStatus: ParentStatus | null;
};

/**
 * Reads the caller's own profile role and parents row. Both reads are
 * RLS-scoped to the caller (profiles_select_own, parents_select_own_or_admin).
 * Null when there is no profile, or a read fails.
 */
export async function getCapabilities(
	supabase: SupabaseClient<Database>,
	userId: string
): Promise<Capabilities | null> {
	const [{ data: profile, error: profileError }, { data: parentRow, error: parentError }] =
		await Promise.all([
			supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
			supabase.from('parents').select('status').eq('id', userId).maybeSingle()
		]);

	if (profileError || !profile) return null;
	if (parentError) {
		console.error('getCapabilities: failed to read parents row', parentError.message);
		return null;
	}

	return { role: profile.role, parentStatus: parentRow?.status ?? null };
}

/** True when the login holds an approved parent capability (is_parent()). */
export function isApprovedParent(capabilities: Capabilities | null): boolean {
	return capabilities?.parentStatus === 'approved';
}
