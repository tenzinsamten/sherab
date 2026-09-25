/**
 * Integration tests against a real local Supabase instance, exercising the
 * migration's actual RLS policies -- not a mock -- because AD-2 says the
 * real authorization boundary is Postgres, not any client code. These
 * complement class-code.spec.ts's pure unit tests.
 *
 * Requires local Supabase running (`npx supabase start`, which needs Docker).
 * If it isn't reachable, the whole suite is skipped with a clear message
 * rather than failing -- matching the story's own "Manual checks (if no
 * CLI)" fallback in the Verification section.
 */
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { isDuplicateSignup } from './signup-duplicate';
import { buildHomeworkProgress, type HomeworkHistoryRow } from './homework-status';
import {
	STUDENT_EMAIL_DOMAIN,
	generateStudentPin,
	generateUniqueStudentUsername,
	resolveLoginIdentifierToEmail,
	studentUsernameToEmail
} from './temp-password';
import { updateAuthUserEmailAndPassword } from '$lib/supabase/admin';
import type { Database } from './../supabase/database.types';

const adminClient = createClient<Database>(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false }
});

async function isSupabaseReachable(): Promise<boolean> {
	try {
		const res = await fetch(`${PUBLIC_SUPABASE_URL}/auth/v1/health`, {
			signal: AbortSignal.timeout(1500)
		});
		return res.ok;
	} catch {
		return false;
	}
}

function anonClient() {
	return createClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
}

async function createSignedInUser(role: 'admin' | 'teacher') {
	const email = `story-1-1-${role}-${crypto.randomUUID()}@example.test`;
	const password = crypto.randomUUID();

	const { data, error } = await adminClient.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		user_metadata: { role }
	});
	if (error || !data.user) {
		throw new Error(`Failed to create ${role} test user: ${error?.message}`);
	}

	const client = anonClient();
	const { error: signInError } = await client.auth.signInWithPassword({ email, password });
	if (signInError) {
		throw new Error(`Failed to sign in ${role} test user: ${signInError.message}`);
	}

	return { id: data.user.id, email, client };
}

const reachable = await isSupabaseReachable();

describe.skipIf(!reachable)('Story 1-1 RLS policies (requires local Supabase)', () => {
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacherB: Awaited<ReturnType<typeof createSignedInUser>>;
	let classAId: string;
	let classBId: string;

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacherA = await createSignedInUser('teacher');
		teacherB = await createSignedInUser('teacher');

		const { data: classA, error: classAError } = await admin.client
			.from('classes')
			.insert({ name: 'Class A', code: `A${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
			.select('id')
			.single();
		if (classAError || !classA)
			throw new Error(`Failed to create Class A: ${classAError?.message}`);
		classAId = classA.id;

		const { data: classB, error: classBError } = await admin.client
			.from('classes')
			.insert({ name: 'Class B', code: `B${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
			.select('id')
			.single();
		if (classBError || !classB)
			throw new Error(`Failed to create Class B: ${classBError?.message}`);
		classBId = classB.id;

		const { error: assignError } = await admin.client
			.from('class_teachers')
			.insert({ class_id: classAId, teacher_id: teacherA.id });
		if (assignError)
			throw new Error(`Failed to assign teacherA to Class A: ${assignError.message}`);
	}, 30000);

	it('admin bootstrap: promoting a signed-up account to admin is idempotent', async () => {
		const { email, password } = await (async () => {
			const email = `story-1-1-bootstrap-${crypto.randomUUID()}@example.test`;
			const password = crypto.randomUUID();
			const client = anonClient();
			const { error } = await client.auth.signUp({ email, password });
			expect(error).toBeNull();
			return { email, password };
		})();

		const { data: userRow } = await adminClient
			.from('profiles')
			.select('id, role')
			.eq('email', email)
			.single();
		expect(userRow?.role).toBe('teacher'); // default role from handle_new_user()

		// This is the documented one-time admin-bootstrap SQL step's effect,
		// applied via the service-role client (which -- like `psql` run by
		// hand -- bypasses RLS):
		//   update public.profiles set role = 'admin' where id = <user id>;
		const promote = () =>
			adminClient
				.from('profiles')
				.update({ role: 'admin' })
				.eq('id', userRow!.id)
				.select('role')
				.single();

		const first = await promote();
		expect(first.error).toBeNull();
		expect(first.data?.role).toBe('admin');

		// Running it again must be a no-op, not an error.
		const second = await promote();
		expect(second.error).toBeNull();
		expect(second.data?.role).toBe('admin');

		void password; // only needed to prove the signUp call above succeeded
	});

	it('creating an auth user with an already-registered email fails with a duplicate-identifiable error', async () => {
		const email = `story-1-1-dup-${crypto.randomUUID()}@example.test`;
		const first = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			user_metadata: { role: 'teacher' }
		});
		expect(first.error).toBeNull();

		const second = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			user_metadata: { role: 'teacher' }
		});

		// Mirrors the exact detection admin/teachers/+page.server.ts relies on
		// to return teachers_error_duplicate() instead of a duplicate row.
		expect(second.error).not.toBeNull();
		const isDuplicate =
			second.error?.code === 'email_exists' ||
			/already.*registered|exists/i.test(second.error?.message ?? '');
		expect(isDuplicate).toBe(true);
	});

	it('signing in with a wrong password is rejected without revealing whether the account exists', async () => {
		const client = anonClient();
		const { data, error } = await client.auth.signInWithPassword({
			email: teacherA.email,
			password: 'definitely-the-wrong-password'
		});

		expect(data.session).toBeNull();
		expect(error).not.toBeNull();
		// Supabase returns one generic invalid-credentials error either way --
		// exactly what (auth)/login/+page.server.ts surfaces verbatim as
		// login_error_invalid(), never distinguishing "wrong password" from
		// "no such account".
	});

	it('signup/+page.server.ts duplicate-email detection matches the real signUp response shape', async () => {
		// Local Supabase config now matches production's `enable_confirmations
		// = true` (migration 0006's guardian-email-verification change): a
		// duplicate email does NOT error from signUp() -- it returns success
		// with the pre-existing user's REAL, non-empty identity (same id, same
		// created_at) while silently resending a confirmation email and
		// bumping updated_at. isDuplicateSignup() must detect this shape, not
		// just a thrown error or an empty-identities array that this GoTrue
		// version doesn't actually produce here.
		const email = `story-1-1-signup-dup-${crypto.randomUUID()}@example.test`;
		const client1 = anonClient();
		const first = await client1.auth.signUp({ email, password: crypto.randomUUID() });
		expect(first.error).toBeNull();
		expect(isDuplicateSignup(first.error, first.data.user)).toBe(false);

		// GoTrue enforces a real per-email resend cooldown (auth.email.max_frequency,
		// "1s" locally) independent of enable_confirmations -- no real user could
		// ever submit the identical email twice within the same millisecond, but
		// this test does, so it must wait past that window first.
		await new Promise((resolve) => setTimeout(resolve, 1100));

		const client2 = anonClient();
		const second = await client2.auth.signUp({ email, password: crypto.randomUUID() });

		expect(second.error).toBeNull();
		expect(second.data.user?.id).toBe(first.data.user?.id);
		expect(second.data.user?.identities?.length).toBeGreaterThan(0);
		expect(isDuplicateSignup(second.error, second.data.user)).toBe(true);
	});

	it('classes.code has a real unique constraint (not just app-level convention)', async () => {
		const sharedCode = `DUP${crypto.randomUUID().slice(0, 4).toUpperCase()}`;

		const first = await admin.client.from('classes').insert({ name: 'Dup 1', code: sharedCode });
		expect(first.error).toBeNull();

		const second = await admin.client.from('classes').insert({ name: 'Dup 2', code: sharedCode });
		expect(second.error).not.toBeNull();
		expect(second.error?.code).toBe('23505');
	});

	it('a teacher assigned to two classes sees both and only those', async () => {
		const { error: assignError } = await admin.client
			.from('class_teachers')
			.insert({ class_id: classBId, teacher_id: teacherA.id });
		expect(assignError).toBeNull();

		const { data: seen } = await teacherA.client.from('classes').select('id');
		const seenIds = (seen ?? []).map((c) => c.id).sort();
		expect(seenIds).toEqual([classAId, classBId].sort());

		// Clean up for the next test's "only assigned" assumption.
		await admin.client
			.from('class_teachers')
			.delete()
			.eq('class_id', classBId)
			.eq('teacher_id', teacherA.id);
	});

	it('cross-class access: a teacher assigned only to Class A gets nothing for Class B', async () => {
		const { data, error } = await teacherA.client.from('classes').select('*').eq('id', classBId);

		// RLS denies by returning zero rows, not by erroring -- exactly the
		// story's "No data returned... regardless of frontend state".
		expect(error).toBeNull();
		expect(data).toEqual([]);
	});

	it('cross-class access: teacherB (unassigned anywhere) sees no classes at all', async () => {
		const { data, error } = await teacherB.client.from('classes').select('*');
		expect(error).toBeNull();
		expect(data).toEqual([]);
	});

	it('a teacher cannot create a class directly (admin-only per RLS, not just hidden UI)', async () => {
		const { data, error } = await teacherA.client
			.from('classes')
			.insert({ name: 'Should Fail', code: `X${crypto.randomUUID().slice(0, 5).toUpperCase()}` });

		expect(data).toBeNull();
		expect(error).not.toBeNull();
	});

	it('a teacher cannot assign themself to another class directly', async () => {
		const { data, error } = await teacherB.client
			.from('class_teachers')
			.insert({ class_id: classAId, teacher_id: teacherB.id });

		expect(data).toBeNull();
		expect(error).not.toBeNull();

		// And it must not have silently gone through:
		const { data: check } = await admin.client
			.from('class_teachers')
			.select('*')
			.eq('class_id', classAId)
			.eq('teacher_id', teacherB.id);
		expect(check).toEqual([]);
	});
});

/**
 * Signs up a student exactly the way (auth)/join's `register` action does
 * (one signUp() call with metadata, matching handle_new_user()'s student
 * branch in migration 0002), then signs the anon client back out -- a
 * Pending student never keeps a session, per the join route's own comment.
 * Uses the guardian's (real-shaped) email as the Auth account's email --
 * migration 0006 replaced the old synthetic `pending-<uuid>@...` placeholder
 * with this, so Supabase's own confirmation flow verifies it directly.
 */
async function signUpStudent(params: {
	classId: string;
	registrationName: string;
	guardianEmail?: string;
}) {
	const client = anonClient();
	const email = params.guardianEmail ?? `story-1-2-guardian-${crypto.randomUUID()}@example.test`;
	const guardianConsentGivenAt = new Date().toISOString();

	const { data, error } = await client.auth.signUp({
		email,
		password: crypto.randomUUID(),
		options: {
			data: {
				role: 'student',
				class_id: params.classId,
				registration_name: params.registrationName,
				guardian_consent_given_at: guardianConsentGivenAt
			}
		}
	});

	await client.auth.signOut();

	return { data, error, id: data.user?.id ?? null };
}

/**
 * Simulates a guardian clicking their confirmation link, without a real
 * mailbox: flips auth.users.email_confirmed_at via the Admin API, which the
 * on_auth_user_email_confirmed trigger (migration 0006) mirrors onto
 * profiles.email_confirmed_at -- the same signal
 * requests/+page.server.ts's approve action gates on.
 */
async function confirmGuardianEmail(userId: string) {
	const { error } = await adminClient.auth.admin.updateUserById(userId, { email_confirm: true });
	if (error) throw new Error(`Failed to confirm guardian email: ${error.message}`);
}

describe.skipIf(!reachable)(
	'Story 1-2 student registration & approval (requires local Supabase)',
	() => {
		let admin: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacherB: Awaited<ReturnType<typeof createSignedInUser>>;
		let classAId: string;
		let teamId: string;

		beforeAll(async () => {
			admin = await createSignedInUser('admin');
			teacherA = await createSignedInUser('teacher');
			teacherB = await createSignedInUser('teacher');

			const { data: classA, error: classAError } = await admin.client
				.from('classes')
				.insert({
					name: 'Story 1-2 Class A',
					code: `S${crypto.randomUUID().slice(0, 5).toUpperCase()}`
				})
				.select('id')
				.single();
			if (classAError || !classA)
				throw new Error(`Failed to create Class A: ${classAError?.message}`);
			classAId = classA.id;

			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: classAId, teacher_id: teacherA.id });
			if (assignError) throw new Error(`Failed to assign teacherA: ${assignError.message}`);

			const { data: team, error: teamError } = await admin.client
				.from('teams')
				.insert({ name: `Story 1-2 Team ${crypto.randomUUID().slice(0, 6)}` })
				.select('id')
				.single();
			if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
			teamId = team.id;
		}, 30000);

		it('validate_class_code() finds a known code and returns nothing for an unknown one', async () => {
			const { data: classRow } = await adminClient
				.from('classes')
				.select('code')
				.eq('id', classAId)
				.single();

			const client = anonClient();
			const found = await client.rpc('validate_class_code', { p_code: classRow!.code });
			expect(found.error).toBeNull();
			expect(found.data).toHaveLength(1);
			expect(found.data?.[0].id).toBe(classAId);

			const notFound = await client.rpc('validate_class_code', { p_code: 'NOPE99' });
			expect(notFound.error).toBeNull();
			expect(notFound.data).toEqual([]);
		});

		it('student registers: signUp() lands a Pending profiles row, invisible to profiles_select_own for anyone else', async () => {
			const registrationName = `Pending Student ${crypto.randomUUID().slice(0, 8)}`;
			const guardianEmail = `story-1-2-guardian-${crypto.randomUUID()}@example.test`;
			const { error, id } = await signUpStudent({
				classId: classAId,
				registrationName,
				guardianEmail
			});
			expect(error).toBeNull();
			expect(id).not.toBeNull();

			const { data: profile } = await adminClient
				.from('profiles')
				.select(
					'status, class_id, registration_name, display_name, team_id, guardian_email, email_confirmed_at'
				)
				.eq('id', id!)
				.single();

			expect(profile?.status).toBe('pending');
			expect(profile?.class_id).toBe(classAId);
			expect(profile?.registration_name).toBe(registrationName);
			// display_name defaults to registration_name (Implementation Notes).
			expect(profile?.display_name).toBe(registrationName);
			expect(profile?.team_id).toBeNull();
			expect(profile?.guardian_email).toBe(guardianEmail);
			// Nobody has clicked the confirmation link yet.
			expect(profile?.email_confirmed_at).toBeNull();
		});

		it('a Pending student is invisible to an unrelated teacher (not assigned to their class)', async () => {
			const registrationName = `Invisible Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });

			const { data, error } = await teacherB.client.from('profiles').select('id').eq('id', id!);
			expect(error).toBeNull();
			expect(data).toEqual([]);
		});

		it('duplicate registration attempt: check_registration_available() and the unique index both block a second open registration for the same (class, name)', async () => {
			const registrationName = `Duplicate Student ${crypto.randomUUID().slice(0, 8)}`;
			const first = await signUpStudent({ classId: classAId, registrationName });
			expect(first.error).toBeNull();

			const client = anonClient();
			const { data: available } = await client.rpc('check_registration_available', {
				p_class_id: classAId,
				p_registration_name: registrationName
			});
			expect(available).toBe(false);

			// The pre-check above is what the route relies on for a friendly error;
			// this proves the DB-level backstop (profiles_open_student_registration_unique)
			// is real too, not just an app-level convention (mirrors the
			// classes.code unique-constraint test in the Story 1-1 block above).
			const second = await signUpStudent({ classId: classAId, registrationName });
			expect(second.error).not.toBeNull();
		});

		it('teacher approves: teacherA (assigned to the class) can move Pending -> approved with a team, generating real sign-in credentials', async () => {
			const registrationName = `Approved Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });
			await confirmGuardianEmail(id!);

			// Mirrors requests/+page.server.ts's approve action's real order:
			// generate + assign the auth credentials FIRST, then flip
			// status/team/email on profiles together -- `email` is included in
			// that same update because there is no trigger syncing
			// profiles.email when auth.users.email changes on UPDATE (only
			// handle_new_user() populates it, and only on INSERT). Asserting it
			// here is what would catch a regression of that sync.
			const { data: existing } = await adminClient
				.from('profiles')
				.select('email')
				.ilike('email', `%@${STUDENT_EMAIL_DOMAIN}`);
			const existingUsernames = new Set(
				(existing ?? [])
					.map((p) => (p.email.endsWith(`@${STUDENT_EMAIL_DOMAIN}`) ? p.email.split('@')[0] : null))
					.filter((u): u is string => u !== null && !u.startsWith('pending-'))
			);
			const username = generateUniqueStudentUsername(registrationName, existingUsernames);
			const pin = generateStudentPin();

			const { error: authUpdateError } = await updateAuthUserEmailAndPassword(id!, {
				email: studentUsernameToEmail(username),
				password: pin
			});
			expect(authUpdateError).toBeNull();

			const { data: updated, error } = await teacherA.client
				.from('profiles')
				.update({
					status: 'approved',
					team_id: teamId,
					email: studentUsernameToEmail(username),
					reviewed_by: teacherA.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!)
				.select('status, team_id, reviewed_by, email')
				.single();

			expect(error).toBeNull();
			expect(updated?.status).toBe('approved');
			expect(updated?.team_id).toBe(teamId);
			expect(updated?.reviewed_by).toBe(teacherA.id);
			expect(updated?.email).toBe(studentUsernameToEmail(username));

			// Goes through resolveLoginIdentifierToEmail -- the exact function
			// (auth)/login/+page.server.ts calls -- with the bare username a
			// student actually types into the shared login form, not a
			// hand-constructed email. This is what proves the real sign-in path
			// works, not just signInWithPassword() in isolation.
			const signInClient = anonClient();
			const correct = await signInClient.auth.signInWithPassword({
				email: resolveLoginIdentifierToEmail(username),
				password: pin
			});
			expect(correct.error).toBeNull();
			expect(correct.data.session).not.toBeNull();

			const wrong = await anonClient().auth.signInWithPassword({
				email: resolveLoginIdentifierToEmail(username),
				password: '000000'
			});
			expect(wrong.error).not.toBeNull();
			expect(wrong.data.session).toBeNull();
		});

		it('team_id is settable only once: a second attempt to change it is rejected for every caller, including an admin', async () => {
			const registrationName = `Team Once Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });
			await confirmGuardianEmail(id!);

			const { error: approveError } = await teacherA.client
				.from('profiles')
				.update({
					status: 'approved',
					team_id: teamId,
					reviewed_by: teacherA.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!);
			expect(approveError).toBeNull();

			const { data: secondTeam } = await admin.client
				.from('teams')
				.insert({ name: `Other Team ${crypto.randomUUID().slice(0, 6)}` })
				.select('id')
				.single();

			// Even the admin, going through the same normal update path
			// (profiles_update_registration_review), is rejected once team_id
			// is already set -- its USING clause requires status='pending',
			// which an approved row no longer satisfies, so RLS filters the
			// row out (zero rows affected, no thrown error, matching the
			// established "RLS denies by returning zero rows" pattern above)
			// before the trigger even runs.
			const asAdmin = await admin.client
				.from('profiles')
				.update({ team_id: secondTeam!.id })
				.eq('id', id!)
				.select('id');
			expect(asAdmin.error).toBeNull();
			expect(asAdmin.data).toEqual([]);

			const asTeacher = await teacherA.client
				.from('profiles')
				.update({ team_id: secondTeam!.id })
				.eq('id', id!)
				.select('id');
			expect(asTeacher.error).toBeNull();
			expect(asTeacher.data).toEqual([]);

			// The trigger itself (the real, unconditional backstop -- Story 1-2
			// AC 2: "including an admin... is rejected") is what stops even a
			// privileged, RLS-bypassing service-role connection, which is the
			// only way to reach an already-approved row's team_id at all. This
			// is what "the documented admin-only override path" in the
			// migration's comments refers to needing (a deliberate, out-of-band
			// action -- not something reachable through this same call shape).
			const viaServiceRole = await adminClient
				.from('profiles')
				.update({ team_id: secondTeam!.id })
				.eq('id', id!);
			expect(viaServiceRole.error).not.toBeNull();

			const { data: unchanged } = await adminClient
				.from('profiles')
				.select('team_id')
				.eq('id', id!)
				.single();
			expect(unchanged?.team_id).toBe(teamId);
		});

		it('non-assigned teacher attempts approval: RLS denies the update regardless of frontend state (zero rows affected, not a bypass)', async () => {
			const registrationName = `Guarded Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });

			const { data, error } = await teacherB.client
				.from('profiles')
				.update({
					status: 'approved',
					team_id: teamId,
					reviewed_by: teacherB.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!)
				.select('id');

			// RLS filters the row out of both USING and WITH CHECK -- PostgREST
			// reports this as zero affected rows, not a thrown error (matching the
			// pattern already established for classes above).
			expect(error).toBeNull();
			expect(data).toEqual([]);

			const { data: stillPending } = await adminClient
				.from('profiles')
				.select('status')
				.eq('id', id!)
				.single();
			expect(stillPending?.status).toBe('pending');
		});

		it('assigned teacher attempts approval before the guardian confirms: the WITH CHECK gate rejects it with a real RLS error', async () => {
			const registrationName = `Unconfirmed Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });
			// Deliberately no confirmGuardianEmail() call -- email_confirmed_at
			// stays null. Unlike the unassigned-teacher case above (where the
			// USING clause itself filters the row out, producing zero rows with
			// no error), teacherA IS assigned and the row IS pending, so USING
			// passes -- only the WITH CHECK added by migration 0006 fails, which
			// Postgres surfaces as an explicit 42501 permission-denied error,
			// not a silent empty result. This is exactly why
			// requests/+page.server.ts's approve action pre-checks
			// email_confirmed_at itself before ever reaching this update.
			const { data, error } = await teacherA.client
				.from('profiles')
				.update({
					status: 'approved',
					team_id: teamId,
					reviewed_by: teacherA.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!)
				.select('id');

			expect(error).not.toBeNull();
			expect(error?.code).toBe('42501');
			expect(data).toBeNull();

			const { data: stillPending } = await adminClient
				.from('profiles')
				.select('status')
				.eq('id', id!)
				.single();
			expect(stillPending?.status).toBe('pending');
		});

		it('rejecting an unconfirmed registration still succeeds -- confirmation only gates approval, not rejection', async () => {
			const registrationName = `Reject Unconfirmed Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });

			const { data, error } = await teacherA.client
				.from('profiles')
				.update({
					status: 'rejected',
					reviewed_by: teacherA.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!)
				.select('status')
				.single();

			expect(error).toBeNull();
			expect(data?.status).toBe('rejected');
		});

		it('a second child registered by the same guardian while the first is still pending hits the real Auth email-uniqueness collision (isDuplicateSignup empty-identities shape)', async () => {
			const guardianEmail = `story-1-2-guardian-${crypto.randomUUID()}@example.test`;

			const child1 = await signUpStudent({
				classId: classAId,
				registrationName: `Sibling One ${crypto.randomUUID().slice(0, 6)}`,
				guardianEmail
			});
			expect(child1.error).toBeNull();

			// GoTrue enforces a real per-email resend cooldown (auth.email.max_frequency)
			// independent of the email-uniqueness collision this test is actually
			// exercising -- wait past it first, same as the Story 1-1 dup-shape test.
			await new Promise((resolve) => setTimeout(resolve, 1100));

			// Same guardian email, different child, while child1 is still
			// pending/unconfirmed -- Supabase Auth's email-uniqueness constraint
			// collides. This is the deliberate, narrow, deferred limitation
			// documented in deferred-work.md: it self-resolves once child1 is
			// approved (their auth email flips to the synthetic username
			// address, freeing the guardian's email for reuse).
			const child2 = await signUpStudent({
				classId: classAId,
				registrationName: `Sibling Two ${crypto.randomUUID().slice(0, 6)}`,
				guardianEmail
			});

			expect(isDuplicateSignup(child2.error, child2.data.user)).toBe(true);
		});

		it("admin approves as a backup path for a class the admin didn't create/isn't assigned to", async () => {
			const registrationName = `Admin Backup Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });
			await confirmGuardianEmail(id!);

			const { data, error } = await admin.client
				.from('profiles')
				.update({
					status: 'approved',
					team_id: teamId,
					reviewed_by: admin.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!)
				.select('status')
				.single();

			expect(error).toBeNull();
			expect(data?.status).toBe('approved');
		});

		it('CLEAR REJECTED: deleting the auth user removes the profile row and re-opens the (class, name) pair for resubmission', async () => {
			const registrationName = `Rejected Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });

			const { error: rejectError } = await teacherA.client
				.from('profiles')
				.update({
					status: 'rejected',
					reviewed_by: teacherA.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!);
			expect(rejectError).toBeNull();

			// Belt-and-suspenders check requests/+page.server.ts's clearRejected
			// action relies on: an RLS-scoped read must find the row before the
			// privileged delete runs.
			const { data: verified } = await teacherA.client
				.from('profiles')
				.select('id')
				.eq('id', id!)
				.eq('status', 'rejected')
				.single();
			expect(verified?.id).toBe(id);

			const { error: deleteError } = await adminClient.auth.admin.deleteUser(id!);
			expect(deleteError).toBeNull();

			const { data: goneProfile } = await adminClient.from('profiles').select('id').eq('id', id!);
			expect(goneProfile).toEqual([]);

			// Not silently deleted earlier -- only now, via this explicit action,
			// does the same (class_id, registration_name) pair become available
			// again (Story 1-2 AC 3 / Boundaries).
			const resubmit = await signUpStudent({ classId: classAId, registrationName });
			expect(resubmit.error).toBeNull();
		});

		it('nav pending-requests badge count query is RLS-scoped: an assigned teacher sees it, an unassigned teacher sees zero', async () => {
			const teacherC = await createSignedInUser('teacher');

			const { data: classC, error: classCError } = await admin.client
				.from('classes')
				.insert({
					name: 'Badge Count Class',
					code: `BC${crypto.randomUUID().slice(0, 4).toUpperCase()}`
				})
				.select('id')
				.single();
			if (classCError || !classC) {
				throw new Error(`Failed to create badge-count class: ${classCError?.message}`);
			}

			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: classC.id, teacher_id: teacherC.id });
			expect(assignError).toBeNull();

			await signUpStudent({
				classId: classC.id,
				registrationName: `Badge Pending A ${crypto.randomUUID().slice(0, 6)}`
			});
			await signUpStudent({
				classId: classC.id,
				registrationName: `Badge Pending B ${crypto.randomUUID().slice(0, 6)}`
			});

			// Mirrors +layout.server.ts's pendingRequestsCount query exactly.
			const asAssignedTeacher = await teacherC.client
				.from('profiles')
				.select('id', { count: 'exact', head: true })
				.eq('role', 'student')
				.eq('status', 'pending');
			expect(asAssignedTeacher.error).toBeNull();
			expect(asAssignedTeacher.count).toBe(2);

			// teacherB is never assigned to any class in this describe block, so
			// RLS scopes their count to zero regardless of how many pending
			// students exist elsewhere.
			const asUnassignedTeacher = await teacherB.client
				.from('profiles')
				.select('id', { count: 'exact', head: true })
				.eq('role', 'student')
				.eq('status', 'pending');
			expect(asUnassignedTeacher.error).toBeNull();
			expect(asUnassignedTeacher.count).toBe(0);
		});

		it('two students with identical registration names in the same class both get distinct, working sign-in credentials (real Auth collision retry)', async () => {
			// Mirrors requests/+page.server.ts's approve action's retry loop
			// exactly, but takes `existingUsernames` as a parameter instead of
			// querying it, so the test can force a genuine Postgres unique-
			// violation on demand rather than hoping one occurs. Uses
			// updateAuthUserEmailAndPassword, not
			// adminClient.auth.admin.updateUserById(), for the same reason the
			// real action does: the SDK wraps every 500 from this endpoint into
			// a generic error with no code, discarding the real `23505` a
			// duplicate-email collision returns.
			async function approveWithUsernameSnapshot(
				studentId: string,
				registrationName: string,
				existingUsernames: Set<string>
			) {
				let username = generateUniqueStudentUsername(registrationName, existingUsernames);
				let pin = generateStudentPin();
				let assigned = false;

				for (let attempt = 0; attempt < 5 && !assigned; attempt++) {
					const { error: authError } = await updateAuthUserEmailAndPassword(studentId, {
						email: studentUsernameToEmail(username),
						password: pin
					});
					if (!authError) {
						assigned = true;
						break;
					}
					const isDuplicate =
						authError.code === '23505' ||
						authError.code === 'email_exists' ||
						/already.*registered|exists|duplicate/i.test(authError.message ?? '');
					if (!isDuplicate) {
						throw new Error(`Unexpected auth update error: ${authError.message}`);
					}
					existingUsernames.add(username);
					username = generateUniqueStudentUsername(registrationName, existingUsernames);
					pin = generateStudentPin();
				}
				if (!assigned) {
					throw new Error('Could not assign student credentials after retries');
				}

				const { error: profileError } = await teacherA.client
					.from('profiles')
					.update({
						status: 'approved',
						team_id: teamId,
						email: studentUsernameToEmail(username),
						reviewed_by: teacherA.id,
						reviewed_at: new Date().toISOString()
					})
					.eq('id', studentId);
				if (profileError) {
					throw new Error(`Profile approval update failed: ${profileError.message}`);
				}

				return { username, pin };
			}

			const dupName = `Dup Name ${crypto.randomUUID().slice(0, 6)}`;

			const student1 = await signUpStudent({ classId: classAId, registrationName: dupName });
			expect(student1.error).toBeNull();
			await confirmGuardianEmail(student1.id!);

			// Approved before student2 registers -- otherwise
			// profiles_open_student_registration_unique would block a second
			// Pending row for the identical (class, name) pair (Boundaries).
			const approval1 = await approveWithUsernameSnapshot(student1.id!, dupName, new Set());

			const student2 = await signUpStudent({ classId: classAId, registrationName: dupName });
			expect(student2.error).toBeNull();
			await confirmGuardianEmail(student2.id!);

			// Deliberately an EMPTY set, not a fresh query of already-assigned
			// usernames -- generateUniqueStudentUsername therefore proposes the
			// exact same base slug student1 already has, guaranteeing
			// updateUserById's first attempt hits a real, already-taken email
			// (a genuine email_exists error from Supabase Auth, not a simulated
			// one) and forcing the retry branch to run for real.
			const approval2 = await approveWithUsernameSnapshot(student2.id!, dupName, new Set());

			expect(approval2.username).not.toBe(approval1.username);

			const login1 = await anonClient().auth.signInWithPassword({
				email: resolveLoginIdentifierToEmail(approval1.username),
				password: approval1.pin
			});
			expect(login1.error).toBeNull();
			expect(login1.data.session).not.toBeNull();

			const login2 = await anonClient().auth.signInWithPassword({
				email: resolveLoginIdentifierToEmail(approval2.username),
				password: approval2.pin
			});
			expect(login2.error).toBeNull();
			expect(login2.data.session).not.toBeNull();
		});
	}
);

