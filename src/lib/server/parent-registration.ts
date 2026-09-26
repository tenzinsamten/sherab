import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import { STUDENT_EMAIL_DOMAIN } from './temp-password';

export const MAX_PARENT_NAME_LENGTH = 80;

/** Escapes `%`, `_` and `\` so an email is matched literally by `ilike`. */
export function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A plausible real email: one `@`, something on both sides, not a student login. */
export function isValidParentEmail(email: string): boolean {
	return (
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
		!email.toLowerCase().endsWith(`@${STUDENT_EMAIL_DOMAIN}`)
	);
}

/**
 * True when any login already uses this email (Story 7-1: a registration for
 * an existing email creates nothing). Service-role read of profiles, whose
 * email mirrors the auth email at sign-up, compared case-insensitively.
 * Throws on a read error, so the caller never mistakes it for "free".
 */
export async function emailHasLogin(
	adminClient: SupabaseClient<Database>,
	email: string
): Promise<boolean> {
	const { data, error } = await adminClient
		.from('profiles')
		.select('id')
		.ilike('email', escapeLikePattern(email))
		.limit(1);
	if (error) throw new Error(`emailHasLogin: ${error.message}`);
	return (data ?? []).length > 0;
}
