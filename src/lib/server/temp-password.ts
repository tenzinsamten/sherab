/**
 * Generates a one-time temporary password for an admin-created teacher
 * account. Shown once in the admin UI so the admin can hand it to the
 * teacher out-of-band; there is no email delivery in this story's scope
 * (local Supabase dev environment only -- see Story 1-1 Boundaries).
 */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 12;

export function generateTempPassword(length: number = TEMP_PASSWORD_LENGTH): string {
	const randomValues = new Uint32Array(length);
	crypto.getRandomValues(randomValues);

	let password = '';
	for (let i = 0; i < length; i++) {
		password += PASSWORD_ALPHABET[randomValues[i] % PASSWORD_ALPHABET.length];
	}
	return password;
}

/**
 * Story 1-2: student sign-in credentials, generated once at approval and
 * shown to the approver for out-of-band handoff -- the same
 * shown-once-in-the-admin-UI pattern as generateTempPassword above, just for
 * a short numeric PIN instead of a full password (a student, unlike a
 * teacher, is expected to type this in from memory).
 */
const STUDENT_PIN_ALPHABET = '0123456789';
const STUDENT_PIN_LENGTH = 4;

export function generateStudentPin(length: number = STUDENT_PIN_LENGTH): string {
	const randomValues = new Uint32Array(length);
	crypto.getRandomValues(randomValues);

	let pin = '';
	for (let i = 0; i < length; i++) {
		pin += STUDENT_PIN_ALPHABET[randomValues[i] % STUDENT_PIN_ALPHABET.length];
	}
	return pin;
}

/**
 * Domain for the deterministic synthetic email a student signs in with
 * (`{username}@students.internal.invalid`) -- `.invalid` is the IANA
 * reserved TLD for addresses that are guaranteed not to resolve (RFC 2606),
 * so this can never collide with, or accidentally email, a real address.
 * Routing student sign-in through a real Supabase Auth session (see Design
 * Notes in the story spec) is what keeps every RLS policy keyed on
 * auth.uid() working unmodified -- no parallel "PIN session" auth model.
 */
export const STUDENT_EMAIL_DOMAIN = 'students.internal.invalid';

export function studentUsernameToEmail(username: string): string {
	return `${username}@${STUDENT_EMAIL_DOMAIN}`;
}

/** Extracts the username back out of a synthesized student email. */
export function studentEmailToUsername(email: string): string | null {
	const suffix = `@${STUDENT_EMAIL_DOMAIN}`;
	return email.endsWith(suffix) ? email.slice(0, -suffix.length) : null;
}

/**
 * Slugifies a registration name into a username candidate: lowercase ASCII
 * letters/digits only, diacritics stripped (so "Tenzin Dölma" -> "tenzindolma"),
 * non-Latin scripts (e.g. a name written in Tibetan) collapse to an empty
 * string -- callers must fall back to a generic base in that case, handled
 * by generateUniqueStudentUsername below rather than here, so this function
 * stays a pure, single-purpose transform.
 */
export function slugifyRegistrationName(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

const FALLBACK_USERNAME_BASE = 'student';

/**
 * Deterministically picks a free username for a newly-approved student:
 * slugify the registration name, then append the smallest integer suffix
 * (2, 3, 4, ...) needed to avoid every username in `existingUsernames`.
 * Falls back to a generic base when the name slugifies to nothing (e.g. a
 * name written entirely in a non-Latin script).
 *
 * Pure and DB-free so it's unit-testable on its own; the real, DB-enforced
 * guarantee is Supabase Auth's email-uniqueness constraint on the
 * synthesized email (Boundaries: "usernames are globally unique... enforced
 * by the synthesized-email uniqueness constraint"), which the approval
 * action retries against on the rare race (see requests/+page.server.ts).
 */
export function generateUniqueStudentUsername(
	registrationName: string,
	existingUsernames: ReadonlySet<string>
): string {
	const base = slugifyRegistrationName(registrationName) || FALLBACK_USERNAME_BASE;

	if (!existingUsernames.has(base)) {
		return base;
	}

	let suffix = 2;
	while (existingUsernames.has(`${base}${suffix}`)) {
		suffix++;
	}
	return `${base}${suffix}`;
}