describe.skipIf(!reachable)(
	'Story 2-1 roster & skill-status tracking (requires local Supabase)',
	() => {
		let admin: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacherB: Awaited<ReturnType<typeof createSignedInUser>>;
		let classAId: string;
		let teamId: string;

		/**
		 * Creates a student profile directly via the service-role client
		 * (bypasses RLS, the same way `psql` run by hand would) rather than
		 * going through the full signUp()+approve() flow -- that flow is
		 * already covered end-to-end by the Story 1-2 block above; this story
		 * only needs profiles in a known (class, status) state to exercise
		 * skill_status_history/attendance_records RLS.
		 */
		async function createStudent(params: {
			classId: string;
			status: 'pending' | 'approved' | 'rejected';
			name: string;
		}) {
			const email = `story-2-1-student-${crypto.randomUUID()}@students.internal.invalid`;
			const { data, error } = await adminClient.auth.admin.createUser({
				email,
				password: crypto.randomUUID(),
				email_confirm: true,
				user_metadata: { role: 'student' }
			});
			if (error || !data.user) {
				throw new Error(`Failed to create student: ${error?.message}`);
			}

			const update: Database['public']['Tables']['profiles']['Update'] = {
				class_id: params.classId,
				status: params.status,
				registration_name: params.name,
				display_name: params.name
			};
			if (params.status === 'approved') {
				update.team_id = teamId;
			}

			const { error: updateError } = await adminClient
				.from('profiles')
				.update(update)
				.eq('id', data.user.id);
			if (updateError) {
				throw new Error(`Failed to set up student: ${updateError.message}`);
			}

			return data.user.id;
		}

		beforeAll(async () => {
			admin = await createSignedInUser('admin');
			teacherA = await createSignedInUser('teacher');
			teacherB = await createSignedInUser('teacher');

			const { data: classA, error: classAError } = await admin.client
				.from('classes')
				.insert({
					name: 'Story 2-1 Class A',
					code: `R${crypto.randomUUID().slice(0, 5).toUpperCase()}`
				})
				.select('id')
				.single();
			if (classAError || !classA)
				throw new Error(`Failed to create Class A: ${classAError?.message}`);
			classAId = classA.id;

			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: classAId, teacher_id: teacherA.id });
			if (assignError) throw new Error(`Failed to assign teacherA: ${assignError.message}`);

			const { data: team, error: teamError } = await admin.client
				.from('teams')
				.insert({ name: `Story 2-1 Team ${crypto.randomUUID().slice(0, 6)}` })
				.select('id')
				.single();
			if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
			teamId = team.id;
		}, 30000);

		it('an assigned teacher can mark attendance for an approved student in their class', async () => {
			const studentId = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Attendance Student ${crypto.randomUUID().slice(0, 6)}`
			});

			const { data, error } = await teacherA.client
				.from('attendance_records')
				.insert({
					student_id: studentId,
					class_id: classAId,
					present: true,
					session_date: '2026-09-13',
					recorded_by: teacherA.id
				})
				.select('present, session_date')
				.single();

			expect(error).toBeNull();
			expect(data?.present).toBe(true);
			expect(data?.session_date).toBe('2026-09-13');
		});

		it('skill-status is append-only: three entries for the same (student, skill_area) all persist, and the latest by timestamp is current', async () => {
			const studentId = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Language Student ${crypto.randomUUID().slice(0, 6)}`
			});
			const now = Date.now();

			const inserts = await Promise.all(
				[
					{ level: 'not_started' as const, offsetMs: 2000 },
					{ level: 'learning' as const, offsetMs: 1000 },
					{ level: 'confident' as const, offsetMs: 0 }
				].map(({ level, offsetMs }) =>
					teacherA.client.from('skill_status_history').insert({
						student_id: studentId,
						class_id: classAId,
						skill_area: 'language',
						level,
						recorded_at: new Date(now - offsetMs).toISOString(),
						recorded_by: teacherA.id
					})
				)
			);
			for (const result of inserts) expect(result.error).toBeNull();

			// Full history remains queryable -- not just the current value.
			const { data: rows, error } = await adminClient
				.from('skill_status_history')
				.select('level, recorded_at')
				.eq('student_id', studentId)
				.eq('skill_area', 'language')
				.order('recorded_at', { ascending: false });

			expect(error).toBeNull();
			expect(rows).toHaveLength(3);
			// Latest row by timestamp is current.
			expect(rows?.[0].level).toBe('confident');
			expect((rows ?? []).map((r) => r.level).sort()).toEqual(
				['confident', 'learning', 'not_started'].sort()
			);
		});

		it('a substitute teacher, newly assigned to the class, sees the full existing skill-status timeline, not just the latest value', async () => {
			const studentId = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Substitute Student ${crypto.randomUUID().slice(0, 6)}`
			});

			const seedInserts = await Promise.all(
				(['not_started', 'learning', 'confident'] as const).map((level, i) =>
					teacherA.client.from('skill_status_history').insert({
						student_id: studentId,
						class_id: classAId,
						skill_area: 'song',
						level,
						recorded_at: new Date(Date.now() - (3 - i) * 1000).toISOString(),
						recorded_by: teacherA.id
					})
				)
			);
			for (const result of seedInserts) expect(result.error).toBeNull();

			const substitute = await createSignedInUser('teacher');

			// Not yet assigned -- sees nothing (RLS denies by filtering).
			const before = await substitute.client
				.from('skill_status_history')
				.select('id')
				.eq('student_id', studentId);
			expect(before.error).toBeNull();
			expect(before.data).toEqual([]);

			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: classAId, teacher_id: substitute.id });
			expect(assignError).toBeNull();

			// Newly assigned -- sees the full timeline, not just the latest row.
			const after = await substitute.client
				.from('skill_status_history')
				.select('level')
				.eq('student_id', studentId);
			expect(after.error).toBeNull();
			expect(after.data).toHaveLength(3);

			await admin.client
				.from('class_teachers')
				.delete()
				.eq('class_id', classAId)
				.eq('teacher_id', substitute.id);
		});

		it('a teacher not assigned to the class gets zero rows reading, and a denied insert, on both tables', async () => {
			const studentId = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Guarded Roster Student ${crypto.randomUUID().slice(0, 6)}`
			});

			// teacherB is never assigned to Class A in this describe block.
			const readAttendance = await teacherB.client
				.from('attendance_records')
				.select('id')
				.eq('student_id', studentId);
			expect(readAttendance.error).toBeNull();
			expect(readAttendance.data).toEqual([]);

			const readSkill = await teacherB.client
				.from('skill_status_history')
				.select('id')
				.eq('student_id', studentId);
			expect(readSkill.error).toBeNull();
			expect(readSkill.data).toEqual([]);

			// WITH CHECK failure on INSERT surfaces as a real error (not silent
			// zero rows), matching the existing "teacher cannot create a class
			// directly" pattern in the Story 1-1 block above.
			const writeAttendance = await teacherB.client.from('attendance_records').insert({
				student_id: studentId,
				class_id: classAId,
				present: true,
				session_date: '2026-09-13'
			});
			expect(writeAttendance.error).not.toBeNull();

			const writeSkill = await teacherB.client.from('skill_status_history').insert({
				student_id: studentId,
				class_id: classAId,
				skill_area: 'dance',
				level: 'learning'
			});
			expect(writeSkill.error).not.toBeNull();

			// Confirms neither denied insert silently went through anyway.
			const { data: attendanceCheck } = await adminClient
				.from('attendance_records')
				.select('id')
				.eq('student_id', studentId);
			expect(attendanceCheck).toEqual([]);
			const { data: skillCheck } = await adminClient
				.from('skill_status_history')
				.select('id')
				.eq('student_id', studentId);
			expect(skillCheck).toEqual([]);
		});

		it('an assigned teacher cannot insert attendance/skill-status rows against a Pending student in their own class -- RLS, not just the roster read filter, rejects it', async () => {
			const pendingStudentId = await createStudent({
				classId: classAId,
				status: 'pending',
				name: `Guarded Pending Student ${crypto.randomUUID().slice(0, 6)}`
			});

			// teacherA IS assigned to classAId -- is_teacher_of_class(class_id)
			// alone would pass here, so this proves the additional
			// approved-student exists() check in the WITH CHECK clause is what's
			// actually stopping it, not class assignment.
			const writeAttendance = await teacherA.client.from('attendance_records').insert({
				student_id: pendingStudentId,
				class_id: classAId,
				present: true,
				session_date: '2026-09-13'
			});
			expect(writeAttendance.error).not.toBeNull();

			const writeSkill = await teacherA.client.from('skill_status_history').insert({
				student_id: pendingStudentId,
				class_id: classAId,
				skill_area: 'language',
				level: 'learning'
			});
			expect(writeSkill.error).not.toBeNull();

			const { data: attendanceCheck } = await adminClient
				.from('attendance_records')
				.select('id')
				.eq('student_id', pendingStudentId);
			expect(attendanceCheck).toEqual([]);
			const { data: skillCheck } = await adminClient
				.from('skill_status_history')
				.select('id')
				.eq('student_id', pendingStudentId);
			expect(skillCheck).toEqual([]);
		});

		it('an assigned teacher cannot insert a row with class_id=A but a student_id belonging to a different class', async () => {
			const { data: classB, error: classBError } = await admin.client
				.from('classes')
				.insert({
					name: 'Story 2-1 Class B',
					code: `RB${crypto.randomUUID().slice(0, 4).toUpperCase()}`
				})
				.select('id')
				.single();
			expect(classBError).toBeNull();
			const classBId = classB!.id;

			const otherClassStudentId = await createStudent({
				classId: classBId,
				status: 'approved',
				name: `Other Class Student ${crypto.randomUUID().slice(0, 6)}`
			});

			// teacherA is assigned to classAId (is_teacher_of_class(classAId)
			// passes), and otherClassStudentId is a real approved student -- just
			// not of classAId. This is exactly the scenario the migration's
			// exists() check comment says it exists to prevent: p.class_id must
			// match the row's own class_id, not merely "is an approved student
			// somewhere".
			const writeAttendance = await teacherA.client.from('attendance_records').insert({
				student_id: otherClassStudentId,
				class_id: classAId,
				present: true,
				session_date: '2026-09-13',
				recorded_by: teacherA.id
			});
			expect(writeAttendance.error).not.toBeNull();

			const writeSkill = await teacherA.client.from('skill_status_history').insert({
				student_id: otherClassStudentId,
				class_id: classAId,
				skill_area: 'language',
				level: 'learning',
				recorded_by: teacherA.id
			});
			expect(writeSkill.error).not.toBeNull();

			const { data: attendanceCheck } = await adminClient
				.from('attendance_records')
				.select('id')
				.eq('student_id', otherClassStudentId);
			expect(attendanceCheck).toEqual([]);
			const { data: skillCheck } = await adminClient
				.from('skill_status_history')
				.select('id')
				.eq('student_id', otherClassStudentId);
			expect(skillCheck).toEqual([]);
		});

		it('pending and rejected students never appear in a roster read scoped to approved students', async () => {
			const approvedName = `Roster Approved ${crypto.randomUUID().slice(0, 6)}`;
			const pendingName = `Roster Pending ${crypto.randomUUID().slice(0, 6)}`;
			const rejectedName = `Roster Rejected ${crypto.randomUUID().slice(0, 6)}`;

			await createStudent({ classId: classAId, status: 'approved', name: approvedName });
			await createStudent({ classId: classAId, status: 'pending', name: pendingName });
			await createStudent({ classId: classAId, status: 'rejected', name: rejectedName });

			// Mirrors src/routes/teacher/classes/[id]/+page.server.ts's roster
			// query exactly.
			const { data, error } = await teacherA.client
				.from('profiles')
				.select('id, display_name')
				.eq('class_id', classAId)
				.eq('role', 'student')
				.eq('status', 'approved');

			expect(error).toBeNull();
			const names = (data ?? []).map((s) => s.display_name);
			expect(names).toContain(approvedName);
			expect(names).not.toContain(pendingName);
			expect(names).not.toContain(rejectedName);
		});

		it('two teachers inserting skill-status rows for the same student and skill_area at the same time both persist -- no clobbering, no lock contention', async () => {
			const studentId = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Concurrent Student ${crypto.randomUUID().slice(0, 6)}`
			});

			const substitute = await createSignedInUser('teacher');
			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: classAId, teacher_id: substitute.id });
			expect(assignError).toBeNull();

			const [resultA, resultB] = await Promise.all([
				teacherA.client.from('skill_status_history').insert({
					student_id: studentId,
					class_id: classAId,
					skill_area: 'dance',
					level: 'learning',
					recorded_by: teacherA.id
				}),
				substitute.client.from('skill_status_history').insert({
					student_id: studentId,
					class_id: classAId,
					skill_area: 'dance',
					level: 'confident',
					recorded_by: substitute.id
				})
			]);

			expect(resultA.error).toBeNull();
			expect(resultB.error).toBeNull();

			const { data: rows } = await adminClient
				.from('skill_status_history')
				.select('id, recorded_by')
				.eq('student_id', studentId)
				.eq('skill_area', 'dance');
			expect(rows).toHaveLength(2);

			await admin.client
				.from('class_teachers')
				.delete()
				.eq('class_id', classAId)
				.eq('teacher_id', substitute.id);
		});

		it('attendance is append-only too: two marks for the same student and session_date both persist rather than one overwriting the other', async () => {
			const studentId = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Attendance Append Student ${crypto.randomUUID().slice(0, 6)}`
			});

			const first = await teacherA.client.from('attendance_records').insert({
				student_id: studentId,
				class_id: classAId,
				present: false,
				session_date: '2026-09-13',
				recorded_by: teacherA.id
			});
			expect(first.error).toBeNull();

			const second = await teacherA.client.from('attendance_records').insert({
				student_id: studentId,
				class_id: classAId,
				present: true,
				session_date: '2026-09-13',
				recorded_by: teacherA.id
			});
			expect(second.error).toBeNull();

			const { data: rows } = await adminClient
				.from('attendance_records')
				.select('present, recorded_at')
				.eq('student_id', studentId)
				.eq('session_date', '2026-09-13')
				.order('recorded_at', { ascending: false });
			expect(rows).toHaveLength(2);
			// Latest-by-timestamp query returns the newer one.
			expect(rows?.[0].present).toBe(true);
		});

		it("neither skill_status_history nor attendance_records has an UPDATE or DELETE policy -- both attempts affect zero rows on both tables (append-only by absence, matching profiles' pattern)", async () => {
			const studentId = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Immutable Student ${crypto.randomUUID().slice(0, 6)}`
			});

			// skill_status_history
			const { data: insertedSkill, error: insertSkillError } = await teacherA.client
				.from('skill_status_history')
				.insert({
					student_id: studentId,
					class_id: classAId,
					skill_area: 'language',
					level: 'learning',
					recorded_by: teacherA.id
				})
				.select('id')
				.single();
			expect(insertSkillError).toBeNull();

			const skillUpdateAttempt = await teacherA.client
				.from('skill_status_history')
				.update({ level: 'confident' })
				.eq('id', insertedSkill!.id)
				.select('id');
			expect(skillUpdateAttempt.error).toBeNull();
			expect(skillUpdateAttempt.data).toEqual([]);

			const skillDeleteAttempt = await teacherA.client
				.from('skill_status_history')
				.delete()
				.eq('id', insertedSkill!.id)
				.select('id');
			expect(skillDeleteAttempt.error).toBeNull();
			expect(skillDeleteAttempt.data).toEqual([]);

			const { data: skillStillThere } = await adminClient
				.from('skill_status_history')
				.select('level')
				.eq('id', insertedSkill!.id)
				.single();
			expect(skillStillThere?.level).toBe('learning');

			// attendance_records -- same assertions, twin table.
			const { data: insertedAttendance, error: insertAttendanceError } = await teacherA.client
				.from('attendance_records')
				.insert({
					student_id: studentId,
					class_id: classAId,
					present: true,
					session_date: '2026-09-13',
					recorded_by: teacherA.id
				})
				.select('id')
				.single();
			expect(insertAttendanceError).toBeNull();

			const attendanceUpdateAttempt = await teacherA.client
				.from('attendance_records')
				.update({ present: false })
				.eq('id', insertedAttendance!.id)
				.select('id');
			expect(attendanceUpdateAttempt.error).toBeNull();
			expect(attendanceUpdateAttempt.data).toEqual([]);

			const attendanceDeleteAttempt = await teacherA.client
				.from('attendance_records')
				.delete()
				.eq('id', insertedAttendance!.id)
				.select('id');
			expect(attendanceDeleteAttempt.error).toBeNull();
			expect(attendanceDeleteAttempt.data).toEqual([]);

			const { data: attendanceStillThere } = await adminClient
				.from('attendance_records')
				.select('present')
				.eq('id', insertedAttendance!.id)
				.single();
			expect(attendanceStillThere?.present).toBe(true);
		});
	}
);

describe.skipIf(!reachable)(
	'Story 3-1 one-off homework assignment & review (requires local Supabase)',
	() => {
		let admin: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacherB: Awaited<ReturnType<typeof createSignedInUser>>;
		let classAId: string;
		let teamId: string;

		/**
		 * Service-role-created student profile in a known (class, status)
		 * state -- same shape as Story 2-1's local createStudent above
		 * (duplicated rather than shared, matching this file's existing
		 * per-describe-block convention).
		 */
		async function createStudent(params: {
			classId: string;
			status: 'pending' | 'approved' | 'rejected';
			name: string;
		}) {
			const email = `story-3-1-student-${crypto.randomUUID()}@students.internal.invalid`;
			const { data, error } = await adminClient.auth.admin.createUser({
				email,
				password: crypto.randomUUID(),
				email_confirm: true,
				user_metadata: { role: 'student' }
			});
			if (error || !data.user) {
				throw new Error(`Failed to create student: ${error?.message}`);
			}

			const update: Database['public']['Tables']['profiles']['Update'] = {
				class_id: params.classId,
				status: params.status,
				registration_name: params.name,
				display_name: params.name
			};
			if (params.status === 'approved') {
				update.team_id = teamId;
			}

			const { error: updateError } = await adminClient
				.from('profiles')
				.update(update)
				.eq('id', data.user.id);
			if (updateError) {
				throw new Error(`Failed to set up student: ${updateError.message}`);
			}

			return data.user.id;
		}

		/**
		 * Same as createStudent, but also signs in with a known password --
		 * needed for the self-mark-Done tests below, which must exercise the
		 * RLS policy as the real student (auth.uid() = student_id), not via
		 * the service-role client.
		 */
		async function createSignedInStudent(params: {
			classId: string;
			status?: 'pending' | 'approved' | 'rejected';
			name: string;
		}) {
			const email = `story-3-1-signedin-student-${crypto.randomUUID()}@students.internal.invalid`;
			const password = crypto.randomUUID();
			const status = params.status ?? 'approved';

			const { data, error } = await adminClient.auth.admin.createUser({
				email,
				password,
				email_confirm: true,
				user_metadata: { role: 'student' }
			});
			if (error || !data.user) {
				throw new Error(`Failed to create signed-in student: ${error?.message}`);
			}

			const update: Database['public']['Tables']['profiles']['Update'] = {
				class_id: params.classId,
				status,
				registration_name: params.name,
				display_name: params.name
			};
			if (status === 'approved') {
				update.team_id = teamId;
			}

			const { error: updateError } = await adminClient
				.from('profiles')
				.update(update)
				.eq('id', data.user.id);
			if (updateError) {
				throw new Error(`Failed to set up signed-in student: ${updateError.message}`);
			}

			const client = anonClient();
			const { error: signInError } = await client.auth.signInWithPassword({ email, password });
			if (signInError) {
				throw new Error(`Failed to sign in student: ${signInError.message}`);
			}

			return { id: data.user.id, email, client };
		}

		async function createHomeworkAssignment(params: {
			classId: string;
			createdBy: { id: string; client: ReturnType<typeof anonClient> };
			title?: string;
			recurrenceRule?: unknown;
			// Story 3-2's homework_assignments_recurrence_shape CHECK constraint
			// requires these whenever recurrence_rule is not null -- optional
			// here (undefined) for every existing Story 3-1 call site, which
			// never passes recurrenceRule at all.
			recurrenceStartDate?: string;
			dueOffsetDays?: number;
		}) {
			// homework_assignments' own INSERT policy places no restriction on
			// recurrence_rule (only AD-8's homework_instances policy does) -- a
			// teacher inserting a recurring-assignment row directly is exactly
			// what Story 3-2 will do, so this fixture goes through the same
			// direct-lane client as the one-off case, not a service-role bypass.
			const { data, error } = await params.createdBy.client
				.from('homework_assignments')
				.insert({
					class_id: params.classId,
					title: params.title ?? `Assignment ${crypto.randomUUID().slice(0, 6)}`,
					skill_area: 'language',
					created_by: params.createdBy.id,
					...(params.recurrenceRule !== undefined
						? { recurrence_rule: params.recurrenceRule }
						: {}),
					...(params.recurrenceStartDate !== undefined
						? { recurrence_start_date: params.recurrenceStartDate }
						: {}),
					...(params.dueOffsetDays !== undefined ? { due_offset_days: params.dueOffsetDays } : {})
				})
				.select('id')
				.single();
			if (error || !data) {
				throw new Error(`Failed to create homework assignment: ${error?.message}`);
			}
			return data.id as string;
		}

		async function createHomeworkInstance(params: {
			assignmentId: string;
			classId: string;
			client: ReturnType<typeof anonClient>;
			dueDate?: string;
			periodStart?: string;
		}) {
			const dueDate = params.dueDate ?? '2026-09-20';
			const { data, error } = await params.client
				.from('homework_instances')
				.insert({
					assignment_id: params.assignmentId,
					class_id: params.classId,
					period_start: params.periodStart ?? dueDate,
					due_date: dueDate
				})
				.select('id')
				.single();
			if (error || !data) {
				throw new Error(`Failed to create homework instance: ${error?.message}`);
			}
			return data.id as string;
		}

		beforeAll(async () => {
			admin = await createSignedInUser('admin');
			teacherA = await createSignedInUser('teacher');
			teacherB = await createSignedInUser('teacher');

			const { data: classA, error: classAError } = await admin.client
				.from('classes')
				.insert({
					name: 'Story 3-1 Class A',
					code: `H${crypto.randomUUID().slice(0, 5).toUpperCase()}`
				})
				.select('id')
				.single();
			if (classAError || !classA)
				throw new Error(`Failed to create Class A: ${classAError?.message}`);
			classAId = classA.id;

			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: classAId, teacher_id: teacherA.id });
			if (assignError) throw new Error(`Failed to assign teacherA: ${assignError.message}`);

			const { data: team, error: teamError } = await admin.client
				.from('teams')
				.insert({ name: `Story 3-1 Team ${crypto.randomUUID().slice(0, 6)}` })
				.select('id')
				.single();
			if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
			teamId = team.id;
		}, 30000);

		it('whole-class assignment: an assigned row is accepted for every approved student, and rejected for a pending one', async () => {
			const approvedA = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Whole Class A ${crypto.randomUUID().slice(0, 6)}`
			});
			const approvedB = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Whole Class B ${crypto.randomUUID().slice(0, 6)}`
			});
			const pending = await createStudent({
				classId: classAId,
				status: 'pending',
				name: `Whole Class Pending ${crypto.randomUUID().slice(0, 6)}`
			});

			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const instanceId = await createHomeworkInstance({
				assignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});

			for (const studentId of [approvedA, approvedB]) {
				const { error } = await teacherA.client.from('homework_status_history').insert({
					instance_id: instanceId,
					student_id: studentId,
					class_id: classAId,
					status: 'assigned',
					recorded_by: teacherA.id
				});
				expect(error).toBeNull();
			}

			const { error: pendingError } = await teacherA.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: pending,
				class_id: classAId,
				status: 'assigned',
				recorded_by: teacherA.id
			});
			expect(pendingError).not.toBeNull();

			const { data: assignedRows } = await adminClient
				.from('homework_status_history')
				.select('student_id')
				.eq('instance_id', instanceId)
				.eq('status', 'assigned');
			expect((assignedRows ?? []).map((r) => r.student_id).sort()).toEqual(
				[approvedA, approvedB].sort()
			);
		});

		it('subset assignment: assigned rows exist only for the selected students, not the rest of the class', async () => {
			const targeted = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Subset Targeted ${crypto.randomUUID().slice(0, 6)}`
			});
			const untargeted = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Subset Untargeted ${crypto.randomUUID().slice(0, 6)}`
			});

			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const instanceId = await createHomeworkInstance({
				assignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});

			const { error } = await teacherA.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: targeted,
				class_id: classAId,
				status: 'assigned',
				recorded_by: teacherA.id
			});
			expect(error).toBeNull();

			const { data: assignedRows } = await adminClient
				.from('homework_status_history')
				.select('student_id')
				.eq('instance_id', instanceId)
				.eq('status', 'assigned');
			const assignedStudentIds = (assignedRows ?? []).map((r) => r.student_id);
			expect(assignedStudentIds).toContain(targeted);
			expect(assignedStudentIds).not.toContain(untargeted);
		});

		it('student marks Done: a new done row is inserted, the assigned row remains as history, and Done/Reviewed stay independently queryable', async () => {
			const student = await createSignedInStudent({
				classId: classAId,
				name: `Self Mark Done ${crypto.randomUUID().slice(0, 6)}`
			});

			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const instanceId = await createHomeworkInstance({
				assignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});
			await teacherA.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student.id,
				class_id: classAId,
				status: 'assigned',
				recorded_by: teacherA.id
			});

			const { error: doneError } = await student.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student.id,
				class_id: classAId,
				status: 'done',
				recorded_by: student.id
			});
			expect(doneError).toBeNull();

			const { data: rows } = await adminClient
				.from('homework_status_history')
				.select('status')
				.eq('instance_id', instanceId)
				.eq('student_id', student.id);
			expect((rows ?? []).map((r) => r.status).sort()).toEqual(['assigned', 'done'].sort());

			// Reviewed is independently queryable and not present yet -- reading
			// "is this Done" (it is) never depended on "is this Reviewed" (it
			// isn't).
			expect((rows ?? []).some((r) => r.status === 'reviewed')).toBe(false);

			// A student cannot self-mark Reviewed directly (Intent: "a teacher
			// separately marks Reviewed after confirming in class").
			const { error: reviewedError } = await student.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student.id,
				class_id: classAId,
				status: 'reviewed',
				recorded_by: student.id
			});
			expect(reviewedError).not.toBeNull();
		});

		it('untargeted student attempts Done: RLS rejects the insert, whether self-marking or a teacher marking on their behalf', async () => {
			const untargeted = await createSignedInStudent({
				classId: classAId,
				name: `Untargeted ${crypto.randomUUID().slice(0, 6)}`
			});

			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const instanceId = await createHomeworkInstance({
				assignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});
			// Deliberately no 'assigned' row inserted for `untargeted` at all.

			const { error: selfError } = await untargeted.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: untargeted.id,
				class_id: classAId,
				status: 'done',
				recorded_by: untargeted.id
			});
			expect(selfError).not.toBeNull();

			// Even the assigned teacher cannot mark Done for a student who was
			// never targeted for this instance -- the "prior assigned row"
			// check is unconditional, not just a student-side guard.
			const { error: teacherError } = await teacherA.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: untargeted.id,
				class_id: classAId,
				status: 'done',
				recorded_by: teacherA.id
			});
			expect(teacherError).not.toBeNull();

			const { data: rows } = await adminClient
				.from('homework_status_history')
				.select('id')
				.eq('instance_id', instanceId)
				.eq('student_id', untargeted.id);
			expect(rows).toEqual([]);
		});

		it("teacher marks Done on a student's behalf: recorded_by shows the teacher, not the student", async () => {
			const student = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `On Behalf ${crypto.randomUUID().slice(0, 6)}`
			});

			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const instanceId = await createHomeworkInstance({
				assignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});
			await teacherA.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student,
				class_id: classAId,
				status: 'assigned',
				recorded_by: teacherA.id
			});

			const { data, error } = await teacherA.client
				.from('homework_status_history')
				.insert({
					instance_id: instanceId,
					student_id: student,
					class_id: classAId,
					status: 'done',
					recorded_by: teacherA.id
				})
				.select('student_id, recorded_by')
				.single();

			expect(error).toBeNull();
			expect(data?.student_id).toBe(student);
			expect(data?.recorded_by).toBe(teacherA.id);
		});

		it('teacher marks Reviewed after the student is Done: independent history, both remain queryable', async () => {
			const student = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Reviewed Flow ${crypto.randomUUID().slice(0, 6)}`
			});

			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const instanceId = await createHomeworkInstance({
				assignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});
			await teacherA.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student,
				class_id: classAId,
				status: 'assigned',
				recorded_by: teacherA.id
			});
			await teacherA.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student,
				class_id: classAId,
				status: 'done',
				recorded_by: teacherA.id
			});

			const { error: reviewedError } = await teacherA.client
				.from('homework_status_history')
				.insert({
					instance_id: instanceId,
					student_id: student,
					class_id: classAId,
					status: 'reviewed',
					recorded_by: teacherA.id
				});
			expect(reviewedError).toBeNull();

			const { data: rows } = await adminClient
				.from('homework_status_history')
				.select('status')
				.eq('instance_id', instanceId)
				.eq('student_id', student);
			expect((rows ?? []).map((r) => r.status).sort()).toEqual(
				['assigned', 'done', 'reviewed'].sort()
			);
		});

		it('overdue, unarchived item stays visible; archiving is the explicit action that removes it going forward', async () => {
			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const instanceId = await createHomeworkInstance({
				assignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2020-01-01' // deliberately far in the past
			});

			// Still selectable -- nothing hides an overdue item automatically.
			const { data: beforeArchive, error: beforeError } = await teacherA.client
				.from('homework_instances')
				.select('id, archived_at')
				.eq('id', instanceId)
				.single();
			expect(beforeError).toBeNull();
			expect(beforeArchive?.archived_at).toBeNull();

			// A non-assigned teacher cannot archive it.
			const { data: deniedArchive } = await teacherB.client
				.from('homework_instances')
				.update({ archived_at: new Date().toISOString(), archived_by: teacherB.id })
				.eq('id', instanceId)
				.select('id');
			expect(deniedArchive).toEqual([]);

			// The assigned teacher's explicit archive action sets archived_at.
			const { data: archived, error: archiveError } = await teacherA.client
				.from('homework_instances')
				.update({ archived_at: new Date().toISOString(), archived_by: teacherA.id })
				.eq('id', instanceId)
				.select('archived_at, archived_by')
				.single();
			expect(archiveError).toBeNull();
			expect(archived?.archived_at).not.toBeNull();
			expect(archived?.archived_by).toBe(teacherA.id);
		});

		it('a teacher not assigned to the class gets zero rows reading, and denied writes, across all three tables', async () => {
			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const instanceId = await createHomeworkInstance({
				assignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});
			const student = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Guarded Homework ${crypto.randomUUID().slice(0, 6)}`
			});
			await teacherA.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student,
				class_id: classAId,
				status: 'assigned',
				recorded_by: teacherA.id
			});

			const readAssignments = await teacherB.client
				.from('homework_assignments')
				.select('id')
				.eq('id', assignmentId);
			expect(readAssignments.data).toEqual([]);

			const readInstances = await teacherB.client
				.from('homework_instances')
				.select('id')
				.eq('id', instanceId);
			expect(readInstances.data).toEqual([]);

			const readHistory = await teacherB.client
				.from('homework_status_history')
				.select('id')
				.eq('instance_id', instanceId);
			expect(readHistory.data).toEqual([]);

			const writeAssignment = await teacherB.client.from('homework_assignments').insert({
				class_id: classAId,
				title: 'Should Fail',
				skill_area: 'language',
				created_by: teacherB.id
			});
			expect(writeAssignment.error).not.toBeNull();

			const writeInstance = await teacherB.client.from('homework_instances').insert({
				assignment_id: assignmentId,
				class_id: classAId,
				period_start: '2026-10-01',
				due_date: '2026-10-01'
			});
			expect(writeInstance.error).not.toBeNull();

			const writeHistory = await teacherB.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student,
				class_id: classAId,
				status: 'done',
				recorded_by: teacherB.id
			});
			expect(writeHistory.error).not.toBeNull();
		});

		it('homework_status_history is append-only: neither UPDATE nor DELETE has a policy -- both attempts affect zero rows', async () => {
			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const instanceId = await createHomeworkInstance({
				assignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});
			const student = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Immutable Homework ${crypto.randomUUID().slice(0, 6)}`
			});

			const { data: inserted, error: insertError } = await teacherA.client
				.from('homework_status_history')
				.insert({
					instance_id: instanceId,
					student_id: student,
					class_id: classAId,
					status: 'assigned',
					recorded_by: teacherA.id
				})
				.select('id')
				.single();
			expect(insertError).toBeNull();

			const updateAttempt = await teacherA.client
				.from('homework_status_history')
				.update({ status: 'done' })
				.eq('id', inserted!.id)
				.select('id');
			expect(updateAttempt.error).toBeNull();
			expect(updateAttempt.data).toEqual([]);

			const deleteAttempt = await teacherA.client
				.from('homework_status_history')
				.delete()
				.eq('id', inserted!.id)
				.select('id');
			expect(deleteAttempt.error).toBeNull();
			expect(deleteAttempt.data).toEqual([]);

			const { data: stillThere } = await adminClient
				.from('homework_status_history')
				.select('status')
				.eq('id', inserted!.id)
				.single();
			expect(stillThere?.status).toBe('assigned');
		});

		it('AD-8: UNIQUE(assignment_id, period_start) rejects a duplicate-period instance insert', async () => {
			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});

			const first = await teacherA.client.from('homework_instances').insert({
				assignment_id: assignmentId,
				class_id: classAId,
				period_start: '2026-09-20',
				due_date: '2026-09-20'
			});
			expect(first.error).toBeNull();

			const second = await teacherA.client.from('homework_instances').insert({
				assignment_id: assignmentId,
				class_id: classAId,
				period_start: '2026-09-20',
				due_date: '2026-09-27'
			});
			expect(second.error).not.toBeNull();
			expect(second.error?.code).toBe('23505');
		});

		it('AD-8: a direct client insert into homework_instances is rejected for a recurring assignment (recurrence_rule IS NOT NULL)', async () => {
			const recurringAssignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA,
				recurrenceRule: { frequency: 'weekly' },
				recurrenceStartDate: '2026-09-20',
				dueOffsetDays: 0
			});

			const { error } = await teacherA.client.from('homework_instances').insert({
				assignment_id: recurringAssignmentId,
				class_id: classAId,
				period_start: '2026-09-20',
				due_date: '2026-09-20'
			});
			expect(error).not.toBeNull();

			const { data: rows } = await adminClient
				.from('homework_instances')
				.select('id')
				.eq('assignment_id', recurringAssignmentId);
			expect(rows).toEqual([]);
		});

		it('class_id/instance_id mismatch: a teacher cannot write history for a foreign instance by submitting their own real class_id (HIGH SEVERITY regression guard)', async () => {
			// teacherB gets a REAL second class of their own (classB), distinct
			// from classAId -- this is what proves is_teacher_of_class(class_id)
			// passing on a class teacherB legitimately teaches does not, by
			// itself, authorize writing history against a DIFFERENT class's
			// instance/student just because that class_id was submitted instead
			// of the instance's real one.
			const { data: classB, error: classBError } = await admin.client
				.from('classes')
				.insert({
					name: 'Story 3-1 Class B (mismatch)',
					code: `HB${crypto.randomUUID().slice(0, 4).toUpperCase()}`
				})
				.select('id')
				.single();
			expect(classBError).toBeNull();
			const classBId = classB!.id;

			const { error: assignBError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: classBId, teacher_id: teacherB.id });
			expect(assignBError).toBeNull();

			const student = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Mismatch Target ${crypto.randomUUID().slice(0, 6)}`
			});

			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const instanceId = await createHomeworkInstance({
				assignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});
			await teacherA.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student,
				class_id: classAId,
				status: 'assigned',
				recorded_by: teacherA.id
			});

			// teacherB legitimately teaches classB (is_teacher_of_class(classBId)
			// passes) but submits classA's real instance_id/student_id alongside
			// classB's id as class_id.
			const doneAttempt = await teacherB.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student,
				class_id: classBId,
				status: 'done',
				recorded_by: teacherB.id
			});
			expect(doneAttempt.error).not.toBeNull();

			const reviewedAttempt = await teacherB.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student,
				class_id: classBId,
				status: 'reviewed',
				recorded_by: teacherB.id
			});
			expect(reviewedAttempt.error).not.toBeNull();

			// Also try the initial 'assigned' row shape against a fresh instance,
			// same mismatch -- the class_id/instance match check applies to every
			// branch, not just done/reviewed.
			const otherAssignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const otherInstanceId = await createHomeworkInstance({
				assignmentId: otherAssignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});
			const otherStudent = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Mismatch Assigned ${crypto.randomUUID().slice(0, 6)}`
			});
			const assignedAttempt = await teacherB.client.from('homework_status_history').insert({
				instance_id: otherInstanceId,
				student_id: otherStudent,
				class_id: classBId,
				status: 'assigned',
				recorded_by: teacherB.id
			});
			expect(assignedAttempt.error).not.toBeNull();

			const { data: rows } = await adminClient
				.from('homework_status_history')
				.select('id')
				.in('instance_id', [instanceId, otherInstanceId])
				.neq('status', 'assigned');
			expect(rows).toEqual([]);
		});

		it("reviewed requires a prior 'done' row: marking Reviewed before Done is rejected", async () => {
			const student = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Reviewed Without Done ${crypto.randomUUID().slice(0, 6)}`
			});

			const assignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const instanceId = await createHomeworkInstance({
				assignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});
			await teacherA.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student,
				class_id: classAId,
				status: 'assigned',
				recorded_by: teacherA.id
			});

			// No 'done' row exists yet -- Reviewed is attempted directly.
			const { error } = await teacherA.client.from('homework_status_history').insert({
				instance_id: instanceId,
				student_id: student,
				class_id: classAId,
				status: 'reviewed',
				recorded_by: teacherA.id
			});
			expect(error).not.toBeNull();

			const { data: rows } = await adminClient
				.from('homework_status_history')
				.select('status')
				.eq('instance_id', instanceId)
				.eq('student_id', student);
			expect((rows ?? []).map((r) => r.status)).toEqual(['assigned']);
		});

		it('is_targeted_for_homework_instance/assignment: a signed-in student sees only the assignments/instances they are targeted by, directly selecting both tables', async () => {
			const student = await createSignedInStudent({
				classId: classAId,
				name: `Direct Select ${crypto.randomUUID().slice(0, 6)}`
			});

			const targetedAssignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const targetedInstanceId = await createHomeworkInstance({
				assignmentId: targetedAssignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});
			await teacherA.client.from('homework_status_history').insert({
				instance_id: targetedInstanceId,
				student_id: student.id,
				class_id: classAId,
				status: 'assigned',
				recorded_by: teacherA.id
			});

			// A second assignment/instance the student is never targeted by (no
			// homework_status_history row for them at all).
			const untargetedAssignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const untargetedInstanceId = await createHomeworkInstance({
				assignmentId: untargetedAssignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: '2026-09-20'
			});

			const seenAssignments = await student.client
				.from('homework_assignments')
				.select('id')
				.in('id', [targetedAssignmentId, untargetedAssignmentId]);
			expect(seenAssignments.error).toBeNull();
			expect((seenAssignments.data ?? []).map((r) => r.id)).toEqual([targetedAssignmentId]);

			const seenInstances = await student.client
				.from('homework_instances')
				.select('id')
				.in('id', [targetedInstanceId, untargetedInstanceId]);
			expect(seenInstances.error).toBeNull();
			expect((seenInstances.data ?? []).map((r) => r.id)).toEqual([targetedInstanceId]);
		});

		it('homework_lookahead_days bounds visibility: an instance due just inside the window is included, one just outside is excluded', async () => {
			const { data: setting } = await adminClient
				.from('app_settings')
				.select('value')
				.eq('key', 'homework_lookahead_days')
				.single();
			const settingValue = setting?.value as { days?: number } | undefined;
			const lookaheadDays = settingValue?.days ?? 14;

			const today = new Date().toISOString().slice(0, 10);
			const addDays = (base: string, days: number) => {
				const d = new Date(`${base}T00:00:00Z`);
				d.setUTCDate(d.getUTCDate() + days);
				return d.toISOString().slice(0, 10);
			};
			const cutoffDate = addDays(today, lookaheadDays);
			const insideDueDate = cutoffDate; // exactly at the cutoff, inclusive (<=)
			const outsideDueDate = addDays(cutoffDate, 1); // one day beyond it

			const student = await createSignedInStudent({
				classId: classAId,
				name: `Lookahead ${crypto.randomUUID().slice(0, 6)}`
			});

			const insideAssignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const insideInstanceId = await createHomeworkInstance({
				assignmentId: insideAssignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: insideDueDate
			});
			await teacherA.client.from('homework_status_history').insert({
				instance_id: insideInstanceId,
				student_id: student.id,
				class_id: classAId,
				status: 'assigned',
				recorded_by: teacherA.id
			});

			const outsideAssignmentId = await createHomeworkAssignment({
				classId: classAId,
				createdBy: teacherA
			});
			const outsideInstanceId = await createHomeworkInstance({
				assignmentId: outsideAssignmentId,
				classId: classAId,
				client: teacherA.client,
				dueDate: outsideDueDate
			});
			await teacherA.client.from('homework_status_history').insert({
				instance_id: outsideInstanceId,
				student_id: student.id,
				class_id: classAId,
				status: 'assigned',
				recorded_by: teacherA.id
			});

			// Mirrors src/routes/student/+page.server.ts's load() query shape
			// exactly (due_date <= cutoff, not archived).
			const { data: visible, error } = await student.client
				.from('homework_instances')
				.select('id')
				.in('id', [insideInstanceId, outsideInstanceId])
				.lte('due_date', cutoffDate)
				.is('archived_at', null);

			expect(error).toBeNull();
			const visibleIds = (visible ?? []).map((r) => r.id);
			expect(visibleIds).toContain(insideInstanceId);
			expect(visibleIds).not.toContain(outsideInstanceId);
		});
	}
);

describe.skipIf(!reachable)(
	'Story 3-2 recurring homework assignments (requires local Supabase)',
	() => {
		let admin: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacherB: Awaited<ReturnType<typeof createSignedInUser>>;
		let classAId: string;
		let teamId: string;

		/** Same shape as the Story 2-1/3-1 blocks' local createStudent. */
		async function createStudent(params: {
			classId: string;
			status: 'pending' | 'approved' | 'rejected';
			name: string;
		}) {
			const email = `story-3-2-student-${crypto.randomUUID()}@students.internal.invalid`;
			const { data, error } = await adminClient.auth.admin.createUser({
				email,
				password: crypto.randomUUID(),
				email_confirm: true,
				user_metadata: { role: 'student' }
			});
			if (error || !data.user) {
				throw new Error(`Failed to create student: ${error?.message}`);
			}

			const update: Database['public']['Tables']['profiles']['Update'] = {
				class_id: params.classId,
				status: params.status,
				registration_name: params.name,
				display_name: params.name
			};
			if (params.status === 'approved') {
				update.team_id = teamId;
			}

			const { error: updateError } = await adminClient
				.from('profiles')
				.update(update)
				.eq('id', data.user.id);
			if (updateError) {
				throw new Error(`Failed to set up student: ${updateError.message}`);
			}

			return data.user.id;
		}

		function addDays(isoDate: string, days: number): string {
			const d = new Date(`${isoDate}T00:00:00Z`);
			d.setUTCDate(d.getUTCDate() + days);
			return d.toISOString().slice(0, 10);
		}

		/**
		 * Creates a recurring assignment directly via teacherA's own client
		 * (not a service-role bypass) -- homework_assignments' INSERT policy
		 * (Story 3-1) places no restriction on recurrence_rule/
		 * recurrence_start_date/due_offset_days, only homework_instances'
		 * AD-8 policy does, so this exercises the exact same direct-lane path
		 * the real createAssignment action (weekly mode) uses.
		 */
		async function createRecurringAssignment(params: {
			classId: string;
			createdBy: { id: string; client: ReturnType<typeof anonClient> };
			startDate: string;
			dueOffsetDays: number;
			title?: string;
		}) {
			const { data, error } = await params.createdBy.client
				.from('homework_assignments')
				.insert({
					class_id: params.classId,
					title: params.title ?? `Recurring ${crypto.randomUUID().slice(0, 6)}`,
					skill_area: 'language',
					created_by: params.createdBy.id,
					recurrence_rule: { frequency: 'weekly' },
					recurrence_start_date: params.startDate,
					due_offset_days: params.dueOffsetDays
				})
				.select('id')
				.single();
			if (error || !data) {
				throw new Error(`Failed to create recurring assignment: ${error?.message}`);
			}
			return data.id as string;
		}

		async function runGenerator(): Promise<number> {
			const { data, error } = await adminClient.rpc('generate_recurring_homework_instances');
			if (error) {
				throw new Error(`Generator call failed: ${error.message}`);
			}
			return data as number;
		}

		beforeAll(async () => {
			admin = await createSignedInUser('admin');
			teacherA = await createSignedInUser('teacher');
			teacherB = await createSignedInUser('teacher');

			const { data: classA, error: classAError } = await admin.client
				.from('classes')
				.insert({
					name: 'Story 3-2 Class A',
					code: `RH${crypto.randomUUID().slice(0, 4).toUpperCase()}`
				})
				.select('id')
				.single();
			if (classAError || !classA)
				throw new Error(`Failed to create Class A: ${classAError?.message}`);
			classAId = classA.id;

			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: classAId, teacher_id: teacherA.id });
			if (assignError) throw new Error(`Failed to assign teacherA: ${assignError.message}`);

			const { data: team, error: teamError } = await admin.client
				.from('teams')
				.insert({ name: `Story 3-2 Team ${crypto.randomUUID().slice(0, 6)}` })
				.select('id')
				.single();
			if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
			teamId = team.id;
		}, 30000);

		it('creating a recurring assignment sets recurrence_rule/start_date/offset and creates no instance yet', async () => {
			const today = new Date().toISOString().slice(0, 10);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 3
			});

			const { data: assignment } = await adminClient
				.from('homework_assignments')
				.select('recurrence_rule, recurrence_start_date, due_offset_days')
				.eq('id', assignmentId)
				.single();
			expect(assignment?.recurrence_rule).toEqual({ frequency: 'weekly' });
			expect(assignment?.recurrence_start_date).toBe(today);
			expect(assignment?.due_offset_days).toBe(3);

			// Intent: "no instance created yet (generator creates the first on
			// its next run, not synchronously)".
			const { data: instances } = await adminClient
				.from('homework_instances')
				.select('id')
				.eq('assignment_id', assignmentId);
			expect(instances).toEqual([]);
		});

		it('generator creates a due instance with fresh assigned rows for the then-current approved roster only, due_date = period_start + due_offset_days', async () => {
			const approved = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Recurring Approved ${crypto.randomUUID().slice(0, 6)}`
			});
			const pending = await createStudent({
				classId: classAId,
				status: 'pending',
				name: `Recurring Pending ${crypto.randomUUID().slice(0, 6)}`
			});

			const today = new Date().toISOString().slice(0, 10);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 4
			});

			await runGenerator();

			const { data: instances } = await adminClient
				.from('homework_instances')
				.select('id, period_start, due_date')
				.eq('assignment_id', assignmentId);
			expect(instances).toHaveLength(1);
			expect(instances?.[0].period_start).toBe(today);
			expect(instances?.[0].due_date).toBe(addDays(today, 4));

			const { data: assignedRows } = await adminClient
				.from('homework_status_history')
				.select('student_id, status, recorded_by')
				.eq('instance_id', instances![0].id);
			const assignedStudentIds = (assignedRows ?? [])
				.filter((r) => r.status === 'assigned')
				.map((r) => r.student_id);
			expect(assignedStudentIds).toContain(approved);
			expect(assignedStudentIds).not.toContain(pending);
			// System-generated, not a teacher/admin action -- no acting user.
			expect((assignedRows ?? []).every((r) => r.recorded_by === null)).toBe(true);
		});

		it('generator run again does not create a duplicate instance for an already-generated period (AD-8 UNIQUE backstop)', async () => {
			const today = new Date().toISOString().slice(0, 10);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 0
			});

			await runGenerator();
			await runGenerator();
			await runGenerator();

			const { data: instances } = await adminClient
				.from('homework_instances')
				.select('id')
				.eq('assignment_id', assignmentId);
			expect(instances).toHaveLength(1);
		});

		it("a later generator run never touches an earlier instance's Done status, even when it creates a second instance in the same run", async () => {
			const student = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `Later Run Unaffected ${crypto.randomUUID().slice(0, 6)}`
			});

			// Start date 8 days ago: two weekly periods (today-8, today-1) are
			// both already due, so a single generator call creates both at
			// once -- this is what lets this test observe "a later period's
			// creation" deterministically, without needing to wait a real
			// week (see the comment on the due-offset tests below for the
			// same constraint).
			const today = new Date().toISOString().slice(0, 10);
			const startDate = addDays(today, -8);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate,
				dueOffsetDays: 0
			});

			await runGenerator();

			const { data: instances } = await adminClient
				.from('homework_instances')
				.select('id, period_start')
				.eq('assignment_id', assignmentId)
				.order('period_start', { ascending: true });
			expect(instances).toHaveLength(2);
			const earlierInstance = instances![0];
			const laterInstance = instances![1];

			await teacherA.client.from('homework_status_history').insert({
				instance_id: earlierInstance.id,
				student_id: student,
				class_id: classAId,
				status: 'done',
				recorded_by: teacherA.id
			});

			// Re-running the generator is a no-op here (both periods already
			// exist, AD-8) -- this asserts that even a run that legitimately
			// re-evaluates a later period never rewrites the earlier
			// instance's already-recorded Done status.
			await runGenerator();

			const { data: earlierRows } = await adminClient
				.from('homework_status_history')
				.select('status')
				.eq('instance_id', earlierInstance.id)
				.eq('student_id', student);
			expect((earlierRows ?? []).map((r) => r.status).sort()).toEqual(['assigned', 'done'].sort());

			const { data: laterRows } = await adminClient
				.from('homework_status_history')
				.select('status')
				.eq('instance_id', laterInstance.id)
				.eq('student_id', student);
			expect((laterRows ?? []).map((r) => r.status)).toEqual(['assigned']);
		});

		it('editing the series title/link never writes to homework_instances -- both an already-generated instance and the series row reflect the edit independently on next read', async () => {
			const today = new Date().toISOString().slice(0, 10);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 2,
				title: 'Original Series Title'
			});
			await runGenerator();

			const { data: before } = await adminClient
				.from('homework_instances')
				.select('id, period_start, due_date, created_at')
				.eq('assignment_id', assignmentId)
				.single();

			const { error: updateError } = await teacherA.client
				.from('homework_assignments')
				.update({ title: 'Updated Series Title', reference_link: 'https://example.test/updated' })
				.eq('id', assignmentId);
			expect(updateError).toBeNull();

			const { data: assignment } = await adminClient
				.from('homework_assignments')
				.select('title, reference_link')
				.eq('id', assignmentId)
				.single();
			expect(assignment?.title).toBe('Updated Series Title');
			expect(assignment?.reference_link).toBe('https://example.test/updated');

			// The instance row itself is byte-for-byte unchanged -- no UPDATE
			// statement in this codebase ever targets homework_instances for a
			// series edit (Always boundary).
			const { data: after } = await adminClient
				.from('homework_instances')
				.select('id, period_start, due_date, created_at')
				.eq('assignment_id', assignmentId)
				.single();
			expect(after).toEqual(before);
		});

		it("editing due_offset_days never rewrites an already-generated instance's due_date, and the generator reads the offset fresh per assignment at generation time", async () => {
			const today = new Date().toISOString().slice(0, 10);

			// Half 1 (deterministic, no time travel needed): generate an
			// instance under offset=2, edit the series to offset=9, confirm
			// the existing instance's due_date is untouched.
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 2
			});
			await runGenerator();

			const { data: instanceBefore } = await adminClient
				.from('homework_instances')
				.select('due_date')
				.eq('assignment_id', assignmentId)
				.single();
			expect(instanceBefore?.due_date).toBe(addDays(today, 2));

			const { error: editError } = await teacherA.client
				.from('homework_assignments')
				.update({ due_offset_days: 9 })
				.eq('id', assignmentId);
			expect(editError).toBeNull();

			// No new period is due yet (next period is 7 days out), so this is
			// a no-op for instance creation -- it only proves the edit alone
			// does not retroactively touch the existing row.
			await runGenerator();

			const { data: instanceAfter } = await adminClient
				.from('homework_instances')
				.select('due_date')
				.eq('assignment_id', assignmentId)
				.single();
			expect(instanceAfter?.due_date).toBe(addDays(today, 2));

			// Half 2: the generator computes due_date = period_start +
			// due_offset_days fresh from EACH assignment row at the moment it
			// generates that assignment's instance -- proven here with a
			// second, independent assignment using a different offset,
			// generated in the same run as the first. This is the mechanism
			// that makes Half 1's guarantee true without needing to actually
			// wait a calendar week between two real generator runs on the
			// same series (this test harness has no fake clock).
			const secondAssignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 11
			});
			await runGenerator();

			const { data: secondInstance } = await adminClient
				.from('homework_instances')
				.select('due_date')
				.eq('assignment_id', secondAssignmentId)
				.single();
			expect(secondInstance?.due_date).toBe(addDays(today, 11));
		});

		it('pausing a series (paused_at set) stops the generator from creating any instance for it, even an already-due one', async () => {
			const today = new Date().toISOString().slice(0, 10);
			const startDate = addDays(today, -8);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate,
				dueOffsetDays: 0
			});

			// Paused before the generator ever runs for it -- two real periods
			// are already due (today-8, today-1) and would otherwise be
			// created.
			const { error: pauseError } = await teacherA.client
				.from('homework_assignments')
				.update({ paused_at: new Date().toISOString() })
				.eq('id', assignmentId);
			expect(pauseError).toBeNull();

			await runGenerator();

			const { data: instances } = await adminClient
				.from('homework_instances')
				.select('id')
				.eq('assignment_id', assignmentId);
			expect(instances).toEqual([]);
		});

		it('ending a series after instances already exist never touches those already-generated instances', async () => {
			const today = new Date().toISOString().slice(0, 10);
			const startDate = addDays(today, -8);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate,
				dueOffsetDays: 0
			});

			// First period (today-8) generated normally, before any end date.
			await runGenerator();
			const { data: firstRunInstances } = await adminClient
				.from('homework_instances')
				.select('id, period_start, created_at')
				.eq('assignment_id', assignmentId);
			expect(firstRunInstances).toHaveLength(2); // today-8 and today-1, both already due

			const preEndSnapshot = [...(firstRunInstances ?? [])].sort((a, b) =>
				a.period_start.localeCompare(b.period_start)
			);

			// Now end the series as of today-8 -- only the already-generated
			// today-8 period stays valid; today-1 (already generated above,
			// before the end date was set) must remain exactly as-is (Never:
			// ending never touches already-generated instances).
			const { error: endError } = await teacherA.client
				.from('homework_assignments')
				.update({ ends_on: startDate })
				.eq('id', assignmentId);
			expect(endError).toBeNull();

			await runGenerator();

			const { data: afterEndInstances } = await adminClient
				.from('homework_instances')
				.select('id, period_start, created_at')
				.eq('assignment_id', assignmentId)
				.order('period_start', { ascending: true });
			// No new instance was added (there were none pending anyway, both
			// already existed) and neither existing row was touched.
			expect(afterEndInstances).toEqual(preEndSnapshot);
		});

		it('ending a series before its first generator run stops periods after ends_on, while periods at/before it still generate', async () => {
			const today = new Date().toISOString().slice(0, 10);
			const startDate = addDays(today, -8); // periods: today-8, today-1
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate,
				dueOffsetDays: 0
			});

			// ends_on = today-8: excludes the today-1 period (> ends_on),
			// keeps the today-8 period (<= ends_on) -- proves the boundary is
			// evaluated per-period, not "skip the whole series if any period
			// is past ends_on".
			const { error: endError } = await teacherA.client
				.from('homework_assignments')
				.update({ ends_on: startDate })
				.eq('id', assignmentId);
			expect(endError).toBeNull();

			await runGenerator();

			const { data: instances } = await adminClient
				.from('homework_instances')
				.select('period_start')
				.eq('assignment_id', assignmentId);
			expect(instances).toHaveLength(1);
			expect(instances?.[0].period_start).toBe(startDate);
		});

		it('a direct client insert into homework_instances for a recurring assignment is still rejected (AD-8, Story 3-1 restriction unchanged)', async () => {
			const today = new Date().toISOString().slice(0, 10);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 0
			});

			const { error } = await teacherA.client.from('homework_instances').insert({
				assignment_id: assignmentId,
				class_id: classAId,
				period_start: today,
				due_date: today
			});
			expect(error).not.toBeNull();

			const { data: rows } = await adminClient
				.from('homework_instances')
				.select('id')
				.eq('assignment_id', assignmentId);
			expect(rows).toEqual([]);
		});

		it('generate_recurring_homework_instances() cannot be invoked by an authenticated client -- only the trusted service-role/pg_cron path can call it', async () => {
			const { error } = await teacherA.client.rpc('generate_recurring_homework_instances');
			expect(error).not.toBeNull();

			const adminAttempt = await admin.client.rpc('generate_recurring_homework_instances');
			expect(adminAttempt.error).not.toBeNull();
		});

		it('column-privilege fix: an authorized teacher cannot UPDATE due_date/period_start on homework_instances, even though they can UPDATE archived_at/archived_by (deferred Story 3-1 gap, now closed)', async () => {
			const today = new Date().toISOString().slice(0, 10);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 0
			});
			await runGenerator();

			const { data: instance } = await adminClient
				.from('homework_instances')
				.select('id, due_date, period_start')
				.eq('assignment_id', assignmentId)
				.single();

			// Column-privilege failure, not an RLS row-filter -- surfaces as a
			// real error (PostgREST propagates Postgres' permission-denied),
			// not silent zero-rows-affected.
			const dueDateAttempt = await teacherA.client
				.from('homework_instances')
				.update({ due_date: addDays(today, 30) })
				.eq('id', instance!.id);
			expect(dueDateAttempt.error).not.toBeNull();

			const periodStartAttempt = await teacherA.client
				.from('homework_instances')
				.update({ period_start: addDays(today, -30) })
				.eq('id', instance!.id);
			expect(periodStartAttempt.error).not.toBeNull();

			// The column-level REVOKE applies to the `authenticated` Postgres
			// role broadly, not just teachers -- the I/O matrix's own row says
			// "admin or assigned teacher", so this must be rejected for admin
			// too, not only for teacherA (review finding #10).
			const adminDueDateAttempt = await admin.client
				.from('homework_instances')
				.update({ due_date: addDays(today, 30) })
				.eq('id', instance!.id);
			expect(adminDueDateAttempt.error).not.toBeNull();

			const adminPeriodStartAttempt = await admin.client
				.from('homework_instances')
				.update({ period_start: addDays(today, -30) })
				.eq('id', instance!.id);
			expect(adminPeriodStartAttempt.error).not.toBeNull();

			// The narrow archived_at/archived_by grant still works (Story 3-1
			// behavior preserved).
			const archiveAttempt = await teacherA.client
				.from('homework_instances')
				.update({ archived_at: new Date().toISOString(), archived_by: teacherA.id })
				.eq('id', instance!.id)
				.select('archived_at')
				.single();
			expect(archiveAttempt.error).toBeNull();
			expect(archiveAttempt.data?.archived_at).not.toBeNull();

			const { data: unchanged } = await adminClient
				.from('homework_instances')
				.select('due_date, period_start')
				.eq('id', instance!.id)
				.single();
			expect(unchanged?.due_date).toBe(instance!.due_date);
			expect(unchanged?.period_start).toBe(instance!.period_start);
		});

		it('a teacher not assigned to the class cannot pause/end/edit a series, and cannot read a recurring assignment scoped to a different class', async () => {
			const today = new Date().toISOString().slice(0, 10);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 0
			});

			const pauseAttempt = await teacherB.client
				.from('homework_assignments')
				.update({ paused_at: new Date().toISOString() })
				.eq('id', assignmentId)
				.select('id');
			expect(pauseAttempt.error).toBeNull();
			expect(pauseAttempt.data).toEqual([]);

			const endAttempt = await teacherB.client
				.from('homework_assignments')
				.update({ ends_on: today })
				.eq('id', assignmentId)
				.select('id');
			expect(endAttempt.error).toBeNull();
			expect(endAttempt.data).toEqual([]);

			const editAttempt = await teacherB.client
				.from('homework_assignments')
				.update({ title: 'Hijacked Title' })
				.eq('id', assignmentId)
				.select('id');
			expect(editAttempt.error).toBeNull();
			expect(editAttempt.data).toEqual([]);

			const { data: stillUntouched } = await adminClient
				.from('homework_assignments')
				.select('paused_at, ends_on, title')
				.eq('id', assignmentId)
				.single();
			expect(stillUntouched?.paused_at).toBeNull();
			expect(stillUntouched?.ends_on).toBeNull();
			expect(stillUntouched?.title).not.toBe('Hijacked Title');

			const readAttempt = await teacherB.client
				.from('homework_assignments')
				.select('id')
				.eq('id', assignmentId);
			expect(readAttempt.data).toEqual([]);
		});
	}
);

