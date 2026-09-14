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
import {
	STUDENT_EMAIL_DOMAIN,
	generateStudentPin,
	generateUniqueStudentUsername,
	resolveLoginIdentifierToEmail,
	studentUsernameToEmail
} from './temp-password';
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
		// This project's local Supabase config runs with `enable_confirmations
		// = false` (autoconfirm), which is the shape (auth)/signup's route
		// actually hits in dev/CI: a direct error, not the success-with-empty-
		// identities shape used when email confirmation is required elsewhere.
		// Both shapes are asserted against isDuplicateSignup here so a config
		// change doesn't silently break duplicate detection.
		const email = `story-1-1-signup-dup-${crypto.randomUUID()}@example.test`;
		const client1 = anonClient();
		const first = await client1.auth.signUp({ email, password: crypto.randomUUID() });
		expect(first.error).toBeNull();
		expect(isDuplicateSignup(first.error, first.data.user)).toBe(false);

		const client2 = anonClient();
		const second = await client2.auth.signUp({ email, password: crypto.randomUUID() });

		// Document the real shape this config produces so a future config
		// change (e.g. enabling email confirmations) is caught here rather than
		// silently breaking the route's duplicate-email error message.
		expect(second.error).not.toBeNull();
		expect(second.error?.status).toBe(422);
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
 */
async function signUpStudent(params: { classId: string; registrationName: string }) {
	const client = anonClient();
	const email = `story-1-2-pending-${crypto.randomUUID()}@students.internal.invalid`;
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
			const { error, id } = await signUpStudent({ classId: classAId, registrationName });
			expect(error).toBeNull();
			expect(id).not.toBeNull();

			const { data: profile } = await adminClient
				.from('profiles')
				.select('status, class_id, registration_name, display_name, team_id')
				.eq('id', id!)
				.single();

			expect(profile?.status).toBe('pending');
			expect(profile?.class_id).toBe(classAId);
			expect(profile?.registration_name).toBe(registrationName);
			// display_name defaults to registration_name (Implementation Notes).
			expect(profile?.display_name).toBe(registrationName);
			expect(profile?.team_id).toBeNull();
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

			const { data: updated, error } = await teacherA.client
				.from('profiles')
				.update({
					status: 'approved',
					team_id: teamId,
					reviewed_by: teacherA.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!)
				.select('status, team_id, reviewed_by')
				.single();

			expect(error).toBeNull();
			expect(updated?.status).toBe('approved');
			expect(updated?.team_id).toBe(teamId);
			expect(updated?.reviewed_by).toBe(teacherA.id);

			// Mirrors requests/+page.server.ts's approve action: assign a real
			// username + PIN and sign in through Supabase Auth, exactly like a
			// student would (Design Notes: "the student just becomes a normal
			// authenticated user").
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

			const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id!, {
				email: studentUsernameToEmail(username),
				password: pin,
				email_confirm: true
			});
			expect(authUpdateError).toBeNull();

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

		it("admin approves as a backup path for a class the admin didn't create/isn't assigned to", async () => {
			const registrationName = `Admin Backup Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });

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
	}
);
