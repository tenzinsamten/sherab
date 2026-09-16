import type { AuthError, User } from '@supabase/supabase-js';

/**
 * Detects a duplicate-email `auth.signUp` outcome across the real response
 * shapes Supabase can return, depending on project config and GoTrue
 * version:
 *
 *  - Autoconfirm enabled (`enable_confirmations = false`): signUp errors
 *    directly, status 422, code `user_already_exists`, message "User already
 *    registered".
 *  - Email confirmation required, older/some GoTrue behavior: signUp returns
 *    *success* with no error -- a real-looking user whose `identities` array
 *    is empty.
 *  - Email confirmation required, this project's actual GoTrue version
 *    (confirmed against a real local instance, not just docs): signUp
 *    returns *success* with no error and the pre-existing user's REAL,
 *    non-empty identity -- same `id`, same `created_at` -- while silently
 *    resending a confirmation email and bumping `updated_at`. A genuinely
 *    new signup's `created_at`/`updated_at` land within the same request, a
 *    few milliseconds apart; a resend to an existing unconfirmed user drifts
 *    them apart by however long it's been since the original signup.
 *
 * Extracted from the signup action so every shape is independently testable
 * against a real Supabase instance (see rls.spec.ts and
 * signup-duplicate.spec.ts) rather than only whichever shape a given
 * project's config/GoTrue version happens to produce.
 */
export function isDuplicateSignup(
	error: Pick<AuthError, 'status' | 'message'> | null,
	user: Pick<User, 'identities' | 'created_at' | 'updated_at'> | null
): boolean {
	if (error) {
		return error.status === 422 || /registered|exists/i.test(error.message);
	}
	if (!user) {
		return false;
	}
	if (Array.isArray(user.identities) && user.identities.length === 0) {
		return true;
	}

	const created = Date.parse(user.created_at);
	const updated = Date.parse(user.updated_at ?? '');
	// 1000ms comfortably covers a single request's own processing time while
	// being well short of any real duplicate-resend interval.
	return Number.isFinite(created) && Number.isFinite(updated) && updated - created > 1000;
}
