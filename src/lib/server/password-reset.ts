import { STUDENT_EMAIL_DOMAIN } from './temp-password';

/** Minimal shape of the Supabase client this needs, so tests can pass a plain fake. */
export type ResetDeps = {
	origin: string;
	supabase: {
		auth: {
			resetPasswordForEmail(
				email: string,
				options: { redirectTo: string }
			): PromiseLike<{ error: { message: string } | null }>;
		};
	};
};

const NEXT = '/reset-password';

/** Set by /auth/confirm after a successful recovery; required by /reset-password. */
export const RECOVERY_COOKIE = 'sb-recovery';

/**
 * Starts a password reset for a real email address (admin/teacher) using
 * Supabase's own recovery email. Never reveals whether an account exists:
 * every branch resolves without throwing, so the caller can always show the
 * same generic message.
 *
 * A bare username (student) or a synthetic student address is ignored --
 * those accounts have no deliverable email; students are reset by a
 * teacher/admin until the parent-account story lands.
 */
export async function requestPasswordReset(identifier: string, deps: ResetDeps): Promise<void> {
	const id = identifier.trim();
	if (!id.includes('@') || id.toLowerCase().endsWith(`@${STUDENT_EMAIL_DOMAIN}`)) return;
	try {
		const { error } = await deps.supabase.auth.resetPasswordForEmail(id, {
			redirectTo: `${deps.origin}/auth/confirm`
		});
		// Not surfaced to the user (would leak account existence); logged for operators.
		if (error) console.error('requestPasswordReset failed', error.message);
	} catch (err) {
		// Same reasoning as above: never surface, always log.
		console.error('requestPasswordReset failed', err instanceof Error ? err.message : err);
	}
}

/** Only same-origin paths; anything else falls back to the reset page. */
export function safeNextPath(next: string | null): string {
	return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
		? next
		: NEXT;
}
