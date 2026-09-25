import { error } from '@sveltejs/kit';

type SingleResult = { data: unknown; error: { message: string } | null };

/**
 * Turns a `.maybeSingle()` result into the row, or the right error page (#35):
 * - a query **error** (database down, missing column from an unpushed
 *   migration, ...) is a 500, logged server-side, so it isn't mistaken for a
 *   missing record;
 * - **no row** is a 404. RLS returns no row for a class the teacher isn't
 *   assigned to, so this is also what another teacher sees.
 */
export function rowOr404<R extends SingleResult>(
	result: R,
	messages: { notFound: string; failed: string }
): NonNullable<R['data']> {
	if (result.error) {
		console.error(`${messages.failed} ${result.error.message}`);
		throw error(500, messages.failed);
	}
	if (!result.data) {
		throw error(404, messages.notFound);
	}
	return result.data as NonNullable<R['data']>;
}

export const CLASS_MESSAGES = {
	notFound: 'Class not found.',
	failed: 'Could not load this class. Please try again.'
};

export const HOMEWORK_MESSAGES = {
	notFound: 'Homework not found.',
	failed: 'Could not load this homework. Please try again.'
};

export const SYLLABUS_MESSAGES = {
	notFound: 'Syllabus not found.',
	failed: 'Could not load this syllabus. Please try again.'
};
