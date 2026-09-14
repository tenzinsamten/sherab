import type { AuthError, User } from '@supabase/supabase-js';

/**
 * Detects a duplicate-email `auth.signUp` outcome across both real response
 * shapes Supabase can return, depending on project config:
 *
 *  - Autoconfirm enabled (`enable_confirmations = false`, this project's
 *    local-dev default): signUp errors directly, status 422, code
 *    `user_already_exists`, message "User already registered".
 *  - Email confirmation required: signUp returns *success* with no error --
 *    a real-looking user whose `identities` array is empty -- so a duplicate
 *    email can't be enumerated by a failed request. No session is issued.
 *
 * Extracted from the signup action so both shapes are independently
 * testable against a real Supabase instance (see rls.spec.ts and
 * signup-duplicate.spec.ts) rather than only the first shape this project's
 * local config happens to produce.
 */
export function isDuplicateSignup(
	error: Pick<AuthError, 'status' | 'message'> | null,
	user: Pick<User, 'identities'> | null
): boolean {
	if (error) {
		return error.status === 422 || /registered|exists/i.test(error.message);
	}
	return user !== null && Array.isArray(user.identities) && user.identities.length === 0;
}
