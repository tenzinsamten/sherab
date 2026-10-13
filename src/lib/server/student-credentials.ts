import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import { STUDENT_EMAIL_DOMAIN, studentEmailToUsername } from '$lib/server/temp-password';

/** How often registration and approval try the next username. */
export const MAX_CREDENTIAL_ATTEMPTS = 5;

/** Prefix of the placeholder address a registration had before #100. */
export const PENDING_EMAIL_PREFIX = 'pending-';

/**
 * Every student username in use: the local part of each student address.
 * The `pending-<uuid>` placeholders of older registrations are no usernames
 * and are left out. Needs the service-role client -- the scan crosses every
 * class. Auth's unique email stays the real guarantee; callers retry on it.
 */
export async function takenStudentUsernames(
	adminClient: SupabaseClient<Database>
): Promise<Set<string>> {
	const { data } = await adminClient
		.from('profiles')
		.select('email')
		.ilike('email', `%@${STUDENT_EMAIL_DOMAIN}`);
	return new Set(
		(data ?? [])
			.map((p) => studentEmailToUsername(p.email))
			.filter((u): u is string => u !== null && !u.startsWith(PENDING_EMAIL_PREFIX))
	);
}

/** True for the error Auth answers when the address is already in use. */
export function isDuplicateEmailError(error: { code?: string; message?: string }): boolean {
	return (
		error.code === '23505' ||
		error.code === 'email_exists' ||
		/already.*registered|exists|duplicate/i.test(error.message ?? '')
	);
}
