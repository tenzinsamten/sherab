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

			// Approved before student2 registers -- otherwise
			// profiles_open_student_registration_unique would block a second
			// Pending row for the identical (class, name) pair (Boundaries).
			const approval1 = await approveWithUsernameSnapshot(student1.id!, dupName, new Set());

			const student2 = await signUpStudent({ classId: classAId, registrationName: dupName });
			expect(student2.error).toBeNull();

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
					...(params.recurrenceRule !== undefined ? { recurrence_rule: params.recurrenceRule } : {})
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
				recurrenceRule: { freq: 'weekly' }
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