describe.skipIf(!reachable)('Story 4-1 streaks (requires local Supabase)', () => {
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacherB: Awaited<ReturnType<typeof createSignedInUser>>;
	let teamId: string;
	let originalGraceWeeksValue: Database['public']['Tables']['app_settings']['Row']['value'];

	/**
	 * Every scenario below gets its own fresh class (rather than sharing one
	 * classAId the way earlier blocks do) -- recompute_student_streak()'s
	 * class-wide holiday exclusion and grace consumption are both scoped to
	 * class_id across *all* of a class's attendance_records rows, so two
	 * scenarios sharing a class could otherwise silently interact via each
	 * other's session weeks.
	 */
	async function createClass(prefix: string) {
		const { data, error } = await admin.client
			.from('classes')
			.insert({
				name: `Story 4-1 ${prefix}`,
				code: `S4${crypto.randomUUID().slice(0, 4).toUpperCase()}`
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		const classId = data.id as string;

		const { error: assignError } = await admin.client
			.from('class_teachers')
			.insert({ class_id: classId, teacher_id: teacherA.id });
		if (assignError) throw new Error(`Failed to assign teacherA: ${assignError.message}`);

		return classId;
	}

	/** Same shape as the Story 2-1/3-1/3-2 blocks' local createStudent. */
	async function createStudent(params: { classId: string; name: string }) {
		const email = `story-4-1-student-${crypto.randomUUID()}@students.internal.invalid`;
		const { data, error } = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			user_metadata: { role: 'student' }
		});
		if (error || !data.user) {
			throw new Error(`Failed to create student: ${error?.message}`);
		}

		const { error: updateError } = await adminClient
			.from('profiles')
			.update({
				class_id: params.classId,
				status: 'approved',
				registration_name: params.name,
				display_name: params.name,
				team_id: teamId
			})
			.eq('id', data.user.id);
		if (updateError) {
			throw new Error(`Failed to set up student: ${updateError.message}`);
		}

		return data.user.id;
	}

	/**
	 * Same as createStudent, but also signs in -- needed for the RLS
	 * self-read test below, which must exercise student_streaks_select_
	 * admin_teacher_or_own's `student_id = auth.uid()` branch as the real
	 * student, not via the service-role client.
	 */
	async function createSignedInStudent(params: { classId: string; name: string }) {
		const email = `story-4-1-signedin-student-${crypto.randomUUID()}@students.internal.invalid`;
		const password = crypto.randomUUID();

		const { data, error } = await adminClient.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
			user_metadata: { role: 'student' }
		});
		if (error || !data.user) {
			throw new Error(`Failed to create signed-in student: ${error?.message}`);
		}

		const { error: updateError } = await adminClient
			.from('profiles')
			.update({
				class_id: params.classId,
				status: 'approved',
				registration_name: params.name,
				display_name: params.name,
				team_id: teamId
			})
			.eq('id', data.user.id);
		if (updateError) {
			throw new Error(`Failed to set up signed-in student: ${updateError.message}`);
		}

		const client = anonClient();
		const { error: signInError } = await client.auth.signInWithPassword({ email, password });
		if (signInError) {
			throw new Error(`Failed to sign in student: ${signInError.message}`);
		}

		return { id: data.user.id, email, client };
	}

	function addDays(isoDate: string, days: number): string {
		const d = new Date(`${isoDate}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().slice(0, 10);
	}

	/** Mirrors the migration's date_trunc('week', ...) -- Monday of the ISO week containing isoDate. */
	function mondayOf(isoDate: string): string {
		const d = new Date(`${isoDate}T00:00:00Z`);
		const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
		const diffFromMonday = day === 0 ? 6 : day - 1;
		d.setUTCDate(d.getUTCDate() - diffFromMonday);
		return d.toISOString().slice(0, 10);
	}

	const today = new Date().toISOString().slice(0, 10);
	/** ISO date for the Nth week offset from today (0 = this week, -1 = last week, ...). */
	function weekOffset(n: number): string {
		return addDays(today, n * 7);
	}

	/**
	 * Fires attendance_records_recompute_streak via a direct service-role
	 * insert (bypasses attendance_records' own RLS, which this story doesn't
	 * re-test -- Stories 2-1/3-1 already cover it). The trigger fires
	 * identically regardless of which role performed the insert.
	 */
	async function markAttendance(params: {
		studentId: string;
		classId: string;
		sessionDate: string;
		present: boolean;
	}) {
		const { error } = await adminClient.from('attendance_records').insert({
			student_id: params.studentId,
			class_id: params.classId,
			session_date: params.sessionDate,
			present: params.present,
			recorded_by: teacherA.id
		});
		if (error) throw new Error(`Failed to mark attendance: ${error.message}`);
	}

	/** One-off homework assignment, service-role, reused across a scenario's weeks. */
	async function createAssignment(classId: string) {
		const { data, error } = await adminClient
			.from('homework_assignments')
			.insert({
				class_id: classId,
				title: `Story 4-1 HW ${crypto.randomUUID().slice(0, 6)}`,
				skill_area: 'language',
				created_by: teacherA.id
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create assignment: ${error?.message}`);
		return data.id as string;
	}

	async function createInstance(params: {
		assignmentId: string;
		classId: string;
		periodStart: string;
	}) {
		const { data, error } = await adminClient
			.from('homework_instances')
			.insert({
				assignment_id: params.assignmentId,
				class_id: params.classId,
				period_start: params.periodStart,
				due_date: addDays(params.periodStart, 3)
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create homework instance: ${error?.message}`);
		return data.id as string;
	}

	async function markHomeworkDone(params: {
		instanceId: string;
		studentId: string;
		classId: string;
		recordedBy?: string;
	}) {
		// The initial 'assigned' row is always inserted first (Code Map /
		// 0004's own history shape) -- a 'done' row with no prior 'assigned'
		// row is not a state this story's trigger needs to handle specially,
		// but every other story's fixtures maintain this shape, so this one
		// does too for realism.
		const { error: assignedError } = await adminClient.from('homework_status_history').insert({
			instance_id: params.instanceId,
			student_id: params.studentId,
			class_id: params.classId,
			status: 'assigned',
			recorded_by: teacherA.id
		});
		if (assignedError) throw new Error(`Failed to insert assigned row: ${assignedError.message}`);

		const { error: doneError } = await adminClient.from('homework_status_history').insert({
			instance_id: params.instanceId,
			student_id: params.studentId,
			class_id: params.classId,
			status: 'done',
			recorded_by: params.recordedBy ?? params.studentId
		});
		if (doneError) throw new Error(`Failed to insert done row: ${doneError.message}`);
	}

	/** Reads current_streak/last_qualifying_week via the service-role client (no RLS involved). */
	async function readStreak(studentId: string) {
		const { data, error } = await adminClient
			.from('student_streaks')
			.select('current_streak, last_qualifying_week')
			.eq('student_id', studentId)
			.maybeSingle();
		if (error) throw new Error(`Failed to read streak: ${error.message}`);
		return data;
	}

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacherA = await createSignedInUser('teacher');
		teacherB = await createSignedInUser('teacher');

		const { data: team, error: teamError } = await admin.client
			.from('teams')
			.insert({ name: `Story 4-1 Team ${crypto.randomUUID().slice(0, 6)}` })
			.select('id')
			.single();
		if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
		teamId = team.id;

		const { data: settingRow, error: settingError } = await adminClient
			.from('app_settings')
			.select('value')
			.eq('key', 'streak_grace_weeks')
			.single();
		if (settingError || !settingRow)
			throw new Error(`Failed to read streak_grace_weeks: ${settingError?.message}`);
		originalGraceWeeksValue = settingRow.value;
		expect((originalGraceWeeksValue as { weeks?: number }).weeks).toBe(2);
	}, 30000);

	it('attendance then homework Done landing in the same week increments the streak exactly once, regardless of mark order', async () => {
		const classId = await createClass('Same Week A');
		const student = await createStudent({
			classId,
			name: `Same Week Attendance First ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);
		const instanceId = await createInstance({ assignmentId, classId, periodStart: weekOffset(0) });

		await markAttendance({
			studentId: student,
			classId,
			sessionDate: weekOffset(0),
			present: true
		});
		let streak = await readStreak(student);
		// Only attendance has landed so far -- I/O matrix: "Streak does not
		// increment for that week until the missing condition also lands".
		expect(streak?.current_streak ?? 0).toBe(0);

		await markHomeworkDone({ instanceId, studentId: student, classId });
		streak = await readStreak(student);
		expect(streak?.current_streak).toBe(1);
		expect(streak?.last_qualifying_week).toBe(mondayOf(weekOffset(0)));
	});

	it('homework Done landing before attendance in the same week produces the identical end state (mark order does not matter)', async () => {
		const classId = await createClass('Same Week B');
		const student = await createStudent({
			classId,
			name: `Same Week Homework First ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);
		const instanceId = await createInstance({ assignmentId, classId, periodStart: weekOffset(0) });

		await markHomeworkDone({ instanceId, studentId: student, classId });
		let streak = await readStreak(student);
		expect(streak?.current_streak ?? 0).toBe(0);

		await markAttendance({
			studentId: student,
			classId,
			sessionDate: weekOffset(0),
			present: true
		});
		streak = await readStreak(student);
		expect(streak?.current_streak).toBe(1);
	});

	it('a multi-week consecutive qualifying run accumulates the full count', async () => {
		const classId = await createClass('Consecutive Run');
		const student = await createStudent({
			classId,
			name: `Consecutive ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);

		for (const offset of [-3, -2, -1, 0]) {
			const periodStart = weekOffset(offset);
			const instanceId = await createInstance({ assignmentId, classId, periodStart });
			await markAttendance({
				studentId: student,
				classId,
				sessionDate: periodStart,
				present: true
			});
			await markHomeworkDone({ instanceId, studentId: student, classId });
		}

		const streak = await readStreak(student);
		expect(streak?.current_streak).toBe(4);
		expect(streak?.last_qualifying_week).toBe(mondayOf(weekOffset(0)));
	});

	it('a single missed week (fewer than streak_grace_weeks) preserves the streak across the gap rather than resetting it', async () => {
		const classId = await createClass('Grace Preserved');
		const student = await createStudent({
			classId,
			name: `Grace Preserved ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);

		for (const offset of [-4, -3]) {
			const periodStart = weekOffset(offset);
			const instanceId = await createInstance({ assignmentId, classId, periodStart });
			await markAttendance({
				studentId: student,
				classId,
				sessionDate: periodStart,
				present: true
			});
			await markHomeworkDone({ instanceId, studentId: student, classId });
		}

		// Week -2: the class holds a session (attendance row exists), but
		// this student misses both conditions entirely -- a real, grace-
		// consuming miss, not a holiday.
		await markAttendance({
			studentId: student,
			classId,
			sessionDate: weekOffset(-2),
			present: false
		});

		for (const offset of [-1, 0]) {
			const periodStart = weekOffset(offset);
			const instanceId = await createInstance({ assignmentId, classId, periodStart });
			await markAttendance({
				studentId: student,
				classId,
				sessionDate: periodStart,
				present: true
			});
			await markHomeworkDone({ instanceId, studentId: student, classId });
		}

		const streak = await readStreak(student);
		// 4 qualifying weeks (-4, -3, -1, 0); the single -2 miss is tolerated
		// (default streak_grace_weeks = 2) and does not itself count.
		expect(streak?.current_streak).toBe(4);
	});

	it('missing more consecutive weeks than streak_grace_weeks resets the streak to 0', async () => {
		const classId = await createClass('Grace Exceeded');
		const student = await createStudent({
			classId,
			name: `Grace Exceeded ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);

		const qualifyingPeriod = weekOffset(-4);
		const instanceId = await createInstance({
			assignmentId,
			classId,
			periodStart: qualifyingPeriod
		});
		await markAttendance({
			studentId: student,
			classId,
			sessionDate: qualifyingPeriod,
			present: true
		});
		await markHomeworkDone({ instanceId, studentId: student, classId });
		expect((await readStreak(student))?.current_streak).toBe(1);

		// 3 consecutive real misses (grace default = 2) -- each is its own
		// class session (present=false), never a holiday.
		for (const offset of [-3, -2, -1]) {
			await markAttendance({
				studentId: student,
				classId,
				sessionDate: weekOffset(offset),
				present: false
			});
		}

		const streak = await readStreak(student);
		expect(streak?.current_streak).toBe(0);
	});

	it('exercises the exact streak_grace_weeks = 2 boundary: 2 consecutive misses preserved, 3 resets to 0', async () => {
		const classId = await createClass('Grace Boundary');
		const preservedStudent = await createStudent({
			classId,
			name: `Grace Boundary Preserved ${crypto.randomUUID().slice(0, 6)}`
		});
		const resetStudent = await createStudent({
			classId,
			name: `Grace Boundary Reset ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);

		// Both students qualify at the same earlier week, then diverge: the
		// "preserved" student misses exactly 2 consecutive weeks (== the
		// shipped default streak_grace_weeks), the "reset" student misses 3.
		const qualifyingPeriod = weekOffset(-5);
		const instanceId = await createInstance({
			assignmentId,
			classId,
			periodStart: qualifyingPeriod
		});
		for (const student of [preservedStudent, resetStudent]) {
			await markAttendance({
				studentId: student,
				classId,
				sessionDate: qualifyingPeriod,
				present: true
			});
			await markHomeworkDone({ instanceId, studentId: student, classId });
		}

		for (const offset of [-4, -3]) {
			await markAttendance({
				studentId: preservedStudent,
				classId,
				sessionDate: weekOffset(offset),
				present: false
			});
		}
		for (const offset of [-4, -3, -2]) {
			await markAttendance({
				studentId: resetStudent,
				classId,
				sessionDate: weekOffset(offset),
				present: false
			});
		}

		expect((await readStreak(preservedStudent))?.current_streak).toBe(1);
		expect((await readStreak(resetStudent))?.current_streak).toBe(0);
	});

	it("a homework Done -> Reviewed transition does not change the streak (the recompute trigger only fires on status = 'done')", async () => {
		const classId = await createClass('Reviewed Transition');
		const student = await createStudent({
			classId,
			name: `Reviewed Transition ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);
		const periodStart = weekOffset(0);
		const instanceId = await createInstance({ assignmentId, classId, periodStart });

		await markAttendance({ studentId: student, classId, sessionDate: periodStart, present: true });
		await markHomeworkDone({ instanceId, studentId: student, classId });
		const before = await readStreak(student);
		expect(before?.current_streak).toBe(1);

		const { error: reviewedError } = await adminClient.from('homework_status_history').insert({
			instance_id: instanceId,
			student_id: student,
			class_id: classId,
			status: 'reviewed',
			recorded_by: teacherA.id
		});
		expect(reviewedError).toBeNull();

		const after = await readStreak(student);
		expect(after).toEqual(before);
	});

	it('a duplicate homework-done mark for an already-done instance (self + teacher on-behalf-of) does not affect the streak', async () => {
		const classId = await createClass('Duplicate Done');
		const student = await createStudent({
			classId,
			name: `Duplicate Done ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);
		const periodStart = weekOffset(0);
		const instanceId = await createInstance({ assignmentId, classId, periodStart });

		await markAttendance({ studentId: student, classId, sessionDate: periodStart, present: true });
		await markHomeworkDone({ instanceId, studentId: student, classId });
		const before = await readStreak(student);
		expect(before?.current_streak).toBe(1);

		// Teacher-on-behalf-of duplicate 'done' mark for the exact same
		// instance -- a second history row, same (student_id, instance_id)
		// pair.
		const { error: duplicateError } = await adminClient.from('homework_status_history').insert({
			instance_id: instanceId,
			student_id: student,
			class_id: classId,
			status: 'done',
			recorded_by: teacherA.id
		});
		expect(duplicateError).toBeNull();

		const after = await readStreak(student);
		expect(after?.current_streak).toBe(1);
		expect(after?.last_qualifying_week).toBe(before?.last_qualifying_week);
	});

	it('a week where the whole class holds zero sessions is excluded from grace consumption for every student in the class, even beyond streak_grace_weeks', async () => {
		const classId = await createClass('Holiday');
		const studentX = await createStudent({
			classId,
			name: `Holiday X ${crypto.randomUUID().slice(0, 6)}`
		});
		const studentY = await createStudent({
			classId,
			name: `Holiday Y ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);

		// One instance per period, shared by both students (homework_instances
		// is unique on (assignment_id, period_start) -- per-student marks land
		// as separate homework_status_history rows against the same instance).
		const earlyPeriod = weekOffset(-5);
		const earlyInstance = await createInstance({ assignmentId, classId, periodStart: earlyPeriod });
		for (const student of [studentX, studentY]) {
			await markAttendance({
				studentId: student,
				classId,
				sessionDate: earlyPeriod,
				present: true
			});
			await markHomeworkDone({ instanceId: earlyInstance, studentId: student, classId });
		}

		// Weeks -4, -3, -2, -1: no attendance_records row for this class at
		// all (for either student) -- a genuine class-wide holiday stretch, 4
		// weeks long (longer than the default streak_grace_weeks = 2), which
		// a real gap of that length would otherwise reset.

		const latePeriod = weekOffset(0);
		const lateInstance = await createInstance({ assignmentId, classId, periodStart: latePeriod });
		for (const student of [studentX, studentY]) {
			await markAttendance({ studentId: student, classId, sessionDate: latePeriod, present: true });
			await markHomeworkDone({ instanceId: lateInstance, studentId: student, classId });
		}

		for (const student of [studentX, studentY]) {
			const streak = await readStreak(student);
			// Both qualifying weeks (-5 and 0) count; the 3 holiday weeks in
			// between never consumed grace, so the streak survives fully
			// intact rather than resetting.
			expect(streak?.current_streak).toBe(2);
		}
	});

	it('a backdated attendance insert for a week behind the student’s last qualifying week is reflected by the next full recompute, not miscounted from a stale state', async () => {
		const classId = await createClass('Backdated Catchup');
		const student = await createStudent({
			classId,
			name: `Backdated ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);

		const earlierPeriod = weekOffset(-1);
		const earlierInstance = await createInstance({
			assignmentId,
			classId,
			periodStart: earlierPeriod
		});
		// Initially recorded absent -- the class did meet (a real session,
		// not a holiday), but this student's attendance mark is wrong.
		await markAttendance({
			studentId: student,
			classId,
			sessionDate: earlierPeriod,
			present: false
		});
		await markHomeworkDone({ instanceId: earlierInstance, studentId: student, classId });

		const laterPeriod = weekOffset(0);
		const laterInstance = await createInstance({ assignmentId, classId, periodStart: laterPeriod });
		await markAttendance({ studentId: student, classId, sessionDate: laterPeriod, present: true });
		await markHomeworkDone({ instanceId: laterInstance, studentId: student, classId });

		// Before the correction: only week 0 qualifies (week -1's homework
		// was Done, but attendance was marked absent).
		expect((await readStreak(student))?.current_streak).toBe(1);

		// Backdated catch-up: a new attendance_records row lands for the
		// same student/session_date, present=true -- append-only (AD-5), the
		// earlier present=false row is never edited in place.
		await markAttendance({
			studentId: student,
			classId,
			sessionDate: earlierPeriod,
			present: true
		});

		const streak = await readStreak(student);
		// Full recompute now finds week -1 qualifying too -- a stale
		// incremental counter would have stayed at 1.
		expect(streak?.current_streak).toBe(2);
		expect(streak?.last_qualifying_week).toBe(mondayOf(laterPeriod));
	});

	it('a direct client insert or update against student_streaks is rejected -- it is trigger-written only', async () => {
		const classId = await createClass('No Direct Writes');
		const student = await createStudent({
			classId,
			name: `No Direct Writes ${crypto.randomUUID().slice(0, 6)}`
		});

		const insertAttempt = await teacherA.client
			.from('student_streaks')
			.insert({ student_id: student, class_id: classId, current_streak: 99 });
		expect(insertAttempt.error).not.toBeNull();

		const adminInsertAttempt = await admin.client
			.from('student_streaks')
			.insert({ student_id: student, class_id: classId, current_streak: 99 });
		expect(adminInsertAttempt.error).not.toBeNull();

		// A trigger-created row to attempt an UPDATE against.
		await markAttendance({
			studentId: student,
			classId,
			sessionDate: weekOffset(0),
			present: true
		});

		const updateAttempt = await teacherA.client
			.from('student_streaks')
			.update({ current_streak: 999 })
			.eq('student_id', student);
		expect(updateAttempt.error).toBeNull(); // RLS denies by filtering, not by erroring
		expect(updateAttempt.data ?? []).toEqual([]);

		const { data: unchanged } = await adminClient
			.from('student_streaks')
			.select('current_streak')
			.eq('student_id', student)
			.single();
		expect(unchanged?.current_streak).not.toBe(999);
	});

	it('RLS: admin, the assigned teacher, and the student themself can read a streak row; an unrelated teacher and another student cannot', async () => {
		const classId = await createClass('RLS Visibility');
		const signedInStudent = await createSignedInStudent({
			classId,
			name: `RLS Visibility ${crypto.randomUUID().slice(0, 6)}`
		});
		const otherSignedInStudent = await createSignedInStudent({
			classId: await createClass('RLS Visibility Other'),
			name: `RLS Visibility Other ${crypto.randomUUID().slice(0, 6)}`
		});

		await markAttendance({
			studentId: signedInStudent.id,
			classId,
			sessionDate: weekOffset(0),
			present: true
		});

		const adminRead = await admin.client
			.from('student_streaks')
			.select('student_id')
			.eq('student_id', signedInStudent.id);
		expect(adminRead.data).toHaveLength(1);

		const assignedTeacherRead = await teacherA.client
			.from('student_streaks')
			.select('student_id')
			.eq('student_id', signedInStudent.id);
		expect(assignedTeacherRead.data).toHaveLength(1);

		const selfRead = await signedInStudent.client
			.from('student_streaks')
			.select('student_id')
			.eq('student_id', signedInStudent.id);
		expect(selfRead.data).toHaveLength(1);

		const unrelatedTeacherRead = await teacherB.client
			.from('student_streaks')
			.select('student_id')
			.eq('student_id', signedInStudent.id);
		expect(unrelatedTeacherRead.data).toEqual([]);

		const otherStudentRead = await otherSignedInStudent.client
			.from('student_streaks')
			.select('student_id')
			.eq('student_id', signedInStudent.id);
		expect(otherStudentRead.data).toEqual([]);
	});

	it('changing streak_grace_weeks applies only to future recomputes -- a previously stored streak row is not retroactively rewritten', async () => {
		const classId = await createClass('Grace Setting Change');
		const student = await createStudent({
			classId,
			name: `Grace Setting Change ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);

		// Qualifying at week -4, then 3 consecutive real misses (weeks -3,
		// -2, -1) -- with the default grace (2), this already exceeds it, so
		// the streak sits at 0 with today's week not yet touched at all
		// (streak_session data doesn't exist for "week 0" yet, so it's
		// treated as a holiday-so-far, not a miss).
		const qualifyingPeriod = weekOffset(-4);
		const instanceId = await createInstance({
			assignmentId,
			classId,
			periodStart: qualifyingPeriod
		});
		await markAttendance({
			studentId: student,
			classId,
			sessionDate: qualifyingPeriod,
			present: true
		});
		await markHomeworkDone({ instanceId, studentId: student, classId });

		for (const offset of [-3, -2, -1]) {
			await markAttendance({
				studentId: student,
				classId,
				sessionDate: weekOffset(offset),
				present: false
			});
		}

		const beforeSettingChange = await readStreak(student);
		expect(beforeSettingChange?.current_streak).toBe(0);

		let restoreError: string | undefined;
		try {
			const { error: updateError } = await admin.client
				.from('app_settings')
				.update({ value: { weeks: 4 } })
				.eq('key', 'streak_grace_weeks');
			expect(updateError).toBeNull();

			// The settings update itself never touches student_streaks -- no
			// trigger exists on app_settings.
			const afterSettingChangeOnly = await readStreak(student);
			expect(afterSettingChangeOnly).toEqual(beforeSettingChange);

			// A fresh trigger fire (week 0, a real miss -- present=false)
			// recomputes using the NEW grace (4): weeks 0, -1, -2, -3 are all
			// real misses (gap = 4, <= new grace), so week -4's qualifying
			// mark is now reached again.
			await markAttendance({
				studentId: student,
				classId,
				sessionDate: weekOffset(0),
				present: false
			});
			const afterNewRecompute = await readStreak(student);
			expect(afterNewRecompute?.current_streak).toBe(1);
			expect(afterNewRecompute?.last_qualifying_week).toBe(mondayOf(qualifyingPeriod));
		} finally {
			const { error } = await admin.client
				.from('app_settings')
				.update({ value: originalGraceWeeksValue })
				.eq('key', 'streak_grace_weeks');
			restoreError = error?.message;
		}
		if (restoreError) {
			throw new Error(`Failed to restore streak_grace_weeks: ${restoreError}`);
		}
	});
});

describe.skipIf(!reachable)('Story 4-2 badges (requires local Supabase)', () => {
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;
	let teamId: string;

	/** Same per-scenario-fresh-class shape as the Story 4-1 block above. */
	async function createClass(prefix: string) {
		const { data, error } = await admin.client
			.from('classes')
			.insert({
				name: `Story 4-2 ${prefix}`,
				code: `S4B${crypto.randomUUID().slice(0, 4).toUpperCase()}`
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		const classId = data.id as string;

		const { error: assignError } = await admin.client
			.from('class_teachers')
			.insert({ class_id: classId, teacher_id: teacherA.id });
		if (assignError) throw new Error(`Failed to assign teacherA: ${assignError.message}`);

		return classId;
	}

	/** Same shape as the Story 4-1 block's local createStudent. */
	async function createStudent(params: { classId: string; name: string }) {
		const email = `story-4-2-student-${crypto.randomUUID()}@students.internal.invalid`;
		const { data, error } = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			user_metadata: { role: 'student' }
		});
		if (error || !data.user) {
			throw new Error(`Failed to create student: ${error?.message}`);
		}

		const { error: updateError } = await adminClient
			.from('profiles')
			.update({
				class_id: params.classId,
				status: 'approved',
				registration_name: params.name,
				display_name: params.name,
				team_id: teamId
			})
			.eq('id', data.user.id);
		if (updateError) {
			throw new Error(`Failed to set up student: ${updateError.message}`);
		}

		return data.user.id;
	}

	/**
	 * Same as createStudent, but also signs in -- needed for the RLS
	 * self-read test below, which must exercise
	 * badges_earned_select_admin_or_own's `student_id = auth.uid()` branch as
	 * the real student, not via the service-role client.
	 */
	async function createSignedInStudent(params: { classId: string; name: string }) {
		const email = `story-4-2-signedin-student-${crypto.randomUUID()}@students.internal.invalid`;
		const password = crypto.randomUUID();

		const { data, error } = await adminClient.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
			user_metadata: { role: 'student' }
		});
		if (error || !data.user) {
			throw new Error(`Failed to create signed-in student: ${error?.message}`);
		}

		const { error: updateError } = await adminClient
			.from('profiles')
			.update({
				class_id: params.classId,
				status: 'approved',
				registration_name: params.name,
				display_name: params.name,
				team_id: teamId
			})
			.eq('id', data.user.id);
		if (updateError) {
			throw new Error(`Failed to set up signed-in student: ${updateError.message}`);
		}

		const client = anonClient();
		const { error: signInError } = await client.auth.signInWithPassword({ email, password });
		if (signInError) {
			throw new Error(`Failed to sign in student: ${signInError.message}`);
		}

		return { id: data.user.id, email, client };
	}

	function addDays(isoDate: string, days: number): string {
		const d = new Date(`${isoDate}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().slice(0, 10);
	}

	const today = new Date().toISOString().slice(0, 10);
	/** A distinct, deterministic session_date/period_start for the Nth mark in a scenario. */
	function dayOffset(n: number): string {
		return addDays(today, -n);
	}

	/**
	 * Fires attendance_records_recompute_badges via a direct service-role
	 * insert (bypasses attendance_records' own RLS, which this story doesn't
	 * re-test -- Stories 2-1/3-1 already cover it).
	 */
	async function markAttendance(params: {
		studentId: string;
		classId: string;
		sessionDate: string;
		present: boolean;
	}) {
		const { error } = await adminClient.from('attendance_records').insert({
			student_id: params.studentId,
			class_id: params.classId,
			session_date: params.sessionDate,
			present: params.present,
			recorded_by: teacherA.id
		});
		if (error) throw new Error(`Failed to mark attendance: ${error.message}`);
	}

	/** One-off homework assignment, service-role, reused across a scenario's instances. */
	async function createAssignment(classId: string) {
		const { data, error } = await adminClient
			.from('homework_assignments')
			.insert({
				class_id: classId,
				title: `Story 4-2 HW ${crypto.randomUUID().slice(0, 6)}`,
				skill_area: 'language',
				created_by: teacherA.id
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create assignment: ${error?.message}`);
		return data.id as string;
	}

	async function createInstance(params: {
		assignmentId: string;
		classId: string;
		periodStart: string;
	}) {
		const { data, error } = await adminClient
			.from('homework_instances')
			.insert({
				assignment_id: params.assignmentId,
				class_id: params.classId,
				period_start: params.periodStart,
				due_date: addDays(params.periodStart, 3)
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create homework instance: ${error?.message}`);
		return data.id as string;
	}

	async function markHomeworkDone(params: {
		instanceId: string;
		studentId: string;
		classId: string;
		recordedBy?: string;
	}) {
		const { error: assignedError } = await adminClient.from('homework_status_history').insert({
			instance_id: params.instanceId,
			student_id: params.studentId,
			class_id: params.classId,
			status: 'assigned',
			recorded_by: teacherA.id
		});
		if (assignedError) throw new Error(`Failed to insert assigned row: ${assignedError.message}`);

		const { error: doneError } = await adminClient.from('homework_status_history').insert({
			instance_id: params.instanceId,
			student_id: params.studentId,
			class_id: params.classId,
			status: 'done',
			recorded_by: params.recordedBy ?? params.studentId
		});
		if (doneError) throw new Error(`Failed to insert done row: ${doneError.message}`);
	}

	/** Reads badge rows via the service-role client (no RLS involved). */
	async function readBadges(studentId: string, badgeType: 'attendance' | 'homework') {
		const { data, error } = await adminClient
			.from('badges_earned')
			.select('badge_type, milestone, earned_at')
			.eq('student_id', studentId)
			.eq('badge_type', badgeType);
		if (error) throw new Error(`Failed to read badges: ${error.message}`);
		return data ?? [];
	}

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacherA = await createSignedInUser('teacher');

		const { data: team, error: teamError } = await admin.client
			.from('teams')
			.insert({ name: `Story 4-2 Team ${crypto.randomUUID().slice(0, 6)}` })
			.select('id')
			.single();
		if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
		teamId = team.id;

		const { data: settingRow, error: settingError } = await adminClient
			.from('app_settings')
			.select('value')
			.eq('key', 'badge_milestone_thresholds')
			.single();
		if (settingError || !settingRow)
			throw new Error(`Failed to read badge_milestone_thresholds: ${settingError?.message}`);
		expect(settingRow.value).toEqual([1, 5, 10, 25, 50, 100]);
	}, 30000);

	it("a student's distinct attendance count reaching a configured milestone inserts exactly one attendance badge row", async () => {
		const classId = await createClass('Attendance Milestone');
		const student = await createStudent({
			classId,
			name: `Attendance Milestone ${crypto.randomUUID().slice(0, 6)}`
		});

		await markAttendance({ studentId: student, classId, sessionDate: dayOffset(0), present: true });

		const badges = await readBadges(student, 'attendance');
		expect(badges).toEqual([
			{ badge_type: 'attendance', milestone: 1, earned_at: expect.any(String) }
		]);
		// earned_at is populated/sane -- a real, recent timestamp, not a
		// placeholder or unset value.
		const earnedAtMs = new Date(badges[0].earned_at).getTime();
		expect(Number.isNaN(earnedAtMs)).toBe(false);
		expect(Date.now() - earnedAtMs).toBeLessThan(60_000);
	});

	it("a student's distinct homework-done count reaching a configured milestone inserts exactly one homework badge row", async () => {
		const classId = await createClass('Homework Milestone');
		const student = await createStudent({
			classId,
			name: `Homework Milestone ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);
		const instanceId = await createInstance({ assignmentId, classId, periodStart: dayOffset(0) });

		await markHomeworkDone({ instanceId, studentId: student, classId });

		const badges = await readBadges(student, 'homework');
		expect(badges).toEqual([
			{ badge_type: 'homework', milestone: 1, earned_at: expect.any(String) }
		]);
	});

	it('marking attendance absent never fires the recompute -- no badge is inserted', async () => {
		const classId = await createClass('Absent No Fire');
		const student = await createStudent({
			classId,
			name: `Absent No Fire ${crypto.randomUUID().slice(0, 6)}`
		});

		await markAttendance({
			studentId: student,
			classId,
			sessionDate: dayOffset(0),
			present: false
		});

		expect(await readBadges(student, 'attendance')).toEqual([]);
	});

	it('a duplicate attendance mark for the same session_date is counted once toward the milestone total (never a raw row count)', async () => {
		const classId = await createClass('Duplicate Attendance');
		const student = await createStudent({
			classId,
			name: `Duplicate Attendance ${crypto.randomUUID().slice(0, 6)}`
		});

		// 4 distinct dates -- one below the next threshold (5).
		for (let i = 0; i < 4; i++) {
			await markAttendance({
				studentId: student,
				classId,
				sessionDate: dayOffset(i),
				present: true
			});
		}
		expect(await readBadges(student, 'attendance')).toEqual([
			{ badge_type: 'attendance', milestone: 1, earned_at: expect.any(String) }
		]);

		// A second, duplicate mark for an already-counted date -- 5 rows total,
		// but still only 4 DISTINCT dates. If the recompute ever counted raw
		// rows instead of distinct session_date, this would incorrectly cross
		// the milestone-5 threshold.
		await markAttendance({ studentId: student, classId, sessionDate: dayOffset(0), present: true });

		expect(await readBadges(student, 'attendance')).toEqual([
			{ badge_type: 'attendance', milestone: 1, earned_at: expect.any(String) }
		]);
	});

	it('a duplicate homework-done mark for the same instance (self + teacher on-behalf-of) is counted once toward the milestone total', async () => {
		const classId = await createClass('Duplicate Homework');
		const student = await createStudent({
			classId,
			name: `Duplicate Homework ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);

		// 4 distinct instances marked done -- one below the next threshold (5).
		const instanceIds: string[] = [];
		for (let i = 0; i < 4; i++) {
			const instanceId = await createInstance({ assignmentId, classId, periodStart: dayOffset(i) });
			instanceIds.push(instanceId);
			await markHomeworkDone({ instanceId, studentId: student, classId });
		}
		expect(await readBadges(student, 'homework')).toEqual([
			{ badge_type: 'homework', milestone: 1, earned_at: expect.any(String) }
		]);

		// Teacher-on-behalf-of duplicate 'done' mark for an instance already
		// marked done -- a second history row, same (student_id, instance_id)
		// pair. 5 history rows now carry status='done', but only 4 DISTINCT
		// instance_ids -- must not cross the milestone-5 threshold.
		const { error: duplicateError } = await adminClient.from('homework_status_history').insert({
			instance_id: instanceIds[0],
			student_id: student,
			class_id: classId,
			status: 'done',
			recorded_by: teacherA.id
		});
		expect(duplicateError).toBeNull();

		expect(await readBadges(student, 'homework')).toEqual([
			{ badge_type: 'homework', milestone: 1, earned_at: expect.any(String) }
		]);
	});

	it('a student with pre-existing history spanning multiple uncrossed milestones gets every already-crossed milestone from the same qualifying write', async () => {
		const classId = await createClass('Catch Up');
		const student = await createStudent({
			classId,
			name: `Catch Up ${crypto.randomUUID().slice(0, 6)}`
		});

		// 12 distinct-date attendance rows in a single bulk insert -- crosses
		// thresholds 1, 5, and 10 (default [1, 5, 10, 25, 50, 100]) together,
		// simulating a student whose substantial history predates ever
		// triggering a recompute.
		const rows = Array.from({ length: 12 }, (_, i) => ({
			student_id: student,
			class_id: classId,
			session_date: dayOffset(i),
			present: true,
			recorded_by: teacherA.id
		}));
		const { error } = await adminClient.from('attendance_records').insert(rows);
		expect(error).toBeNull();

		const badges = await readBadges(student, 'attendance');
		expect(badges.map((b) => b.milestone).sort((a, b) => a - b)).toEqual([1, 5, 10]);
	});

	it('recompute firing again with the total unchanged is a true no-op -- no duplicate badge row, no error', async () => {
		const classId = await createClass('No Duplicate');
		const student = await createStudent({
			classId,
			name: `No Duplicate ${crypto.randomUUID().slice(0, 6)}`
		});
		const assignmentId = await createAssignment(classId);
		const instanceId = await createInstance({ assignmentId, classId, periodStart: dayOffset(0) });

		await markHomeworkDone({ instanceId, studentId: student, classId });
		const before = await readBadges(student, 'homework');
		expect(before).toEqual([
			{ badge_type: 'homework', milestone: 1, earned_at: expect.any(String) }
		]);

		// A duplicate homework-done insert fires the trigger again with the
		// distinct-instance total unchanged -- re-inserting the already-
		// present milestone-1 row is a true ON CONFLICT DO NOTHING no-op, not
		// an error.
		const { error: duplicateError } = await adminClient.from('homework_status_history').insert({
			instance_id: instanceId,
			student_id: student,
			class_id: classId,
			status: 'done',
			recorded_by: teacherA.id
		});
		expect(duplicateError).toBeNull();

		expect(await readBadges(student, 'homework')).toEqual(before);
	});

	it('a direct client insert or update against badges_earned is rejected -- it is trigger-written only', async () => {
		const classId = await createClass('No Direct Writes');
		const student = await createStudent({
			classId,
			name: `No Direct Writes ${crypto.randomUUID().slice(0, 6)}`
		});
		const signedInStudent = await createSignedInStudent({
			classId,
			name: `No Direct Writes Self ${crypto.randomUUID().slice(0, 6)}`
		});

		const insertAttempt = await teacherA.client
			.from('badges_earned')
			.insert({ student_id: student, badge_type: 'attendance', milestone: 999 });
		expect(insertAttempt.error).not.toBeNull();

		const adminInsertAttempt = await admin.client
			.from('badges_earned')
			.insert({ student_id: student, badge_type: 'attendance', milestone: 999 });
		expect(adminInsertAttempt.error).not.toBeNull();

		// The actual abuse case this boundary exists to prevent: a student
		// self-awarding a badge for themself. No INSERT policy exists for
		// anyone (trigger-written only, AD-3), so this is rejected exactly
		// like the teacher/admin attempts above, not specially allowed just
		// because student_id matches auth.uid().
		const selfInsertAttempt = await signedInStudent.client
			.from('badges_earned')
			.insert({ student_id: signedInStudent.id, badge_type: 'attendance', milestone: 999 });
		expect(selfInsertAttempt.error).not.toBeNull();

		const { data: selfInsertCheck } = await adminClient
			.from('badges_earned')
			.select('id')
			.eq('student_id', signedInStudent.id);
		expect(selfInsertCheck).toEqual([]);

		// A trigger-created row to attempt an UPDATE against.
		await markAttendance({ studentId: student, classId, sessionDate: dayOffset(0), present: true });

		const updateAttempt = await teacherA.client
			.from('badges_earned')
			.update({ milestone: 999 })
			.eq('student_id', student);
		expect(updateAttempt.error).toBeNull(); // RLS denies by filtering, not by erroring
		expect(updateAttempt.data ?? []).toEqual([]);

		const { data: unchanged } = await adminClient
			.from('badges_earned')
			.select('milestone')
			.eq('student_id', student)
			.eq('badge_type', 'attendance')
			.single();
		expect(unchanged?.milestone).not.toBe(999);
	});

	it('RLS: admin and the student themself can read a badge row; another student and even the assigned teacher cannot (no teacher access, unlike streaks)', async () => {
		const classId = await createClass('RLS Visibility');
		const signedInStudent = await createSignedInStudent({
			classId,
			name: `RLS Visibility ${crypto.randomUUID().slice(0, 6)}`
		});
		const otherSignedInStudent = await createSignedInStudent({
			classId: await createClass('RLS Visibility Other'),
			name: `RLS Visibility Other ${crypto.randomUUID().slice(0, 6)}`
		});

		await markAttendance({
			studentId: signedInStudent.id,
			classId,
			sessionDate: dayOffset(0),
			present: true
		});

		const adminRead = await admin.client
			.from('badges_earned')
			.select('student_id')
			.eq('student_id', signedInStudent.id);
		expect(adminRead.data).toHaveLength(1);

		const selfRead = await signedInStudent.client
			.from('badges_earned')
			.select('student_id')
			.eq('student_id', signedInStudent.id);
		expect(selfRead.data).toHaveLength(1);

		// Per Boundaries: "visible only on the student's own profile" -- unlike
		// student_streaks' three-way shape, even the assigned teacher has no
		// read access here.
		const assignedTeacherRead = await teacherA.client
			.from('badges_earned')
			.select('student_id')
			.eq('student_id', signedInStudent.id);
		expect(assignedTeacherRead.data).toEqual([]);

		const otherStudentRead = await otherSignedInStudent.client
			.from('badges_earned')
			.select('student_id')
			.eq('student_id', signedInStudent.id);
		expect(otherStudentRead.data).toEqual([]);
	});

	it('changing badge_milestone_thresholds applies only to future recomputes -- a new threshold below an already-reached total is picked up on the next qualifying write, not retroactively', async () => {
		const classId = await createClass('Threshold Setting Change');
		const student = await createStudent({
			classId,
			name: `Threshold Setting Change ${crypto.randomUUID().slice(0, 6)}`
		});

		// 4 distinct dates under the default thresholds ([1, 5, 10, 25, 50,
		// 100]) -- only milestone 1 has been crossed so far (4 < 5).
		for (let i = 0; i < 4; i++) {
			await markAttendance({
				studentId: student,
				classId,
				sessionDate: dayOffset(i),
				present: true
			});
		}
		const beforeSettingChange = await readBadges(student, 'attendance');
		expect(beforeSettingChange.map((b) => b.milestone)).toEqual([1]);

		let restoreError: string | undefined;
		try {
			const { error: updateError } = await admin.client
				.from('app_settings')
				.update({ value: [1, 4, 10, 25, 50, 100] })
				.eq('key', 'badge_milestone_thresholds');
			expect(updateError).toBeNull();

			// The settings update itself never touches badges_earned -- no
			// trigger exists on app_settings, mirroring streak_grace_weeks'
			// behavior in the Story 4-1 block above.
			const afterSettingChangeOnly = await readBadges(student, 'attendance');
			expect(afterSettingChangeOnly).toEqual(beforeSettingChange);

			// A fresh trigger fire -- a duplicate mark for an already-counted
			// date, so present=true still satisfies the WHEN clause but the
			// distinct total stays at 4 -- recomputes using the NEW thresholds:
			// 4 is now a configured milestone the existing total already
			// satisfies, so it appears without any new attendance ever landing.
			await markAttendance({
				studentId: student,
				classId,
				sessionDate: dayOffset(0),
				present: true
			});

			const afterNewRecompute = await readBadges(student, 'attendance');
			expect(afterNewRecompute.map((b) => b.milestone).sort((a, b) => a - b)).toEqual([1, 4]);
		} finally {
			const { error } = await admin.client
				.from('app_settings')
				.update({ value: [1, 5, 10, 25, 50, 100] })
				.eq('key', 'badge_milestone_thresholds');
			restoreError = error?.message;
		}
		if (restoreError) {
			throw new Error(`Failed to restore badge_milestone_thresholds: ${restoreError}`);
		}
	});
});

describe.skipIf(!reachable)('Story 4-3 leaderboard (requires local Supabase)', () => {
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;

	/** Same per-scenario-fresh-class shape as the Story 4-1/4-2 blocks above. */
	async function createClass(prefix: string) {
		const { data, error } = await admin.client
			.from('classes')
			.insert({
				name: `Story 4-3 ${prefix}`,
				code: `S4C${crypto.randomUUID().slice(0, 4).toUpperCase()}`
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		const classId = data.id as string;

		const { error: assignError } = await admin.client
			.from('class_teachers')
			.insert({ class_id: classId, teacher_id: teacherA.id });
		if (assignError) throw new Error(`Failed to assign teacherA: ${assignError.message}`);

		return classId;
	}

	async function createTeam(name: string) {
		const { data, error } = await admin.client.from('teams').insert({ name }).select('id').single();
		if (error || !data) throw new Error(`Failed to create team: ${error?.message}`);
		return data.id as string;
	}

	/**
	 * A student in an arbitrary approval/team state -- unlike the Story
	 * 4-1/4-2 blocks' createStudent (which always creates an approved,
	 * team-assigned student), this story's own I/O matrix needs pending and
	 * team-less students too (e.g. "Student with a streak but team_id IS
	 * NULL -- excluded from every team's sum").
	 */
	async function createStudent(params: {
		classId: string;
		name: string;
		status?: 'pending' | 'approved' | 'rejected';
		teamId?: string | null;
	}) {
		const email = `story-4-3-student-${crypto.randomUUID()}@students.internal.invalid`;
		const { data, error } = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			user_metadata: { role: 'student' }
		});
		if (error || !data.user) {
			throw new Error(`Failed to create student: ${error?.message}`);
		}

		const { error: updateError } = await adminClient
			.from('profiles')
			.update({
				class_id: params.classId,
				status: params.status ?? 'approved',
				registration_name: params.name,
				display_name: params.name,
				team_id: params.teamId ?? null
			})
			.eq('id', data.user.id);
		if (updateError) {
			throw new Error(`Failed to set up student: ${updateError.message}`);
		}

		return data.user.id;
	}

	/**
	 * Directly upserts a known student_streaks total via the service-role
	 * client -- team_leaderboard() only sums whatever is already in
	 * student_streaks, so this story's own tests don't need to replay a full
	 * attendance/homework history to get a specific number the way the
	 * Story 4-1 block's trigger tests do; that recompute logic is already
	 * covered there. Mirrors the table's own upsert shape
	 * (0007_streaks.sql's ON CONFLICT (student_id) DO UPDATE).
	 */
	async function setStreak(studentId: string, classId: string, currentStreak: number) {
		const { error } = await adminClient
			.from('student_streaks')
			.upsert({ student_id: studentId, class_id: classId, current_streak: currentStreak });
		if (error) throw new Error(`Failed to set streak: ${error.message}`);
	}

	/** Calls the RPC as a given signed-in client and returns only the rows for the given team ids, in the order returned (i.e. still rank-ordered). */
	async function readLeaderboard(
		client: Awaited<ReturnType<typeof createSignedInUser>>['client'],
		teamIds: string[]
	) {
		const { data, error } = await client.rpc('team_leaderboard');
		if (error) throw new Error(`team_leaderboard RPC failed: ${error.message}`);
		return (data ?? []).filter((row) => teamIds.includes(row.team_id));
	}

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacherA = await createSignedInUser('teacher');
	}, 30000);

	it('ranks teams by combined approved-student streak descending', async () => {
		const classId = await createClass('Ranking');
		const teamHigh = await createTeam(`Ranking High ${crypto.randomUUID().slice(0, 6)}`);
		const teamLow = await createTeam(`Ranking Low ${crypto.randomUUID().slice(0, 6)}`);

		const s1 = await createStudent({ classId, name: 'Ranking S1', teamId: teamHigh });
		const s2 = await createStudent({ classId, name: 'Ranking S2', teamId: teamHigh });
		const s3 = await createStudent({ classId, name: 'Ranking S3', teamId: teamLow });

		await setStreak(s1, classId, 5);
		await setStreak(s2, classId, 3);
		await setStreak(s3, classId, 3);

		const rows = await readLeaderboard(admin.client, [teamHigh, teamLow]);
		expect(rows).toEqual([
			{ team_id: teamHigh, team_name: expect.any(String), total_streak: 8 },
			{ team_id: teamLow, team_name: expect.any(String), total_streak: 3 }
		]);
		// The higher-total team is genuinely first in the returned order, not
		// just present with the right total (I/O matrix: "the higher-total
		// team is ranked above the lower one").
		const highIndex = rows.findIndex((r) => r.team_id === teamHigh);
		const lowIndex = rows.findIndex((r) => r.team_id === teamLow);
		expect(highIndex).toBeLessThan(lowIndex);
	});

	it('a team with no approved students holding a streak still appears, with a total of 0', async () => {
		const teamEmpty = await createTeam(`Empty Team ${crypto.randomUUID().slice(0, 6)}`);

		const rows = await readLeaderboard(admin.client, [teamEmpty]);
		expect(rows).toEqual([{ team_id: teamEmpty, team_name: expect.any(String), total_streak: 0 }]);
	});

	it('a team whose only member has never triggered a streak recompute (no student_streaks row) still totals correctly, never null', async () => {
		const classId = await createClass('No Streak Row');
		const team = await createTeam(`No Streak Row ${crypto.randomUUID().slice(0, 6)}`);
		const withRow = await createStudent({ classId, name: 'Has Row', teamId: team });
		await createStudent({ classId, name: 'Never Recomputed', teamId: team });
		await setStreak(withRow, classId, 5);

		const rows = await readLeaderboard(admin.client, [team]);
		// COALESCE(SUM(...), 0) plus the fact that SUM() itself already skips
		// a NULL row (the never-recomputed student's LEFT JOIN miss) --
		// total_streak must come back as a real 5, never null or an error.
		expect(rows).toEqual([{ team_id: team, team_name: expect.any(String), total_streak: 5 }]);
	});

	it('tied totals are ordered deterministically by team name ascending, across repeated loads', async () => {
		const classId = await createClass('Tied');
		const suffix = crypto.randomUUID().slice(0, 6);
		// Names deliberately chosen so alphabetical order is unambiguous
		// regardless of the random suffix.
		const teamA = await createTeam(`AAA Tied ${suffix}`);
		const teamZ = await createTeam(`ZZZ Tied ${suffix}`);

		const sa = await createStudent({ classId, name: 'Tied SA', teamId: teamA });
		const sz = await createStudent({ classId, name: 'Tied SZ', teamId: teamZ });
		await setStreak(sa, classId, 4);
		await setStreak(sz, classId, 4);

		for (let attempt = 0; attempt < 2; attempt++) {
			const rows = await readLeaderboard(admin.client, [teamA, teamZ]);
			expect(rows.map((r) => r.team_id)).toEqual([teamA, teamZ]);
		}
	});

	it("a student with a streak but no team assignment (team_id IS NULL) is excluded from every team's sum", async () => {
		const classId = await createClass('No Team');
		const team = await createTeam(`No Team Control ${crypto.randomUUID().slice(0, 6)}`);
		const teamless = await createStudent({ classId, name: 'Teamless', teamId: null });
		await setStreak(teamless, classId, 99);

		// The control team has zero members -- if the teamless student's
		// streak were ever mis-attributed anywhere, this is the team it could
		// only wrongly land on by a null-handling bug (e.g. team_id IS NULL
		// coalescing to some team's id).
		const rows = await readLeaderboard(admin.client, [team]);
		expect(rows).toEqual([{ team_id: team, team_name: expect.any(String), total_streak: 0 }]);
	});

	it("a pending (not yet approved) student's streak is excluded from their team's sum", async () => {
		const classId = await createClass('Pending Excluded');
		const team = await createTeam(`Pending Excluded ${crypto.randomUUID().slice(0, 6)}`);
		const pending = await createStudent({
			classId,
			name: 'Pending Student',
			status: 'pending',
			teamId: team
		});
		await setStreak(pending, classId, 10);

		const rows = await readLeaderboard(admin.client, [team]);
		expect(rows).toEqual([{ team_id: team, team_name: expect.any(String), total_streak: 0 }]);
	});

	it('every authenticated role (admin, teacher, student) sees the identical team-level totals -- no individual streak is exposed', async () => {
		const classId = await createClass('Cross Role');
		const team = await createTeam(`Cross Role ${crypto.randomUUID().slice(0, 6)}`);
		const s1 = await createStudent({ classId, name: 'Cross Role S1', teamId: team });
		await setStreak(s1, classId, 6);

		const signedInStudentEmail = `story-4-3-signedin-${crypto.randomUUID()}@students.internal.invalid`;
		const signedInStudentPassword = crypto.randomUUID();
		const { data: signedInStudentData, error: signedInStudentError } =
			await adminClient.auth.admin.createUser({
				email: signedInStudentEmail,
				password: signedInStudentPassword,
				email_confirm: true,
				user_metadata: { role: 'student' }
			});
		if (signedInStudentError || !signedInStudentData.user) {
			throw new Error(`Failed to create signed-in student: ${signedInStudentError?.message}`);
		}
		await adminClient
			.from('profiles')
			.update({
				class_id: classId,
				status: 'approved',
				registration_name: 'Cross Role Viewer',
				display_name: 'Cross Role Viewer',
				team_id: team
			})
			.eq('id', signedInStudentData.user.id);
		const studentClient = anonClient();
		const { error: signInError } = await studentClient.auth.signInWithPassword({
			email: signedInStudentEmail,
			password: signedInStudentPassword
		});
		if (signInError) throw new Error(`Failed to sign in student: ${signInError.message}`);

		const adminRows = await readLeaderboard(admin.client, [team]);
		const teacherRows = await readLeaderboard(teacherA.client, [team]);
		const studentRows = await readLeaderboard(studentClient, [team]);

		expect(adminRows).toEqual([{ team_id: team, team_name: expect.any(String), total_streak: 6 }]);
		expect(teacherRows).toEqual(adminRows);
		expect(studentRows).toEqual(adminRows);

		// The return shape itself only ever carries team-level columns -- no
		// student_id/student-level field could leak through even by accident
		// (Boundaries: "Do not expose any individual student's streak value
		// through this feature -- only team-level sums").
		expect(Object.keys(adminRows[0]).sort()).toEqual(['team_id', 'team_name', 'total_streak']);
	});
});

describe.skipIf(!reachable)('Story 5-1 admin dashboard (requires local Supabase)', () => {
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;

	/** Same per-scenario-fresh-class shape as the Story 4-1/4-2/4-3 blocks above -- teacherA is assigned. */
	async function createClass(prefix: string) {
		const { data, error } = await admin.client
			.from('classes')
			.insert({
				name: `Story 5-1 ${prefix}`,
				code: `S5${crypto.randomUUID().slice(0, 4).toUpperCase()}`
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		const classId = data.id as string;

		const { error: assignError } = await admin.client
			.from('class_teachers')
			.insert({ class_id: classId, teacher_id: teacherA.id });
		if (assignError) throw new Error(`Failed to assign teacherA: ${assignError.message}`);

		return classId;
	}

	/**
	 * Deliberately NOT assigned to teacherA -- used by the cross-role
	 * regression test below to prove a class outside a teacher's own
	 * assignment never counts toward their scoped read, the way it would for
	 * admin's cross-class dashboard read.
	 */
	async function createUnassignedClass(prefix: string) {
		const { data, error } = await admin.client
			.from('classes')
			.insert({
				name: `Story 5-1 ${prefix}`,
				code: `S5${crypto.randomUUID().slice(0, 4).toUpperCase()}`
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create unassigned class: ${error?.message}`);
		return data.id as string;
	}

	/** Same shape as the Story 4-3 block's own createStudent (status defaults to approved). */
	async function createStudent(params: {
		classId: string;
		name: string;
		status?: 'pending' | 'approved' | 'rejected';
	}) {
		const email = `story-5-1-student-${crypto.randomUUID()}@students.internal.invalid`;
		const { data, error } = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			user_metadata: { role: 'student' }
		});
		if (error || !data.user) {
			throw new Error(`Failed to create student: ${error?.message}`);
		}

		const { error: updateError } = await adminClient
			.from('profiles')
			.update({
				class_id: params.classId,
				status: params.status ?? 'approved',
				registration_name: params.name,
				display_name: params.name
			})
			.eq('id', data.user.id);
		if (updateError) {
			throw new Error(`Failed to set up student: ${updateError.message}`);
		}

		return data.user.id;
	}

	/** Same as createStudent, but also signs in -- needed for the student-side regression check below. */
	async function createSignedInStudent(params: { classId: string; name: string }) {
		const email = `story-5-1-signedin-student-${crypto.randomUUID()}@students.internal.invalid`;
		const password = crypto.randomUUID();

		const { data, error } = await adminClient.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
			user_metadata: { role: 'student' }
		});
		if (error || !data.user) {
			throw new Error(`Failed to create signed-in student: ${error?.message}`);
		}

		const { error: updateError } = await adminClient
			.from('profiles')
			.update({
				class_id: params.classId,
				status: 'approved',
				registration_name: params.name,
				display_name: params.name
			})
			.eq('id', data.user.id);
		if (updateError) {
			throw new Error(`Failed to set up signed-in student: ${updateError.message}`);
		}

		const client = anonClient();
		const { error: signInError } = await client.auth.signInWithPassword({ email, password });
		if (signInError) {
			throw new Error(`Failed to sign in student: ${signInError.message}`);
		}

		return { id: data.user.id, email, client };
	}

	function addDays(isoDate: string, days: number): string {
		const d = new Date(`${isoDate}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().slice(0, 10);
	}

	const today = new Date().toISOString().slice(0, 10);

	/** One-off homework assignment, service-role. */
	async function createAssignment(classId: string) {
		const { data, error } = await adminClient
			.from('homework_assignments')
			.insert({
				class_id: classId,
				title: `Story 5-1 HW ${crypto.randomUUID().slice(0, 6)}`,
				skill_area: 'language',
				created_by: teacherA.id
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create assignment: ${error?.message}`);
		return data.id as string;
	}

	async function createInstance(params: {
		assignmentId: string;
		classId: string;
		periodStart: string;
	}) {
		const { data, error } = await adminClient
			.from('homework_instances')
			.insert({
				assignment_id: params.assignmentId,
				class_id: params.classId,
				period_start: params.periodStart,
				due_date: addDays(params.periodStart, 3)
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create homework instance: ${error?.message}`);
		return data.id as string;
	}

	/** Inserts the initial 'assigned' row for a (instance, student) pair -- Code Map's own history shape (0004). */
	async function assignStudent(params: { instanceId: string; studentId: string; classId: string }) {
		const { error } = await adminClient.from('homework_status_history').insert({
			instance_id: params.instanceId,
			student_id: params.studentId,
			class_id: params.classId,
			status: 'assigned',
			recorded_by: teacherA.id
		});
		if (error) throw new Error(`Failed to insert assigned row: ${error.message}`);
	}

	async function markStatus(params: {
		instanceId: string;
		studentId: string;
		classId: string;
		status: 'done' | 'reviewed';
	}) {
		const { error } = await adminClient.from('homework_status_history').insert({
			instance_id: params.instanceId,
			student_id: params.studentId,
			class_id: params.classId,
			status: params.status,
			recorded_by: params.status === 'done' ? params.studentId : teacherA.id
		});
		if (error) throw new Error(`Failed to insert ${params.status} row: ${error.message}`);
	}

	/**
	 * Runs the same shape of parallel aggregate queries
	 * src/routes/admin/+page.server.ts issues, as whichever client is passed
	 * -- lets the cross-role regression test below reuse the exact query
	 * shapes rather than re-deriving its own.
	 */
	async function readAggregateCounts(
		client: Awaited<ReturnType<typeof createSignedInUser>>['client']
	) {
		const [classesRes, teachersRes, studentsRes, pendingRes, assignmentsRes] = await Promise.all([
			client.from('classes').select('id', { count: 'exact', head: true }),
			client.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'teacher'),
			client
				.from('profiles')
				.select('id', { count: 'exact', head: true })
				.eq('role', 'student')
				.eq('status', 'approved'),
			client
				.from('profiles')
				.select('id', { count: 'exact', head: true })
				.eq('role', 'student')
				.eq('status', 'pending'),
			client.from('homework_assignments').select('id', { count: 'exact', head: true })
		]);
		return {
			classes: classesRes.count ?? 0,
			teachers: teachersRes.count ?? 0,
			students: studentsRes.count ?? 0,
			pending: pendingRes.count ?? 0,
			assignments: assignmentsRes.count ?? 0
		};
	}

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacherA = await createSignedInUser('teacher');
	}, 30000);

	it('as admin, classes/teachers/approved-students/pending-requests/homework-assignments counts each increase by exactly the known fixture added (I/O matrix: "Normal load")', async () => {
		const before = await readAggregateCounts(admin.client);

		const classId = await createClass('Fixture A');
		await createClass('Fixture B');
		await createSignedInUser('teacher');
		await createStudent({ classId, name: 'Fixture Approved 1' });
		await createStudent({ classId, name: 'Fixture Approved 2' });
		await createStudent({ classId, name: 'Fixture Pending 1', status: 'pending' });
		await createAssignment(classId);

		const after = await readAggregateCounts(admin.client);

		expect(after.classes - before.classes).toBe(2);
		expect(after.teachers - before.teachers).toBe(1);
		expect(after.students - before.students).toBe(2);
		expect(after.pending - before.pending).toBe(1);
		expect(after.assignments - before.assignments).toBe(1);
	});

	it('a fresh class contributing zero pending requests is a truthful 0, not a missing/undefined count (I/O matrix: "Fresh school with zero of something")', async () => {
		const before = await readAggregateCounts(admin.client);
		await createClass('Zero Pending');
		const after = await readAggregateCounts(admin.client);

		// The new class has no students at all -- pending, students, and
		// assignments must be unchanged, never null/NaN/undefined, and the
		// classes count must still move by exactly 1.
		expect(after.classes - before.classes).toBe(1);
		expect(after.pending - before.pending).toBe(0);
		expect(after.students - before.students).toBe(0);
		expect(after.assignments - before.assignments).toBe(0);
		expect(Number.isFinite(after.pending)).toBe(true);
	});

	it('completion math follows the distinct (instance, student) done-or-reviewed dedup convention (never raw history-row counts) against a known fixture', async () => {
		const classId = await createClass('Completion');
		const assignmentId = await createAssignment(classId);
		const s1 = await createStudent({ classId, name: 'Completion S1' });
		const s2 = await createStudent({ classId, name: 'Completion S2' });
		const s3 = await createStudent({ classId, name: 'Completion S3' });

		const instance1 = await createInstance({ assignmentId, classId, periodStart: today });
		const instance2 = await createInstance({
			assignmentId,
			classId,
			periodStart: addDays(today, 7)
		});

		// instance1: three targeted students, s1 reaches done, s2 reaches
		// done+reviewed (a second history row for the same pair -- must not
		// double-count), s3 stays assigned-only.
		await assignStudent({ instanceId: instance1, studentId: s1, classId });
		await assignStudent({ instanceId: instance1, studentId: s2, classId });
		await assignStudent({ instanceId: instance1, studentId: s3, classId });
		await markStatus({ instanceId: instance1, studentId: s1, classId, status: 'done' });
		await markStatus({ instanceId: instance1, studentId: s2, classId, status: 'done' });
		await markStatus({ instanceId: instance1, studentId: s2, classId, status: 'reviewed' });

		// instance2: one assigned-only pair (I/O matrix: "no homework history
		// at all yet" for this pair specifically) -- contributes to the
		// denominator, never the numerator.
		await assignStudent({ instanceId: instance2, studentId: s1, classId });

		// Admin reads via the same admin-readable RLS policy
		// src/routes/admin/+page.server.ts's own (paginated) whole-table read
		// relies on (homework_status_history_select_admin_teacher_or_own),
		// but this test scopes server-side to its own known instance ids via
		// `.in(...)` rather than an unfiltered select -- the shared table
		// already holds 1000+ rows across every other describe block in this
		// file, past PostgREST's `api.max_rows` page cap, so an unfiltered
		// select here would itself need the same pagination the route uses;
		// `.in('instance_id', [...])` sidesteps that while still exercising
		// the identical RLS policy and dedup logic.
		const { data: allHistory, error } = await admin.client
			.from('homework_status_history')
			.select('id, instance_id, student_id, status, recorded_by, recorded_at')
			.in('instance_id', [instance1, instance2]);
		expect(error).toBeNull();

		const scoped: HomeworkHistoryRow[] = (allHistory ?? []).map((r) => ({
			id: r.id,
			instanceId: r.instance_id,
			studentId: r.student_id,
			status: r.status,
			recordedBy: r.recorded_by,
			recordedAt: r.recorded_at
		}));

		const progress = Object.values(buildHomeworkProgress(scoped));
		const totalAssigned = progress.filter((p) => p.assignedAt !== null).length;
		const totalDoneOrReviewed = progress.filter(
			(p) => p.doneAt !== null || p.reviewedAt !== null
		).length;

		// Four distinct (instance, student) pairs total: (i1,s1) (i1,s2)
		// (i1,s3) (i2,s1) -- never five, even though six history rows were
		// inserted (three assigned + done + done + reviewed).
		expect(totalAssigned).toBe(4);
		// Two pairs reached done-or-reviewed: (i1,s1) and (i1,s2) -- s2's
		// extra 'reviewed' row must not count it twice.
		expect(totalDoneOrReviewed).toBe(2);

		const percent =
			totalAssigned === 0 ? 0 : Math.round((totalDoneOrReviewed / totalAssigned) * 100);
		expect(percent).toBe(50);
	});

	it('completion percentage is 0, never NaN, when the assigned-pairs denominator is 0 (I/O matrix: "No homework history at all yet")', () => {
		const progress = Object.values(buildHomeworkProgress([]));
		const totalAssigned = progress.filter((p) => p.assignedAt !== null).length;
		const totalDoneOrReviewed = progress.filter(
			(p) => p.doneAt !== null || p.reviewedAt !== null
		).length;
		const percent =
			totalAssigned === 0 ? 0 : Math.round((totalDoneOrReviewed / totalAssigned) * 100);

		expect(percent).toBe(0);
		expect(Number.isNaN(percent)).toBe(false);
	});

	it("a teacher's identical aggregate queries stay scoped to their own assignment -- never the admin's cross-class totals (read-only regression, no new policy)", async () => {
		const ownClassId = await createClass('Teacher Scope Own');
		const foreignClassId = await createUnassignedClass('Teacher Scope Foreign');

		await createStudent({ classId: ownClassId, name: 'Own Approved' });
		await createStudent({ classId: foreignClassId, name: 'Foreign Approved' });
		await createStudent({ classId: foreignClassId, name: 'Foreign Pending', status: 'pending' });

		// classes_select_admin_or_assigned_teacher: teacherA's count excludes
		// the foreign class entirely, so it must be strictly less than
		// admin's, even though both ran the exact same query shape.
		const adminCounts = await readAggregateCounts(admin.client);
		const teacherCounts = await readAggregateCounts(teacherA.client);
		expect(teacherCounts.classes).toBeLessThan(adminCounts.classes);

		// profiles_select_admin_or_teacher_of_student_class: the foreign
		// class's students (approved and pending alike) never appear in
		// teacherA's read, even though the dashboard's own query has no
		// class_id filter -- RLS is the real scoping, not app-level code.
		const { data: teacherVisibleStudents, error: teacherStudentsError } = await teacherA.client
			.from('profiles')
			.select('id, class_id')
			.eq('role', 'student');
		expect(teacherStudentsError).toBeNull();
		expect((teacherVisibleStudents ?? []).some((r) => r.class_id === foreignClassId)).toBe(false);

		// profiles_select_own is the only policy that could match a
		// role='teacher' filter for a non-admin -- teacherA sees exactly
		// their own row, never every teacher account the way admin's
		// dashboard tile does.
		const { data: teacherVisibleTeachers, error: teacherTeachersError } = await teacherA.client
			.from('profiles')
			.select('id')
			.eq('role', 'teacher');
		expect(teacherTeachersError).toBeNull();
		expect(teacherVisibleTeachers).toEqual([{ id: teacherA.id }]);

		// homework_status_history_select_admin_teacher_or_own: this is the
		// one unfiltered, highest-risk read behind the completion tile's
		// paginated fetchAllHistoryRows() -- confirm it's scoped the same way
		// as the five aggregates above, not just assumed from the policy's
		// name (Review Triage Log #4).
		const foreignAssignmentId = await createAssignment(foreignClassId);
		const foreignInstanceId = await createInstance({
			assignmentId: foreignAssignmentId,
			classId: foreignClassId,
			periodStart: today
		});
		const foreignStudentId = await createStudent({
			classId: foreignClassId,
			name: 'Foreign History Subject'
		});
		await assignStudent({
			instanceId: foreignInstanceId,
			studentId: foreignStudentId,
			classId: foreignClassId
		});

		const { data: teacherVisibleHistory, error: teacherHistoryError } = await teacherA.client
			.from('homework_status_history')
			.select('id')
			.eq('instance_id', foreignInstanceId);
		expect(teacherHistoryError).toBeNull();
		expect(teacherVisibleHistory).toEqual([]);

		const { data: adminVisibleHistory, error: adminHistoryError } = await admin.client
			.from('homework_status_history')
			.select('id')
			.eq('instance_id', foreignInstanceId);
		expect(adminHistoryError).toBeNull();
		expect(adminVisibleHistory).toHaveLength(1);

		// A student has no select policy on `classes` at all (admin-or-
		// assigned-teacher only) -- zero rows, not a scoped-down subset.
		const signedInStudent = await createSignedInStudent({
			classId: ownClassId,
			name: 'Regression Viewer'
		});
		const { data: studentVisibleClasses, error: studentClassesError } = await signedInStudent.client
			.from('classes')
			.select('id');
		expect(studentClassesError).toBeNull();
		expect(studentVisibleClasses).toEqual([]);

		// profiles_select_own: a student sees only their own profile row,
		// never the cross-class student roster the admin dashboard aggregates.
		const { data: studentVisibleProfiles, error: studentProfilesError } =
			await signedInStudent.client.from('profiles').select('id').eq('role', 'student');
		expect(studentProfilesError).toBeNull();
		expect(studentVisibleProfiles).toEqual([{ id: signedInStudent.id }]);
	});
});

describe.skipIf(!reachable)('Story 6-1 class days & sessions (requires local Supabase)', () => {
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacherA2: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacherB: Awaited<ReturnType<typeof createSignedInUser>>;

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacherA = await createSignedInUser('teacher');
		teacherA2 = await createSignedInUser('teacher');
		teacherB = await createSignedInUser('teacher');
	}, 30000);

	/**
	 * class_days.day is unique school-wide and the test database is shared by
	 * every run, so each scenario works in its own random far-future year.
	 */
	function randomYear() {
		return 3000 + Math.floor(Math.random() * 6000);
	}

	/** A class taught by teacherA (and optionally teacherA2). */
	async function createClass(prefix: string, teachers = [teacherA.id]) {
		const { data, error } = await admin.client
			.from('classes')
			.insert({
				name: `Story 6-1 ${prefix}`,
				code: `S6${crypto.randomUUID().slice(0, 4).toUpperCase()}`
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		for (const teacherId of teachers) {
			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: data.id, teacher_id: teacherId });
			if (assignError) throw new Error(`Failed to assign teacher: ${assignError.message}`);
		}
		return data.id as string;
	}

	async function addDays(days: string[]) {
		const { data, error } = await admin.client
			.from('class_days')
			.upsert(
				days.map((day) => ({ day })),
				{ onConflict: 'day', ignoreDuplicates: true }
			)
			.select('id, day');
		if (error) throw new Error(`Failed to add class days: ${error.message}`);
		return data ?? [];
	}

	async function dayId(day: string) {
		const { data } = await adminClient.from('class_days').select('id').eq('day', day).single();
		return data!.id as string;
	}

	async function sessionId(classId: string, day: string) {
		const { data } = await adminClient
			.from('class_sessions_effective')
			.select('id')
			.eq('class_id', classId)
			.eq('day', day)
			.single();
		return data!.id as string;
	}

	async function effective(classId: string, day: string) {
		const { data } = await adminClient
			.from('class_sessions_effective')
			.select('start_time, duration_minutes, cancelled, session_cancelled, day_cancelled')
			.eq('class_id', classId)
			.eq('day', day)
			.single();
		return data!;
	}

	async function createSignedInStudent(classIds: string[]) {
		const email = `story-6-1-student-${crypto.randomUUID()}@students.internal.invalid`;
		const password = crypto.randomUUID();
		const { data, error } = await adminClient.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
			user_metadata: { role: 'student' }
		});
		if (error || !data.user) throw new Error(`Failed to create student: ${error?.message}`);

		// Approval enrolls into the registered class (0016 trigger); the rest
		// are added the way enroll_student() would.
		const { error: updateError } = await adminClient
			.from('profiles')
			.update({
				class_id: classIds[0],
				status: 'approved',
				registration_name: 'Story 6-1 Student',
				display_name: 'Story 6-1 Student'
			})
			.eq('id', data.user.id);
		if (updateError) throw new Error(`Failed to approve student: ${updateError.message}`);
		for (const classId of classIds.slice(1)) {
			const { error: enrollError } = await adminClient
				.from('class_enrollments')
				.insert({ student_id: data.user.id, class_id: classId });
			if (enrollError) throw new Error(`Failed to enroll student: ${enrollError.message}`);
		}

		const client = anonClient();
		const { error: signInError } = await client.auth.signInWithPassword({ email, password });
		if (signInError) throw new Error(`Failed to sign in student: ${signInError.message}`);
		return { id: data.user.id, client };
	}

	it('bulk add: existing dates are skipped and every class gets one session per new day', async () => {
		const year = randomYear();
		const classA = await createClass('Bulk A');
		const classB = await createClass('Bulk B');

		await addDays([`${year}-10-11`]);
		const added = await addDays([
			`${year}-10-04`,
			`${year}-10-11`,
			`${year}-10-18`,
			`${year}-10-25`
		]);
		expect(added.map((d) => d.day).sort()).toEqual([
			`${year}-10-04`,
			`${year}-10-18`,
			`${year}-10-25`
		]);

		const { data: sessions } = await adminClient
			.from('class_sessions_effective')
			.select('class_id, day')
			.in('class_id', [classA, classB])
			.gte('day', `${year}-10-01`)
			.lte('day', `${year}-10-31`);
		// 4 days x 2 classes, exactly one row per pair.
		expect(sessions).toHaveLength(8);
		const pairs = new Set((sessions ?? []).map((s) => `${s.class_id}:${s.day}`));
		expect(pairs.size).toBe(8);
	});

	it('a class created after class days exist gets a session on each of them', async () => {
		const year = randomYear();
		await addDays([`${year}-03-01`, `${year}-03-08`, `${year}-03-15`]);
		const classId = await createClass('Late Class');

		const { data } = await adminClient
			.from('class_sessions_effective')
			.select('day')
			.eq('class_id', classId)
			.gte('day', `${year}-03-01`)
			.lte('day', `${year}-03-31`)
			.order('day');
		expect((data ?? []).map((s) => s.day)).toEqual([
			`${year}-03-01`,
			`${year}-03-08`,
			`${year}-03-15`
		]);
	});

	it('class days are admin-write only, readable by every signed-in role, never deleted, and sessions are trigger-only', async () => {
		const year = randomYear();
		const classId = await createClass('Access Days');
		const [created] = await addDays([`${year}-05-03`]);
		const student = await createSignedInStudent([classId]);

		const { error: teacherInsert } = await teacherA.client
			.from('class_days')
			.insert({ day: `${year}-05-10` });
		expect(teacherInsert).not.toBeNull();
		const { error: studentInsert } = await student.client
			.from('class_days')
			.insert({ day: `${year}-05-10` });
		expect(studentInsert).not.toBeNull();

		for (const client of [teacherA.client, teacherB.client, student.client]) {
			const { data } = await client.from('class_days').select('id').eq('id', created.id);
			expect(data).toEqual([{ id: created.id }]);
		}
		const { data: anonDays } = await anonClient()
			.from('class_days')
			.select('id')
			.eq('id', created.id);
		expect(anonDays ?? []).toEqual([]);

		const { data: teacherCancel } = await teacherA.client
			.from('class_days')
			.update({ cancelled: true })
			.eq('id', created.id)
			.select('id');
		expect(teacherCancel ?? []).toEqual([]);

		// No hard delete, not even for the admin.
		await admin.client.from('class_days').delete().eq('id', created.id);
		const { data: stillThere } = await adminClient
			.from('class_days')
			.select('id')
			.eq('id', created.id);
		expect(stillThere).toHaveLength(1);

		// No client insert into sessions, and a session can't be moved.
		const { error: sessionInsert } = await admin.client
			.from('class_sessions')
			.insert({ class_id: classId, class_day_id: created.id });
		expect(sessionInsert).not.toBeNull();
		const otherClass = await createClass('Access Other');
		const { error: moveError } = await teacherA.client
			.from('class_sessions')
			.update({ class_id: otherClass })
			.eq('id', await sessionId(classId, `${year}-05-03`));
		expect(moveError).not.toBeNull();
	});

	it('override one day: only that session changes; a default change reaches only non-overridden sessions', async () => {
		const year = randomYear();
		const classId = await createClass('Override');
		await addDays([`${year}-06-07`, `${year}-06-14`]);

		const { error: defaultError } = await teacherA.client.rpc('set_class_default', {
			p_class_id: classId,
			p_start_time: '10:00',
			p_duration_minutes: 90
		});
		expect(defaultError).toBeNull();

		const overridden = await sessionId(classId, `${year}-06-14`);
		const { data: updated, error } = await teacherA.client
			.from('class_sessions')
			.update({ start_time_override: '11:00' })
			.eq('id', overridden)
			.select('id, updated_by');
		expect(error).toBeNull();
		expect(updated).toEqual([{ id: overridden, updated_by: teacherA.id }]);

		expect(await effective(classId, `${year}-06-07`)).toMatchObject({
			start_time: '10:00:00',
			duration_minutes: 90
		});
		expect(await effective(classId, `${year}-06-14`)).toMatchObject({
			start_time: '11:00:00',
			duration_minutes: 90
		});
		const { data: cls } = await adminClient
			.from('classes')
			.select('default_start_time')
			.eq('id', classId)
			.single();
		expect(cls?.default_start_time).toBe('10:00:00');

		await teacherA.client.rpc('set_class_default', {
			p_class_id: classId,
			p_start_time: '09:30',
			p_duration_minutes: 90
		});
		expect((await effective(classId, `${year}-06-07`)).start_time).toBe('09:30:00');
		expect((await effective(classId, `${year}-06-14`)).start_time).toBe('11:00:00');

		// Out-of-range duration is rejected by the check constraint.
		const { error: rangeError } = await teacherA.client
			.from('class_sessions')
			.update({ duration_minutes_override: 5 })
			.eq('id', overridden)
			.select('id');
		expect(rangeError).not.toBeNull();
	});

	it('admin sets the default of a class they do not teach, and NULL/NULL clears it again', async () => {
		const year = randomYear();
		const classId = await createClass('Admin Default', [teacherB.id]);
		await addDays([`${year}-08-02`]);

		const { error: setError } = await admin.client.rpc('set_class_default', {
			p_class_id: classId,
			p_start_time: '14:00',
			p_duration_minutes: 60
		});
		expect(setError).toBeNull();
		expect(await effective(classId, `${year}-08-02`)).toMatchObject({
			start_time: '14:00:00',
			duration_minutes: 60
		});

		const { error: clearError } = await admin.client.rpc('set_class_default', {
			p_class_id: classId,
			p_start_time: null,
			p_duration_minutes: null
		});
		expect(clearError).toBeNull();
		expect(await effective(classId, `${year}-08-02`)).toMatchObject({
			start_time: null,
			duration_minutes: null
		});
	});

	it('no default: the effective start time stays null (Time not set)', async () => {
		const year = randomYear();
		const classId = await createClass('No Default');
		await addDays([`${year}-07-05`]);
		expect(await effective(classId, `${year}-07-05`)).toMatchObject({
			start_time: null,
			duration_minutes: null,
			cancelled: false
		});
	});

	it('cancel class day cancels every session; restore returns each session to its own prior state', async () => {
		const year = randomYear();
		const classA = await createClass('Cancel A');
		const classB = await createClass('Cancel B');
		const day = `${year}-09-06`;
		await addDays([day]);
		const id = await dayId(day);

		// classA's session is cancelled on its own first.
		const { data: ownCancel } = await teacherA.client
			.from('class_sessions')
			.update({ cancelled: true })
			.eq('id', await sessionId(classA, day))
			.select('id');
		expect(ownCancel).toHaveLength(1);
		expect((await effective(classB, day)).cancelled).toBe(false);

		const { data: cancelled, error } = await admin.client
			.from('class_days')
			.update({ cancelled: true })
			.eq('id', id)
			.select('id');
		expect(error).toBeNull();
		expect(cancelled).toHaveLength(1);
		expect((await effective(classA, day)).cancelled).toBe(true);
		expect((await effective(classB, day)).cancelled).toBe(true);

		await admin.client.from('class_days').update({ cancelled: false }).eq('id', id);
		expect(await effective(classA, day)).toMatchObject({
			cancelled: true,
			session_cancelled: true,
			day_cancelled: false
		});
		expect(await effective(classB, day)).toMatchObject({
			cancelled: false,
			session_cancelled: false
		});
	});

	it('a teacher not assigned to the class is denied: no rows updated, default rpc refused', async () => {
		const year = randomYear();
		const classId = await createClass('Other Teacher');
		await addDays([`${year}-04-04`]);
		const id = await sessionId(classId, `${year}-04-04`);

		const { data: visible } = await teacherB.client
			.from('class_sessions')
			.select('id')
			.eq('id', id);
		expect(visible ?? []).toEqual([]);

		const { data: updated } = await teacherB.client
			.from('class_sessions')
			.update({ cancelled: true })
			.eq('id', id)
			.select('id');
		expect(updated ?? []).toEqual([]);
		expect((await effective(classId, `${year}-04-04`)).cancelled).toBe(false);

		const { error } = await teacherB.client.rpc('set_class_default', {
			p_class_id: classId,
			p_start_time: '08:00',
			p_duration_minutes: 60
		});
		expect(error).not.toBeNull();
	});

	it("a student sees both enrolled classes' sessions read-only and no other class's", async () => {
		const year = randomYear();
		const classA = await createClass('Student A');
		const classB = await createClass('Student B');
		const classC = await createClass('Student C');
		const day = `${year}-11-01`;
		await addDays([day]);
		const student = await createSignedInStudent([classA, classB]);

		const { data, error } = await student.client
			.from('class_sessions_effective')
			.select('id, class_id, class_name')
			.eq('day', day);
		expect(error).toBeNull();
		const classIds = new Set((data ?? []).map((s) => s.class_id));
		expect(classIds).toEqual(new Set([classA, classB]));
		expect(classIds.has(classC)).toBe(false);
		expect((data ?? []).every((s) => s.class_name?.startsWith('Story 6-1'))).toBe(true);

		const { data: updated } = await student.client
			.from('class_sessions')
			.update({ cancelled: true })
			.eq('id', await sessionId(classA, day))
			.select('id');
		expect(updated ?? []).toEqual([]);
		expect((await effective(classA, day)).cancelled).toBe(false);

		const { error: rpcError } = await student.client.rpc('set_class_default', {
			p_class_id: classA,
			p_start_time: '08:00',
			p_duration_minutes: 60
		});
		expect(rpcError).not.toBeNull();
	});

	it('two teachers of one class editing different sessions at once both persist', async () => {
		const year = randomYear();
		const classId = await createClass('Concurrent', [teacherA.id, teacherA2.id]);
		await addDays([`${year}-02-07`, `${year}-02-14`]);
		const first = await sessionId(classId, `${year}-02-07`);
		const second = await sessionId(classId, `${year}-02-14`);

		const [a, b] = await Promise.all([
			teacherA.client
				.from('class_sessions')
				.update({ start_time_override: '11:00' })
				.eq('id', first)
				.select('id'),
			teacherA2.client
				.from('class_sessions')
				.update({ duration_minutes_override: 45 })
				.eq('id', second)
				.select('id')
		]);
		expect(a.data).toHaveLength(1);
		expect(b.data).toHaveLength(1);

		const { data } = await adminClient
			.from('class_sessions')
			.select('id, start_time_override, duration_minutes_override, updated_by')
			.in('id', [first, second]);
		const byId = new Map((data ?? []).map((s) => [s.id, s]));
		expect(byId.get(first)).toMatchObject({
			start_time_override: '11:00:00',
			duration_minutes_override: null,
			updated_by: teacherA.id
		});
		expect(byId.get(second)).toMatchObject({
			start_time_override: null,
			duration_minutes_override: 45,
			updated_by: teacherA2.id
		});
	});
});
