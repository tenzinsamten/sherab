/** Supabase Auth's default minimum; the same rule signup already enforces. */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Checks a new password and its confirmation. Shared by /reset-password and
 * /account so both apply the same rules. Returns the problem, or null.
 */
export function checkNewPassword(password: string, confirm: string): 'length' | 'mismatch' | null {
	if (password.length < MIN_PASSWORD_LENGTH) return 'length';
	if (password !== confirm) return 'mismatch';
	return null;
}
