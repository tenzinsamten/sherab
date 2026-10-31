import * as m from '$lib/paraglide/messages.js';
import type { UserRole } from '$lib/supabase/database.types';

type Locale = 'en' | 'de' | 'bo';

/** Story 7: a board post title's most characters, as the board_posts_title_shape check (0063). */
export const MAX_BOARD_TITLE_LENGTH = 120;

/**
 * The name a board post's author is shown with, on /board and in the board
 * push (spec-parent-message-board story 7). A real name always wins. An
 * account without one (its stored name is empty or is its email address) is
 * "Sherab Admin" for an admin and "Teacher" for a teacher; anyone else, and
 * a deleted author, is "Former member".
 *
 * `email`, when given, is compared with the name here (the push reads the
 * profile itself); board_author_names (0063) already returns a null name then.
 */
export function boardAuthorName(
	author: { displayName: string | null; role: UserRole | null; email?: string | null } | null,
	locale?: Locale
): string {
	const opt = locale ? { locale } : undefined;
	const name = author?.displayName?.trim() ?? '';
	const email = author?.email?.trim().toLowerCase() ?? '';
	if (name && name.toLowerCase() !== email) return name;
	if (author?.role === 'admin') return m.board_author_admin({}, opt);
	if (author?.role === 'teacher') return m.board_author_teacher({}, opt);
	return m.board_former_member({}, opt);
}
