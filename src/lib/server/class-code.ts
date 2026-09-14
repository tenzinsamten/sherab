/**
 * Generates a short, unique, human-typeable code for a class (name is not
 * the identity -- duplicate names are allowed, per Story 1-1's I/O matrix).
 *
 * Alphabet deliberately excludes visually-ambiguous characters (0/O, 1/I) so
 * a code can be read off a whiteboard or spoken aloud without confusion.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CLASS_CODE_LENGTH = 6;

/** DB error code Postgres/PostgREST returns for a unique-constraint violation. */
export const UNIQUE_VIOLATION_CODE = '23505';

/** How many times to retry code generation on a (rare) collision before giving up. */
export const MAX_CODE_GENERATION_ATTEMPTS = 5;

export function generateClassCode(length: number = CLASS_CODE_LENGTH): string {
	const randomValues = new Uint32Array(length);
	crypto.getRandomValues(randomValues);

	let code = '';
	for (let i = 0; i < length; i++) {
		code += CODE_ALPHABET[randomValues[i] % CODE_ALPHABET.length];
	}
	return code;
}

export type InsertResult<T> = { data: T | null; error: { code?: string; message: string } | null };

/**
 * Generates a class code and attempts `insertAttempt` with it; on a
 * unique-constraint collision (rare -- the DB's UNIQUE constraint is the
 * real guarantee, this loop only smooths over the occasional retry) it
 * generates a fresh code and tries again, up to `maxAttempts` times. Any
 * other error is returned immediately without retrying.
 *
 * Extracted from the `admin/classes` create action so the retry/backoff
 * behavior is unit-testable without a live database.
 */
export async function insertClassWithUniqueCode<T>(
	insertAttempt: (code: string) => Promise<InsertResult<T>>,
	options: { length?: number; maxAttempts?: number } = {}
): Promise<InsertResult<T>> {
	const maxAttempts = options.maxAttempts ?? MAX_CODE_GENERATION_ATTEMPTS;
	let lastError: { code?: string; message: string } | null = null;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const code = generateClassCode(options.length);
		const { data, error } = await insertAttempt(code);

		if (!error) {
			return { data, error: null };
		}
		if (error.code !== UNIQUE_VIOLATION_CODE) {
			return { data: null, error };
		}
		lastError = error;
	}

	return {
		data: null,
		error: lastError ?? { message: 'Could not generate a unique class code.' }
	};
}
