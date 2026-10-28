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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { isDuplicateSignup } from './signup-duplicate';
import { isDuplicateEmailError } from './student-credentials';
import { approvedParentExists, emailHasLogin } from './parent-registration';
import { buildHomeworkProgress, type HomeworkHistoryRow } from './homework-status';
import {
	STUDENT_EMAIL_DOMAIN,
	generateStudentPin,
	generateUniqueStudentUsername,
	resolveLoginIdentifierToEmail,
	studentUsernameToEmail
} from './temp-password';
import { updateAuthUserEmailAndPassword } from '$lib/supabase/admin';
import { todayInBerlin } from '$lib/berlin-date';
import {
	FILE_LIMIT_ERROR_CODE,
	SYLLABUS_FILES_BUCKET,
	removeStoredFiles,
	signedFileUrl
} from './syllabus-files';
import {
	HOMEWORK_FILES_BUCKET,
	HOMEWORK_FILE_LIMIT_ERROR_CODE,
	loadHomeworkFiles,
	removeStoredFiles as removeStoredHomeworkFiles,
	signedFileUrl as signedHomeworkFileUrl
} from './homework-files';
import type { Database } from './../supabase/database.types';
import { linkParent } from './testing/link-parent';

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
		app_metadata: { role }
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

/**
 * Story 6-2: attendance marks reference a class session. Returns the session
 * of `classId` on `day`, creating the class day and an extra session if
 * needed -- through the 0021 backfill function (service role), so fixtures
 * map a (class, date) onto a session exactly the way the migration did.
 */
async function sessionFor(classId: string, day: string): Promise<string> {
	const { data, error } = await adminClient.rpc('attendance_backfill_session', {
		p_class_id: classId,
		p_day: day
	});
	if (error || !data) throw new Error(`Failed to get a session: ${error?.message}`);
	return data;
}

/**
 * #99: the database gives a team to every student approved without one
 * (0043), fixtures of the service role too, and refuses the approval while
 * there is no team. A fixture with no team of its own names this one, so its
 * student lands in no team another test counts.
 */
let fixtureTeam: Promise<string> | undefined;
function fixtureTeamId(): Promise<string> {
	fixtureTeam ??= (async () => {
		const { data, error } = await adminClient
			.from('teams')
			.insert({ name: `Fixture Team ${crypto.randomUUID().slice(0, 6)}` })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create the fixture team: ${error?.message}`);
		return data.id;
	})();
	return fixtureTeam;
}

/**
 * The past day Story 2-1's attendance fixtures use. Far in the past, so the
 * shared calendar's real (recent) class days are left alone.
 */
const ATTENDANCE_DAY = '1899-09-17';

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

	it('admin bootstrap: an Admin-API-created account promoted to admin is idempotent', async () => {
		// The public /signup page is gone (#50). The documented bootstrap
		// creates the first account through the Admin API (service role, role
		// in app_metadata -- handle_new_user() refuses any account without a
		// role, 0020), then runs the one-time promote SQL.
		const email = `story-1-1-bootstrap-${crypto.randomUUID()}@example.test`;
		const created = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'teacher' }
		});
		expect(created.error).toBeNull();

		const { data: userRow } = await adminClient
			.from('profiles')
			.select('id, role')
			.eq('email', email)
			.single();
		expect(userRow?.role).toBe('teacher');

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
	});

	it('creating an auth user with an already-registered email fails with a duplicate-identifiable error', async () => {
		const email = `story-1-1-dup-${crypto.randomUUID()}@example.test`;
		const first = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'teacher' }
		});
		expect(first.error).toBeNull();

		const second = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'teacher' }
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

	it('register/+page.server.ts duplicate-email detection matches the real signUp response shape', async () => {
		// The parent /register action signs up with the parent's real email, so
		// a second registration for the same email is a duplicate signUp.
		// (Student /join no longer uses signUp at all since Story 7-2.)
		// Local Supabase config matches production's `enable_confirmations
		// = true`: a duplicate email does NOT error from signUp() -- it returns
		// success with the pre-existing user's REAL, non-empty identity (same
		// id, same created_at) while silently resending a confirmation email
		// and bumping updated_at. isDuplicateSignup() must detect this shape,
		// not just a thrown error or an empty-identities array that this
		// GoTrue version doesn't actually produce here.
		const email = `story-1-1-register-dup-${crypto.randomUUID()}@example.test`;
		const client1 = anonClient();
		// A parent sign-up, as /register sends it: since #50 (0020) a sign-up
		// with no role is refused outright.
		const parentSignUp = (password: string) => ({
			email,
			password,
			options: { data: { role: 'parent', display_name: 'Dup Shape Parent' } }
		});
		const first = await client1.auth.signUp(parentSignUp(crypto.randomUUID()));
		expect(first.error).toBeNull();
		expect(isDuplicateSignup(first.error, first.data.user)).toBe(false);

		// GoTrue enforces a real per-email resend cooldown (auth.email.max_frequency,
		// "1s" locally) independent of enable_confirmations -- no real user could
		// ever submit the identical email twice within the same millisecond, but
		// this test does, so it must wait past that window first.
		await new Promise((resolve) => setTimeout(resolve, 1100));

		const client2 = anonClient();
		const second = await client2.auth.signUp(parentSignUp(crypto.randomUUID()));

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

	it('badge detail CAP-1: classes.badge_subject only takes language, dance or instrument (0047)', async () => {
		const code = () => `BS${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
		const name = (label: string) => `Badge subject ${label} ${crypto.randomUUID().slice(0, 6)}`;

		const song = await admin.client
			.from('classes')
			.insert({ name: name('song'), code: code(), badge_subject: 'song' });
		expect(song.error?.code).toBe('23514');

		const { data: dance, error } = await admin.client
			.from('classes')
			.insert({ name: name('dance'), code: code(), badge_subject: 'dance' })
			.select('id, badge_subject')
			.single();
		expect(error).toBeNull();
		expect(dance?.badge_subject).toBe('dance');
		await admin.client.from('classes').delete().eq('id', dance!.id);
	});

	it('badge detail CAP-1: a teacher can still save the schedule of a class with no subject', async () => {
		const { data: cls, error } = await admin.client
			.from('classes')
			.insert({
				name: `Badge subject unset ${crypto.randomUUID().slice(0, 6)}`,
				code: `BU${crypto.randomUUID().slice(0, 4).toUpperCase()}`
			})
			.select('id, badge_subject')
			.single();
		expect(error).toBeNull();
		expect(cls?.badge_subject).toBeNull();
		const { error: assignError } = await admin.client
			.from('class_teachers')
			.insert({ class_id: cls!.id, teacher_id: teacherA.id });
		expect(assignError).toBeNull();

		const { error: scheduleError } = await teacherA.client.rpc('set_class_schedule', {
			p_class_id: cls!.id,
			p_weekdays: [7],
			p_start_time: '10:00',
			p_duration_minutes: 90,
			p_starts_on: '3999-01-01',
			p_ends_on: null
		});
		expect(scheduleError).toBeNull();

		await admin.client.from('class_teachers').delete().eq('class_id', cls!.id);
		await admin.client.from('classes').delete().eq('id', cls!.id);
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
 * Issue #50 (AD-4, migration 0020): handle_new_user() takes admin/teacher
 * only from app_metadata (service role only). The one role client metadata
 * may carry is 'student'; anything else refuses the whole sign-up.
 */
describe.skipIf(!reachable)('Issue #50 sign-up role (requires local Supabase)', () => {
	let classId: string;

	beforeAll(async () => {
		const { data, error } = await adminClient
			.from('classes')
			.insert({
				name: `Issue 50 Class ${crypto.randomUUID().slice(0, 6)}`,
				code: `R${crypto.randomUUID().slice(0, 5).toUpperCase()}`
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		classId = data.id;
	});

	/** No auth user exists for the email: creating one now is not a duplicate. */
	async function expectNoAccount(email: string) {
		const { data: profiles } = await adminClient.from('profiles').select('id').eq('email', email);
		expect(profiles).toEqual([]);

		const probe = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'teacher' }
		});
		expect(probe.error).toBeNull();
		await adminClient.auth.admin.deleteUser(probe.data.user!.id);
	}

	it.each([
		['forged admin', { role: 'admin' }],
		['forged teacher', { role: 'teacher' }],
		['no role', undefined]
	])('public signUp with %s is refused: no auth user, no profile', async (_label, data) => {
		const email = `issue-50-forged-${crypto.randomUUID()}@example.test`;
		const { data: result, error } = await anonClient().auth.signUp({
			email,
			password: crypto.randomUUID(),
			...(data ? { options: { data } } : {})
		});
		expect(error).not.toBeNull();
		expect(result.user).toBeNull();
		await expectNoAccount(email);
	});

	it('student join signUp still lands a Pending student profile', async () => {
		const registrationName = `Issue 50 Student ${crypto.randomUUID().slice(0, 8)}`;
		const { error, id } = await signUpStudent({ classId, registrationName });
		expect(error).toBeNull();

		const { data: profile } = await adminClient
			.from('profiles')
			.select('role, status, class_id, registration_name')
			.eq('id', id!)
			.single();
		expect(profile).toEqual({
			role: 'student',
			status: 'pending',
			class_id: classId,
			registration_name: registrationName
		});
	});

	it('admin createUser with app_metadata teacher gives a teacher profile, and a duplicate is still detected', async () => {
		const email = `issue-50-teacher-${crypto.randomUUID()}@example.test`;
		const create = () =>
			adminClient.auth.admin.createUser({
				email,
				password: crypto.randomUUID(),
				email_confirm: true,
				app_metadata: { role: 'teacher' },
				user_metadata: { display_name: 'Issue 50 Teacher' }
			});
		const first = await create();
		expect(first.error).toBeNull();

		const { data: profile } = await adminClient
			.from('profiles')
			.select('role, display_name, status')
			.eq('id', first.data.user!.id)
			.single();
		expect(profile).toEqual({ role: 'teacher', display_name: 'Issue 50 Teacher', status: null });

		const second = await create();
		expect(second.error).not.toBeNull();
		const isDuplicate =
			second.error?.code === 'email_exists' ||
			/already.*registered|exists/i.test(second.error?.message ?? '');
		expect(isDuplicate).toBe(true);
	});

	it('service-role createUser with app_metadata admin gives an admin profile', async () => {
		const { data, error } = await adminClient.auth.admin.createUser({
			email: `issue-50-admin-${crypto.randomUUID()}@example.test`,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'admin' }
		});
		expect(error).toBeNull();
		const { data: profile } = await adminClient
			.from('profiles')
			.select('role')
			.eq('id', data.user!.id)
			.single();
		expect(profile?.role).toBe('admin');
	});

	it('mixed: app_metadata teacher wins over user_metadata admin', async () => {
		const { data, error } = await adminClient.auth.admin.createUser({
			email: `issue-50-mixed-${crypto.randomUUID()}@example.test`,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'teacher' },
			user_metadata: { role: 'admin' }
		});
		expect(error).toBeNull();
		const { data: profile } = await adminClient
			.from('profiles')
			.select('role')
			.eq('id', data.user!.id)
			.single();
		expect(profile?.role).toBe('teacher');
	});

	it('admin createUser with app_metadata parent gives a parent profile and a pending parents row (Story 7-1)', async () => {
		const email = `issue-50-parent-${crypto.randomUUID()}@example.test`;
		const { data, error } = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'parent' }
		});
		expect(error).toBeNull();
		const { data: profile } = await adminClient
			.from('profiles')
			.select('role')
			.eq('id', data.user!.id)
			.single();
		expect(profile?.role).toBe('parent');
		const { data: parentRow } = await adminClient
			.from('parents')
			.select('status')
			.eq('id', data.user!.id)
			.single();
		expect(parentRow?.status).toBe('pending');
	});

	it('admin createUser with an unknown app_metadata role is refused, no profile', async () => {
		const email = `issue-50-unknown-${crypto.randomUUID()}@example.test`;
		const { data, error } = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'superuser' }
		});
		expect(error).not.toBeNull();
		expect(data.user).toBeNull();
		await expectNoAccount(email);
	});

	it('admin createUser with no role at all (e.g. Studio "Add user") is refused', async () => {
		const email = `issue-50-norole-${crypto.randomUUID()}@example.test`;
		const { error } = await adminClient.auth.admin.createUser({
			email,
			password: crypto.randomUUID(),
			email_confirm: true
		});
		expect(error).not.toBeNull();
		await expectNoAccount(email);
	});
});

/**
 * Story 7-2: an approved parent, created the trusted way (Admin API with
 * app_metadata 'parent', pre-confirmed) and approved with the service role.
 * The admin-decision path itself is covered by the 7-1 block.
 */
async function createApprovedParent(
	email = `story-7-2-parent-${crypto.randomUUID()}@example.test`
) {
	const password = crypto.randomUUID();
	const { data, error } = await adminClient.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role: 'parent' },
		user_metadata: { display_name: 'Approved Parent' }
	});
	if (error || !data.user) throw new Error(`Failed to create parent: ${error?.message}`);
	const { error: approveError } = await adminClient
		.from('parents')
		.update({ status: 'approved' })
		.eq('id', data.user.id);
	if (approveError) throw new Error(`Failed to approve parent: ${approveError.message}`);
	return { id: data.user.id, email, password };
}

/**
 * spec-second-parent: a parent login whose parents row stays pending. Since
 * 0054 a parent with linked children cannot be rejected, so a linked parent
 * who is not approved is a pending one, linked with the service role.
 */
async function createPendingParent(
	email = `ssp-pending-parent-${crypto.randomUUID()}@example.test`
) {
	const password = crypto.randomUUID();
	const { data, error } = await adminClient.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role: 'parent' },
		user_metadata: { display_name: 'Pending Parent' }
	});
	if (error || !data.user) throw new Error(`Failed to create parent: ${error?.message}`);
	return { id: data.user.id, email, password };
}

/** One approved parent shared by every signUpStudent() call without its own guardian email. */
let sharedParent: ReturnType<typeof createApprovedParent> | null = null;
function defaultParent() {
	sharedParent ??= createApprovedParent();
	return sharedParent;
}

/**
 * Signs up a student exactly the way (auth)/join's `register` action does
 * (Story 7-2): Admin API createUser with a synthetic, pre-confirmed
 * `pending-<uuid>` address and user_metadata role 'student' plus the
 * guardian email. handle_new_user() links the approved parent with that
 * email, or refuses the whole sign-up. Defaults to a shared approved parent.
 *
 * #100: with `credentials` the action's second step follows -- the username
 * address and the PIN on the auth user, and the address on the profile.
 * `credentialsError` is that step's refusal (a taken username). Without
 * `credentials` it is a registration from before #100.
 */
async function signUpStudent(params: {
	classId: string;
	registrationName: string;
	guardianEmail?: string;
	credentials?: { username: string; pin: string };
}) {
	const guardianEmail = params.guardianEmail ?? (await defaultParent()).email;
	const { data, error } = await adminClient.auth.admin.createUser({
		email: `pending-${crypto.randomUUID()}@${STUDENT_EMAIL_DOMAIN}`,
		password: crypto.randomUUID(),
		email_confirm: true,
		user_metadata: {
			role: 'student',
			class_id: params.classId,
			registration_name: params.registrationName,
			guardian_consent_given_at: new Date().toISOString(),
			guardian_email: guardianEmail
		}
	});
	const id = data.user?.id ?? null;
	let credentialsError: { code?: string; message: string } | null = null;
	if (id && params.credentials) {
		const email = studentUsernameToEmail(params.credentials.username);
		credentialsError = (
			await updateAuthUserEmailAndPassword(id, { email, password: params.credentials.pin })
		).error;
		if (!credentialsError) {
			const { error: profileError } = await adminClient
				.from('profiles')
				.update({ email })
				.eq('id', id)
				.select('id')
				.single();
			if (profileError) throw new Error(`Failed to record the username: ${profileError.message}`);
		}
	}
	return { data, error, id, credentialsError };
}

/**
 * Simulates a parent clicking their confirmation link, without a real
 * mailbox: flips auth.users.email_confirmed_at via the Admin API, which the
 * on_auth_user_email_confirmed trigger (migration 0006) mirrors onto
 * profiles.email_confirmed_at -- the signal parent approval (7-1) gates on.
 * Student approval no longer needs it (Story 7-2).
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

			// #99: the database assigns the team at approval (0043) and refuses an
			// approval while there is no team, so one has to exist.
			const { error: teamError } = await admin.client
				.from('teams')
				.insert({ name: `Story 1-2 Team ${crypto.randomUUID().slice(0, 6)}` });
			if (teamError) throw new Error(`Failed to create team: ${teamError.message}`);
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

		it('student registers: the Admin API sign-up lands a Pending, parent-linked profiles row with a synthetic pre-confirmed email', async () => {
			const registrationName = `Pending Student ${crypto.randomUUID().slice(0, 8)}`;
			const parent = await createApprovedParent();
			const { error, id } = await signUpStudent({
				classId: classAId,
				registrationName,
				guardianEmail: parent.email
			});
			expect(error).toBeNull();
			expect(id).not.toBeNull();

			const { data: profile } = await adminClient
				.from('profiles')
				.select(
					'email, status, class_id, registration_name, display_name, team_id, guardian_email, registered_by_parent_id, email_confirmed_at'
				)
				.eq('id', id!)
				.single();

			expect(profile?.status).toBe('pending');
			expect(profile?.class_id).toBe(classAId);
			expect(profile?.registration_name).toBe(registrationName);
			// display_name defaults to registration_name (Implementation Notes).
			expect(profile?.display_name).toBe(registrationName);
			expect(profile?.team_id).toBeNull();
			expect(profile?.guardian_email).toBe(parent.email);
			expect(profile?.registered_by_parent_id).toBe(parent.id);
			// Story 7-2: synthetic, pre-confirmed auth email; no mail is sent.
			expect(profile?.email).toMatch(/^pending-[0-9a-f-]+@students\.internal\.invalid$/);
			expect(profile?.email_confirmed_at).not.toBeNull();
		});

		it('a Pending student is invisible to an unrelated teacher (not assigned to their class)', async () => {
			const registrationName = `Invisible Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });

			const { data, error } = await teacherB.client.from('profiles').select('id').eq('id', id!);
			expect(error).toBeNull();
			expect(data).toEqual([]);
		});

		describe('#98 one student account per parent and name', () => {
			let otherClassId: string;

			beforeAll(async () => {
				const { data: other, error } = await adminClient
					.from('classes')
					.insert({
						name: `Issue 98 Other Class ${crypto.randomUUID().slice(0, 8)}`,
						code: `N${crypto.randomUUID().slice(0, 5).toUpperCase()}`
					})
					.select('id')
					.single();
				if (error || !other) throw new Error(`Failed to create the other class: ${error?.message}`);
				otherClassId = other.id;
			});

			function childName(label: string) {
				return `${label} ${crypto.randomUUID().slice(0, 8)}`;
			}

			async function stateOf(guardianEmail: string, registrationName: string) {
				const { data, error } = await adminClient.rpc('student_registration_state', {
					p_guardian_email: guardianEmail,
					p_registration_name: registrationName
				});
				if (error) throw new Error(`student_registration_state: ${error.message}`);
				return data;
			}

			async function studentCount(parentId: string) {
				const { data, error } = await adminClient
					.from('profiles')
					.select('id')
					.eq('role', 'student')
					.eq('registered_by_parent_id', parentId);
				if (error) throw new Error(`count students: ${error.message}`);
				return (data ?? []).length;
			}

			/** The teacher's decision on a registration, as on /requests (status only matters here). */
			async function decide(studentId: string, status: 'approved' | 'rejected') {
				const { data, error } = await teacherA.client
					.from('profiles')
					.update({
						status,
						reviewed_by: teacherA.id,
						reviewed_at: new Date().toISOString()
					})
					.eq('id', studentId)
					.select('status');
				if (error) throw new Error(`decide ${status}: ${error.message}`);
				expect(data).toEqual([{ status }]);
			}

			it('new child: the state is available and the registration is created', async () => {
				const parent = await createApprovedParent();
				const name = childName('New Child');
				expect(await stateOf(parent.email, name)).toBe('available');

				const { error, id } = await signUpStudent({
					classId: classAId,
					registrationName: name,
					guardianEmail: parent.email
				});
				expect(error).toBeNull();
				expect(id).not.toBeNull();
				expect(await stateOf(parent.email, name)).toBe('pending');
			});

			it('pending: the same parent and name is refused in the same class and in another class', async () => {
				const parent = await createApprovedParent();
				const name = childName('Pending Child');
				const first = await signUpStudent({
					classId: classAId,
					registrationName: name,
					guardianEmail: parent.email
				});
				expect(first.error).toBeNull();
				expect(await stateOf(parent.email, name)).toBe('pending');

				// The lookup is what the route relies on for a friendly message;
				// this proves the DB-level backstop
				// (profiles_student_parent_name_unique) is real too.
				for (const classId of [classAId, otherClassId]) {
					const again = await signUpStudent({
						classId,
						registrationName: name,
						guardianEmail: parent.email
					});
					expect(again.error).not.toBeNull();
					expect(again.id).toBeNull();
				}
				expect(await studentCount(parent.id)).toBe(1);
			});

			it('already approved, other class: refused, and the state says approved', async () => {
				const parent = await createApprovedParent();
				const name = childName('Approved Child');
				const first = await signUpStudent({
					classId: classAId,
					registrationName: name,
					guardianEmail: parent.email
				});
				expect(first.error).toBeNull();
				await decide(first.id!, 'approved');
				expect(await stateOf(parent.email, name)).toBe('approved');

				const second = await signUpStudent({
					classId: otherClassId,
					registrationName: name,
					guardianEmail: parent.email
				});
				expect(second.error).not.toBeNull();
				expect(second.id).toBeNull();
				expect(await studentCount(parent.id)).toBe(1);
			});

			it('rejected: keeps blocking the same parent and name, in any class, until it is cleared', async () => {
				const parent = await createApprovedParent();
				const name = childName('Rejected Child');
				const first = await signUpStudent({
					classId: classAId,
					registrationName: name,
					guardianEmail: parent.email
				});
				expect(first.error).toBeNull();
				await decide(first.id!, 'rejected');
				expect(await stateOf(parent.email, name)).toBe('rejected');

				const second = await signUpStudent({
					classId: otherClassId,
					registrationName: name,
					guardianEmail: parent.email
				});
				expect(second.error).not.toBeNull();
				expect(await studentCount(parent.id)).toBe(1);

				// CLEAR REJECTED deletes the account; the name is free again.
				const { error: deleteError } = await adminClient.auth.admin.deleteUser(first.id!);
				expect(deleteError).toBeNull();
				expect(await stateOf(parent.email, name)).toBe('available');
				const third = await signUpStudent({
					classId: otherClassId,
					registrationName: name,
					guardianEmail: parent.email
				});
				expect(third.error).toBeNull();
			});

			it('case and spaces: " tenzin dolma " with P@Example.com is the same child as "Tenzin Dolma"', async () => {
				const tag = crypto.randomUUID().slice(0, 8);
				const parent = await createApprovedParent(`issue-98-parent-${tag}@example.test`);
				const name = `Tenzin Dolma ${tag}`;
				const first = await signUpStudent({
					classId: classAId,
					registrationName: name,
					guardianEmail: parent.email
				});
				expect(first.error).toBeNull();

				const otherSpelling = `  ${name.toLowerCase()}  `;
				const otherEmail = ` ${parent.email.replace('issue-98-parent', 'Issue-98-PARENT')} `;
				expect(otherEmail.trim()).not.toBe(parent.email);
				expect(await stateOf(otherEmail, otherSpelling)).toBe('pending');

				const second = await signUpStudent({
					classId: otherClassId,
					registrationName: otherSpelling,
					guardianEmail: otherEmail
				});
				expect(second.error).not.toBeNull();
				expect(await studentCount(parent.id)).toBe(1);
			});

			it('no fuzzy matching: a different spelling is a different child', async () => {
				const parent = await createApprovedParent();
				const name = childName('Tenzin Dolma');
				expect(
					(
						await signUpStudent({
							classId: classAId,
							registrationName: name,
							guardianEmail: parent.email
						})
					).error
				).toBeNull();

				const otherSpelling = name.replace('Tenzin Dolma', 'Tenzin  Dolma');
				expect(await stateOf(parent.email, otherSpelling)).toBe('available');
				const second = await signUpStudent({
					classId: classAId,
					registrationName: otherSpelling,
					guardianEmail: parent.email
				});
				expect(second.error).toBeNull();
			});

			it('same name, other parent: both are created in the same class, also while the first is pending', async () => {
				const parentP = await createApprovedParent();
				const parentQ = await createApprovedParent();
				const name = childName('Same Name');

				const ofP = await signUpStudent({
					classId: classAId,
					registrationName: name,
					guardianEmail: parentP.email
				});
				expect(ofP.error).toBeNull();
				expect(await stateOf(parentQ.email, name)).toBe('available');

				const ofQ = await signUpStudent({
					classId: classAId,
					registrationName: name,
					guardianEmail: parentQ.email
				});
				expect(ofQ.error).toBeNull();

				const { data: rows } = await adminClient
					.from('profiles')
					.select('registered_by_parent_id, status, class_id')
					.in('id', [ofP.id!, ofQ.id!]);
				expect(rows).toHaveLength(2);
				expect(new Set(rows?.map((r) => r.registered_by_parent_id))).toEqual(
					new Set([parentP.id, parentQ.id])
				);
				expect(rows?.every((r) => r.status === 'pending' && r.class_id === classAId)).toBe(true);
			});

			it('sibling: the same parent registers a child with another name', async () => {
				const parent = await createApprovedParent();
				const first = await signUpStudent({
					classId: classAId,
					registrationName: childName('Tenzin'),
					guardianEmail: parent.email
				});
				expect(first.error).toBeNull();

				const siblingName = childName('Pema');
				expect(await stateOf(parent.email, siblingName)).toBe('available');
				const sibling = await signUpStudent({
					classId: classAId,
					registrationName: siblingName,
					guardianEmail: parent.email
				});
				expect(sibling.error).toBeNull();
				expect(await studentCount(parent.id)).toBe(2);
			});

			it('race: of two registrations for the same parent and name at once, exactly one is created', async () => {
				const parent = await createApprovedParent();
				const name = childName('Race Child');
				const results = await Promise.all(
					[classAId, otherClassId].map((classId) =>
						signUpStudent({ classId, registrationName: name, guardianEmail: parent.email })
					)
				);
				expect(results.filter((r) => r.error === null)).toHaveLength(1);
				expect(await studentCount(parent.id)).toBe(1);
				// What the action re-reads after the failed createUser.
				expect(await stateOf(parent.email, name)).toBe('pending');
			});

			it('students without a parent (service-role fixtures) are outside the rule', async () => {
				const name = childName('No Parent');
				const ids: string[] = [];
				for (let i = 0; i < 2; i++) {
					const { data, error } = await adminClient.auth.admin.createUser({
						email: `issue-98-noparent-${crypto.randomUUID()}@${STUDENT_EMAIL_DOMAIN}`,
						password: crypto.randomUUID(),
						email_confirm: true,
						app_metadata: { role: 'student' },
						user_metadata: { class_id: classAId, registration_name: name }
					});
					expect(error).toBeNull();
					ids.push(data.user!.id);
				}
				const { data: rows } = await adminClient
					.from('profiles')
					.select('registered_by_parent_id, registration_name')
					.in('id', ids);
				expect(rows).toHaveLength(2);
				expect(
					rows?.every((r) => r.registered_by_parent_id === null && r.registration_name === name)
				).toBe(true);
			});

			it('the index also refuses moving a student under a parent who already has that name', async () => {
				const parentP = await createApprovedParent();
				const parentQ = await createApprovedParent();
				const name = childName('Moved Child');
				const ofP = await signUpStudent({
					classId: classAId,
					registrationName: name,
					guardianEmail: parentP.email
				});
				const ofQ = await signUpStudent({
					classId: classAId,
					registrationName: name,
					guardianEmail: parentQ.email
				});
				expect(ofP.error).toBeNull();
				expect(ofQ.error).toBeNull();

				const { error } = await adminClient
					.from('profiles')
					.update({ registered_by_parent_id: parentP.id, guardian_email: parentP.email })
					.eq('id', ofQ.id!);
				expect(error?.code).toBe('23505');
				expect(error?.message).toContain('profiles_student_parent_name_unique');
			});

			it('direct call: anon and a signed-in user may not run student_registration_state()', async () => {
				const parent = await createApprovedParent();
				const name = childName('Probe Child');
				expect(
					(
						await signUpStudent({
							classId: classAId,
							registrationName: name,
							guardianEmail: parent.email
						})
					).error
				).toBeNull();

				for (const client of [anonClient(), teacherA.client, admin.client]) {
					const { data, error } = await client.rpc('student_registration_state', {
						p_guardian_email: parent.email,
						p_registration_name: name
					});
					expect(data).toBeNull();
					expect(error?.code).toBe('42501');
				}
			});

			it('the old rule is gone: check_registration_available() no longer exists', async () => {
				const { data, error } = await (
					anonClient() as unknown as {
						rpc: (
							fn: string,
							args: Record<string, unknown>
						) => Promise<{ data: unknown; error: { code?: string } | null }>;
					}
				).rpc('check_registration_available', {
					p_class_id: classAId,
					p_registration_name: 'Anyone'
				});
				expect(data).toBeNull();
				// PostgREST: function not found in the schema cache.
				expect(error?.code).toBe('PGRST202');
			});
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
					email: studentUsernameToEmail(username),
					reviewed_by: teacherA.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!)
				.select('status, team_id, reviewed_by, email')
				.single();

			expect(error).toBeNull();
			expect(updated?.status).toBe('approved');
			// #99: no team is sent; the database assigned one (which one is the
			// "#99 team assigned at approval" block's business).
			const { data: assignedTeam } = await adminClient
				.from('teams')
				.select('id')
				.eq('id', updated?.team_id ?? '')
				.maybeSingle();
			expect(assignedTeam).toEqual({ id: updated?.team_id });
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

			// #99: the team is the database's choice at approval.
			const { data: approvedRow, error: approveError } = await teacherA.client
				.from('profiles')
				.update({
					status: 'approved',
					reviewed_by: teacherA.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!)
				.select('team_id')
				.single();
			expect(approveError).toBeNull();
			const teamId = approvedRow?.team_id;
			expect(teamId).toEqual(expect.any(String));

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

		it('approval no longer needs email_confirmed_at: the WITH CHECK accepts an assigned teacher even when it is null (Story 7-2)', async () => {
			const registrationName = `Unconfirmed Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });
			// Force the retired gate's input to null: the 0006 clause would refuse this.
			const { error: nullError } = await adminClient
				.from('profiles')
				.update({ email_confirmed_at: null })
				.eq('id', id!);
			expect(nullError).toBeNull();

			const { data, error } = await teacherA.client
				.from('profiles')
				.update({
					status: 'approved',
					reviewed_by: teacherA.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!)
				.select('status')
				.single();

			expect(error).toBeNull();
			expect(data?.status).toBe('approved');
		});

		it('rejecting a registration succeeds for the assigned teacher', async () => {
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

		it('siblings: two children registered with the same parent email while both are pending are both created and linked (Story 7-2)', async () => {
			const parent = await createApprovedParent();

			const child1 = await signUpStudent({
				classId: classAId,
				registrationName: `Sibling One ${crypto.randomUUID().slice(0, 6)}`,
				guardianEmail: parent.email
			});
			const child2 = await signUpStudent({
				classId: classAId,
				registrationName: `Sibling Two ${crypto.randomUUID().slice(0, 6)}`,
				guardianEmail: parent.email
			});
			expect(child1.error).toBeNull();
			expect(child2.error).toBeNull();

			const { data: rows } = await adminClient
				.from('profiles')
				.select('id, status, registered_by_parent_id')
				.in('id', [child1.id!, child2.id!]);
			expect(rows).toHaveLength(2);
			for (const row of rows ?? []) {
				expect(row.status).toBe('pending');
				expect(row.registered_by_parent_id).toBe(parent.id);
			}
		});

		it("admin approves as a backup path for a class the admin didn't create/isn't assigned to", async () => {
			const registrationName = `Admin Backup Student ${crypto.randomUUID().slice(0, 8)}`;
			const { id } = await signUpStudent({ classId: classAId, registrationName });

			const { data, error } = await admin.client
				.from('profiles')
				.update({
					status: 'approved',
					reviewed_by: admin.id,
					reviewed_at: new Date().toISOString()
				})
				.eq('id', id!)
				.select('status')
				.single();

			expect(error).toBeNull();
			expect(data?.status).toBe('approved');
		});

		it('CLEAR REJECTED: deleting the auth user removes the profile row and re-opens the (parent, name) pair for resubmission', async () => {
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
			// does the same (parent, registration_name) pair become available
			// again (Story 1-2 AC 3 / Boundaries; per parent since #98).
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

			const approval1 = await approveWithUsernameSnapshot(student1.id!, dupName, new Set());

			// #98: one student per parent and name
			// (profiles_student_parent_name_unique), so the second student with
			// the identical name has its own parent.
			const otherParent = await createApprovedParent();
			const student2 = await signUpStudent({
				classId: classAId,
				registrationName: dupName,
				guardianEmail: otherParent.email
			});
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
		let attendanceSessionId: string;
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
				app_metadata: { role: 'student' }
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

			attendanceSessionId = await sessionFor(classAId, ATTENDANCE_DAY);

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
					class_session_id: attendanceSessionId,
					recorded_by: teacherA.id
				})
				.select('present, session_date')
				.single();

			expect(error).toBeNull();
			expect(data?.present).toBe(true);
			expect(data?.session_date).toBe(ATTENDANCE_DAY);
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
				class_session_id: attendanceSessionId
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
				class_session_id: attendanceSessionId
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
				class_session_id: attendanceSessionId,
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
				class_session_id: attendanceSessionId,
				recorded_by: teacherA.id
			});
			expect(first.error).toBeNull();

			const second = await teacherA.client.from('attendance_records').insert({
				student_id: studentId,
				class_id: classAId,
				present: true,
				class_session_id: attendanceSessionId,
				recorded_by: teacherA.id
			});
			expect(second.error).toBeNull();

			const { data: rows } = await adminClient
				.from('attendance_records')
				.select('present, recorded_at')
				.eq('student_id', studentId)
				.eq('class_session_id', attendanceSessionId)
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
					class_session_id: attendanceSessionId,
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
				app_metadata: { role: 'student' }
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
				app_metadata: { role: 'student' }
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
				app_metadata: { role: 'student' }
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

		it('#103 a series ended before its first generator run gets no copy, not even for weeks at or before ends_on', async () => {
			const today = todayInBerlin();
			const startDate = addDays(today, -8); // periods: today-8, today-1
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate,
				dueOffsetDays: 0
			});

			// ends_on = today-8: the today-8 period is not after ends_on, and
			// it is still not made -- an ended series makes nothing.
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
			expect(instances).toEqual([]);
		});

		it('#103 a series created and ended on the same day gets no copy from the nightly function', async () => {
			const today = todayInBerlin();
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 7
			});
			const { error: endError } = await teacherA.client
				.from('homework_assignments')
				.update({ ends_on: today })
				.eq('id', assignmentId);
			expect(endError).toBeNull();

			await runGenerator();

			const { data: instances } = await adminClient
				.from('homework_instances')
				.select('period_start')
				.eq('assignment_id', assignmentId);
			expect(instances).toEqual([]);
		});

		it('#103 a series with a copy and a missed week gets no catch-up week once it is ended, and its copy is untouched', async () => {
			const today = todayInBerlin();
			const startDate = addDays(today, -7); // periods: today-7, today
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate,
				dueOffsetDays: 7
			});
			const generateUpTo = (day: string) =>
				adminClient.rpc('generate_recurring_homework_for_series', {
					p_assignment_id: assignmentId,
					p_today: day
				});
			const copies = async () =>
				(
					await adminClient
						.from('homework_instances')
						.select('id, period_start, due_date, created_at')
						.eq('assignment_id', assignmentId)
						.order('period_start', { ascending: true })
				).data;

			// Only the first week is made; this week's copy is still missing.
			expect((await generateUpTo(startDate)).data).toBe(1);
			const before = await copies();
			expect(before?.map((i) => i.period_start)).toEqual([startDate]);

			const { error: endError } = await teacherA.client
				.from('homework_assignments')
				.update({ ends_on: today })
				.eq('id', assignmentId);
			expect(endError).toBeNull();

			expect((await generateUpTo(today)).data).toBe(0);
			await runGenerator();
			expect(await copies()).toEqual(before);
		});

		it('#103 a series whose ends_on is still ahead keeps getting its weeks', async () => {
			const today = todayInBerlin();
			const startDate = addDays(today, -7); // periods: today-7, today
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate,
				dueOffsetDays: 0
			});
			const { error: endError } = await teacherA.client
				.from('homework_assignments')
				.update({ ends_on: addDays(today, 1) })
				.eq('id', assignmentId);
			expect(endError).toBeNull();

			const { data: count, error } = await adminClient.rpc(
				'generate_recurring_homework_for_series',
				{ p_assignment_id: assignmentId, p_today: today }
			);
			expect(error).toBeNull();
			expect(count).toBe(2);

			const { data: instances } = await adminClient
				.from('homework_instances')
				.select('period_start')
				.eq('assignment_id', assignmentId)
				.order('period_start', { ascending: true });
			expect(instances?.map((i) => i.period_start)).toEqual([startDate, today]);
		});

		it("#103b a teacher of the class archives a series' open copies in one update; an archived copy keeps its date, and another teacher changes none", async () => {
			const today = todayInBerlin();
			const startDate = addDays(today, -7); // periods: today-7, today
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate,
				dueOffsetDays: 7
			});
			const { data: made } = await adminClient.rpc('generate_recurring_homework_for_series', {
				p_assignment_id: assignmentId,
				p_today: today
			});
			expect(made).toBe(2);

			const copies = async () =>
				(
					await adminClient
						.from('homework_instances')
						.select('period_start, archived_at, archived_by')
						.eq('assignment_id', assignmentId)
						.order('period_start', { ascending: true })
				).data ?? [];

			// The first week was archived earlier, by the admin.
			const earlier = '2026-01-15T10:00:00+00:00';
			await adminClient
				.from('homework_instances')
				.update({ archived_at: earlier, archived_by: admin.id })
				.eq('assignment_id', assignmentId)
				.eq('period_start', startDate);

			// The update endSeries sends when the teacher ticked "also archive"
			// (the action's own filters are pinned in its page.server.spec.ts).
			const archiveOpenCopies = (teacher: typeof teacherA) =>
				teacher.client
					.from('homework_instances')
					.update({ archived_at: new Date().toISOString(), archived_by: teacher.id })
					.eq('assignment_id', assignmentId)
					.eq('class_id', classAId)
					.is('archived_at', null)
					.select('id');

			const other = await archiveOpenCopies(teacherB);
			expect(other.error).toBeNull();
			expect(other.data).toEqual([]);
			expect((await copies()).map((c) => c.archived_at === null)).toEqual([false, true]);

			const own = await archiveOpenCopies(teacherA);
			expect(own.error).toBeNull();
			expect(own.data).toHaveLength(1);

			const after = await copies();
			expect(new Date(after[0].archived_at as string).toISOString()).toBe(
				new Date(earlier).toISOString()
			);
			expect(after[0].archived_by).toBe(admin.id);
			expect(after[1].archived_at).not.toBeNull();
			expect(after[1].archived_by).toBe(teacherA.id);
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

		// -----------------------------------------------------------------
		// #96: the first week's copies are made when the series is created
		// (create_weekly_homework_first_copies, 0040), not by the nightly job.
		// -----------------------------------------------------------------

		async function firstCopies(client: ReturnType<typeof anonClient>, assignmentId: string) {
			return client.rpc('create_weekly_homework_first_copies', {
				p_assignment_id: assignmentId
			});
		}

		async function instancesOf(assignmentId: string) {
			const { data, error } = await adminClient
				.from('homework_instances')
				.select('id, period_start, due_date')
				.eq('assignment_id', assignmentId)
				.order('period_start');
			if (error) throw new Error(`Failed to read instances: ${error.message}`);
			return data ?? [];
		}

		async function assignedStudents(instanceId: string): Promise<string[]> {
			const { data, error } = await adminClient
				.from('homework_status_history')
				.select('student_id, status')
				.eq('instance_id', instanceId)
				.eq('status', 'assigned');
			if (error) throw new Error(`Failed to read history: ${error.message}`);
			return (data ?? []).map((r) => r.student_id);
		}

		it('#96 start today (Munich): the teacher gets one copy at once, due after the offset, for the approved enrolled students -- and the student reads it', async () => {
			// A student who can sign in, to read the copy as the student page does.
			const email = `story-96-student-${crypto.randomUUID()}@students.internal.invalid`;
			const password = crypto.randomUUID();
			const { data: created, error: createError } = await adminClient.auth.admin.createUser({
				email,
				password,
				email_confirm: true,
				app_metadata: { role: 'student' }
			});
			if (createError || !created.user) throw new Error(`create student: ${createError?.message}`);
			const studentId = created.user.id;
			const { error: profileError } = await adminClient
				.from('profiles')
				.update({
					class_id: classAId,
					status: 'approved',
					registration_name: 'Ninety-six Student',
					display_name: 'Ninety-six Student',
					team_id: teamId
				})
				.eq('id', studentId);
			if (profileError) throw new Error(`set up student: ${profileError.message}`);
			const studentClient = anonClient();
			const { error: signInError } = await studentClient.auth.signInWithPassword({
				email,
				password
			});
			if (signInError) throw new Error(`sign in student: ${signInError.message}`);
			const pending = await createStudent({
				classId: classAId,
				status: 'pending',
				name: `NinetySix Pending ${crypto.randomUUID().slice(0, 6)}`
			});

			const today = todayInBerlin();
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 7
			});

			const { data: count, error } = await firstCopies(teacherA.client, assignmentId);
			expect(error).toBeNull();
			expect(count).toBe(1);

			const instances = await instancesOf(assignmentId);
			expect(instances).toHaveLength(1);
			expect(instances[0].period_start).toBe(today);
			expect(instances[0].due_date).toBe(addDays(today, 7));

			const assigned = await assignedStudents(instances[0].id);
			expect(assigned).toContain(studentId);
			expect(assigned).not.toContain(pending);

			// Straight after, as the student: the homework with its due date.
			const { data: seen, error: seenError } = await studentClient
				.from('homework_instances')
				.select('id, due_date')
				.eq('assignment_id', assignmentId);
			expect(seenError).toBeNull();
			expect(seen).toEqual([{ id: instances[0].id, due_date: addDays(today, 7) }]);
		});

		it('#96 nightly run afterwards: no second copy of any week, and no second assigned row', async () => {
			const student = await createStudent({
				classId: classAId,
				status: 'approved',
				name: `NinetySix Nightly ${crypto.randomUUID().slice(0, 6)}`
			});
			const today = todayInBerlin();
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: addDays(today, -7),
				dueOffsetDays: 7
			});

			expect((await firstCopies(teacherA.client, assignmentId)).data).toBe(2);
			const before = await instancesOf(assignmentId);

			await runGenerator();
			// Called twice by the page (a double submit) creates nothing more.
			expect((await firstCopies(teacherA.client, assignmentId)).data).toBe(0);

			const after = await instancesOf(assignmentId);
			expect(after).toEqual(before);
			expect(after.map((i) => i.period_start)).toEqual([addDays(today, -7), today]);
			for (const instance of after) {
				const assigned = await assignedStudents(instance.id);
				expect(assigned.filter((id) => id === student)).toHaveLength(1);
			}
		});

		it('#96 start in the past: one copy per week from then up to today, the same weeks and due dates the nightly function makes', async () => {
			const today = todayInBerlin();
			const startDate = addDays(today, -21);
			const immediateId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate,
				dueOffsetDays: 5
			});
			const nightlyId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate,
				dueOffsetDays: 5
			});

			const { data: count, error } = await firstCopies(teacherA.client, immediateId);
			expect(error).toBeNull();
			expect(count).toBe(4);

			const immediate = await instancesOf(immediateId);
			expect(immediate.map((i) => [i.period_start, i.due_date])).toEqual(
				[-21, -14, -7, 0].map((d) => [addDays(today, d), addDays(today, d + 5)])
			);

			// The series left to the nightly function gets the same weeks,
			// for the same students. (It runs on the database's UTC date: the
			// current week is compared only when that is already Munich's today.)
			await runGenerator();
			const nightly = await instancesOf(nightlyId);
			const utcToday = new Date().toISOString().slice(0, 10);
			const comparable = utcToday === today ? immediate : immediate.slice(0, 3);
			expect(nightly.map((i) => [i.period_start, i.due_date])).toEqual(
				comparable.map((i) => [i.period_start, i.due_date])
			);
			for (let i = 0; i < nightly.length; i++) {
				expect((await assignedStudents(nightly[i].id)).sort()).toEqual(
					(await assignedStudents(immediate[i].id)).sort()
				);
			}
		});

		it('#96 start in the future: nothing is created now', async () => {
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: addDays(todayInBerlin(), 6),
				dueOffsetDays: 7
			});

			const { data: count, error } = await firstCopies(teacherA.client, assignmentId);
			expect(error).toBeNull();
			expect(count).toBe(0);
			expect(await instancesOf(assignmentId)).toEqual([]);
		});

		it("#96 the per-series function generates up to the date it is given, not the database's UTC date: a start date one day ahead gets its copy, and the nightly run adds no second one", async () => {
			// The date create_weekly_homework_first_copies would pass at 00:30
			// in Munich, built by hand here: one day ahead of the database's
			// current_date (UTC). That function itself is not called.
			const utcToday = new Date().toISOString().slice(0, 10);
			const munichToday = addDays(utcToday, 1);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: munichToday,
				dueOffsetDays: 7
			});

			// The nightly function, on the UTC date, makes nothing yet...
			await runGenerator();
			expect(await instancesOf(assignmentId)).toEqual([]);

			// ...the per-series function with Munich's date does.
			const { data: count, error } = await adminClient.rpc(
				'generate_recurring_homework_for_series',
				{ p_assignment_id: assignmentId, p_today: munichToday }
			);
			expect(error).toBeNull();
			expect(count).toBe(1);
			const instances = await instancesOf(assignmentId);
			expect(instances.map((i) => [i.period_start, i.due_date])).toEqual([
				[munichToday, addDays(munichToday, 7)]
			]);

			// And the nightly run that follows adds no second copy.
			await runGenerator();
			expect(await instancesOf(assignmentId)).toEqual(instances);
		});

		it('#96 class with no students: the copy exists with no students, and a student enrolled later gets it', async () => {
			const { data: emptyClass, error: classError } = await admin.client
				.from('classes')
				.insert({
					name: `Story 96 Empty ${crypto.randomUUID().slice(0, 6)}`,
					code: `NS${crypto.randomUUID().slice(0, 4).toUpperCase()}`
				})
				.select('id')
				.single();
			if (classError || !emptyClass) throw new Error(`create class: ${classError?.message}`);
			const { error: teachError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: emptyClass.id, teacher_id: teacherA.id });
			if (teachError) throw new Error(`assign teacher: ${teachError.message}`);

			const assignmentId = await createRecurringAssignment({
				classId: emptyClass.id,
				createdBy: teacherA,
				startDate: todayInBerlin(),
				dueOffsetDays: 7
			});
			// whole_class is what the late-joiner trigger looks at; the create
			// page always sets it for a weekly series.
			await adminClient
				.from('homework_assignments')
				.update({ whole_class: true })
				.eq('id', assignmentId);

			expect((await firstCopies(teacherA.client, assignmentId)).data).toBe(1);
			const instances = await instancesOf(assignmentId);
			expect(instances).toHaveLength(1);
			expect(await assignedStudents(instances[0].id)).toEqual([]);

			const late = await createStudent({
				classId: emptyClass.id,
				status: 'approved',
				name: `NinetySix Late ${crypto.randomUUID().slice(0, 6)}`
			});
			expect(await assignedStudents(instances[0].id)).toEqual([late]);
		});

		it('#96 refused: another teacher, a student and a signed-out caller create nothing; the admin may', async () => {
			const email = `story-96-outsider-${crypto.randomUUID()}@students.internal.invalid`;
			const password = crypto.randomUUID();
			const { data: created, error: createError } = await adminClient.auth.admin.createUser({
				email,
				password,
				email_confirm: true,
				app_metadata: { role: 'student' }
			});
			if (createError || !created.user) throw new Error(`create student: ${createError?.message}`);
			const { error: profileError } = await adminClient
				.from('profiles')
				.update({
					class_id: classAId,
					status: 'approved',
					registration_name: 'Ninety-six Caller',
					display_name: 'Ninety-six Caller',
					team_id: teamId
				})
				.eq('id', created.user.id);
			if (profileError) throw new Error(`set up student: ${profileError.message}`);
			const studentClient = anonClient();
			const { error: signInError } = await studentClient.auth.signInWithPassword({
				email,
				password
			});
			if (signInError) throw new Error(`sign in student: ${signInError.message}`);

			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: todayInBerlin(),
				dueOffsetDays: 7
			});

			// teacherB teaches no class of this series.
			for (const client of [teacherB.client, studentClient, anonClient()]) {
				const { data, error } = await firstCopies(client, assignmentId);
				expect(error).not.toBeNull();
				expect(data).toBeNull();
			}
			// An id that does not exist gets the same refusal.
			expect((await firstCopies(teacherA.client, crypto.randomUUID())).error?.code).toBe('42501');
			expect((await firstCopies(teacherB.client, assignmentId)).error?.code).toBe('42501');
			expect(await instancesOf(assignmentId)).toEqual([]);

			// The per-series function itself is not callable by any client role.
			for (const client of [teacherA.client, admin.client, anonClient()]) {
				const { error } = await client.rpc('generate_recurring_homework_for_series', {
					p_assignment_id: assignmentId,
					p_today: todayInBerlin()
				});
				expect(error).not.toBeNull();
			}
			expect(await instancesOf(assignmentId)).toEqual([]);

			const adminCall = await firstCopies(admin.client, assignmentId);
			expect(adminCall.error).toBeNull();
			expect(adminCall.data).toBe(1);
		});

		it('#96 refused: a one-off assignment id creates nothing', async () => {
			const { data: oneOff, error: insertError } = await teacherA.client
				.from('homework_assignments')
				.insert({
					class_id: classAId,
					title: `One-off ${crypto.randomUUID().slice(0, 6)}`,
					skill_area: 'language',
					created_by: teacherA.id
				})
				.select('id')
				.single();
			if (insertError || !oneOff) throw new Error(`create one-off: ${insertError?.message}`);

			const { data, error } = await firstCopies(teacherA.client, oneOff.id);
			expect(error?.code).toBe('22023');
			expect(data).toBeNull();
			expect(await instancesOf(oneOff.id)).toEqual([]);
		});

		it('#96 a start date 110 weeks back: one call makes exactly 104 weeks (the per-call cap)', async () => {
			const today = todayInBerlin();
			const startDate = addDays(today, -110 * 7);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate,
				dueOffsetDays: 7
			});

			const { data: count, error } = await firstCopies(teacherA.client, assignmentId);
			expect(error).toBeNull();
			expect(count).toBe(104);

			const instances = await instancesOf(assignmentId);
			expect(instances).toHaveLength(104);
			expect(instances[0].period_start).toBe(startDate);
			expect(instances[103].period_start).toBe(addDays(startDate, 103 * 7));
		}, 30000);

		it('#96, #103 a paused series and an ended series get no copy, as with the nightly function', async () => {
			const today = todayInBerlin();
			const pausedId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 7
			});
			await adminClient
				.from('homework_assignments')
				.update({ paused_at: new Date().toISOString() })
				.eq('id', pausedId);
			expect((await firstCopies(teacherA.client, pausedId)).data).toBe(0);
			expect(await instancesOf(pausedId)).toEqual([]);

			const endedId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: addDays(today, -14),
				dueOffsetDays: 7
			});
			await adminClient
				.from('homework_assignments')
				.update({ ends_on: addDays(today, -7) })
				.eq('id', endedId);
			// #103: ended a week ago with two weeks never made -- none is made.
			expect((await firstCopies(teacherA.client, endedId)).data).toBe(0);
			expect(await instancesOf(endedId)).toEqual([]);
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

		it("the class's teacher edits a homework's content and its language (#72-#74, 0034); another teacher cannot, bad values are refused and other columns stay closed", async () => {
			const today = new Date().toISOString().slice(0, 10);
			const assignmentId = await createRecurringAssignment({
				classId: classAId,
				createdBy: teacherA,
				startDate: today,
				dueOffsetDays: 0
			});
			const content = {
				type: 'doc',
				content: [{ type: 'paragraph', content: [{ type: 'text', text: 'བོད་ཡིག' }] }]
			};

			const edit = await teacherA.client
				.from('homework_assignments')
				.update({ content, content_language: 'bo' })
				.eq('id', assignmentId)
				.select('content, content_language')
				.single();
			expect(edit.error).toBeNull();
			expect(edit.data).toEqual({ content, content_language: 'bo' });

			const otherTeacher = await teacherB.client
				.from('homework_assignments')
				.update({ content: { type: 'doc', content: [] }, content_language: 'de' })
				.eq('id', assignmentId)
				.select('id');
			expect(otherTeacher.error).toBeNull();
			expect(otherTeacher.data).toEqual([]);

			// The check constraints: a language the app doesn't offer, and
			// content that is not a document object.
			const unknownLanguage = await teacherA.client
				.from('homework_assignments')
				.update({ content_language: 'fr' })
				.eq('id', assignmentId);
			expect(unknownLanguage.error).not.toBeNull();
			const notADocument = await teacherA.client
				.from('homework_assignments')
				.update({ content: 'plain text' })
				.eq('id', assignmentId);
			expect(notADocument.error).not.toBeNull();

			// Still a column-level grant: whole_class is set at creation only.
			const outsideGrant = await teacherA.client
				.from('homework_assignments')
				.update({ whole_class: true })
				.eq('id', assignmentId);
			expect(outsideGrant.error).not.toBeNull();

			const { data: stored } = await adminClient
				.from('homework_assignments')
				.select('content, content_language, whole_class')
				.eq('id', assignmentId)
				.single();
			expect(stored).toEqual({ content, content_language: 'bo', whole_class: false });
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
			app_metadata: { role: 'student' }
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
			app_metadata: { role: 'student' }
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

	// Berlin, like the streak walk's current week (Story 6-2).
	const today = todayInBerlin();
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
			class_session_id: await sessionFor(params.classId, params.sessionDate),
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
		// Each student gets their own class: since 6-2 a session week is one
		// with a marked session in the student's classes, so a shared class
		// would turn the "reset" student's extra week into a miss for the
		// "preserved" student too.
		const preservedClassId = await createClass('Grace Boundary Preserved');
		const resetClassId = await createClass('Grace Boundary Reset');
		const preservedStudent = await createStudent({
			classId: preservedClassId,
			name: `Grace Boundary Preserved ${crypto.randomUUID().slice(0, 6)}`
		});
		const resetStudent = await createStudent({
			classId: resetClassId,
			name: `Grace Boundary Reset ${crypto.randomUUID().slice(0, 6)}`
		});

		// Both students qualify at the same earlier week, then diverge: the
		// "preserved" student misses exactly 2 consecutive weeks (== the
		// shipped default streak_grace_weeks), the "reset" student misses 3.
		const qualifyingPeriod = weekOffset(-5);
		for (const [student, classId] of [
			[preservedStudent, preservedClassId],
			[resetStudent, resetClassId]
		] as const) {
			const instanceId = await createInstance({
				assignmentId: await createAssignment(classId),
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
		}

		for (const offset of [-4, -3]) {
			await markAttendance({
				studentId: preservedStudent,
				classId: preservedClassId,
				sessionDate: weekOffset(offset),
				present: false
			});
		}
		for (const offset of [-4, -3, -2]) {
			await markAttendance({
				studentId: resetStudent,
				classId: resetClassId,
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
				code: `S4B${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
				// Badge detail 2: a class without a subject counts toward nothing.
				badge_subject: 'dance'
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
			app_metadata: { role: 'student' }
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
			app_metadata: { role: 'student' }
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

	// Badges ignore dates, so marks go on far-past days (Story 6-2: each needs a
	// class session), leaving the shared calendar's recent days alone.
	const today = '1890-06-30';
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
			class_session_id: await sessionFor(params.classId, params.sessionDate),
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
		const sessionIds: string[] = [];
		for (let i = 0; i < 12; i++) sessionIds.push(await sessionFor(classId, dayOffset(i)));
		const rows = sessionIds.map((sessionId) => ({
			student_id: student,
			class_id: classId,
			class_session_id: sessionId,
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

		const insertAttempt = await teacherA.client.from('badges_earned').insert({
			student_id: student,
			badge_subject: 'dance',
			badge_type: 'attendance',
			milestone: 999
		});
		expect(insertAttempt.error).not.toBeNull();

		const adminInsertAttempt = await admin.client.from('badges_earned').insert({
			student_id: student,
			badge_subject: 'dance',
			badge_type: 'attendance',
			milestone: 999
		});
		expect(adminInsertAttempt.error).not.toBeNull();

		// The actual abuse case this boundary exists to prevent: a student
		// self-awarding a badge for themself. No INSERT policy exists for
		// anyone (trigger-written only, AD-3), so this is rejected exactly
		// like the teacher/admin attempts above, not specially allowed just
		// because student_id matches auth.uid().
		const selfInsertAttempt = await signedInStudent.client.from('badges_earned').insert({
			student_id: signedInStudent.id,
			badge_subject: 'dance',
			badge_type: 'attendance',
			milestone: 999
		});
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

	it('RLS: admin, the student themself and the assigned teacher can read a badge row; another student cannot', async () => {
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

		// Badge detail 2 (CAP-8): teachers of the student's classes can read.
		const assignedTeacherRead = await teacherA.client
			.from('badges_earned')
			.select('student_id')
			.eq('student_id', signedInStudent.id);
		expect(assignedTeacherRead.data).toHaveLength(1);

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

// Badge detail story 2 (0048): badges are counted and awarded per badge
// subject of the class, and teachers of the student's classes can read them.
describe.skipIf(!reachable)('Badge detail 2: per-subject badges (requires local Supabase)', () => {
	type Subject = 'language' | 'dance' | 'instrument';
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let teamId: string;

	const label = (text: string) => `BD2 ${text} ${crypto.randomUUID().slice(0, 8)}`;
	/** Far-past days, so the shared calendar's real class days are left alone. */
	function pastDay(n: number): string {
		const d = new Date('1880-01-01T00:00:00Z');
		d.setUTCDate(d.getUTCDate() + n);
		return d.toISOString().slice(0, 10);
	}

	async function createClass(subject: Subject | null, classTeacher = teacher) {
		const { data, error } = await adminClient
			.from('classes')
			.insert({
				name: label('Class'),
				code: `B${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
				badge_subject: subject
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		const { error: assignError } = await adminClient
			.from('class_teachers')
			.insert({ class_id: data.id, teacher_id: classTeacher.id });
		if (assignError) throw new Error(`Failed to assign the teacher: ${assignError.message}`);
		return data.id;
	}

	/** An approved student of `classId`, enrolled in `alsoIn` too. */
	async function createStudent(classId: string, alsoIn: string[] = [], guardianEmail?: string) {
		const { id, error } = await signUpStudent({
			classId,
			registrationName: label('Kid'),
			guardianEmail
		});
		if (error || !id) throw new Error(`Failed to register the student: ${error?.message}`);
		const { error: approveError } = await adminClient
			.from('profiles')
			.update({ status: 'approved', team_id: teamId })
			.eq('id', id);
		if (approveError) throw new Error(`Failed to approve the student: ${approveError.message}`);
		for (const other of alsoIn) {
			const { error: enrollError } = await adminClient
				.from('class_enrollments')
				.insert({ student_id: id, class_id: other });
			if (enrollError) throw new Error(`Failed to enroll: ${enrollError.message}`);
		}
		return id;
	}

	async function signInStudent(id: string) {
		const password = crypto.randomUUID();
		const { data, error } = await adminClient.auth.admin.updateUserById(id, { password });
		if (error || !data.user?.email) throw new Error(`Failed to set a password: ${error?.message}`);
		const client = anonClient();
		const { error: signInError } = await client.auth.signInWithPassword({
			email: data.user.email,
			password
		});
		if (signInError) throw new Error(`Failed to sign in: ${signInError.message}`);
		return client;
	}

	async function present(studentId: string, classId: string, days: number[]) {
		const rows = [];
		for (const day of days) {
			rows.push({
				student_id: studentId,
				class_id: classId,
				class_session_id: await sessionFor(classId, pastDay(day)),
				present: true,
				recorded_by: teacher.id
			});
		}
		const { error } = await adminClient.from('attendance_records').insert(rows);
		if (error) throw new Error(`Failed to mark attendance: ${error.message}`);
	}

	async function homeworkDone(studentId: string, classId: string, count: number) {
		const { data: assignment, error: assignmentError } = await adminClient
			.from('homework_assignments')
			.insert({
				class_id: classId,
				title: label('HW'),
				skill_area: 'language',
				created_by: teacher.id
			})
			.select('id')
			.single();
		if (assignmentError || !assignment)
			throw new Error(`Failed to create assignment: ${assignmentError?.message}`);
		for (let n = 0; n < count; n++) {
			const { data: instance, error: instanceError } = await adminClient
				.from('homework_instances')
				.insert({
					assignment_id: assignment.id,
					class_id: classId,
					period_start: pastDay(n),
					due_date: pastDay(n)
				})
				.select('id')
				.single();
			if (instanceError || !instance)
				throw new Error(`Failed to create instance: ${instanceError?.message}`);
			const { error } = await adminClient.from('homework_status_history').insert({
				instance_id: instance.id,
				class_id: classId,
				student_id: studentId,
				status: 'done',
				recorded_by: teacher.id
			});
			if (error) throw new Error(`Failed to mark homework done: ${error.message}`);
		}
	}

	/** The student's badges as `subject-type-milestone`, sorted. */
	async function badgesOf(studentId: string) {
		const { data, error } = await adminClient
			.from('badges_earned')
			.select('badge_subject, badge_type, milestone')
			.eq('student_id', studentId);
		if (error) throw new Error(`Failed to read badges: ${error.message}`);
		return data
			.map((b) => `${b.badge_subject}-${b.badge_type}-${String(b.milestone).padStart(3, '0')}`)
			.sort();
	}

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacher = await createSignedInUser('teacher');
		teamId = await fixtureTeamId();
	}, 30000);

	it('per-subject attendance: 10 dance days and 3 language days earn dance 1, 5, 10 and language 1', async () => {
		const dance = await createClass('dance');
		const language = await createClass('language');
		const kid = await createStudent(dance, [language]);

		await present(kid, dance, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		await present(kid, language, [1, 2, 3]);

		expect(await badgesOf(kid)).toEqual([
			'dance-attendance-001',
			'dance-attendance-005',
			'dance-attendance-010',
			'language-attendance-001'
		]);
	});

	it('song counts as dance: present days of song and dance classes add up, a shared day once', async () => {
		const song = await createClass('dance');
		const dance = await createClass('dance');
		const kid = await createStudent(song, [dance]);

		// Days 1-3 in song, 3-4 in dance: 4 distinct days (5 raw marks).
		await present(kid, song, [1, 2, 3]);
		await present(kid, dance, [3, 4]);
		expect(await badgesOf(kid)).toEqual(['dance-attendance-001']);

		await present(kid, dance, [5]);
		expect(await badgesOf(kid)).toEqual(['dance-attendance-001', 'dance-attendance-005']);
	});

	it('per-subject homework: 5 Done in a language class earn language homework 1 and 5 only', async () => {
		const language = await createClass('language');
		const dance = await createClass('dance');
		const kid = await createStudent(language, [dance]);

		await homeworkDone(kid, language, 5);

		expect(await badgesOf(kid)).toEqual(['language-homework-001', 'language-homework-005']);
	});

	it('a class without a subject counts toward no badge', async () => {
		const unset = await createClass(null);
		const kid = await createStudent(unset);

		await present(kid, unset, [1, 2]);
		await homeworkDone(kid, unset, 1);

		expect(await badgesOf(kid)).toEqual([]);
	});

	it('assigning a subject later awards the badges the history already earns', async () => {
		const cls = await createClass(null);
		const kid = await createStudent(cls);
		await present(kid, cls, [1, 2, 3, 4, 5]);
		expect(await badgesOf(kid)).toEqual([]);

		const { error } = await admin.client
			.from('classes')
			.update({ badge_subject: 'dance' })
			.eq('id', cls);
		expect(error).toBeNull();

		expect(await badgesOf(kid)).toEqual(['dance-attendance-001', 'dance-attendance-005']);
	});

	it('changing a subject keeps the old badges and recomputes the new subject from the history', async () => {
		const cls = await createClass('dance');
		const kid = await createStudent(cls);
		await present(kid, cls, [1, 2, 3, 4, 5]);
		await homeworkDone(kid, cls, 1);
		const danceBadges = ['dance-attendance-001', 'dance-attendance-005', 'dance-homework-001'];
		expect(await badgesOf(kid)).toEqual(danceBadges);

		const { error } = await admin.client
			.from('classes')
			.update({ badge_subject: 'language' })
			.eq('id', cls);
		expect(error).toBeNull();

		expect(await badgesOf(kid)).toEqual([
			...danceBadges,
			'language-attendance-001',
			'language-attendance-005',
			'language-homework-001'
		]);
	});

	it("a teacher of any of the student's classes reads all of the student's badges", async () => {
		const languageTeacher = await createSignedInUser('teacher');
		const dance = await createClass('dance');
		const language = await createClass('language', languageTeacher);
		const kid = await createStudent(dance, [language]);
		await present(kid, dance, [1]);

		const { data, error } = await languageTeacher.client
			.from('badges_earned')
			.select('badge_subject, badge_type, milestone')
			.eq('student_id', kid);
		expect(error).toBeNull();
		expect(data).toEqual([{ badge_subject: 'dance', badge_type: 'attendance', milestone: 1 }]);
	});

	it("other teachers, other students and another student's parent read no rows", async () => {
		const otherTeacher = await createSignedInUser('teacher');
		const otherParent = await createApprovedParent();
		const cls = await createClass('dance');
		const otherClass = await createClass('dance', otherTeacher);
		const kid = await createStudent(cls);
		const otherKid = await createStudent(otherClass, [], otherParent.email);
		await present(kid, cls, [1]);
		expect(await badgesOf(kid)).toEqual(['dance-attendance-001']);

		const parentClient = anonClient();
		const { error: signInError } = await parentClient.auth.signInWithPassword({
			email: otherParent.email,
			password: otherParent.password
		});
		expect(signInError).toBeNull();

		for (const client of [otherTeacher.client, await signInStudent(otherKid), parentClient]) {
			const { data, error } = await client.from('badges_earned').select('id').eq('student_id', kid);
			expect(error).toBeNull();
			expect(data).toEqual([]);
		}
	});

	it('a client insert into badges_earned is rejected (trigger-written only)', async () => {
		const cls = await createClass('dance');
		const kid = await createStudent(cls);
		const kidClient = await signInStudent(kid);

		for (const client of [kidClient, teacher.client, admin.client]) {
			const { error } = await client.from('badges_earned').insert({
				student_id: kid,
				badge_subject: 'dance',
				badge_type: 'attendance',
				milestone: 1
			});
			expect(error).not.toBeNull();
		}
		expect(await badgesOf(kid)).toEqual([]);
	});

	// Badge detail story 3 (0049): badge_progress() per subject, both tracks.
	describe('Badge detail 3: badge_progress()', () => {
		async function progressOf(client: ReturnType<typeof anonClient>, studentId: string) {
			const { data, error } = await client.rpc('badge_progress', { p_student_id: studentId });
			expect(error).toBeNull();
			return data;
		}

		it('lists both tracks of each enrolled subject with the recompute counts, even at 0', async () => {
			const language = await createClass('language');
			const dance = await createClass('dance');
			const unset = await createClass(null);
			const kid = await createStudent(dance, [language, unset]);
			await present(kid, dance, [1, 2, 3, 4, 5, 6, 7]);
			await present(kid, unset, [8, 9]);

			expect(await progressOf(admin.client, kid)).toEqual([
				{ subject: 'language', badge_type: 'attendance', total: 0, next_milestone: 1 },
				{ subject: 'language', badge_type: 'homework', total: 0, next_milestone: 1 },
				{ subject: 'dance', badge_type: 'attendance', total: 7, next_milestone: 10 },
				{ subject: 'dance', badge_type: 'homework', total: 0, next_milestone: 1 }
			]);
		});

		it('song and dance share one count (a shared day once), and Done homework moves the target', async () => {
			const song = await createClass('dance');
			const dance = await createClass('dance');
			const kid = await createStudent(song, [dance]);
			await present(kid, song, [1, 2, 3]);
			await present(kid, dance, [3, 4]);
			await homeworkDone(kid, dance, 5);

			expect(await progressOf(admin.client, kid)).toEqual([
				{ subject: 'dance', badge_type: 'attendance', total: 4, next_milestone: 5 },
				{ subject: 'dance', badge_type: 'homework', total: 5, next_milestone: 10 }
			]);
			expect(await badgesOf(kid)).toContain('dance-homework-005');
		});

		it('a student enrolled only in classes without a subject has no progress rows', async () => {
			const unset = await createClass(null);
			const kid = await createStudent(unset);
			await present(kid, unset, [1]);

			expect(await progressOf(admin.client, kid)).toEqual([]);
		});

		it('the student, a linked parent, a teacher of the student and admin read it; anyone else gets no rows', async () => {
			const parent = await createApprovedParent();
			const otherParent = await createApprovedParent();
			const otherTeacher = await createSignedInUser('teacher');
			const cls = await createClass('dance');
			const otherClass = await createClass('dance', otherTeacher);
			const kid = await createStudent(cls, [], parent.email);
			const otherKid = await createStudent(otherClass, [], otherParent.email);
			await present(kid, cls, [1, 2]);

			const signInParent = async (p: { email: string; password: string }) => {
				const client = anonClient();
				const { error } = await client.auth.signInWithPassword(p);
				expect(error).toBeNull();
				return client;
			};

			const expected = [
				{ subject: 'dance', badge_type: 'attendance', total: 2, next_milestone: 5 },
				{ subject: 'dance', badge_type: 'homework', total: 0, next_milestone: 1 }
			];
			for (const client of [
				await signInStudent(kid),
				await signInParent(parent),
				teacher.client,
				admin.client
			]) {
				expect(await progressOf(client, kid)).toEqual(expected);
			}
			for (const client of [
				await signInStudent(otherKid),
				await signInParent(otherParent),
				otherTeacher.client
			]) {
				expect(await progressOf(client, kid)).toEqual([]);
			}
			// Not signed in: no execute grant for anon.
			const { data, error } = await anonClient().rpc('badge_progress', { p_student_id: kid });
			expect(data ?? []).toEqual([]);
			expect(error).not.toBeNull();
		});
	});

	// Badge detail story 5 (0050): badges_earned.seen_at and mark_badges_seen().
	describe('Badge detail 5: mark_badges_seen()', () => {
		async function seenOf(studentId: string) {
			const { data, error } = await adminClient
				.from('badges_earned')
				.select('id, seen_at')
				.eq('student_id', studentId)
				.order('id');
			if (error) throw new Error(`Failed to read seen_at: ${error.message}`);
			return data;
		}

		it('a newly earned badge starts unseen, and the student reads it as unseen', async () => {
			const cls = await createClass('dance');
			const kid = await createStudent(cls);
			await present(kid, cls, [1]);

			const rows = await seenOf(kid);
			expect(rows).toHaveLength(1);
			expect(rows[0].seen_at).toBeNull();

			const { data, error } = await (
				await signInStudent(kid)
			)
				.from('badges_earned')
				.select('id')
				.eq('student_id', kid)
				.is('seen_at', null);
			expect(error).toBeNull();
			expect(data).toEqual([{ id: rows[0].id }]);
		});

		it("marks the caller's own unseen rows only, once", async () => {
			const cls = await createClass('language');
			const kid = await createStudent(cls);
			await present(kid, cls, [1, 2, 3, 4, 5]);
			const ids = (await seenOf(kid)).map((r) => r.id);
			expect(ids).toHaveLength(2);
			const kidClient = await signInStudent(kid);

			expect((await kidClient.rpc('mark_badges_seen', { p_ids: ids })).error).toBeNull();
			const first = await seenOf(kid);
			expect(first.every((r) => r.seen_at !== null)).toBe(true);

			// Again: nothing changes (seen_at stays the first dismissal).
			expect((await kidClient.rpc('mark_badges_seen', { p_ids: ids })).error).toBeNull();
			expect(await seenOf(kid)).toEqual(first);
		});

		it("another student's ids change nothing; parents, teachers and admin consume nothing", async () => {
			const parent = await createApprovedParent();
			const cls = await createClass('dance');
			const kid = await createStudent(cls, [], parent.email);
			const otherKid = await createStudent(cls);
			await present(kid, cls, [1]);
			const ids = (await seenOf(kid)).map((r) => r.id);
			expect(ids).toHaveLength(1);

			const parentClient = anonClient();
			const { error: signInError } = await parentClient.auth.signInWithPassword({
				email: parent.email,
				password: parent.password
			});
			expect(signInError).toBeNull();

			for (const client of [
				await signInStudent(otherKid),
				parentClient,
				teacher.client,
				admin.client
			]) {
				const { error } = await client.rpc('mark_badges_seen', { p_ids: ids });
				expect(error).toBeNull();
			}
			expect((await seenOf(kid))[0].seen_at).toBeNull();
		});

		it('refuses a signed-out caller, and a direct update by the student is ignored', async () => {
			const cls = await createClass('dance');
			const kid = await createStudent(cls);
			await present(kid, cls, [1]);
			const ids = (await seenOf(kid)).map((r) => r.id);

			const signedOut = await anonClient().rpc('mark_badges_seen', { p_ids: ids });
			expect(signedOut.error).not.toBeNull();

			await (
				await signInStudent(kid)
			)
				.from('badges_earned')
				.update({ seen_at: new Date().toISOString() })
				.eq('student_id', kid);
			expect((await seenOf(kid))[0].seen_at).toBeNull();
		});

		it('the migration counts rows existing when it runs as seen (no retroactive celebration)', async () => {
			const { readFile } = await import('node:fs/promises');
			const sql = await readFile(
				new URL('../../../supabase/migrations/0050_badges_seen.sql', import.meta.url),
				'utf8'
			);
			const backfill = sql.search(
				/update public\.badges_earned\s+set seen_at = earned_at\s+where seen_at is null;/
			);
			expect(backfill).toBeGreaterThan(sql.indexOf('add column seen_at timestamptz'));
		});
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
	 *
	 * #99: an update to approved without a team now gets one from the
	 * database (0043). `teamId: null` with status approved therefore builds
	 * the row the only way left: the pending profile row is replaced by an
	 * approved copy (the trigger is on update, not on insert). Such rows exist
	 * from before 0043.
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
			app_metadata: { role: 'student' }
		});
		if (error || !data.user) {
			throw new Error(`Failed to create student: ${error?.message}`);
		}

		const status = params.status ?? 'approved';
		const teamless = status === 'approved' && !params.teamId;
		const { data: row, error: updateError } = await adminClient
			.from('profiles')
			.update({
				class_id: params.classId,
				status: teamless ? 'pending' : status,
				registration_name: params.name,
				display_name: params.name,
				team_id: params.teamId ?? null
			})
			.eq('id', data.user.id)
			.select('*')
			.single();
		if (updateError || !row) {
			throw new Error(`Failed to set up student: ${updateError?.message}`);
		}

		if (teamless) {
			const { error: deleteError } = await adminClient
				.from('profiles')
				.delete()
				.eq('id', data.user.id);
			if (deleteError) throw new Error(`Failed to remove the pending row: ${deleteError.message}`);
			const { data: inserted, error: insertError } = await adminClient
				.from('profiles')
				.insert({ ...row, status: 'approved' })
				.select('status, team_id')
				.single();
			if (insertError) throw new Error(`Failed to insert the approved row: ${insertError.message}`);
			// The fixture is what the test says it is.
			expect(inserted).toEqual({ status: 'approved', team_id: null });
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
			{
				team_id: teamHigh,
				team_name: expect.any(String),
				team_name_bo: null,
				team_name_de: null,
				total_streak: 8
			},
			{
				team_id: teamLow,
				team_name: expect.any(String),
				team_name_bo: null,
				team_name_de: null,
				total_streak: 3
			}
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
		expect(rows).toEqual([
			{
				team_id: teamEmpty,
				team_name: expect.any(String),
				team_name_bo: null,
				team_name_de: null,
				total_streak: 0
			}
		]);
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
		expect(rows).toEqual([
			{
				team_id: team,
				team_name: expect.any(String),
				team_name_bo: null,
				team_name_de: null,
				total_streak: 5
			}
		]);
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
		expect(rows).toEqual([
			{
				team_id: team,
				team_name: expect.any(String),
				team_name_bo: null,
				team_name_de: null,
				total_streak: 0
			}
		]);
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
		expect(rows).toEqual([
			{
				team_id: team,
				team_name: expect.any(String),
				team_name_bo: null,
				team_name_de: null,
				total_streak: 0
			}
		]);
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
				app_metadata: { role: 'student' }
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

		expect(adminRows).toEqual([
			{
				team_id: team,
				team_name: expect.any(String),
				team_name_bo: null,
				team_name_de: null,
				total_streak: 6
			}
		]);
		expect(teacherRows).toEqual(adminRows);
		expect(studentRows).toEqual(adminRows);

		// The return shape itself only ever carries team-level columns -- no
		// student_id/student-level field could leak through even by accident
		// (Boundaries: "Do not expose any individual student's streak value
		// through this feature -- only team-level sums").
		expect(Object.keys(adminRows[0]).sort()).toEqual([
			'team_id',
			'team_name',
			'team_name_bo',
			'team_name_de',
			'total_streak'
		]);
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
			app_metadata: { role: 'student' }
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
			app_metadata: { role: 'student' }
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
				team_id: await fixtureTeamId()
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

		// classes_select_own_student (0014, via is_enrolled_in_class since
		// 0016): a student sees only the classes they're enrolled in -- their
		// own class, never the foreign one the admin dashboard aggregates. The
		// enrollment row comes from profiles_enroll_on_approval (0016), which
		// fires when createSignedInStudent sets status to 'approved'.
		const signedInStudent = await createSignedInStudent({
			classId: ownClassId,
			name: 'Regression Viewer'
		});
		const { data: studentVisibleClasses, error: studentClassesError } = await signedInStudent.client
			.from('classes')
			.select('id');
		expect(studentClassesError).toBeNull();
		expect(studentVisibleClasses).toEqual([{ id: ownClassId }]);

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

	/**
	 * A class taught by teacherA (and optionally teacherA2). Story 6-4: its
	 * schedule covers every weekday since 1900, so -- as these 6-1 scenarios
	 * assume -- it has a session on every class day.
	 */
	async function createClass(prefix: string, teachers = [teacherA.id]) {
		const { data, error } = await admin.client
			.from('classes')
			.insert({
				// Unique per run: class names are unique (0012) and runs leave rows behind.
				name: `Story 6-1 ${prefix} ${crypto.randomUUID().slice(0, 6)}`,
				code: `S6${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
				schedule_weekdays: [1, 2, 3, 4, 5, 6, 7],
				schedule_starts_on: '1900-01-01'
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
			app_metadata: { role: 'student' }
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
				display_name: 'Story 6-1 Student',
				team_id: await fixtureTeamId()
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

	it('a class created after class days exist gets a session on each one its schedule matches', async () => {
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

	it('class days are admin-write only, readable by every signed-in role, not deleted by a teacher, and sessions are trigger-only', async () => {
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

		// No hard delete by a teacher (#105: the admin deletes untouched future days).
		await teacherA.client.from('class_days').delete().eq('id', created.id);
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

describe.skipIf(!reachable)(
	'Story 6-4 class schedules & extra sessions (requires local Supabase)',
	() => {
		let admin: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacherB: Awaited<ReturnType<typeof createSignedInUser>>;

		beforeAll(async () => {
			admin = await createSignedInUser('admin');
			teacherA = await createSignedInUser('teacher');
			teacherB = await createSignedInUser('teacher');
		}, 30000);

		const SUN = 7;
		const WED = 3;
		const SAT = 6;

		/** A random far-future year (class days are unique school-wide). */
		function futureYear() {
			return 3000 + Math.floor(Math.random() * 6000);
		}
		/** A random past year: before today (Berlin) whatever day the suite runs. */
		function pastYear() {
			return 1901 + Math.floor(Math.random() * 99);
		}

		function berlinToday() {
			return new Intl.DateTimeFormat('en-CA', {
				timeZone: 'Europe/Berlin',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			}).format(new Date());
		}

		/** The first date on or after `from` that falls on ISO weekday `dow`. */
		function onOrAfter(from: string, dow: number) {
			const date = new Date(`${from}T00:00:00Z`);
			while ((date.getUTCDay() || 7) !== dow) date.setUTCDate(date.getUTCDate() + 1);
			return date.toISOString().slice(0, 10);
		}

		function plusDays(from: string, days: number) {
			const date = new Date(`${from}T00:00:00Z`);
			date.setUTCDate(date.getUTCDate() + days);
			return date.toISOString().slice(0, 10);
		}

		/** A class taught by `teachers`, with the new-class default schedule. */
		async function createClass(prefix: string, teachers = [teacherA.id]) {
			const { data, error } = await admin.client
				.from('classes')
				.insert({
					name: `Story 6-4 ${prefix} ${crypto.randomUUID().slice(0, 6)}`,
					code: `S4${crypto.randomUUID().slice(0, 4).toUpperCase()}`
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
			const { error } = await admin.client.from('class_days').upsert(
				days.map((day) => ({ day })),
				{ onConflict: 'day', ignoreDuplicates: true }
			);
			if (error) throw new Error(`Failed to add class days: ${error.message}`);
		}

		async function dayId(day: string) {
			const { data } = await adminClient.from('class_days').select('id').eq('day', day).single();
			return data!.id as string;
		}

		/**
		 * The class's sessions on `days`. Class days are shared by every test run
		 * (other runs' far-future days stay behind), and an open-ended schedule
		 * picks those up too, so each test looks at its own dates only.
		 */
		async function sessionsOf(classId: string, days: string[]) {
			const { data, error } = await adminClient
				.from('class_sessions_effective')
				.select(
					'id, day, start_time, duration_minutes, start_time_override, session_cancelled, extra'
				)
				.eq('class_id', classId)
				.in('day', days)
				.order('day');
			if (error) throw new Error(`Failed to read sessions: ${error.message}`);
			return data ?? [];
		}

		async function sessionDays(classId: string, days: string[]) {
			return (await sessionsOf(classId, days)).map((s) => s.day);
		}

		type Schedule = {
			weekdays: number[];
			startsOn: string;
			endsOn?: string | null;
			startTime?: string | null;
			duration?: number | null;
			/** Repeat every N weeks (issue #51); omitted = the function's default (1). */
			intervalWeeks?: number;
		};

		function setSchedule(
			client: typeof adminClient,
			classId: string,
			{
				weekdays,
				startsOn,
				endsOn = null,
				startTime = null,
				duration = null,
				intervalWeeks
			}: Schedule
		) {
			return client.rpc('set_class_schedule', {
				p_class_id: classId,
				p_weekdays: weekdays,
				p_start_time: startTime,
				p_duration_minutes: duration,
				p_starts_on: startsOn,
				p_ends_on: endsOn,
				...(intervalWeeks === undefined ? {} : { p_interval_weeks: intervalWeeks })
			});
		}

		async function createSignedInStudent(classId: string) {
			const email = `story-6-4-student-${crypto.randomUUID()}@students.internal.invalid`;
			const password = crypto.randomUUID();
			const { data, error } = await adminClient.auth.admin.createUser({
				email,
				password,
				email_confirm: true,
				app_metadata: { role: 'student' }
			});
			if (error || !data.user) throw new Error(`Failed to create student: ${error?.message}`);
			const { error: updateError } = await adminClient
				.from('profiles')
				.update({
					class_id: classId,
					status: 'approved',
					registration_name: 'Story 6-4 Student',
					display_name: 'Story 6-4 Student',
					team_id: await fixtureTeamId()
				})
				.eq('id', data.user.id);
			if (updateError) throw new Error(`Failed to approve student: ${updateError.message}`);
			const client = anonClient();
			const { error: signInError } = await client.auth.signInWithPassword({ email, password });
			if (signInError) throw new Error(`Failed to sign in student: ${signInError.message}`);
			return { id: data.user.id, client };
		}

		it('a new class defaults to Sunday only, from today (Berlin), no end', async () => {
			const classId = await createClass('Default');
			const { data } = await adminClient
				.from('classes')
				.select(
					'schedule_weekdays, schedule_starts_on, schedule_ends_on, schedule_interval_weeks, default_start_time'
				)
				.eq('id', classId)
				.single();
			expect(data).toEqual({
				schedule_weekdays: [SUN],
				schedule_starts_on: berlinToday(),
				schedule_ends_on: null,
				schedule_interval_weeks: 1,
				default_start_time: null
			});
		});

		it('schedule match: Sun+Wed from 10-01 until 12-20 gets sessions only on those class days', async () => {
			const year = futureYear();
			const classId = await createClass('Match');
			const { error } = await setSchedule(teacherA.client, classId, {
				weekdays: [SUN, WED],
				startsOn: `${year}-10-01`,
				endsOn: `${year}-12-20`,
				startTime: '10:00',
				duration: 90
			});
			expect(error).toBeNull();

			const sun = onOrAfter(`${year}-10-01`, SUN);
			const wed = onOrAfter(`${year}-10-01`, WED);
			const sat = onOrAfter(`${year}-10-01`, SAT);
			const sunAfterEnd = onOrAfter(`${year}-12-21`, SUN);
			const sunBeforeStart = plusDays(sun, -7);
			const days = [sun, wed, sat, sunAfterEnd, sunBeforeStart];
			await addDays(days);

			expect(await sessionDays(classId, days)).toEqual([sun, wed].sort());
			const [first] = await sessionsOf(classId, days);
			expect(first).toMatchObject({ start_time: '10:00:00', duration_minutes: 90, extra: false });
		});

		it('adding a class day creates sessions only for classes whose schedule includes and covers it', async () => {
			const year = futureYear();
			const wedClass = await createClass('Wed');
			const sunClass = await createClass('Sun');
			const endedClass = await createClass('Ended');
			await setSchedule(admin.client, wedClass, { weekdays: [WED], startsOn: `${year}-01-01` });
			await setSchedule(admin.client, sunClass, { weekdays: [SUN], startsOn: `${year}-01-01` });
			await setSchedule(admin.client, endedClass, {
				weekdays: [WED],
				startsOn: `${year}-01-01`,
				endsOn: `${year}-06-30`
			});

			const wed = onOrAfter(`${year}-10-10`, WED);
			await addDays([wed]);
			expect(await sessionDays(wedClass, [wed])).toEqual([wed]);
			expect(await sessionDays(sunClass, [wed])).toEqual([]);
			expect(await sessionDays(endedClass, [wed])).toEqual([]);
		});

		it('schedule edit: past sessions unchanged, future non-matching removed, missing added, still-matching keep override and cancel, extras stay', async () => {
			const past = pastYear();
			const year = futureYear();
			const classId = await createClass('Edit');
			const { error: firstError } = await setSchedule(teacherA.client, classId, {
				weekdays: [SUN],
				startsOn: '1900-01-01',
				startTime: '10:00',
				duration: 90
			});
			expect(firstError).toBeNull();

			const pastSun = onOrAfter(`${past}-03-01`, SUN);
			const pastSat = plusDays(pastSun, 6);
			// Past, following the class time (no override of its own).
			const pastSun2 = plusDays(pastSun, 7);
			const sun1 = onOrAfter(`${year}-10-01`, SUN);
			const sun2 = plusDays(sun1, 7);
			const sat1 = plusDays(sun1, 6);
			const tue = plusDays(sun1, 2);
			const days = [pastSun, pastSat, pastSun2, sun1, sun2, sat1, tue];
			await addDays(days);
			expect(await sessionDays(classId, days)).toEqual([pastSun, pastSun2, sun1, sun2]);
			expect((await sessionsOf(classId, [pastSun2]))[0]).toMatchObject({
				start_time: '10:00:00',
				duration_minutes: 90
			});

			// The past session and a future one get their own time and cancel flag.
			const byDay = new Map((await sessionsOf(classId, days)).map((s) => [s.day, s.id!]));
			for (const day of [pastSun, sun1]) {
				const { data } = await teacherA.client
					.from('class_sessions')
					.update({ start_time_override: '11:00', cancelled: true })
					.eq('id', byDay.get(day)!)
					.select('id');
				expect(data).toHaveLength(1);
			}
			// An extra session on the Tuesday.
			const { error: extraError } = await teacherA.client.rpc('add_extra_session', {
				p_class_id: classId,
				p_class_day_id: await dayId(tue),
				p_start_time: '18:00',
				p_duration_minutes: 60
			});
			expect(extraError).toBeNull();

			// Sun -> Sun + Sat: sun1 still matches and keeps its override and cancel;
			// the future Saturday gets a session, the past Saturday does not.
			await setSchedule(teacherA.client, classId, { weekdays: [SUN, SAT], startsOn: '1900-01-01' });
			let sessions = await sessionsOf(classId, days);
			expect(sessions.map((s) => s.day)).toEqual([pastSun, pastSun2, sun1, sat1, tue, sun2].sort());
			const sun1Session = sessions.find((s) => s.day === sun1)!;
			expect(sun1Session).toMatchObject({
				id: byDay.get(sun1),
				start_time_override: '11:00:00',
				session_cancelled: true
			});

			// Sun + Sat -> Sat: future Sundays go, the past Sunday and the extra stay.
			await setSchedule(teacherA.client, classId, { weekdays: [SAT], startsOn: '1900-01-01' });
			sessions = await sessionsOf(classId, days);
			expect(sessions.map((s) => s.day)).toEqual([pastSun, pastSun2, sat1, tue].sort());
			// The class time changed (10:00 / 90 -> not set), yet the past session
			// without an override still shows the time it had.
			expect(sessions.find((s) => s.day === pastSun2)).toMatchObject({
				start_time: '10:00:00',
				duration_minutes: 90
			});
			expect(sessions.find((s) => s.day === pastSun)).toMatchObject({
				id: byDay.get(pastSun),
				start_time_override: '11:00:00',
				session_cancelled: true,
				extra: false
			});
			expect(sessions.find((s) => s.day === tue)).toMatchObject({
				extra: true,
				start_time: '18:00:00',
				duration_minutes: 60
			});
			// The schedule time follows the last save (NULL = not set).
			expect(sessions.find((s) => s.day === sat1)).toMatchObject({ start_time: null });
		});

		it('extra session: on a class day outside the schedule, marked extra; a second one that day errors', async () => {
			const year = futureYear();
			const classId = await createClass('Extra');
			await setSchedule(admin.client, classId, {
				weekdays: [SUN],
				startsOn: `${year}-01-01`,
				startTime: '10:00',
				duration: 90
			});
			const sun = onOrAfter(`${year}-10-04`, SUN);
			const sat = plusDays(sun, 6);
			await addDays([sun, sat]);
			expect(await sessionDays(classId, [sun, sat])).toEqual([sun]);

			const { data: id, error } = await admin.client.rpc('add_extra_session', {
				p_class_id: classId,
				p_class_day_id: await dayId(sat),
				p_start_time: '14:00',
				p_duration_minutes: 60
			});
			expect(error).toBeNull();
			const extra = (await sessionsOf(classId, [sat])).find((s) => s.day === sat);
			expect(extra).toMatchObject({
				id,
				extra: true,
				start_time: '14:00:00',
				duration_minutes: 60
			});

			// One session per class per day: again on the Saturday, or on the
			// scheduled Sunday.
			for (const day of [sat, sun]) {
				const { error: dupError } = await admin.client.rpc('add_extra_session', {
					p_class_id: classId,
					p_class_day_id: await dayId(day),
					p_start_time: '15:00',
					p_duration_minutes: null
				});
				expect(dupError?.code).toBe('23505');
			}
			expect(await sessionDays(classId, [sun, sat])).toEqual([sun, sat]);

			// Not on a cancelled class day (22023).
			const cancelledSat = plusDays(sat, 7);
			await addDays([cancelledSat]);
			await admin.client
				.from('class_days')
				.update({ cancelled: true })
				.eq('id', await dayId(cancelledSat));
			const { error: cancelledError } = await admin.client.rpc('add_extra_session', {
				p_class_id: classId,
				p_class_day_id: await dayId(cancelledSat),
				p_start_time: '14:00',
				p_duration_minutes: 60
			});
			expect(cancelledError?.code).toBe('22023');
			expect(await sessionDays(classId, [cancelledSat])).toEqual([]);
		});

		it('invalid schedules are refused by the function and save nothing', async () => {
			const year = futureYear();
			const classId = await createClass('Invalid');
			const cases: Schedule[] = [
				{ weekdays: [], startsOn: `${year}-01-01` },
				{ weekdays: [0], startsOn: `${year}-01-01` },
				{ weekdays: [8], startsOn: `${year}-01-01` },
				{ weekdays: [SUN], startsOn: `${year}-02-01`, endsOn: `${year}-01-01` },
				{ weekdays: [SUN], startsOn: `${year}-01-01`, duration: 5 }
			];
			for (const schedule of cases) {
				const { error } = await setSchedule(admin.client, classId, schedule);
				expect(error, JSON.stringify(schedule)).not.toBeNull();
			}
			const { data } = await adminClient
				.from('classes')
				.select('schedule_weekdays')
				.eq('id', classId)
				.single();
			expect(data?.schedule_weekdays).toEqual([SUN]);
		});

		it('another teacher or a student cannot set the schedule or add an extra session (42501); the admin can', async () => {
			const year = futureYear();
			const classId = await createClass('Access');
			const sat = onOrAfter(`${year}-10-01`, SAT);
			await addDays([sat]);
			const student = await createSignedInStudent(classId);
			const schedule = { weekdays: [SAT], startsOn: `${year}-01-01` };

			for (const client of [teacherB.client, student.client]) {
				const { error } = await setSchedule(client, classId, schedule);
				expect(error?.code).toBe('42501');
				const { error: extraError } = await client.rpc('add_extra_session', {
					p_class_id: classId,
					p_class_day_id: await dayId(sat),
					p_start_time: null,
					p_duration_minutes: null
				});
				expect(extraError?.code).toBe('42501');
			}
			expect(await sessionDays(classId, [sat])).toEqual([]);

			// Still no client insert into sessions, not even as an extra.
			const { error: insertError } = await admin.client
				.from('class_sessions')
				.insert({ class_id: classId, class_day_id: await dayId(sat), extra: true });
			expect(insertError).not.toBeNull();

			// The admin need not teach the class.
			const { error } = await setSchedule(admin.client, classId, schedule);
			expect(error).toBeNull();
			expect(await sessionDays(classId, [sat])).toEqual([sat]);

			// The student reads the extra flag through the view.
			const { data: visible } = await student.client
				.from('class_sessions_effective')
				.select('day, extra')
				.eq('class_id', classId)
				.eq('day', sat);
			expect(visible).toEqual([{ day: sat, extra: false }]);
		});

		it('backfill rule: weekdays and start derive from existing sessions, else Sunday from today', async () => {
			const year = futureYear();
			const classId = await createClass('Backfill');
			// Sessions on two Sundays (one cancelled) and a Wednesday. The schedule
			// spans exactly sun1..sun2, so no other run's class day can add one.
			const sun1 = onOrAfter(`${year}-05-01`, SUN);
			const wed = plusDays(sun1, 3);
			const sun2 = plusDays(sun1, 7);
			await setSchedule(admin.client, classId, {
				weekdays: [SUN, WED],
				startsOn: sun1,
				endsOn: sun2
			});
			await addDays([sun1, wed, sun2]);
			const sessions = await sessionsOf(classId, [sun1, wed, sun2]);
			expect(sessions).toHaveLength(3);
			await adminClient
				.from('class_sessions')
				.update({ cancelled: true })
				.eq('id', sessions[0].id!);

			const { data, error } = await adminClient.rpc('class_schedule_from_sessions', {
				p_class_id: classId
			});
			expect(error).toBeNull();
			expect(data).toEqual({ weekdays: [WED, SUN], starts_on: sun1 });

			// A class without sessions: Sunday, from today.
			const empty = await createClass('Backfill Empty');
			await setSchedule(admin.client, empty, {
				weekdays: [SAT],
				startsOn: `${year}-01-01`,
				endsOn: `${year}-01-01`
			});
			const { data: none } = await adminClient.rpc('class_schedule_from_sessions', {
				p_class_id: empty
			});
			expect(none).toEqual({ weekdays: [SUN], starts_on: berlinToday() });

			// Clients cannot call it.
			const { error: clientError } = await admin.client.rpc('class_schedule_from_sessions', {
				p_class_id: classId
			});
			expect(clientError).not.toBeNull();
		});

		it('fortnightly (issue #51): Sun every 2 weeks from Sun W0 has sessions in W0, W2, W4 only', async () => {
			const year = futureYear();
			const classId = await createClass('Fortnightly');
			const w = Array.from({ length: 5 }, (_, i) =>
				plusDays(onOrAfter(`${year}-03-01`, SUN), 7 * i)
			);
			const { error } = await setSchedule(teacherA.client, classId, {
				weekdays: [SUN],
				startsOn: w[0],
				intervalWeeks: 2
			});
			expect(error).toBeNull();
			await addDays(w);
			expect(await sessionDays(classId, w)).toEqual([w[0], w[2], w[4]]);
		});

		it('mid-week start (issue #51): Sun+Wed every 2 weeks from Wed W0 keeps both days in step', async () => {
			const year = futureYear();
			const classId = await createClass('Mid-week');
			const wed0 = onOrAfter(`${year}-03-01`, WED);
			const sun0 = plusDays(wed0, 4);
			const wed1 = plusDays(wed0, 7);
			const sun1 = plusDays(sun0, 7);
			const wed2 = plusDays(wed0, 14);
			const sun2 = plusDays(sun0, 14);
			const days = [wed0, sun0, wed1, sun1, wed2, sun2];
			await addDays(days);
			const { error } = await setSchedule(admin.client, classId, {
				weekdays: [SUN, WED],
				startsOn: wed0,
				intervalWeeks: 2
			});
			expect(error).toBeNull();
			expect(await sessionDays(classId, days)).toEqual([wed0, sun0, wed2, sun2]);
		});

		it('fortnightly (issue #51): a cancelled on-week class day loses that session, later weeks stay on', async () => {
			const year = futureYear();
			const classId = await createClass('Fortnightly Cancel');
			const w = Array.from({ length: 5 }, (_, i) =>
				plusDays(onOrAfter(`${year}-03-01`, SUN), 7 * i)
			);
			await setSchedule(admin.client, classId, {
				weekdays: [SUN],
				startsOn: w[0],
				intervalWeeks: 2
			});
			await addDays(w);
			const { error: cancelError } = await admin.client
				.from('class_days')
				.update({ cancelled: true })
				.eq('day', w[2]);
			expect(cancelError).toBeNull();

			const { data } = await adminClient
				.from('class_sessions_effective')
				.select('day, cancelled')
				.eq('class_id', classId)
				.in('day', w)
				.order('day');
			expect(data).toEqual([
				{ day: w[0], cancelled: false },
				{ day: w[2], cancelled: true },
				{ day: w[4], cancelled: false }
			]);
		});

		it('interval edit (issue #51): weekly -> every 2 weeks drops future off-week sessions, keeps past ones', async () => {
			const past = pastYear();
			const year = futureYear();
			const pastSun = onOrAfter(`${past}-03-01`, SUN);
			const pastSun2 = plusDays(pastSun, 7);
			const futureSuns = Array.from({ length: 4 }, (_, i) =>
				plusDays(onOrAfter(`${year}-03-01`, SUN), 7 * i)
			);
			const days = [pastSun, pastSun2, ...futureSuns];
			// Days first, then a weekly class inserted with its schedule: its insert
			// trigger covers every day, even past ones an earlier run already added.
			await addDays(days);
			const { data: created, error: createError } = await admin.client
				.from('classes')
				.insert({
					name: `Story 6-4 Interval Edit ${crypto.randomUUID().slice(0, 6)}`,
					code: `S4${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
					schedule_weekdays: [SUN],
					schedule_starts_on: pastSun
				})
				.select('id')
				.single();
			expect(createError).toBeNull();
			const classId = created!.id as string;
			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: classId, teacher_id: teacherA.id });
			expect(assignError).toBeNull();
			expect(await sessionDays(classId, days)).toEqual(days);

			const { error } = await setSchedule(teacherA.client, classId, {
				weekdays: [SUN],
				startsOn: pastSun,
				intervalWeeks: 2
			});
			expect(error).toBeNull();
			const { data: cls } = await adminClient
				.from('classes')
				.select('schedule_interval_weeks')
				.eq('id', classId)
				.single();
			expect(cls?.schedule_interval_weeks).toBe(2);

			// On-weeks: a whole even number of weeks after the week of pastSun.
			const weeksAfter = (day: string) =>
				Math.round(
					(Date.parse(`${day}T00:00:00Z`) - Date.parse(`${pastSun}T00:00:00Z`)) / (7 * 86400000)
				);
			const onWeeks = futureSuns.filter((day) => weeksAfter(day) % 2 === 0);
			expect(onWeeks).toHaveLength(2);
			expect(await sessionDays(classId, days)).toEqual([pastSun, pastSun2, ...onWeeks]);

			// Back to weekly brings the off-weeks back.
			await setSchedule(teacherA.client, classId, {
				weekdays: [SUN],
				startsOn: pastSun,
				intervalWeeks: 1
			});
			expect(await sessionDays(classId, days)).toEqual(days);
		});

		it('an interval outside 1-4 is refused (22023) and saves nothing', async () => {
			const year = futureYear();
			const classId = await createClass('Interval Invalid');
			for (const intervalWeeks of [0, 5]) {
				const { error } = await setSchedule(admin.client, classId, {
					weekdays: [SUN],
					startsOn: `${year}-01-01`,
					intervalWeeks
				});
				expect(error?.code, String(intervalWeeks)).toBe('22023');
			}
			const { error: nullError } = await admin.client.rpc('set_class_schedule', {
				p_class_id: classId,
				p_weekdays: [SUN],
				p_start_time: null,
				p_duration_minutes: null,
				p_starts_on: `${year}-01-01`,
				p_ends_on: null,
				p_interval_weeks: null as unknown as number
			});
			expect(nullError?.code).toBe('22023');

			// The column check holds for direct writes too, even the service role's.
			const { error: checkError } = await adminClient
				.from('classes')
				.update({ schedule_interval_weeks: 5 })
				.eq('id', classId);
			expect(checkError?.code).toBe('23514');
			const { data } = await adminClient
				.from('classes')
				.select('schedule_interval_weeks, schedule_starts_on')
				.eq('id', classId)
				.single();
			expect(data).toEqual({ schedule_interval_weeks: 1, schedule_starts_on: berlinToday() });
		});
	}
);

describe.skipIf(!reachable)(
	'Story 6-2 attendance per session & calendar holidays (requires local Supabase)',
	() => {
		let admin: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacherA: Awaited<ReturnType<typeof createSignedInUser>>;
		let graceWeeks: number;

		beforeAll(async () => {
			admin = await createSignedInUser('admin');
			teacherA = await createSignedInUser('teacher');
			const { data } = await adminClient
				.from('app_settings')
				.select('value')
				.eq('key', 'streak_grace_weeks')
				.single();
			graceWeeks = (data?.value as { weeks?: number } | undefined)?.weeks ?? 2;
		}, 30000);

		const SUN = 7;

		/**
		 * A random past year within the streak walk's 50-year reach from today
		 * (class days are unique school-wide, so each scenario gets its own).
		 */
		function pastYear() {
			const thisYear = Number(todayInBerlin().slice(0, 4));
			return thisYear - 45 + Math.floor(Math.random() * 40);
		}
		function futureYear() {
			return 3000 + Math.floor(Math.random() * 6000);
		}

		function plusDays(from: string, days: number) {
			const date = new Date(`${from}T00:00:00Z`);
			date.setUTCDate(date.getUTCDate() + days);
			return date.toISOString().slice(0, 10);
		}
		function isoDow(day: string) {
			return new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
		}
		/** Monday of the ISO week containing `day` (the SQL date_trunc('week', ...)). */
		function mondayOf(day: string) {
			return plusDays(day, 1 - isoDow(day));
		}
		/** `count` consecutive Sundays from the first one on/after March 1st of `year`. */
		function sundays(year: number, count: number) {
			let first = `${year}-03-01`;
			while (isoDow(first) !== SUN) first = plusDays(first, 1);
			return Array.from({ length: count }, (_, i) => plusDays(first, 7 * i));
		}

		/**
		 * Taught by teacherA; its schedule covers `weekdays` (default: every
		 * weekday) since 1900, so it has a session on every matching class day,
		 * existing or added later.
		 */
		async function createClass(
			prefix: string,
			weekdays = [1, 2, 3, 4, 5, 6, 7],
			{ startsOn = '1900-01-01', intervalWeeks = 1 } = {}
		) {
			const { data, error } = await admin.client
				.from('classes')
				.insert({
					name: `Story 6-2 ${prefix} ${crypto.randomUUID().slice(0, 6)}`,
					code: `S62${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
					schedule_weekdays: weekdays,
					schedule_starts_on: startsOn,
					schedule_interval_weeks: intervalWeeks
				})
				.select('id')
				.single();
			if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: data.id, teacher_id: teacherA.id });
			if (assignError) throw new Error(`Failed to assign teacher: ${assignError.message}`);
			return data.id as string;
		}

		/** An approved student, enrolled in `classId` by the approval trigger. */
		async function createStudent(classId: string) {
			const { data, error } = await adminClient.auth.admin.createUser({
				email: `story-6-2-student-${crypto.randomUUID()}@students.internal.invalid`,
				password: crypto.randomUUID(),
				email_confirm: true,
				app_metadata: { role: 'student' }
			});
			if (error || !data.user) throw new Error(`Failed to create student: ${error?.message}`);
			const { error: updateError } = await adminClient
				.from('profiles')
				.update({
					class_id: classId,
					status: 'approved',
					registration_name: 'Story 6-2 Student',
					display_name: 'Story 6-2 Student',
					team_id: await fixtureTeamId()
				})
				.eq('id', data.user.id);
			if (updateError) throw new Error(`Failed to approve student: ${updateError.message}`);
			return data.user.id;
		}

		async function addDays(days: string[]) {
			const { error } = await admin.client.from('class_days').upsert(
				days.map((day) => ({ day })),
				{ onConflict: 'day', ignoreDuplicates: true }
			);
			if (error) throw new Error(`Failed to add class days: ${error.message}`);
		}

		async function dayId(day: string) {
			const { data } = await adminClient.from('class_days').select('id').eq('day', day).single();
			return data!.id as string;
		}

		/** The class's session on `day` (the class day must exist). */
		async function sessionOf(classId: string, day: string) {
			const { data, error } = await adminClient
				.from('class_sessions_effective')
				.select('id')
				.eq('class_id', classId)
				.eq('day', day)
				.single();
			if (error || !data) throw new Error(`No session on ${day}: ${error?.message}`);
			return data.id as string;
		}

		/** A service-role mark (no RLS), like the migration's own data. */
		function serviceMark(params: {
			studentId: string;
			classId: string;
			sessionId: string;
			present: boolean;
		}) {
			return adminClient.from('attendance_records').insert({
				student_id: params.studentId,
				class_id: params.classId,
				class_session_id: params.sessionId,
				present: params.present,
				recorded_by: teacherA.id
			});
		}

		/** A teacher's mark; throws if it is refused. */
		async function teacherMark(params: {
			studentId: string;
			classId: string;
			sessionId: string;
			present: boolean;
		}) {
			const { error } = await teacherA.client.from('attendance_records').insert({
				student_id: params.studentId,
				class_id: params.classId,
				class_session_id: params.sessionId,
				present: params.present,
				recorded_by: teacherA.id
			});
			if (error) throw new Error(`Failed to mark attendance: ${error.message}`);
		}

		const assignments = new Map<string, string>();
		/** Homework of `classId` for the week of `day`, marked Done by the student. */
		async function homeworkDone(classId: string, studentId: string, day: string) {
			let assignmentId = assignments.get(classId);
			if (!assignmentId) {
				const { data, error } = await adminClient
					.from('homework_assignments')
					.insert({
						class_id: classId,
						title: `Story 6-2 HW ${crypto.randomUUID().slice(0, 6)}`,
						skill_area: 'language',
						created_by: teacherA.id
					})
					.select('id')
					.single();
				if (error || !data) throw new Error(`Failed to create assignment: ${error?.message}`);
				assignmentId = data.id as string;
				assignments.set(classId, assignmentId);
			}
			const periodStart = mondayOf(day);
			const { data: existing } = await adminClient
				.from('homework_instances')
				.select('id')
				.eq('assignment_id', assignmentId)
				.eq('period_start', periodStart)
				.maybeSingle();
			let instanceId = existing?.id as string | undefined;
			if (!instanceId) {
				const { data, error } = await adminClient
					.from('homework_instances')
					.insert({
						assignment_id: assignmentId,
						class_id: classId,
						period_start: periodStart,
						due_date: plusDays(periodStart, 6)
					})
					.select('id')
					.single();
				if (error || !data) throw new Error(`Failed to create instance: ${error?.message}`);
				instanceId = data.id as string;
			}
			for (const status of ['assigned', 'done'] as const) {
				const { error } = await adminClient.from('homework_status_history').insert({
					instance_id: instanceId,
					student_id: studentId,
					class_id: classId,
					status,
					recorded_by: teacherA.id
				});
				if (error) throw new Error(`Failed to mark homework ${status}: ${error.message}`);
			}
		}

		async function readStreak(studentId: string) {
			const { data } = await adminClient
				.from('student_streaks')
				.select('current_streak, last_qualifying_week')
				.eq('student_id', studentId)
				.maybeSingle();
			return data;
		}

		it('a teacher marks a non-cancelled session held today: the row references the session, carries its day, and the streak is recomputed', async () => {
			const today = todayInBerlin();
			const classId = await createClass('Today');
			const student = await createStudent(classId);
			await addDays([today]);
			const sessionId = await sessionOf(classId, today);
			await homeworkDone(classId, student, today);

			const { data, error } = await teacherA.client
				.from('attendance_records')
				.insert({
					student_id: student,
					class_id: classId,
					class_session_id: sessionId,
					present: true,
					// Ignored: the day always comes from the session.
					session_date: '2000-01-01',
					recorded_by: teacherA.id
				})
				.select('class_session_id, session_date')
				.single();
			expect(error).toBeNull();
			expect(data).toEqual({ class_session_id: sessionId, session_date: today });

			expect(await readStreak(student)).toEqual({
				current_streak: 1,
				last_qualifying_week: mondayOf(today)
			});
		});

		it('a session after today (Berlin) is refused, for the admin too', async () => {
			const day = `${futureYear()}-06-01`;
			const classId = await createClass('Future');
			const student = await createStudent(classId);
			await addDays([day]);
			const sessionId = await sessionOf(classId, day);

			const byTeacher = await teacherA.client.from('attendance_records').insert({
				student_id: student,
				class_id: classId,
				class_session_id: sessionId,
				present: true,
				recorded_by: teacherA.id
			});
			expect(byTeacher.error).not.toBeNull();

			const byAdmin = await admin.client.from('attendance_records').insert({
				student_id: student,
				class_id: classId,
				class_session_id: sessionId,
				present: true,
				recorded_by: admin.id
			});
			expect(byAdmin.error).not.toBeNull();

			const { data } = await adminClient
				.from('attendance_records')
				.select('id')
				.eq('student_id', student);
			expect(data).toEqual([]);
		});

		it('a cancelled session, or a session on a cancelled class day, is refused', async () => {
			const [open, cancelledSession, cancelledDay] = sundays(pastYear(), 3);
			const classId = await createClass('Cancelled');
			const student = await createStudent(classId);
			await addDays([open, cancelledSession, cancelledDay]);

			const { data: updated, error: sessionError } = await teacherA.client
				.from('class_sessions')
				.update({ cancelled: true })
				.eq('id', await sessionOf(classId, cancelledSession))
				.select('id');
			expect(sessionError).toBeNull();
			expect(updated).toHaveLength(1);
			const { error: dayError } = await admin.client
				.from('class_days')
				.update({ cancelled: true })
				.eq('id', await dayId(cancelledDay));
			expect(dayError).toBeNull();

			try {
				for (const day of [cancelledSession, cancelledDay]) {
					const { error } = await teacherA.client.from('attendance_records').insert({
						student_id: student,
						class_id: classId,
						class_session_id: await sessionOf(classId, day),
						present: true,
						recorded_by: teacherA.id
					});
					expect(error).not.toBeNull();
				}

				// The same student on an open session of the same class is fine.
				await teacherMark({
					studentId: student,
					classId,
					sessionId: await sessionOf(classId, open),
					present: true
				});
			} finally {
				const { error } = await admin.client
					.from('class_days')
					.update({ cancelled: false })
					.eq('id', await dayId(cancelledDay));
				expect(error).toBeNull();
			}
		});

		it('a session of another class is refused, and the foreign key refuses it even for the service role', async () => {
			const [day] = sundays(pastYear(), 1);
			const classA = await createClass('Wrong A');
			const classB = await createClass('Wrong B');
			const student = await createStudent(classA);
			await addDays([day]);
			const sessionB = await sessionOf(classB, day);

			const byTeacher = await teacherA.client.from('attendance_records').insert({
				student_id: student,
				class_id: classA,
				class_session_id: sessionB,
				present: true,
				recorded_by: teacherA.id
			});
			expect(byTeacher.error).not.toBeNull();

			const byService = await serviceMark({
				studentId: student,
				classId: classA,
				sessionId: sessionB,
				present: true
			});
			expect(byService.error?.code).toBe('23503');
		});

		it('weeks whose sessions are all cancelled are holidays: they neither extend nor break the streak, and (un)cancelling recomputes it', async () => {
			const [s0, s1, s2, s3, s4] = sundays(pastYear(), 5);
			const classId = await createClass('Holiday');
			const x = await createStudent(classId);
			const y = await createStudent(classId);
			await addDays([s0, s1, s2, s3, s4]);

			// X qualifies in the first and last week and misses the three between
			// (Y attends them, so the class met) -- three misses exceed the default
			// grace of two, so only the last week counts.
			for (const day of [s0, s4]) {
				await homeworkDone(classId, x, day);
				await teacherMark({
					studentId: x,
					classId,
					sessionId: await sessionOf(classId, day),
					present: true
				});
			}
			for (const day of [s1, s2, s3]) {
				const sessionId = await sessionOf(classId, day);
				await teacherMark({ studentId: x, classId, sessionId, present: false });
				await teacherMark({ studentId: y, classId, sessionId, present: true });
			}
			expect(graceWeeks).toBe(2);
			expect(await readStreak(x)).toEqual({
				current_streak: 1,
				last_qualifying_week: mondayOf(s4)
			});

			// Cancelling one missed session after marking makes its week a holiday:
			// two misses are within grace, so the streak reaches back to s0.
			const s1Session = await sessionOf(classId, s1);
			expect(
				(
					await teacherA.client
						.from('class_sessions')
						.update({ cancelled: true })
						.eq('id', s1Session)
				).error
			).toBeNull();
			expect(await readStreak(x)).toEqual({
				current_streak: 2,
				last_qualifying_week: mondayOf(s4)
			});

			// Restoring it counts the week again.
			expect(
				(
					await teacherA.client
						.from('class_sessions')
						.update({ cancelled: false })
						.eq('id', s1Session)
				).error
			).toBeNull();
			expect((await readStreak(x))?.current_streak).toBe(1);

			// Cancelling the whole class day works the same way.
			const s2Day = await dayId(s2);
			expect(
				(await admin.client.from('class_days').update({ cancelled: true }).eq('id', s2Day)).error
			).toBeNull();
			try {
				// Two, not three: the holiday week doesn't extend the streak either.
				expect((await readStreak(x))?.current_streak).toBe(2);
			} finally {
				expect(
					(await admin.client.from('class_days').update({ cancelled: false }).eq('id', s2Day)).error
				).toBeNull();
			}
			expect((await readStreak(x))?.current_streak).toBe(1);
		});

		it('fortnightly class (issue #51): qualifying in W0, W2, W4 gives a streak of 3; off weeks neither break nor count', async () => {
			const w = sundays(pastYear(), 5);
			const classId = await createClass('Fortnightly', [SUN], { startsOn: w[0], intervalWeeks: 2 });
			const x = await createStudent(classId);
			await addDays(w);

			// Off weeks have no session at all.
			const { data: sessions } = await adminClient
				.from('class_sessions_effective')
				.select('day')
				.eq('class_id', classId)
				.in('day', w)
				.order('day');
			expect((sessions ?? []).map((s) => s.day)).toEqual([w[0], w[2], w[4]]);

			for (const day of [w[0], w[2], w[4]]) {
				await homeworkDone(classId, x, day);
				await teacherMark({
					studentId: x,
					classId,
					sessionId: await sessionOf(classId, day),
					present: true
				});
			}
			expect(await readStreak(x)).toEqual({
				current_streak: 3,
				last_qualifying_week: mondayOf(w[4])
			});
		});

		it('an admin can delete a class that has attendance marks once nobody is enrolled: the marks go with it', async () => {
			const [day] = sundays(pastYear(), 1);
			const classId = await createClass('Delete');
			const otherClass = await createClass('Delete Other');
			const student = await createStudent(classId);
			await addDays([day]);
			await teacherMark({
				studentId: student,
				classId,
				sessionId: await sessionOf(classId, day),
				present: true
			});

			// The 0011 guard needs the class empty; unenrolling needs another class.
			const { error: enrollError } = await adminClient
				.from('class_enrollments')
				.insert({ class_id: otherClass, student_id: student });
			expect(enrollError).toBeNull();
			const { error: unenrollError } = await admin.client.rpc('unenroll_student', {
				p_class_id: classId,
				p_student_id: student
			});
			expect(unenrollError).toBeNull();

			const { data: deleted, error: deleteError } = await admin.client
				.from('classes')
				.delete()
				.eq('id', classId)
				.select('id');
			expect(deleteError).toBeNull();
			expect(deleted).toHaveLength(1);

			const { data: marks } = await adminClient
				.from('attendance_records')
				.select('id')
				.eq('class_id', classId);
			expect(marks).toEqual([]);
		});

		it('a session nobody was marked on is a holiday, until its first mark makes the week count for the whole class', async () => {
			const [s0, s1, s2, s3] = sundays(pastYear(), 4);
			const classId = await createClass('First Mark');
			const x = await createStudent(classId);
			const y = await createStudent(classId);
			await addDays([s0, s1, s2, s3]);

			await homeworkDone(classId, x, s0);
			await teacherMark({
				studentId: x,
				classId,
				sessionId: await sessionOf(classId, s0),
				present: true
			});
			// s1..s3 have sessions but no marks: holidays, no grace used.
			expect(await readStreak(x)).toEqual({
				current_streak: 1,
				last_qualifying_week: mondayOf(s0)
			});

			// Y's marks turn those weeks into session weeks X missed -- X's streak
			// is recomputed although X was never marked on them.
			for (const day of [s1, s2, s3]) {
				await teacherMark({
					studentId: y,
					classId,
					sessionId: await sessionOf(classId, day),
					present: true
				});
			}
			expect((await readStreak(x))?.current_streak).toBe(0);
		});

		it('a schedule change keeps a today-session that has marks and still drops an unmarked one', async () => {
			const today = todayInBerlin();
			const others = [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== isoDow(today));
			const marked = await createClass('Regen Marked');
			const unmarked = await createClass('Regen Unmarked');
			const student = await createStudent(marked);
			await addDays([today]);
			const sessionId = await sessionOf(marked, today);
			await teacherMark({ studentId: student, classId: marked, sessionId, present: true });

			for (const classId of [marked, unmarked]) {
				const { error } = await admin.client.rpc('set_class_schedule', {
					p_class_id: classId,
					p_weekdays: others,
					p_start_time: null,
					p_duration_minutes: null,
					p_starts_on: '1900-01-01',
					p_ends_on: null
				});
				expect(error).toBeNull();
			}

			const { data: kept } = await adminClient
				.from('class_sessions_effective')
				.select('id, extra')
				.in('class_id', [marked, unmarked])
				.eq('day', today);
			expect(kept).toEqual([{ id: sessionId, extra: false }]);
		});

		/**
		 * The pre-0021 rule (0016), ported: attendance weeks = weeks of the
		 * student's present marks; session weeks = weeks with any mark in the
		 * class; walk back from `asOfWeek`, skipping non-session weeks.
		 */
		function legacyStreak(params: {
			marks: { student: string; day: string; present: boolean }[];
			doneDays: string[];
			student: string;
			asOfWeek: string;
			grace: number;
		}) {
			const attendanceWeeks = new Set(
				params.marks
					.filter((m) => m.student === params.student && m.present)
					.map((m) => mondayOf(m.day))
			);
			const doneWeeks = new Set(params.doneDays.map(mondayOf));
			const qualifying = new Set([...attendanceWeeks].filter((w) => doneWeeks.has(w)));
			const sessionWeeks = new Set(params.marks.map((m) => mondayOf(m.day)));
			const earliest = [...sessionWeeks].sort()[0];
			let streak = 0;
			let last: string | null = null;
			let gap = 0;
			if (qualifying.size === 0) return { current_streak: 0, last_qualifying_week: null };
			for (let week = params.asOfWeek; week >= earliest; week = plusDays(week, -7)) {
				if (!sessionWeeks.has(week)) continue;
				if (qualifying.has(week)) {
					streak += 1;
					gap = 0;
					last ??= week;
				} else {
					gap += 1;
					if (gap > params.grace) break;
				}
			}
			return { current_streak: streak, last_qualifying_week: last };
		}

		it('migration equivalence: legacy (class, date) marks map onto sessions unchanged, and every streak matches the pre-0021 rule', async () => {
			const year = pastYear();
			const sun = sundays(year, 10);
			// Sunday-only schedule, so a Saturday mark needs an extra session.
			const classId = await createClass('Backfill', [SUN]);
			const x = await createStudent(classId);
			const y = await createStudent(classId);

			// sun[0] already has a class day (and so a session); the others don't.
			await addDays([sun[0]]);
			const existingSession = await sessionOf(classId, sun[0]);

			const saturday = plusDays(sun[6], -1);
			const marks = [
				...[0, 1, 2, 4, 5, 8, 9].flatMap((i) => [
					{ student: x, day: sun[i], present: i !== 5 },
					{ student: y, day: sun[i], present: i % 2 === 0 }
				]),
				// Week 3 and 7: no marks (holidays). Week 6: a Saturday session.
				{ student: x, day: saturday, present: true },
				{ student: y, day: saturday, present: true },
				// A duplicate, later mark for the same (student, day).
				{ student: y, day: sun[1], present: true }
			];
			const doneDays = [0, 1, 2, 4, 6, 8, 9].map((i) => sun[i]);

			for (const student of [x, y]) {
				for (const day of doneDays) await homeworkDone(classId, student, day);
			}

			// Legacy marks: (class, date) -> the backfill's session.
			const sessionByDay = new Map<string, string>();
			for (const m of marks) {
				let sessionId = sessionByDay.get(m.day);
				if (!sessionId) {
					sessionId = await sessionFor(classId, m.day);
					sessionByDay.set(m.day, sessionId);
				}
				const { error } = await serviceMark({
					studentId: m.student,
					classId,
					sessionId,
					present: m.present
				});
				expect(error).toBeNull();
			}

			// Existing sessions are reused; a scheduled day gets a regular session;
			// an off-schedule day gets an extra one; a second call is idempotent.
			expect(sessionByDay.get(sun[0])).toBe(existingSession);
			expect(await sessionFor(classId, sun[1])).toBe(sessionByDay.get(sun[1]));
			const { data: kinds } = await adminClient
				.from('class_sessions_effective')
				.select('day, extra, cancelled')
				.eq('class_id', classId)
				.in('day', [sun[1], saturday])
				.order('day');
			expect(kinds).toEqual([
				{ day: sun[1], extra: false, cancelled: false },
				{ day: saturday, extra: true, cancelled: false }
			]);

			// Every mark keeps student, class, present and day.
			const { data: rows } = await adminClient
				.from('attendance_records')
				.select('student_id, class_id, present, session_date, class_session_id')
				.eq('class_id', classId);
			expect(rows).toHaveLength(marks.length);
			const got = (rows ?? []).map((r) => `${r.student_id}|${r.session_date}|${r.present}`).sort();
			const want = marks.map((m) => `${m.student}|${m.day}|${m.present}`).sort();
			expect(got).toEqual(want);
			for (const r of rows ?? []) {
				expect(r.class_session_id).toBe(sessionByDay.get(r.session_date));
			}

			// Streaks: the calendar rule equals the pre-0021 rule, at several
			// points in time.
			for (const asOf of [sun[9], sun[7], sun[5], plusDays(sun[9], 21)]) {
				const asOfWeek = mondayOf(asOf);
				for (const student of [x, y]) {
					const { data, error } = await adminClient.rpc('compute_student_streak', {
						p_student_id: student,
						p_class_id: classId,
						p_as_of_week: asOfWeek
					});
					expect(error).toBeNull();
					expect(data).toEqual(
						legacyStreak({ marks, doneDays, student, asOfWeek, grace: graceWeeks })
					);
				}
			}
			// The scenario is not trivial.
			expect(
				legacyStreak({ marks, doneDays, student: x, asOfWeek: mondayOf(sun[9]), grace: graceWeeks })
					.current_streak
			).toBeGreaterThan(2);

			// Clients can't call the backfill or the pure rule.
			const backfill = await admin.client.rpc('attendance_backfill_session', {
				p_class_id: classId,
				p_day: sun[0]
			});
			expect(backfill.error).not.toBeNull();
			const compute = await admin.client.rpc('compute_student_streak', {
				p_student_id: x,
				p_class_id: classId
			});
			expect(compute.error).not.toBeNull();
		});
	}
);

/**
 * Story 7-1: parent accounts (migrations 0022/0023). Registration goes
 * through the public signUp() with user_metadata role 'parent', exactly as
 * the /register action does; the admin decides through RLS.
 */
describe.skipIf(!reachable)('7-1 parents (requires local Supabase)', () => {
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let classId: string;

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacher = await createSignedInUser('teacher');

		const { data, error } = await adminClient
			.from('classes')
			.insert({
				name: `7-1 Class ${crypto.randomUUID().slice(0, 6)}`,
				code: `P${crypto.randomUUID().slice(0, 5).toUpperCase()}`
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		classId = data.id;
		await adminClient.from('class_teachers').insert({ class_id: classId, teacher_id: teacher.id });

		const { error: studentError } = await signUpStudent({
			classId,
			registrationName: `7-1 Student ${crypto.randomUUID().slice(0, 8)}`
		});
		if (studentError) throw new Error(`Failed to sign up student: ${studentError.message}`);

		const { error: hwError } = await adminClient.from('homework_assignments').insert({
			class_id: classId,
			title: '7-1 homework',
			skill_area: 'language',
			created_by: teacher.id
		});
		if (hwError) throw new Error(`Failed to create homework: ${hwError.message}`);
	});

	/** Registers a parent like /register does. */
	async function registerParent(email = `story-7-1-parent-${crypto.randomUUID()}@example.test`) {
		const password = crypto.randomUUID();
		const client = anonClient();
		const { data, error } = await client.auth.signUp({
			email,
			password,
			options: { data: { role: 'parent', display_name: 'Dolma Parent' } }
		});
		await client.auth.signOut();
		return { email, password, id: data.user?.id ?? null, data, error };
	}

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	async function parentRow(id: string) {
		const { data } = await adminClient
			.from('parents')
			.select('status, reviewed_by, reviewed_at')
			.eq('id', id)
			.maybeSingle();
		return data;
	}

	it('Register: a parent sign-up creates a parent profile and a pending parents row', async () => {
		const { id, error, email } = await registerParent();
		expect(error).toBeNull();

		const { data: profile } = await adminClient
			.from('profiles')
			.select('role, display_name, email, status, email_confirmed_at')
			.eq('id', id!)
			.single();
		expect(profile).toEqual({
			role: 'parent',
			display_name: 'Dolma Parent',
			email,
			status: null,
			email_confirmed_at: null
		});
		expect(await parentRow(id!)).toEqual({
			status: 'pending',
			reviewed_by: null,
			reviewed_at: null
		});
	});

	it('Existing email: the lookup finds any login, case-insensitively, and a second sign-up creates nothing', async () => {
		expect(await emailHasLogin(adminClient, teacher.email)).toBe(true);
		expect(await emailHasLogin(adminClient, teacher.email.toUpperCase())).toBe(true);
		expect(await emailHasLogin(adminClient, `nobody-${crypto.randomUUID()}@example.test`)).toBe(
			false
		);
		// Wildcards in the input must not match other emails.
		expect(await emailHasLogin(adminClient, '%@example.test')).toBe(false);

		const first = await registerParent();
		expect(await emailHasLogin(adminClient, first.email)).toBe(true);

		// The /register action stops at the lookup above. Even a sign-up that
		// got past it (a race) creates no second account.
		const second = await registerParent(first.email);
		expect(second.id === null || second.id === first.id).toBe(true);
		const { data: rows } = await adminClient
			.from('profiles')
			.select('id')
			.ilike('email', first.email);
		expect(rows).toHaveLength(1);
	});

	it('Approve unconfirmed: refused by RLS', async () => {
		const { id } = await registerParent();
		const { data, error } = await admin.client
			.from('parents')
			.update({ status: 'approved' })
			.eq('id', id!)
			.select('id');
		expect(error ?? (data ?? []).length === 0).toBeTruthy();
		expect((await parentRow(id!))?.status).toBe('pending');
	});

	it('Approve: a confirmed parent becomes approved, reviewed_by/at are set, is_parent() is true', async () => {
		const { id, email, password } = await registerParent();
		await confirmGuardianEmail(id!);
		const parent = await signIn(email, password);

		const { data: before } = await parent.rpc('is_parent');
		expect(before).toBe(false);

		const { error } = await admin.client
			.from('parents')
			.update({ status: 'approved' })
			.eq('id', id!)
			.select('id')
			.single();
		expect(error).toBeNull();

		const row = await parentRow(id!);
		expect(row?.status).toBe('approved');
		expect(row?.reviewed_by).toBe(admin.id);
		expect(row?.reviewed_at).not.toBeNull();

		const { data: after } = await parent.rpc('is_parent');
		expect(after).toBe(true);

		// A decided row never goes back to pending.
		const { error: backError } = await admin.client
			.from('parents')
			.update({ status: 'pending' })
			.eq('id', id!)
			.select('id')
			.single();
		expect(backError).not.toBeNull();
		expect((await parentRow(id!))?.status).toBe('approved');
	});

	it('Reject: allowed even unconfirmed; deleting the auth user removes profile and row, and the email registers again', async () => {
		const { id, email } = await registerParent();

		const { error } = await admin.client
			.from('parents')
			.update({ status: 'rejected' })
			.eq('id', id!)
			.select('id')
			.single();
		expect(error).toBeNull();

		const { error: deleteError } = await adminClient.auth.admin.deleteUser(id!);
		expect(deleteError).toBeNull();
		expect(await parentRow(id!)).toBeNull();
		const { data: profile } = await adminClient
			.from('profiles')
			.select('id')
			.eq('id', id!)
			.maybeSingle();
		expect(profile).toBeNull();
		expect(await emailHasLogin(adminClient, email)).toBe(false);

		const again = await registerParent(email);
		expect(again.error).toBeNull();
		expect(again.id).not.toBe(id);
		expect((await parentRow(again.id!))?.status).toBe('pending');
	});

	it('Parent edits own row: refused by RLS, and no client insert or delete', async () => {
		const { id, email, password } = await registerParent();
		await confirmGuardianEmail(id!);
		const parent = await signIn(email, password);

		const { data: own } = await parent.from('parents').select('id, status');
		expect(own).toEqual([{ id, status: 'pending' }]);

		const { data: updated } = await parent
			.from('parents')
			.update({ status: 'approved' })
			.eq('id', id!)
			.select('id');
		expect(updated ?? []).toEqual([]);
		expect((await parentRow(id!))?.status).toBe('pending');

		const { error: insertError } = await parent
			.from('parents')
			.insert({ id: crypto.randomUUID(), status: 'approved' });
		expect(insertError).not.toBeNull();

		await parent.from('parents').delete().eq('id', id!);
		expect((await parentRow(id!))?.status).toBe('pending');

		// Nor can the admin write reviewed_by directly (column grant is status only).
		const { error: stampError } = await admin.client
			.from('parents')
			.update({ reviewed_by: teacher.id })
			.eq('id', id!);
		expect(stampError).not.toBeNull();
	});

	it('Teacher and anon read no parents rows', async () => {
		await registerParent();
		const { data: teacherRows } = await teacher.client.from('parents').select('id');
		expect(teacherRows ?? []).toEqual([]);

		const { data: anonRows } = await anonClient().from('parents').select('id');
		expect(anonRows ?? []).toEqual([]);

		const { data: adminRows } = await admin.client.from('parents').select('id');
		expect((adminRows ?? []).length).toBeGreaterThan(0);
	});

	it('A pending parent reads no student, class or homework rows', async () => {
		const { id, email, password } = await registerParent();
		await confirmGuardianEmail(id!);
		const parent = await signIn(email, password);

		const { data: profiles } = await parent.from('profiles').select('id');
		expect(profiles).toEqual([{ id }]);
		const { data: classes } = await parent.from('classes').select('id');
		expect(classes ?? []).toEqual([]);
		const { data: assignments } = await parent.from('homework_assignments').select('id');
		expect(assignments ?? []).toEqual([]);
		const { data: instances } = await parent.from('homework_instances').select('id');
		expect(instances ?? []).toEqual([]);
		const { data: enrollments } = await parent.from('class_enrollments').select('student_id');
		expect(enrollments ?? []).toEqual([]);
	});

	it('A teacher cannot change parents.status', async () => {
		const { id } = await registerParent();
		await confirmGuardianEmail(id!);
		const { data } = await teacher.client
			.from('parents')
			.update({ status: 'approved' })
			.eq('id', id!)
			.select('id');
		expect(data ?? []).toEqual([]);
		expect((await parentRow(id!))?.status).toBe('pending');
	});

	it('A rejected parent cannot be approved afterwards', async () => {
		const { id } = await registerParent();
		await confirmGuardianEmail(id!);
		const { error } = await admin.client
			.from('parents')
			.update({ status: 'rejected' })
			.eq('id', id!)
			.select('id')
			.single();
		expect(error).toBeNull();

		const { error: approveError } = await admin.client
			.from('parents')
			.update({ status: 'approved' })
			.eq('id', id!)
			.select('id')
			.single();
		expect(approveError).not.toBeNull();
		expect((await parentRow(id!))?.status).toBe('rejected');
	});

	it('A parent sign-up carrying student metadata leaves the student columns null', async () => {
		const client = anonClient();
		const { data, error } = await client.auth.signUp({
			email: `story-7-1-meta-${crypto.randomUUID()}@example.test`,
			password: crypto.randomUUID(),
			options: {
				data: {
					role: 'parent',
					display_name: 'Meta Parent',
					class_id: classId,
					registration_name: 'Sneaky Student',
					guardian_consent_given_at: new Date().toISOString()
				}
			}
		});
		await client.auth.signOut();
		expect(error).toBeNull();

		const { data: profile } = await adminClient
			.from('profiles')
			.select(
				'role, status, class_id, team_id, registration_name, guardian_consent_given_at, guardian_email'
			)
			.eq('id', data.user!.id)
			.single();
		expect(profile).toEqual({
			role: 'parent',
			status: null,
			class_id: null,
			team_id: null,
			registration_name: null,
			guardian_consent_given_at: null,
			guardian_email: null
		});
	});

	it('A crafted parent sign-up with a student login address is refused', async () => {
		const email = `story-7-1-${crypto.randomUUID().slice(0, 8)}@${STUDENT_EMAIL_DOMAIN.toUpperCase()}`;
		const { data, error } = await anonClient().auth.signUp({
			email,
			password: crypto.randomUUID(),
			options: { data: { role: 'parent', display_name: 'Crafted' } }
		});
		expect(error).not.toBeNull();
		expect(data.user).toBeNull();
		expect(await emailHasLogin(adminClient, email)).toBe(false);
	});

	it('A crafted parent sign-up with a name over 80 characters is refused', async () => {
		const email = `story-7-1-longname-${crypto.randomUUID()}@example.test`;
		const { data, error } = await anonClient().auth.signUp({
			email,
			password: crypto.randomUUID(),
			options: { data: { role: 'parent', display_name: 'x'.repeat(81) } }
		});
		expect(error).not.toBeNull();
		expect(data.user).toBeNull();
		expect(await emailHasLogin(adminClient, email)).toBe(false);
	});

	it.each([
		['admin', { role: 'admin' }],
		['teacher', { role: 'teacher' }]
	])('Crafted sign-up with user_metadata role %s is refused', async (_label, data) => {
		const email = `story-7-1-crafted-${crypto.randomUUID()}@example.test`;
		const { data: result, error } = await anonClient().auth.signUp({
			email,
			password: crypto.randomUUID(),
			options: { data }
		});
		expect(error).not.toBeNull();
		expect(result.user).toBeNull();
		expect(await emailHasLogin(adminClient, email)).toBe(false);
	});
});

/**
 * Story 7-2: parent-first student registration & linking (migration 0024).
 * One test per I/O matrix row. Students register the way /join does
 * (signUpStudent: Admin API, synthetic pending- email, user_metadata).
 */
describe.skipIf(!reachable)('7-2 parent-first registration (requires local Supabase)', () => {
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let otherTeacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let classId: string;

	beforeAll(async () => {
		teacher = await createSignedInUser('teacher');
		otherTeacher = await createSignedInUser('teacher');

		const { data, error } = await adminClient
			.from('classes')
			.insert({
				name: `7-2 Class ${crypto.randomUUID().slice(0, 6)}`,
				code: `Q${crypto.randomUUID().slice(0, 5).toUpperCase()}`
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		classId = data.id;
		await adminClient.from('class_teachers').insert({ class_id: classId, teacher_id: teacher.id });

		// #99: approval needs a team to exist; the database picks it (0043).
		const { error: teamError } = await adminClient
			.from('teams')
			.insert({ name: `7-2 Team ${crypto.randomUUID().slice(0, 6)}` });
		if (teamError) throw new Error(`Failed to create team: ${teamError.message}`);
	}, 30000);

	const studentName = (label: string) => `7-2 ${label} ${crypto.randomUUID().slice(0, 8)}`;

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	async function profileOf(id: string) {
		const { data } = await adminClient
			.from('profiles')
			.select('status, registered_by_parent_id, guardian_email, role')
			.eq('id', id)
			.maybeSingle();
		return data;
	}

	/** No profile carries this registration name: the sign-up rolled back. */
	async function expectNoStudent(registrationName: string) {
		const { data } = await adminClient
			.from('profiles')
			.select('id')
			.eq('registration_name', registrationName);
		expect(data).toEqual([]);
	}

	/**
	 * The requests/+page.server.ts approve action's order: mint credentials,
	 * then flip the profile as the assigned teacher. Returns the credentials.
	 */
	async function approveAsTeacher(studentId: string, registrationName: string) {
		const username = generateUniqueStudentUsername(
			`${registrationName} ${crypto.randomUUID().slice(0, 6)}`,
			new Set()
		);
		const pin = generateStudentPin();
		const { error: authError } = await updateAuthUserEmailAndPassword(studentId, {
			email: studentUsernameToEmail(username),
			password: pin
		});
		if (authError) throw new Error(`Failed to mint credentials: ${authError.message}`);
		const { error } = await teacher.client
			.from('profiles')
			.update({
				status: 'approved',
				email: studentUsernameToEmail(username),
				reviewed_by: teacher.id,
				reviewed_at: new Date().toISOString()
			})
			.eq('id', studentId)
			.select('id')
			.single();
		if (error) throw new Error(`Failed to approve: ${error.message}`);
		return { username, pin };
	}

	/** #100: a username and PIN as the `register` action makes them. */
	function newCredentials(registrationName: string) {
		return {
			username: generateUniqueStudentUsername(
				`${registrationName} ${crypto.randomUUID().slice(0, 6)}`,
				new Set()
			),
			pin: generateStudentPin()
		};
	}

	it('Register: an approved parent email in any case links a pending student whose address is the username (#100)', async () => {
		const parent = await createApprovedParent();
		const typed = `  ${parent.email.toUpperCase()} `;
		expect(await approvedParentExists(adminClient, typed)).toBe(true);

		const registrationName = studentName('Register');
		const credentials = newCredentials(registrationName);
		const { error, credentialsError, id } = await signUpStudent({
			classId,
			registrationName,
			guardianEmail: typed,
			credentials
		});
		expect(error ?? credentialsError).toBeNull();

		const { data: profile } = await adminClient
			.from('profiles')
			.select('status, registered_by_parent_id, guardian_email, email')
			.eq('id', id!)
			.single();
		expect(profile?.status).toBe('pending');
		expect(profile?.registered_by_parent_id).toBe(parent.id);
		expect(profile?.guardian_email).toBe(typed.trim());
		// The second step replaced the placeholder address with the username's.
		expect(profile?.email).toBe(studentUsernameToEmail(credentials.username));
	});

	it('Register (#100): a taken username is refused as a duplicate and the account keeps its placeholder address', async () => {
		const first = studentName('Taken A');
		const credentials = newCredentials(first);
		const one = await signUpStudent({ classId, registrationName: first, credentials });
		expect(one.error ?? one.credentialsError).toBeNull();

		const second = studentName('Taken B');
		const two = await signUpStudent({
			classId,
			registrationName: second,
			credentials: { username: credentials.username, pin: generateStudentPin() }
		});
		expect(two.error).toBeNull();
		expect(two.credentialsError).not.toBeNull();
		expect(isDuplicateEmailError(two.credentialsError!)).toBe(true);

		const { data: profile } = await adminClient
			.from('profiles')
			.select('email, status')
			.eq('id', two.id!)
			.single();
		expect(profile?.status).toBe('pending');
		expect(profile?.email).toMatch(/^pending-[0-9a-f-]+@students\.internal\.invalid$/);
		// The first student's PIN still signs in.
		await signIn(studentUsernameToEmail(credentials.username), credentials.pin);
	});

	it.each(['pending', 'rejected'] as const)(
		'#100: a %s student signs in with the username and PIN and reads the own profile and nothing of a class',
		async (status) => {
			const registrationName = studentName(`Gate ${status}`);
			const credentials = newCredentials(registrationName);
			const { error, credentialsError, id } = await signUpStudent({
				classId,
				registrationName,
				credentials
			});
			expect(error ?? credentialsError).toBeNull();

			if (status === 'rejected') {
				const { error: rejectError } = await teacher.client
					.from('profiles')
					.update({
						status: 'rejected',
						reviewed_by: teacher.id,
						reviewed_at: new Date().toISOString()
					})
					.eq('id', id!)
					.select('id')
					.single();
				expect(rejectError).toBeNull();
			}

			// The login page's own path: the bare username and the PIN.
			const student = await signIn(
				resolveLoginIdentifierToEmail(credentials.username),
				credentials.pin
			);

			// Every profile the student can read is the own one.
			const { data: profiles, error: profilesError } = await student
				.from('profiles')
				.select('id, status, role');
			expect(profilesError).toBeNull();
			expect(profiles).toEqual([{ id: id!, status, role: 'student' }]);

			for (const table of [
				'classes',
				'class_enrollments',
				'homework_assignments',
				'homework_instances',
				'homework_status_history',
				'class_sessions',
				'attendance_records'
			] as const) {
				const { data, error: readError } = await student.from(table).select('*');
				expect(readError, table).toBeNull();
				expect(data, table).toEqual([]);
			}

			// And the student cannot approve itself.
			await student.from('profiles').update({ status: 'approved' }).eq('id', id!);
			expect((await profileOf(id!))?.status).toBe(status);
		},
		30000
	);

	it.each(['pending', 'rejected'] as const)(
		'#100: a signed-in %s student can write nothing: no join request, push subscription, deletion request or change to the own profile',
		async (status) => {
			const registrationName = studentName(`Writes ${status}`);
			const credentials = newCredentials(registrationName);
			const { error, credentialsError, id } = await signUpStudent({
				classId,
				registrationName,
				credentials
			});
			expect(error ?? credentialsError).toBeNull();
			if (status === 'rejected') {
				const { error: rejectError } = await teacher.client
					.from('profiles')
					.update({
						status: 'rejected',
						reviewed_by: teacher.id,
						reviewed_at: new Date().toISOString()
					})
					.eq('id', id!)
					.select('id')
					.single();
				expect(rejectError).toBeNull();
			}
			const student = await signIn(studentUsernameToEmail(credentials.username), credentials.pin);

			// Another class to ask for, a team and a parent to move to.
			const otherCode = `W${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
			const { data: otherClass, error: classError } = await adminClient
				.from('classes')
				.insert({ name: `7-2 Other ${crypto.randomUUID().slice(0, 6)}`, code: otherCode })
				.select('id')
				.single();
			expect(classError).toBeNull();
			const otherParent = await createApprovedParent();
			const teamId = await fixtureTeamId();

			const join = await student.rpc('request_class_join', { p_code: otherCode });
			expect(join.error, 'request_class_join').not.toBeNull();
			const { data: joinRows } = await adminClient
				.from('class_join_requests')
				.select('id')
				.eq('student_id', id!);
			expect(joinRows).toEqual([]);

			const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
			const push = await student.rpc('save_push_subscription', {
				p_endpoint: endpoint,
				p_p256dh: 'p256dh',
				p_auth: 'auth',
				p_locale: 'en'
			});
			expect(push.error, 'save_push_subscription').not.toBeNull();
			const { data: pushRows } = await adminClient
				.from('push_subscriptions')
				.select('endpoint')
				.eq('endpoint', endpoint);
			expect(pushRows).toEqual([]);

			const deletion = await student
				.from('deletion_requests')
				.insert({ student_id: id!, requested_by: id! });
			expect(deletion.error, 'deletion_requests insert').not.toBeNull();
			const { data: deletionRows } = await adminClient
				.from('deletion_requests')
				.select('id')
				.eq('student_id', id!);
			expect(deletionRows).toEqual([]);

			const ownProfile = async () =>
				(
					await adminClient
						.from('profiles')
						.select('email, class_id, team_id, registered_by_parent_id, status')
						.eq('id', id!)
						.single()
				).data;
			const before = await ownProfile();
			expect(before?.status).toBe(status);
			const attempts: Database['public']['Tables']['profiles']['Update'][] = [
				{ email: `hijack-${crypto.randomUUID().slice(0, 8)}@${STUDENT_EMAIL_DOMAIN}` },
				{ class_id: otherClass!.id },
				{ team_id: teamId },
				{ registered_by_parent_id: otherParent.id }
			];
			if (status === 'rejected') attempts.push({ status: 'pending' });
			for (const values of attempts) {
				await student.from('profiles').update(values).eq('id', id!);
				expect(await ownProfile(), JSON.stringify(values)).toEqual(before);
			}
		},
		30000
	);

	it('#100: approval flips the status only; the same username and PIN keep working and the class opens', async () => {
		const registrationName = studentName('Keep PIN');
		const credentials = newCredentials(registrationName);
		const { id } = await signUpStudent({ classId, registrationName, credentials });
		const email = studentUsernameToEmail(credentials.username);
		const student = await signIn(email, credentials.pin);
		expect((await student.from('classes').select('id')).data).toEqual([]);

		// The approve action for such a student: no Admin API call, no email.
		const { error } = await teacher.client
			.from('profiles')
			.update({
				status: 'approved',
				reviewed_by: teacher.id,
				reviewed_at: new Date().toISOString()
			})
			.eq('id', id!)
			.select('id')
			.single();
		expect(error).toBeNull();

		const { data: profile } = await adminClient
			.from('profiles')
			.select('status, email, team_id')
			.eq('id', id!)
			.single();
		expect(profile).toMatchObject({ status: 'approved', email });
		expect(profile?.team_id).not.toBeNull();

		// The session from before approval now reads the class, and the PIN
		// from registration still signs in.
		expect((await student.from('classes').select('id')).data).toEqual([{ id: classId }]);
		await signIn(email, credentials.pin);
	});

	it('No parent: an unknown email is not found and the sign-up creates nothing', async () => {
		const email = `story-7-2-nobody-${crypto.randomUUID()}@example.test`;
		expect(await approvedParentExists(adminClient, email)).toBe(false);

		const registrationName = studentName('No Parent');
		const { error, data } = await signUpStudent({
			classId,
			registrationName,
			guardianEmail: email
		});
		expect(error).not.toBeNull();
		expect(data.user).toBeNull();
		await expectNoStudent(registrationName);
	});

	it('Parent not approved: a pending, unconfirmed or rejected parent counts as not found', async () => {
		// Pending (confirmed, not yet decided).
		const pending = await adminClient.auth.admin.createUser({
			email: `story-7-2-pending-${crypto.randomUUID()}@example.test`,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'parent' }
		});
		// Unconfirmed: the public /register sign-up, never confirmed.
		const unconfirmedEmail = `story-7-2-unconfirmed-${crypto.randomUUID()}@example.test`;
		const client = anonClient();
		const unconfirmed = await client.auth.signUp({
			email: unconfirmedEmail,
			password: crypto.randomUUID(),
			options: { data: { role: 'parent', display_name: 'Unconfirmed Parent' } }
		});
		await client.auth.signOut();
		// Rejected (the row still exists before the action deletes the login).
		const rejected = await adminClient.auth.admin.createUser({
			email: `story-7-2-rejected-${crypto.randomUUID()}@example.test`,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'parent' }
		});
		expect(pending.error ?? unconfirmed.error ?? rejected.error).toBeNull();
		await adminClient
			.from('parents')
			.update({ status: 'rejected' })
			.eq('id', rejected.data.user!.id);

		for (const email of [pending.data.user!.email!, unconfirmedEmail, rejected.data.user!.email!]) {
			expect(await approvedParentExists(adminClient, email)).toBe(false);
			const registrationName = studentName('Unapproved');
			const { error } = await signUpStudent({ classId, registrationName, guardianEmail: email });
			expect(error).not.toBeNull();
			await expectNoStudent(registrationName);
		}
	});

	it('Siblings: two pending registrations with one parent email are both created and linked', async () => {
		const parent = await createApprovedParent();
		const ids: string[] = [];
		for (const label of ['Sibling A', 'Sibling B']) {
			const { error, id } = await signUpStudent({
				classId,
				registrationName: studentName(label),
				guardianEmail: parent.email
			});
			expect(error).toBeNull();
			ids.push(id!);
		}
		for (const id of ids) {
			expect(await profileOf(id)).toMatchObject({
				status: 'pending',
				registered_by_parent_id: parent.id
			});
		}
	});

	it('Crafted sign-up: a public signUp with an unknown guardian or a real auth email is refused', async () => {
		const parent = await createApprovedParent();

		// Unknown guardian, synthetic address.
		const unknownName = studentName('Crafted Unknown');
		const unknown = await anonClient().auth.signUp({
			email: `pending-${crypto.randomUUID()}@${STUDENT_EMAIL_DOMAIN}`,
			password: crypto.randomUUID(),
			options: {
				data: {
					role: 'student',
					class_id: classId,
					registration_name: unknownName,
					guardian_email: `story-7-2-nobody-${crypto.randomUUID()}@example.test`
				}
			}
		});
		expect(unknown.error).not.toBeNull();
		expect(unknown.data.user).toBeNull();
		await expectNoStudent(unknownName);

		// Approved guardian, but a real auth email (the retired 0006 shape).
		const realEmail = `story-7-2-real-${crypto.randomUUID()}@example.test`;
		const realName = studentName('Crafted Real');
		const real = await anonClient().auth.signUp({
			email: realEmail,
			password: crypto.randomUUID(),
			options: {
				data: {
					role: 'student',
					class_id: classId,
					registration_name: realName,
					guardian_email: parent.email
				}
			}
		});
		expect(real.error).not.toBeNull();
		expect(real.data.user).toBeNull();
		await expectNoStudent(realName);
		expect(await emailHasLogin(adminClient, realEmail)).toBe(false);

		// The trigger enforces it, not the client: the Admin API with
		// user_metadata and a real email is refused too.
		const viaAdminName = studentName('Crafted Admin');
		const viaAdmin = await adminClient.auth.admin.createUser({
			email: `story-7-2-real-${crypto.randomUUID()}@example.test`,
			password: crypto.randomUUID(),
			email_confirm: true,
			user_metadata: {
				role: 'student',
				class_id: classId,
				registration_name: viaAdminName,
				guardian_email: parent.email
			}
		});
		expect(viaAdmin.error).not.toBeNull();
		await expectNoStudent(viaAdminName);
	});

	it('Service-role student: app_metadata student may have no parent', async () => {
		const { data, error } = await adminClient.auth.admin.createUser({
			email: `story-7-2-fixture-${crypto.randomUUID()}@${STUDENT_EMAIL_DOMAIN}`,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'student' }
		});
		expect(error).toBeNull();
		expect(await profileOf(data.user!.id)).toMatchObject({
			role: 'student',
			status: 'pending',
			registered_by_parent_id: null
		});
	});

	it('Approve: the teacher approves without any confirmation; the child signs in and the parent sees them approved', async () => {
		const parent = await createApprovedParent();
		const registrationName = studentName('Approve');
		const { id } = await signUpStudent({ classId, registrationName, guardianEmail: parent.email });

		const parentClient = await signIn(parent.email, parent.password);
		const { data: before } = await parentClient.rpc('linked_children');
		expect(before).toEqual([{ id, name: registrationName, status: 'pending' }]);

		const { username, pin } = await approveAsTeacher(id!, registrationName);

		const login = await anonClient().auth.signInWithPassword({
			email: resolveLoginIdentifierToEmail(username),
			password: pin
		});
		expect(login.error).toBeNull();
		expect(login.data.session).not.toBeNull();

		const { data: after } = await parentClient.rpc('linked_children');
		expect(after).toEqual([{ id, name: registrationName, status: 'approved' }]);
		expect(await profileOf(id!)).toMatchObject({
			status: 'approved',
			registered_by_parent_id: parent.id
		});
	});

	it('Guard: the assigned teacher hits the guard trigger for registered_by_parent_id, guardian_email and role; student and parent updates have no effect; the service role can change them', async () => {
		const parent = await createApprovedParent();
		const otherParent = await createApprovedParent();
		const pendingName = studentName('Guard Pending');
		const { id: pendingId } = await signUpStudent({
			classId,
			registrationName: pendingName,
			guardianEmail: parent.email
		});

		// The assigned teacher's registration-review update (USING passes):
		// each link column alone, so only the guard can refuse it.
		for (const change of [
			{ registered_by_parent_id: otherParent.id },
			{ guardian_email: otherParent.email },
			{ role: 'teacher' as const }
		]) {
			const { error } = await teacher.client
				.from('profiles')
				.update(change)
				.eq('id', pendingId!)
				.select('id');
			expect(error?.message).toContain('cannot be changed here');
		}
		expect(await profileOf(pendingId!)).toMatchObject({
			status: 'pending',
			registered_by_parent_id: parent.id,
			guardian_email: parent.email,
			role: 'student'
		});

		// The student themself and the parent: no UPDATE policy covers the
		// row for them, so RLS filters it out (no effect, never reaches the guard).
		const approvedName = studentName('Guard Approved');
		const { id: approvedId } = await signUpStudent({
			classId,
			registrationName: approvedName,
			guardianEmail: parent.email
		});
		const { username, pin } = await approveAsTeacher(approvedId!, approvedName);
		const student = await signIn(resolveLoginIdentifierToEmail(username), pin);
		const parentClient = await signIn(parent.email, parent.password);
		for (const client of [student, parentClient]) {
			await client
				.from('profiles')
				.update({ registered_by_parent_id: otherParent.id, guardian_email: otherParent.email })
				.eq('id', approvedId!);
		}
		expect(await profileOf(approvedId!)).toMatchObject({
			registered_by_parent_id: parent.id,
			guardian_email: parent.email
		});

		// Trusted path (service role; 7-6's approval trigger is security definer).
		const { error: serviceError } = await adminClient
			.from('profiles')
			.update({ registered_by_parent_id: otherParent.id, guardian_email: otherParent.email })
			.eq('id', pendingId!);
		expect(serviceError).toBeNull();
		expect(await profileOf(pendingId!)).toMatchObject({ registered_by_parent_id: otherParent.id });

		// An unassigned teacher is filtered out by RLS before the guard.
		const { data: unassigned } = await otherTeacher.client
			.from('profiles')
			.update({ registered_by_parent_id: parent.id })
			.eq('id', pendingId!)
			.select('id');
		expect(unassigned ?? []).toEqual([]);
	});

	it('Parent sees children: pending and approved are listed, rejected is hidden; other parents see none', async () => {
		const parent = await createApprovedParent();
		const names = {
			pending: studentName('Kid Pending'),
			approved: studentName('Kid Approved'),
			rejected: studentName('Kid Rejected')
		};
		const ids: Record<string, string> = {};
		for (const [key, registrationName] of Object.entries(names)) {
			const { id, error } = await signUpStudent({
				classId,
				registrationName,
				guardianEmail: parent.email
			});
			expect(error).toBeNull();
			ids[key] = id!;
		}
		await approveAsTeacher(ids.approved, names.approved);
		const { error: rejectError } = await teacher.client
			.from('profiles')
			.update({
				status: 'rejected',
				reviewed_by: teacher.id,
				reviewed_at: new Date().toISOString()
			})
			.eq('id', ids.rejected)
			.select('id')
			.single();
		expect(rejectError).toBeNull();

		const parentClient = await signIn(parent.email, parent.password);
		const { data, error } = await parentClient.rpc('linked_children');
		expect(error).toBeNull();
		expect([...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name))).toEqual(
			[
				{ id: ids.approved, name: names.approved, status: 'approved' },
				{ id: ids.pending, name: names.pending, status: 'pending' }
			].sort((a, b) => a.name.localeCompare(b.name))
		);

		const stranger = await createApprovedParent();
		const strangerClient = await signIn(stranger.email, stranger.password);
		const { data: none } = await strangerClient.rpc('linked_children');
		expect(none).toEqual([]);

		// Anonymous callers cannot execute it.
		const anon = await anonClient().rpc('linked_children');
		expect(anon.error).not.toBeNull();
	});

	it('A parent who is not approved: is_parent_of is false and linked_children() is empty; a parent with a linked child cannot be rejected (0054)', async () => {
		const parent = await createApprovedParent();
		const childName = studentName('No Longer');
		const { id: childId } = await signUpStudent({
			classId,
			registrationName: childName,
			guardianEmail: parent.email
		});
		await approveAsTeacher(childId!, childName);
		const parentClient = await signIn(parent.email, parent.password);
		expect((await parentClient.rpc('is_parent_of', { p_student_id: childId! })).data).toBe(true);

		// spec-second-parent: the admin removes the links first.
		const { error: rejectError } = await adminClient
			.from('parents')
			.update({ status: 'rejected' })
			.eq('id', parent.id);
		expect(rejectError?.hint).toBe('parent_has_links');
		expect((await parentClient.rpc('is_parent_of', { p_student_id: childId! })).data).toBe(true);

		// A linked parent who is not approved (pending) gets nothing.
		const pending = await createPendingParent();
		await linkParent(adminClient, childId!, pending.id);
		const pendingClient = await signIn(pending.email, pending.password);
		expect((await pendingClient.rpc('is_parent_of', { p_student_id: childId! })).data).toBe(false);
		const { data: children, error } = await pendingClient.rpc('linked_children');
		expect(error).toBeNull();
		expect(children).toEqual([]);
	});

	it('is_parent_of: own approved child true, own pending child false, other child false', async () => {
		const parent = await createApprovedParent();
		const other = await createApprovedParent();

		const approvedName = studentName('Of Approved');
		const { id: approvedId } = await signUpStudent({
			classId,
			registrationName: approvedName,
			guardianEmail: parent.email
		});
		await approveAsTeacher(approvedId!, approvedName);
		const { id: pendingId } = await signUpStudent({
			classId,
			registrationName: studentName('Of Pending'),
			guardianEmail: parent.email
		});
		const otherName = studentName('Of Other');
		const { id: otherId } = await signUpStudent({
			classId,
			registrationName: otherName,
			guardianEmail: other.email
		});
		await approveAsTeacher(otherId!, otherName);

		const parentClient = await signIn(parent.email, parent.password);
		const check = async (studentId: string) =>
			(await parentClient.rpc('is_parent_of', { p_student_id: studentId })).data;
		expect(await check(approvedId!)).toBe(true);
		expect(await check(pendingId!)).toBe(false);
		expect(await check(otherId!)).toBe(false);

		// A teacher is never a parent of the student.
		const { data: asTeacher } = await teacher.client.rpc('is_parent_of', {
			p_student_id: approvedId!
		});
		expect(asTeacher).toBe(false);
	});
});

/**
 * Story 7-3: parent read access (migration 0025). One test per I/O matrix
 * row, plus the dual-role acceptance criterion. Fixtures are written with
 * the service role; every assertion reads as the real caller.
 */
describe.skipIf(!reachable)('7-3 parent reads (requires local Supabase)', () => {
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacherB: Awaited<ReturnType<typeof createSignedInUser>>;
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let classId: string;
	let classBId: string;
	let teamId: string;
	let lookahead: number;

	const today = todayInBerlin();
	const addDays = (isoDate: string, days: number) => {
		const date = new Date(`${isoDate}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() + days);
		return date.toISOString().slice(0, 10);
	};
	const name = (label: string) => `7-3 ${label} ${crypto.randomUUID().slice(0, 8)}`;

	async function createClass(label: string, teacherId: string) {
		const { data, error } = await adminClient
			.from('classes')
			.insert({
				name: name(label),
				code: `P${crypto.randomUUID().slice(0, 5).toUpperCase()}`
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		await adminClient.from('class_teachers').insert({ class_id: data.id, teacher_id: teacherId });
		return data.id;
	}

	beforeAll(async () => {
		teacher = await createSignedInUser('teacher');
		teacherB = await createSignedInUser('teacher');
		admin = await createSignedInUser('admin');
		classId = await createClass('Class A', teacher.id);
		classBId = await createClass('Class B', teacherB.id);

		const { data: team, error: teamError } = await adminClient
			.from('teams')
			.insert({ name: name('Team') })
			.select('id')
			.single();
		if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
		teamId = team.id;

		const { data: setting } = await adminClient
			.from('app_settings')
			.select('value')
			.eq('key', 'homework_lookahead_days')
			.single();
		lookahead = Number((setting?.value as { days?: unknown } | null)?.days ?? 14);
	}, 30000);

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	/** A child of `parentEmail` in `cls`; approved (and so enrolled) unless `pending`. */
	async function child(parentEmail: string, cls = classId, pending = false) {
		const { id, error } = await signUpStudent({
			classId: cls,
			registrationName: name(pending ? 'Pending Kid' : 'Kid'),
			guardianEmail: parentEmail
		});
		if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
		if (!pending) {
			const { error: approveError } = await adminClient
				.from('profiles')
				.update({ status: 'approved', team_id: teamId })
				.eq('id', id);
			if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
		}
		return id;
	}

	async function signInStudent(id: string) {
		const password = crypto.randomUUID();
		const { data } = await adminClient.auth.admin.updateUserById(id, { password });
		return signIn(data.user!.email!, password);
	}

	/** One homework instance of `cls` due on `dueDate`, assigned to `targets`. */
	async function homework(params: {
		cls?: string;
		dueDate: string;
		targets: string[];
		archived?: boolean;
	}) {
		const cls = params.cls ?? classId;
		const { data: assignment, error: assignmentError } = await adminClient
			.from('homework_assignments')
			.insert({
				class_id: cls,
				title: name('Homework'),
				skill_area: 'language',
				created_by: teacher.id
			})
			.select('id')
			.single();
		if (assignmentError || !assignment)
			throw new Error(`Failed to create assignment: ${assignmentError?.message}`);
		const { data: instance, error: instanceError } = await adminClient
			.from('homework_instances')
			.insert({
				assignment_id: assignment.id,
				class_id: cls,
				period_start: params.dueDate,
				due_date: params.dueDate,
				...(params.archived ? { archived_at: new Date().toISOString() } : {})
			})
			.select('id')
			.single();
		if (instanceError || !instance)
			throw new Error(`Failed to create instance: ${instanceError?.message}`);
		await setStatus(instance.id, cls, params.targets, 'assigned');
		return { assignmentId: assignment.id, instanceId: instance.id };
	}

	async function setStatus(
		instanceId: string,
		cls: string,
		studentIds: string[],
		status: 'assigned' | 'done' | 'reviewed'
	) {
		if (studentIds.length === 0) return;
		const { error } = await adminClient.from('homework_status_history').insert(
			studentIds.map((student_id) => ({
				instance_id: instanceId,
				class_id: cls,
				student_id,
				status,
				recorded_by: teacher.id
			}))
		);
		if (error) throw new Error(`Failed to set homework status: ${error.message}`);
	}

	/** Rows of every student-keyed table for `studentId` (service role). */
	async function seedChildData(studentId: string) {
		const hw = await homework({ dueDate: addDays(today, 1), targets: [studentId] });
		const { error: skillError } = await adminClient.from('skill_status_history').insert({
			student_id: studentId,
			class_id: classId,
			skill_area: 'language',
			level: 'learning',
			notes: 'Reads well at home too',
			recorded_by: teacher.id
		});
		if (skillError) throw new Error(`Failed to add skill status: ${skillError.message}`);
		const sessionId = await sessionFor(classId, ATTENDANCE_DAY);
		const { error: attendanceError } = await adminClient.from('attendance_records').insert({
			student_id: studentId,
			class_id: classId,
			class_session_id: sessionId,
			present: true,
			notes: 'Teacher-only note',
			recorded_by: teacher.id
		});
		if (attendanceError) throw new Error(`Failed to add attendance: ${attendanceError.message}`);
		await adminClient
			.from('student_streaks')
			.upsert(
				{ student_id: studentId, class_id: classId, current_streak: 3 },
				{ onConflict: 'student_id' }
			);
		await adminClient
			.from('badges_earned')
			.upsert(
				{ student_id: studentId, badge_subject: 'dance', badge_type: 'attendance', milestone: 1 },
				{ onConflict: 'student_id,badge_subject,badge_type,milestone' }
			);
		return hw;
	}

	/** What `client` can read of `studentId` in each student-keyed table and its homework. */
	async function readsOf(
		client: ReturnType<typeof anonClient>,
		studentId: string,
		hw: { assignmentId: string; instanceId: string }
	) {
		const [history, skills, streaks, badges, enrollments, profile, instance, assignment] =
			await Promise.all([
				client.from('homework_status_history').select('id').eq('student_id', studentId),
				client.from('skill_status_history').select('notes').eq('student_id', studentId),
				client.from('student_streaks').select('student_id').eq('student_id', studentId),
				client.from('badges_earned').select('id').eq('student_id', studentId),
				client.from('class_enrollments').select('class_id').eq('student_id', studentId),
				client.from('profiles').select('id').eq('id', studentId),
				client.from('homework_instances').select('id').eq('id', hw.instanceId),
				client.from('homework_assignments').select('id').eq('id', hw.assignmentId)
			]);
		return {
			history: history.data ?? [],
			skills: skills.data ?? [],
			streaks: streaks.data ?? [],
			badges: badges.data ?? [],
			enrollments: enrollments.data ?? [],
			profile: profile.data ?? [],
			instance: instance.data ?? [],
			assignment: assignment.data ?? []
		};
	}

	async function counts(client: ReturnType<typeof anonClient>, studentId: string) {
		const { data, error } = await client.rpc('homework_counts', { p_student_id: studentId });
		return { counts: data?.[0] ?? null, error };
	}

	it('Cards: an approved child has classes and Open/Overdue counts; a pending child is only listed', async () => {
		const parent = await createApprovedParent();
		const approvedId = await child(parent.email);
		const pendingId = await child(parent.email, classId, true);
		await homework({ dueDate: addDays(today, 2), targets: [approvedId] });
		await homework({ dueDate: addDays(today, -1), targets: [approvedId] });

		const client = await signIn(parent.email, parent.password);
		const { data: linked } = await client.rpc('linked_children');
		expect((linked ?? []).map((c) => [c.id, c.status]).sort()).toEqual(
			[
				[approvedId, 'approved'],
				[pendingId, 'pending']
			].sort()
		);

		expect(await counts(client, approvedId)).toEqual({
			counts: { open_count: 2, overdue_count: 1 },
			error: null
		});
		const { data: enrollments } = await client
			.from('class_enrollments')
			.select('class_id')
			.eq('student_id', approvedId);
		expect(enrollments).toEqual([{ class_id: classId }]);
		const { data: classes } = await client.from('classes').select('id').eq('id', classId);
		expect(classes).toEqual([{ id: classId }]);

		const pendingCounts = await counts(client, pendingId);
		expect(pendingCounts.error?.code).toBe('42501');
	});

	it('Counts: archived, left class, Done, Reviewed and beyond the look-ahead are neither Open nor Overdue; marking Done drops Open', async () => {
		const parent = await createApprovedParent();
		const kid = await child(parent.email);
		await adminClient
			.from('class_enrollments')
			.insert({ student_id: kid, class_id: classBId, enrolled_by: null });

		const dueSoon = await homework({ dueDate: addDays(today, 1), targets: [kid] });
		await homework({ dueDate: addDays(today, -2), targets: [kid] }); // overdue
		await homework({ dueDate: addDays(today, lookahead), targets: [kid] }); // edge of window
		await homework({ dueDate: addDays(today, -1), targets: [kid], archived: true });
		await homework({ cls: classBId, dueDate: addDays(today, -1), targets: [kid] });
		const done = await homework({ dueDate: addDays(today, -1), targets: [kid] });
		await setStatus(done.instanceId, classId, [kid], 'done');
		const reviewed = await homework({ dueDate: addDays(today, -1), targets: [kid] });
		await setStatus(reviewed.instanceId, classId, [kid], 'done');
		await setStatus(reviewed.instanceId, classId, [kid], 'reviewed');
		await homework({ dueDate: addDays(today, lookahead + 1), targets: [kid] });
		// Left class B: its homework no longer counts.
		await adminClient
			.from('class_enrollments')
			.delete()
			.eq('student_id', kid)
			.eq('class_id', classBId);

		const client = await signIn(parent.email, parent.password);
		expect(await counts(client, kid)).toEqual({
			counts: { open_count: 3, overdue_count: 1 },
			error: null
		});

		// Acceptance: the teacher marks one Done; the next load shows one fewer.
		const { error: markError } = await teacher.client.from('homework_status_history').insert({
			instance_id: dueSoon.instanceId,
			class_id: classId,
			student_id: kid,
			status: 'done',
			recorded_by: teacher.id
		});
		expect(markError).toBeNull();
		expect(await counts(client, kid)).toEqual({
			counts: { open_count: 2, overdue_count: 1 },
			error: null
		});

		// The teacher and the admin get the same numbers.
		const asTeacher = await counts(teacher.client, kid);
		expect(asTeacher.counts).toEqual({ open_count: 2, overdue_count: 1 });
		expect(await counts(admin.client, kid)).toEqual(asTeacher);

		// A teacher who does not teach the student is refused.
		const unrelated = await createSignedInUser('teacher');
		expect((await counts(unrelated.client, kid)).error?.code).toBe('42501');
	});

	it("Student tiles: the student reads their own counts, never another student's", async () => {
		const parent = await createApprovedParent();
		const kid = await child(parent.email);
		const other = await child(parent.email);
		await homework({ dueDate: addDays(today, 3), targets: [kid] });
		await homework({ dueDate: addDays(today, -3), targets: [kid] });

		const student = await signInStudent(kid);
		expect(await counts(student, kid)).toEqual({
			counts: { open_count: 2, overdue_count: 1 },
			error: null
		});
		expect((await counts(student, other)).error?.code).toBe('42501');
	});

	it('Own child reads: every student-keyed table, targeted homework, the class and its sessions', async () => {
		const parent = await createApprovedParent();
		const kid = await child(parent.email);
		const hw = await seedChildData(kid);
		await sessionFor(classId, addDays(today, 7));

		const client = await signIn(parent.email, parent.password);
		const reads = await readsOf(client, kid, hw);
		expect(reads.history.length).toBeGreaterThan(0);
		expect(reads.skills).toEqual([{ notes: 'Reads well at home too' }]);
		expect(reads.streaks).toHaveLength(1);
		expect(reads.badges.length).toBeGreaterThan(0);
		expect(reads.enrollments).toEqual([{ class_id: classId }]);
		expect(reads.profile).toEqual([{ id: kid }]);
		expect(reads.instance).toEqual([{ id: hw.instanceId }]);
		expect(reads.assignment).toEqual([{ id: hw.assignmentId }]);

		const { data: classes } = await client.from('classes').select('id');
		expect(classes).toEqual([{ id: classId }]);
		const { data: sessions } = await client.from('class_sessions').select('class_id');
		expect((sessions ?? []).length).toBeGreaterThan(0);
		expect(new Set((sessions ?? []).map((s) => s.class_id))).toEqual(new Set([classId]));
	});

	it("Isolation: another student's rows, untargeted homework, other classes and their RPCs are refused", async () => {
		const parent = await createApprovedParent();
		const kid = await child(parent.email);
		const otherParent = await createApprovedParent();
		const otherKid = await child(otherParent.email);
		const otherHw = await seedChildData(otherKid);
		// Homework in the child's own class that targets only the other child.
		const untargeted = await homework({ dueDate: addDays(today, 1), targets: [otherKid] });
		expect(kid).not.toBe(otherKid);

		const client = await signIn(parent.email, parent.password);
		expect(await readsOf(client, otherKid, otherHw)).toEqual({
			history: [],
			skills: [],
			streaks: [],
			badges: [],
			enrollments: [],
			profile: [],
			instance: [],
			assignment: []
		});
		const { data: instance } = await client
			.from('homework_instances')
			.select('id')
			.eq('id', untargeted.instanceId);
		expect(instance).toEqual([]);
		const { data: otherClass } = await client.from('classes').select('id').eq('id', classBId);
		expect(otherClass).toEqual([]);

		expect((await counts(client, otherKid)).error?.code).toBe('42501');
		const attendance = await client.rpc('child_attendance', { p_student_id: otherKid });
		expect(attendance.error?.code).toBe('42501');
	});

	it('Pending child: the parent reads nothing of them', async () => {
		const parent = await createApprovedParent();
		const pendingId = await child(parent.email, classId, true);

		const client = await signIn(parent.email, parent.password);
		const { data: profile } = await client.from('profiles').select('id').eq('id', pendingId);
		expect(profile).toEqual([]);
		expect((await counts(client, pendingId)).error?.code).toBe('42501');
		const attendance = await client.rpc('child_attendance', { p_student_id: pendingId });
		expect(attendance.error?.code).toBe('42501');
	});

	it('Attendance: child_attendance() returns date, class and present without notes; a direct select is empty', async () => {
		const parent = await createApprovedParent();
		const kid = await child(parent.email);
		await seedChildData(kid);

		const client = await signIn(parent.email, parent.password);
		const { data, error } = await client.rpc('child_attendance', { p_student_id: kid });
		expect(error).toBeNull();
		expect(data).toHaveLength(1);
		expect(Object.keys(data![0]).sort()).toEqual(
			['class_id', 'class_name', 'class_name_bo', 'class_name_de', 'present', 'session_date'].sort()
		);
		expect(data![0]).toMatchObject({
			session_date: ATTENDANCE_DAY,
			class_id: classId,
			present: true
		});
		expect(JSON.stringify(data)).not.toContain('Teacher-only note');

		const { data: direct } = await client
			.from('attendance_records')
			.select('id')
			.eq('student_id', kid);
		expect(direct).toEqual([]);

		// The student may read their own through the same RPC.
		const student = await signInStudent(kid);
		const own = await student.rpc('child_attendance', { p_student_id: kid });
		expect(own.error).toBeNull();
		expect(own.data).toHaveLength(1);
	});

	it("class_people: a parent of the class's child gets the teachers only", async () => {
		const parent = await createApprovedParent();
		await child(parent.email);

		const client = await signIn(parent.email, parent.password);
		const { data, error } = await client.rpc('class_people', { p_class_id: classId });
		expect(error).toBeNull();
		expect((data ?? []).length).toBeGreaterThan(0);
		expect((data ?? []).every((p) => p.is_teacher)).toBe(true);
		expect((data ?? []).map((p) => p.person_id)).toContain(teacher.id);

		const other = await client.rpc('class_people', { p_class_id: classBId });
		expect(other.error?.code).toBe('42501');
	});

	it('class_people: an enrolled student and the admin still get teachers and classmates', async () => {
		const parent = await createApprovedParent();
		const kid = await child(parent.email);
		const classmate = await child(parent.email);

		const student = await signInStudent(kid);
		const { data: asStudent, error } = await student.rpc('class_people', { p_class_id: classId });
		expect(error).toBeNull();
		expect(asStudent).toContainEqual(
			expect.objectContaining({ person_id: teacher.id, is_teacher: true })
		);
		expect(asStudent).toContainEqual(
			expect.objectContaining({ person_id: classmate, is_teacher: false })
		);

		const { data: asAdmin, error: adminError } = await admin.client.rpc('class_people', {
			p_class_id: classId
		});
		expect(adminError).toBeNull();
		expect(asAdmin).toEqual(asStudent);
	});

	it('No writes: the parent cannot insert, update or delete homework status, skills, attendance, streaks, badges or profiles', async () => {
		const parent = await createApprovedParent();
		const kid = await child(parent.email);
		const hw = await seedChildData(kid);
		const sessionId = await sessionFor(classId, ATTENDANCE_DAY);

		/** Every row of the child the parent might touch, read with the service role. */
		const snapshot = async () => {
			const [history, skills, attendance, streaks, badges, profile, instance] = await Promise.all([
				adminClient.from('homework_status_history').select('*').eq('student_id', kid).order('id'),
				adminClient.from('skill_status_history').select('*').eq('student_id', kid).order('id'),
				adminClient.from('attendance_records').select('*').eq('student_id', kid).order('id'),
				adminClient.from('student_streaks').select('*').eq('student_id', kid),
				adminClient.from('badges_earned').select('*').eq('student_id', kid).order('id'),
				adminClient.from('profiles').select('*').eq('id', kid),
				adminClient.from('homework_instances').select('*').eq('id', hw.instanceId)
			]);
			return {
				history: history.data,
				skills: skills.data,
				attendance: attendance.data,
				streaks: streaks.data,
				badges: badges.data,
				profile: profile.data,
				instance: instance.data
			};
		};
		const before = await snapshot();
		expect(before.history?.length).toBeGreaterThan(0);
		expect(before.skills?.length).toBeGreaterThan(0);
		expect(before.attendance?.length).toBeGreaterThan(0);
		expect(before.streaks).toHaveLength(1);
		expect(before.badges?.length).toBeGreaterThan(0);

		const client = await signIn(parent.email, parent.password);
		const inserts = await Promise.all([
			client.from('homework_status_history').insert({
				instance_id: hw.instanceId,
				class_id: classId,
				student_id: kid,
				status: 'done',
				recorded_by: parent.id
			}),
			client.from('skill_status_history').insert({
				student_id: kid,
				class_id: classId,
				skill_area: 'language',
				level: 'confident',
				recorded_by: parent.id
			}),
			client.from('attendance_records').insert({
				student_id: kid,
				class_id: classId,
				class_session_id: sessionId,
				present: false,
				recorded_by: parent.id
			}),
			// The parent's own child: only RLS can refuse it.
			client
				.from('student_streaks')
				.insert({ student_id: kid, class_id: classId, current_streak: 99 })
		]);
		for (const insert of inserts) expect(insert.error?.code).toBe('42501');

		// UPDATE and DELETE: RLS either errors or filters to 0 affected rows.
		const changes = await Promise.all([
			client.from('student_streaks').update({ current_streak: 99 }).eq('student_id', kid).select(),
			client
				.from('homework_instances')
				.update({ due_date: '2000-01-01' })
				.eq('id', hw.instanceId)
				.select(),
			client
				.from('skill_status_history')
				.update({ notes: 'changed' })
				.eq('student_id', kid)
				.select(),
			client
				.from('attendance_records')
				.update({ present: false, notes: 'changed' })
				.eq('student_id', kid)
				.select(),
			client
				.from('homework_status_history')
				.update({ status: 'done' })
				.eq('student_id', kid)
				.select(),
			client.from('profiles').update({ display_name: 'Changed by parent' }).eq('id', kid).select(),
			client.from('homework_status_history').delete().eq('student_id', kid).select(),
			client.from('skill_status_history').delete().eq('student_id', kid).select(),
			client.from('attendance_records').delete().eq('student_id', kid).select(),
			client.from('badges_earned').delete().eq('student_id', kid).select()
		]);
		for (const change of changes) {
			if (!change.error) expect(change.data ?? []).toEqual([]);
		}

		expect(await snapshot()).toEqual(before);
	});

	it('Not approved: a linked parent who is not approved reads nothing; one with a linked child cannot be rejected (0054)', async () => {
		const parent = await createApprovedParent();
		const kid = await child(parent.email);
		const hw = await seedChildData(kid);
		const approvedClient = await signIn(parent.email, parent.password);
		expect((await readsOf(approvedClient, kid, hw)).profile).toEqual([{ id: kid }]);

		// spec-second-parent: rejecting needs the links removed first.
		const { error } = await adminClient
			.from('parents')
			.update({ status: 'rejected' })
			.eq('id', parent.id);
		expect(error?.hint).toBe('parent_has_links');
		expect((await readsOf(approvedClient, kid, hw)).profile).toEqual([{ id: kid }]);

		// A pending parent with an active link to the same child.
		const pending = await createPendingParent();
		await linkParent(adminClient, kid, pending.id);
		const client = await signIn(pending.email, pending.password);

		expect(await readsOf(client, kid, hw)).toEqual({
			history: [],
			skills: [],
			streaks: [],
			badges: [],
			enrollments: [],
			profile: [],
			instance: [],
			assignment: []
		});
		const { data: classes } = await client.from('classes').select('id');
		expect(classes).toEqual([]);
		const { data: sessions } = await client.from('class_sessions').select('id');
		expect(sessions).toEqual([]);
		expect((await counts(client, kid)).error?.code).toBe('42501');
		expect((await client.rpc('child_attendance', { p_student_id: kid })).error?.code).toBe('42501');
		expect((await client.rpc('class_people', { p_class_id: classId })).error?.code).toBe('42501');
	});

	it('Dual role: a teacher-parent sees only their own children, and their teacher reads are unchanged', async () => {
		const { error: parentError } = await adminClient
			.from('parents')
			.insert({ id: teacherB.id, status: 'approved' });
		expect(parentError).toBeNull();

		const ownKid = await child(teacherB.email, classId);
		const otherParent = await createApprovedParent();
		const classAKid = await child(otherParent.email, classId);
		const classBKid = await child(otherParent.email, classBId);

		const { data: linked } = await teacherB.client.rpc('linked_children');
		expect((linked ?? []).map((c) => c.id)).toEqual([ownKid]);

		// Parent side: class A shows teachers only; its other students stay hidden.
		const { data: peopleA } = await teacherB.client.rpc('class_people', { p_class_id: classId });
		expect((peopleA ?? []).every((p) => p.is_teacher)).toBe(true);
		const { data: hiddenKid } = await teacherB.client
			.from('profiles')
			.select('id')
			.eq('id', classAKid);
		expect(hiddenKid).toEqual([]);
		expect((await counts(teacherB.client, classAKid)).error?.code).toBe('42501');

		// Teacher side (class B) as before: the full roster and the counts.
		const { data: peopleB } = await teacherB.client.rpc('class_people', { p_class_id: classBId });
		expect((peopleB ?? []).map((p) => p.person_id)).toContain(classBKid);
		const { data: rosterKid } = await teacherB.client
			.from('profiles')
			.select('id')
			.eq('id', classBKid);
		expect(rosterKid).toEqual([{ id: classBKid }]);
		expect((await counts(teacherB.client, classBKid)).error).toBeNull();
	});
});

/**
 * Story 7-4: parent session leave (migration 0027). One test per I/O matrix
 * row. Time-sensitive rows (after start, sick cutoff, planned vs
 * short-notice) use sessions dated relative to today (Berlin); the rest use
 * far-future days so no real class day is touched.
 */
describe.skipIf(!reachable)('7-4 session leave (requires local Supabase)', () => {
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let parent: { id: string; email: string; client: ReturnType<typeof anonClient> };
	let classId: string;
	let classBId: string;
	let kid: string;
	let teamId: string;

	const today = todayInBerlin();
	const plusDays = (isoDate: string, days: number) => {
		const date = new Date(`${isoDate}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() + days);
		return date.toISOString().slice(0, 10);
	};
	const isoDow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
	const mondayOf = (day: string) => plusDays(day, 1 - isoDow(day));
	const name = (label: string) => `7-4 ${label} ${crypto.randomUUID().slice(0, 8)}`;
	/** A random far-future day (class days are unique school-wide). */
	const futureDay = () =>
		`${3000 + Math.floor(Math.random() * 6000)}-06-0${1 + Math.floor(Math.random() * 9)}`;

	async function createClass(label: string, extra: Record<string, unknown> = {}) {
		const { data, error } = await adminClient
			.from('classes')
			.insert({
				name: name(label),
				code: `L${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
				...extra
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		await adminClient.from('class_teachers').insert({ class_id: data.id, teacher_id: teacher.id });
		return data.id;
	}

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	async function newParent() {
		const p = await createApprovedParent();
		return { id: p.id, email: p.email, client: await signIn(p.email, p.password) };
	}

	/** A child of `parentEmail` in `cls`; approved (and so enrolled) unless `pending`. */
	async function child(parentEmail: string, cls = classId, pending = false, team?: string) {
		const { id, error } = await signUpStudent({
			classId: cls,
			registrationName: name(pending ? 'Pending Kid' : 'Kid'),
			guardianEmail: parentEmail
		});
		if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
		if (!pending) {
			const { error: approveError } = await adminClient
				.from('profiles')
				.update({ status: 'approved', team_id: team ?? teamId })
				.eq('id', id);
			if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
		}
		return id;
	}

	async function signInStudent(id: string) {
		const password = crypto.randomUUID();
		const { data } = await adminClient.auth.admin.updateUserById(id, { password });
		return signIn(data.user!.email!, password);
	}

	function setLeave(
		client: ReturnType<typeof anonClient>,
		sessionId: string,
		studentId: string,
		answer: 'coming' | 'on_leave' | 'sick',
		classification?: 'planned' | 'short_notice'
	) {
		return client
			.from('session_leave_history')
			.insert({
				class_session_id: sessionId,
				student_id: studentId,
				answer,
				...(classification ? { classification } : {})
			})
			.select('answer, classification, answered_by')
			.single();
	}

	async function latest(sessionId: string, studentId: string) {
		const { data } = await adminClient
			.from('session_leave_history')
			.select('answer, classification')
			.eq('class_session_id', sessionId)
			.eq('student_id', studentId)
			.order('answered_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(1)
			.maybeSingle();
		return data;
	}

	/** Runs `fn` with app_settings[key] set to `value`, then restores it. */
	async function withSetting(key: string, value: Record<string, number>, fn: () => Promise<void>) {
		const { data: before } = await adminClient
			.from('app_settings')
			.select('value')
			.eq('key', key)
			.single();
		await adminClient.from('app_settings').update({ value }).eq('key', key);
		try {
			await fn();
		} finally {
			await adminClient.from('app_settings').update({ value: before!.value }).eq('key', key);
		}
	}

	beforeAll(async () => {
		teacher = await createSignedInUser('teacher');
		admin = await createSignedInUser('admin');
		const { data: team, error: teamError } = await adminClient
			.from('teams')
			.insert({ name: name('Team') })
			.select('id')
			.single();
		if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
		teamId = team.id;
		classId = await createClass('Class A');
		classBId = await createClass('Class B');
		parent = await newParent();
		kid = await child(parent.email);
	}, 30000);

	it('Planned: On leave 15 days ahead (notice 2 weeks) is planned, as the preview said', async () => {
		const sessionId = await sessionFor(classId, plusDays(today, 15));
		const preview = await parent.client.rpc('preview_leave', {
			p_class_session_id: sessionId,
			p_student_id: kid
		});
		expect(preview).toMatchObject({ data: 'planned', error: null });

		const { data, error } = await setLeave(parent.client, sessionId, kid, 'on_leave');
		expect(error).toBeNull();
		expect(data).toEqual({ answer: 'on_leave', classification: 'planned', answered_by: parent.id });
	});

	it('Short-notice: On leave 3 days ahead is short_notice, as the preview said', async () => {
		const sessionId = await sessionFor(classId, plusDays(today, 3));
		const preview = await parent.client.rpc('preview_leave', {
			p_class_session_id: sessionId,
			p_student_id: kid
		});
		expect(preview).toMatchObject({ data: 'short_notice', error: null });

		const { data, error } = await setLeave(parent.client, sessionId, kid, 'on_leave');
		expect(error).toBeNull();
		expect(data).toMatchObject({ answer: 'on_leave', classification: 'short_notice' });
	});

	it('AC: On leave 10 days ahead previews and saves as Short-notice', async () => {
		const sessionId = await sessionFor(classId, plusDays(today, 10));
		const preview = await parent.client.rpc('preview_leave', {
			p_class_session_id: sessionId,
			p_student_id: kid
		});
		expect(preview.data).toBe('short_notice');
		const { data } = await setLeave(parent.client, sessionId, kid, 'on_leave');
		expect(data?.classification).toBe(preview.data);
	});

	it('Change: On leave then Coming before the start -> the latest answer is coming', async () => {
		const sessionId = await sessionFor(classId, futureDay());
		expect((await setLeave(parent.client, sessionId, kid, 'on_leave')).error).toBeNull();
		expect((await setLeave(parent.client, sessionId, kid, 'coming')).error).toBeNull();
		expect(await latest(sessionId, kid)).toEqual({ answer: 'coming', classification: null });

		// Append-only: both rows stay, and nothing can be updated or deleted.
		const { data: rows } = await adminClient
			.from('session_leave_history')
			.select('answer')
			.eq('class_session_id', sessionId);
		expect(rows).toHaveLength(2);
		const update = await parent.client
			.from('session_leave_history')
			.update({ answer: 'on_leave' })
			.eq('class_session_id', sessionId)
			.select('id');
		expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
		await parent.client.from('session_leave_history').delete().eq('class_session_id', sessionId);
		const { data: after } = await adminClient
			.from('session_leave_history')
			.select('answer')
			.eq('class_session_id', sessionId);
		expect(after).toHaveLength(2);
	});

	it('After start: Coming / On leave for a session that has started are refused', async () => {
		const sessionId = await sessionFor(classId, plusDays(today, -1));
		for (const answer of ['coming', 'on_leave'] as const) {
			const { error } = await setLeave(parent.client, sessionId, kid, answer);
			expect(error?.hint).toBe('leave_started');
		}
	});

	it('Sick cutoff: accepted until the end of the day after the session, refused on day+2', async () => {
		const yesterday = await sessionFor(classId, plusDays(today, -1));
		const accepted = await setLeave(parent.client, yesterday, kid, 'sick');
		expect(accepted.error).toBeNull();
		expect(accepted.data).toMatchObject({ answer: 'sick', classification: null });

		const twoDaysAgo = await sessionFor(classId, plusDays(today, -2));
		const refused = await setLeave(parent.client, twoDaysAgo, kid, 'sick');
		expect(refused.error?.hint).toBe('leave_sick_closed');
	});

	it('Forged: a client-sent classification is overwritten', async () => {
		const sessionId = await sessionFor(classId, plusDays(today, 2));
		const { data, error } = await setLeave(parent.client, sessionId, kid, 'on_leave', 'planned');
		expect(error).toBeNull();
		expect(data?.classification).toBe('short_notice');

		const coming = await setLeave(parent.client, sessionId, kid, 'coming', 'planned');
		expect(coming.data?.classification).toBeNull();
	});

	it("Not parent: the student, a teacher, another parent and a pending child's parent are refused (42501)", async () => {
		const sessionId = await sessionFor(classId, futureDay());
		const kidClient = await signInStudent(kid);
		const other = await newParent();
		const pendingParent = await newParent();
		const pendingKid = await child(pendingParent.email, classId, true);

		expect((await setLeave(kidClient, sessionId, kid, 'coming')).error?.code).toBe('42501');
		expect((await setLeave(teacher.client, sessionId, kid, 'coming')).error?.code).toBe('42501');
		expect((await setLeave(admin.client, sessionId, kid, 'coming')).error?.code).toBe('42501');
		expect((await setLeave(other.client, sessionId, kid, 'on_leave')).error?.code).toBe('42501');
		expect(
			(await setLeave(pendingParent.client, sessionId, pendingKid, 'on_leave')).error?.code
		).toBe('42501');
		// Not even the service role writes leave.
		expect((await setLeave(adminClient, sessionId, kid, 'coming')).error?.code).toBe('42501');

		// preview_leave has the same gate.
		const preview = await other.client.rpc('preview_leave', {
			p_class_session_id: sessionId,
			p_student_id: kid
		});
		expect(preview.error?.code).toBe('42501');

		const { data: rows } = await adminClient
			.from('session_leave_history')
			.select('id')
			.eq('class_session_id', sessionId);
		expect(rows).toEqual([]);
	});

	it("Not enrolled / cancelled: another class's session and a cancelled session are refused", async () => {
		const otherClassSession = await sessionFor(classBId, futureDay());
		const notEnrolled = await setLeave(parent.client, otherClassSession, kid, 'coming');
		expect(notEnrolled.error?.hint).toBe('leave_not_enrolled');

		const cancelledSession = await sessionFor(classId, futureDay());
		await adminClient.from('class_sessions').update({ cancelled: true }).eq('id', cancelledSession);
		const cancelled = await setLeave(parent.client, cancelledSession, kid, 'on_leave');
		expect(cancelled.error?.hint).toBe('leave_cancelled');
	});

	it('Read: the student, their parent, the class teacher and the admin read; another student or parent reads nothing', async () => {
		const sessionId = await sessionFor(classId, futureDay());
		expect((await setLeave(parent.client, sessionId, kid, 'on_leave')).error).toBeNull();

		const kidClient = await signInStudent(kid);
		const other = await newParent();
		const otherKid = await child(other.email);
		const otherKidClient = await signInStudent(otherKid);
		const outsideTeacher = await createSignedInUser('teacher');

		const read = (client: ReturnType<typeof anonClient>) =>
			client
				.from('session_leave_history')
				.select('answer')
				.eq('class_session_id', sessionId)
				.eq('student_id', kid);

		for (const client of [kidClient, parent.client, teacher.client, admin.client]) {
			expect((await read(client)).data).toEqual([{ answer: 'on_leave' }]);
		}
		for (const client of [otherKidClient, other.client, outsideTeacher.client]) {
			expect((await read(client)).data).toEqual([]);
		}
	});

	it('Masked: a classmate sees Sick as on_leave, a teammate only teammates, a parent-only caller nothing (42501)', async () => {
		// Sick is accepted only for yesterday or today (7-5), and Coming only
		// before the start: answer Sick on yesterday's session, then move that
		// session to a far-future day (service role, set-up only).
		const sessionId = await sessionFor(classId, plusDays(today, -1));
		expect((await setLeave(parent.client, sessionId, kid, 'sick')).error).toBeNull();
		// Not a Sunday: the class's default schedule would already have a
		// session there (one per class per day).
		let futureDate = futureDay();
		while (isoDow(futureDate) === 7) futureDate = futureDay();
		await adminClient
			.from('class_days')
			.upsert([{ day: futureDate }], { onConflict: 'day', ignoreDuplicates: true });
		const { data: futureClassDay } = await adminClient
			.from('class_days')
			.select('id')
			.eq('day', futureDate)
			.single();
		const { error: moveError } = await adminClient
			.from('class_sessions')
			.update({ class_day_id: futureClassDay!.id })
			.eq('id', sessionId);
		if (moveError) throw new Error(`Failed to move session: ${moveError.message}`);

		async function newTeam() {
			const { data } = await adminClient
				.from('teams')
				.insert({ name: name('Team') })
				.select('id')
				.single();
			return data!.id;
		}
		const other = await newParent();
		// An enrolled child on a second team, with a Coming answer on the same session.
		const team2 = await newTeam();
		const team2Kid = await child(other.email, classId, false, team2);
		expect((await setLeave(other.client, sessionId, team2Kid, 'coming')).error).toBeNull();

		// A classmate (enrolled) sees every enrolled student's answer, Sick masked.
		const classmate = await child(other.email);
		const classmateClient = await signInStudent(classmate);
		const { data, error } = await classmateClient.rpc('session_leave_masked', {
			p_class_session_id: sessionId
		});
		expect(error).toBeNull();
		expect(
			(data ?? []).map((r) => [r.student_id, r.answer]).sort((a, b) => a[0].localeCompare(b[0]))
		).toEqual(
			[
				[kid, 'on_leave'],
				[team2Kid, 'coming']
			].sort((a, b) => a[0].localeCompare(b[0]))
		);
		expect(data?.find((r) => r.student_id === kid)?.display_name).toEqual(expect.any(String));

		// A teammate in another class sees only their teammates' rows, not the
		// second team's child.
		const teammate = await child(other.email, classBId);
		const teammateClient = await signInStudent(teammate);
		const asTeammate = await teammateClient.rpc('session_leave_masked', {
			p_class_session_id: sessionId
		});
		expect(asTeammate.data?.map((r) => [r.student_id, r.answer])).toEqual([[kid, 'on_leave']]);

		// A student on a third team, not enrolled in the class: refused.
		const team3 = await newTeam();
		const outsider = await child(other.email, classBId, false, team3);
		const outsiderClient = await signInStudent(outsider);
		const asOutsider = await outsiderClient.rpc('session_leave_masked', {
			p_class_session_id: sessionId
		});
		expect(asOutsider.error?.code).toBe('42501');

		// The parent of both children, calling as a parent only: nothing.
		const asParent = await other.client.rpc('session_leave_masked', {
			p_class_session_id: sessionId
		});
		expect(asParent.error?.code).toBe('42501');
		expect(asParent.data).toBeNull();
	});

	it('Streak planned / short: an absent week with planned leave keeps the streak, short-notice resets it (grace 0)', async () => {
		// Planned: three consecutive far-future weeks, the middle one on leave.
		const plannedDays = (() => {
			const d0 = futureDay();
			return [plusDays(d0, -7), d0, plusDays(d0, 7)];
		})();
		// Short-notice: the middle session is 3 days from today.
		const shortDays = [plusDays(today, -4), plusDays(today, 3), plusDays(today, 10)];

		async function scenario(days: string[]) {
			const cls = await createClass('Streak');
			const p = await newParent();
			const x = await child(p.email, cls);
			const y = await child(p.email, cls);
			const sessions = [];
			for (const day of days) sessions.push(await sessionFor(cls, day));

			const { data: assignment } = await adminClient
				.from('homework_assignments')
				.insert({
					class_id: cls,
					title: name('HW'),
					skill_area: 'language',
					created_by: teacher.id
				})
				.select('id')
				.single();
			for (const [i, day] of days.entries()) {
				// Y attends every week; X attends (and does homework) in weeks 0 and 2 only.
				const marks = [
					{ student_id: y, present: true },
					{ student_id: x, present: i !== 1 }
				];
				for (const mark of marks) {
					const { error } = await adminClient.from('attendance_records').insert({
						...mark,
						class_id: cls,
						class_session_id: sessions[i],
						recorded_by: teacher.id
					});
					if (error) throw new Error(`Failed to mark: ${error.message}`);
				}
				if (i === 1) continue;
				const { data: instance } = await adminClient
					.from('homework_instances')
					.insert({
						assignment_id: assignment!.id,
						class_id: cls,
						period_start: mondayOf(day),
						due_date: plusDays(mondayOf(day), 6)
					})
					.select('id')
					.single();
				for (const status of ['assigned', 'done'] as const) {
					await adminClient.from('homework_status_history').insert({
						instance_id: instance!.id,
						student_id: x,
						class_id: cls,
						status,
						recorded_by: teacher.id
					});
				}
			}

			// The leave insert recomputes X's stored streak (AFTER INSERT trigger).
			const { data: before } = await adminClient
				.from('student_streaks')
				.select('updated_at')
				.eq('student_id', x)
				.single();
			return { cls, x, parentClient: p.client, leaveSession: sessions[1], before, days };
		}

		async function streakOf(s: { x: string; cls: string; days: string[] }) {
			const { data, error } = await adminClient.rpc('compute_student_streak', {
				p_student_id: s.x,
				p_class_id: s.cls,
				p_as_of_week: mondayOf(s.days[2])
			});
			expect(error).toBeNull();
			return data;
		}

		const planned = await scenario(plannedDays);
		const short = await scenario(shortDays);

		await withSetting('streak_grace_weeks', { weeks: 0 }, async () => {
			// Without an answer, the missed week breaks the streak.
			expect(await streakOf(planned)).toMatchObject({ current_streak: 1 });

			const p1 = await setLeave(planned.parentClient, planned.leaveSession, planned.x, 'on_leave');
			expect(p1.data?.classification).toBe('planned');
			expect(await streakOf(planned)).toEqual({
				current_streak: 2,
				last_qualifying_week: mondayOf(planned.days[2])
			});

			const s1 = await setLeave(short.parentClient, short.leaveSession, short.x, 'on_leave');
			expect(s1.data?.classification).toBe('short_notice');
			expect(await streakOf(short)).toMatchObject({ current_streak: 1 });

			// A later Coming replaces the planned leave: the absence counts again.
			await setLeave(planned.parentClient, planned.leaveSession, planned.x, 'coming');
			expect(await streakOf(planned)).toMatchObject({ current_streak: 1 });
		});

		const { data: after } = await adminClient
			.from('student_streaks')
			.select('updated_at')
			.eq('student_id', planned.x)
			.single();
		expect(Date.parse(after!.updated_at)).toBeGreaterThan(Date.parse(planned.before!.updated_at));
	});

	it('Streak mixed week: planned leave protects the week only if every missed marked session has it and the student attended none (grace 0)', async () => {
		/**
		 * Weeks 0 and 2: one session each, X present with homework done. Week
		 * 1: two sessions (Mon, Tue); Y is present at both, X as `present`.
		 */
		async function mixedWeek(present: [boolean, boolean]) {
			const monday = mondayOf(futureDay());
			const days = [plusDays(monday, -7), monday, plusDays(monday, 1), plusDays(monday, 7)];
			const cls = await createClass('Mixed');
			const p = await newParent();
			const x = await child(p.email, cls);
			const y = await child(p.email, cls);
			const sessions: string[] = [];
			for (const day of days) sessions.push(await sessionFor(cls, day));
			const xPresent = [true, present[0], present[1], true];
			for (const [i, sessionId] of sessions.entries()) {
				for (const mark of [
					{ student_id: y, present: true },
					{ student_id: x, present: xPresent[i] }
				]) {
					const { error } = await adminClient.from('attendance_records').insert({
						...mark,
						class_id: cls,
						class_session_id: sessionId,
						recorded_by: teacher.id
					});
					if (error) throw new Error(`Failed to mark: ${error.message}`);
				}
			}
			const { data: assignment } = await adminClient
				.from('homework_assignments')
				.insert({
					class_id: cls,
					title: name('HW'),
					skill_area: 'language',
					created_by: teacher.id
				})
				.select('id')
				.single();
			for (const day of [days[0], days[3]]) {
				const { data: instance } = await adminClient
					.from('homework_instances')
					.insert({
						assignment_id: assignment!.id,
						class_id: cls,
						period_start: mondayOf(day),
						due_date: plusDays(mondayOf(day), 6)
					})
					.select('id')
					.single();
				for (const status of ['assigned', 'done'] as const) {
					await adminClient.from('homework_status_history').insert({
						instance_id: instance!.id,
						student_id: x,
						class_id: cls,
						status,
						recorded_by: teacher.id
					});
				}
			}
			const streak = async () => {
				const { data, error } = await adminClient.rpc('compute_student_streak', {
					p_student_id: x,
					p_class_id: cls,
					p_as_of_week: mondayOf(days[3])
				});
				expect(error).toBeNull();
				return data?.current_streak;
			};
			const leave = async (i: 1 | 2) => {
				const { data, error } = await setLeave(p.client, sessions[i], x, 'on_leave');
				expect(error).toBeNull();
				expect(data?.classification).toBe('planned');
			};
			return { streak, leave };
		}

		await withSetting('streak_grace_weeks', { weeks: 0 }, async () => {
			// Absent at both: planned leave on one, no answer on the other -> not protected.
			const partial = await mixedWeek([false, false]);
			await partial.leave(1);
			expect(await partial.streak()).toBe(1);
			// Planned leave on both -> protected (the streak spans the week).
			await partial.leave(2);
			expect(await partial.streak()).toBe(2);

			// Present at one session (no homework), planned leave on the other -> not protected.
			const attended = await mixedWeek([true, false]);
			await attended.leave(2);
			expect(await attended.streak()).toBe(1);
			// Still not protected with planned leave on the attended session too.
			await attended.leave(1);
			expect(await attended.streak()).toBe(1);
		});
	});

	it('Regeneration: a future session removed by a schedule change takes its leave rows with it', async () => {
		const day = futureDay();
		const cls = await createClass('Regen', {
			schedule_weekdays: [isoDow(day)],
			schedule_starts_on: '1900-01-01'
		});
		const p = await newParent();
		const x = await child(p.email, cls);
		await admin.client
			.from('class_days')
			.upsert([{ day }], { onConflict: 'day', ignoreDuplicates: true });
		const { data: session } = await adminClient
			.from('class_sessions_effective')
			.select('id, extra')
			.eq('class_id', cls)
			.eq('day', day)
			.single();
		expect(session?.extra).toBe(false);
		expect((await setLeave(p.client, session!.id!, x, 'on_leave')).error).toBeNull();

		const { error } = await adminClient
			.from('classes')
			.update({ schedule_weekdays: [(isoDow(day) % 7) + 1] })
			.eq('id', cls);
		expect(error).toBeNull();

		const { data: sessions } = await adminClient
			.from('class_sessions')
			.select('id')
			.eq('id', session!.id!);
		expect(sessions).toEqual([]);
		const { data: rows } = await adminClient
			.from('session_leave_history')
			.select('id')
			.eq('class_session_id', session!.id!);
		expect(rows).toEqual([]);
	});

	it('Notice setting: with leave_notice_weeks = 1, 8 days ahead is planned (and existing answers stay frozen)', async () => {
		const sessionId = await sessionFor(classId, plusDays(today, 8));
		const before = await setLeave(parent.client, sessionId, kid, 'on_leave');
		expect(before.data?.classification).toBe('short_notice');

		await withSetting('leave_notice_weeks', { weeks: 1 }, async () => {
			const preview = await parent.client.rpc('preview_leave', {
				p_class_session_id: sessionId,
				p_student_id: kid
			});
			expect(preview.data).toBe('planned');
			const { data } = await setLeave(parent.client, sessionId, kid, 'on_leave');
			expect(data?.classification).toBe('planned');

			// The earlier answer keeps its classification.
			const { data: rows } = await adminClient
				.from('session_leave_history')
				.select('classification')
				.eq('class_session_id', sessionId)
				.order('id');
			expect(rows?.map((r) => r.classification)).toEqual(['short_notice', 'planned']);
		});
	});

	it('session_starts_at is the class day + effective start time in Europe/Berlin', async () => {
		const day = futureDay();
		const sessionId = await sessionFor(classId, day);
		const { data: midnight } = await adminClient.rpc('session_starts_at', {
			p_class_session_id: sessionId
		});
		const { data: view } = await adminClient
			.from('class_sessions_effective')
			.select('starts_at')
			.eq('id', sessionId)
			.single();
		expect(Date.parse(view!.starts_at!)).toBe(Date.parse(midnight!));

		// Security invoker: a user who can't read the session gets no start.
		const outsider = await createSignedInUser('teacher');
		const hidden = await outsider.client.rpc('session_starts_at', {
			p_class_session_id: sessionId
		});
		expect(hidden.error).toBeNull();
		expect(hidden.data).toBeNull();
		const visible = await teacher.client.rpc('session_starts_at', {
			p_class_session_id: sessionId
		});
		expect(Date.parse(visible.data!)).toBe(Date.parse(midnight!));

		await adminClient
			.from('class_sessions')
			.update({ start_time_override: '10:30' })
			.eq('id', sessionId);
		const { data: withTime } = await adminClient.rpc('session_starts_at', {
			p_class_session_id: sessionId
		});
		expect(Date.parse(withTime!) - Date.parse(midnight!)).toBe((10 * 60 + 30) * 60 * 1000);
		// June: Berlin is UTC+2.
		expect(new Date(withTime!).toISOString()).toBe(`${day}T08:30:00.000Z`);
	});

	it('Dual role: a teacher-parent sets leave for their own child; their teacher reads are unchanged', async () => {
		const dual = await createSignedInUser('teacher');
		const { error: parentError } = await adminClient
			.from('parents')
			.insert({ id: dual.id, status: 'approved' });
		expect(parentError).toBeNull();
		const teachesClass = await createClass('Dual taught');
		await adminClient
			.from('class_teachers')
			.insert({ class_id: teachesClass, teacher_id: dual.id });

		const ownKid = await child(dual.email, classId);
		const sessionId = await sessionFor(classId, futureDay());
		const own = await setLeave(dual.client, sessionId, ownKid, 'on_leave');
		expect(own.error).toBeNull();
		expect(own.data).toMatchObject({ answer: 'on_leave', answered_by: dual.id });

		// Another child in class A: not theirs as parent, not taught by them.
		expect((await setLeave(dual.client, sessionId, kid, 'on_leave')).error?.code).toBe('42501');
		const { data: hidden } = await dual.client
			.from('session_leave_history')
			.select('id')
			.eq('student_id', kid);
		expect(hidden).toEqual([]);

		// Teacher side: reads a taught class's leave rows as before.
		const other = await newParent();
		const taughtKid = await child(other.email, teachesClass);
		const taughtSession = await sessionFor(teachesClass, futureDay());
		expect((await setLeave(other.client, taughtSession, taughtKid, 'coming')).error).toBeNull();
		const { data: taughtRows } = await dual.client
			.from('session_leave_history')
			.select('answer')
			.eq('class_session_id', taughtSession);
		expect(taughtRows).toEqual([{ answer: 'coming' }]);
		// A teacher is still no leave writer for a taught student.
		expect((await setLeave(dual.client, taughtSession, taughtKid, 'on_leave')).error?.code).toBe(
			'42501'
		);
	});
});

/**
 * Story 7-5: Sick leave decisions (migration 0028). One test per I/O matrix
 * row. Sick can only be answered for yesterday's or today's sessions, so each
 * test answers on a fresh class's session dated yesterday (Berlin); the
 * auto-approval rows then move that session back in time with the service
 * role.
 */
describe.skipIf(!reachable)('7-5 sick leave decisions (requires local Supabase)', () => {
	type Client = ReturnType<typeof anonClient>;
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teamId: string;

	const today = todayInBerlin();
	const plusDays = (isoDate: string, days: number) => {
		const date = new Date(`${isoDate}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() + days);
		return date.toISOString().slice(0, 10);
	};
	const yesterday = plusDays(today, -1);
	const isoDow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
	const mondayOf = (day: string) => plusDays(day, 1 - isoDow(day));
	const name = (label: string) => `7-5 ${label} ${crypto.randomUUID().slice(0, 8)}`;
	/** A random far-future day (class days are unique school-wide). */
	const futureDay = () =>
		`${3000 + Math.floor(Math.random() * 6000)}-07-0${1 + Math.floor(Math.random() * 9)}`;

	async function createClass(label: string, teacherId = teacher.id) {
		const { data, error } = await adminClient
			.from('classes')
			.insert({ name: name(label), code: `K${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		await adminClient.from('class_teachers').insert({ class_id: data.id, teacher_id: teacherId });
		return data.id;
	}

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	async function newParent() {
		const p = await createApprovedParent();
		return { id: p.id, email: p.email, client: await signIn(p.email, p.password) };
	}

	async function child(parentEmail: string, cls: string) {
		const { id, error } = await signUpStudent({
			classId: cls,
			registrationName: name('Kid'),
			guardianEmail: parentEmail
		});
		if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
		const { error: approveError } = await adminClient
			.from('profiles')
			.update({ status: 'approved', team_id: teamId })
			.eq('id', id);
		if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
		return id;
	}

	async function signInStudent(id: string) {
		const password = crypto.randomUUID();
		const { data } = await adminClient.auth.admin.updateUserById(id, { password });
		return signIn(data.user!.email!, password);
	}

	function setLeave(
		client: Client,
		sessionId: string,
		studentId: string,
		answer: 'coming' | 'on_leave' | 'sick'
	) {
		return client
			.from('session_leave_history')
			.insert({ class_session_id: sessionId, student_id: studentId, answer })
			.select('answer')
			.single();
	}

	function decide(
		client: Client,
		sessionId: string,
		studentId: string,
		decision: 'approved' | 'rejected'
	) {
		return client
			.from('sick_leave_decisions')
			.insert({ class_session_id: sessionId, student_id: studentId, decision })
			.select('decision, decided_by')
			.single();
	}

	async function decisionsFor(sessionId: string, studentId: string) {
		const { data } = await adminClient
			.from('sick_leave_decisions')
			.select('decision, decided_by')
			.eq('class_session_id', sessionId)
			.eq('student_id', studentId);
		return data ?? [];
	}

	/** A fresh class taught by `teacher`, a child of a new parent, and a Sick answer for yesterday. */
	async function sickYesterday(teacherId = teacher.id) {
		const cls = await createClass('Sick', teacherId);
		const p = await newParent();
		const kid = await child(p.email, cls);
		const sessionId = await sessionFor(cls, yesterday);
		const { error } = await setLeave(p.client, sessionId, kid, 'sick');
		if (error) throw new Error(`Failed to set Sick: ${error.message}`);
		return { cls, parent: p, kid, sessionId };
	}

	/** Moves a session to another class day (service role; test set-up only). */
	async function moveSession(sessionId: string, day: string) {
		await adminClient.from('class_days').upsert([{ day }], {
			onConflict: 'day',
			ignoreDuplicates: true
		});
		const { data: classDay } = await adminClient
			.from('class_days')
			.select('id')
			.eq('day', day)
			.single();
		const { error } = await adminClient
			.from('class_sessions')
			.update({ class_day_id: classDay!.id })
			.eq('id', sessionId);
		if (error) throw new Error(`Failed to move session: ${error.message}`);
	}

	async function dualRole(role: 'teacher' | 'admin') {
		const dual = await createSignedInUser(role);
		const { error } = await adminClient.from('parents').insert({ id: dual.id, status: 'approved' });
		if (error) throw new Error(`Failed to make parent: ${error.message}`);
		return dual;
	}

	beforeAll(async () => {
		teacher = await createSignedInUser('teacher');
		admin = await createSignedInUser('admin');
		const { data: team, error: teamError } = await adminClient
			.from('teams')
			.insert({ name: name('Team') })
			.select('id')
			.single();
		if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
		teamId = team.id;
	}, 30000);

	it('Approve: a class teacher approves pending Sick; decided_by is the teacher, the streak is recomputed, the parent sees it', async () => {
		const s = await sickYesterday();
		const { data: before } = await adminClient
			.from('student_streaks')
			.select('updated_at')
			.eq('student_id', s.kid)
			.single();

		// The client never stamps the actor.
		const forged = await teacher.client
			.from('sick_leave_decisions')
			.insert({
				class_session_id: s.sessionId,
				student_id: s.kid,
				decision: 'approved',
				decided_by: admin.id
			})
			.select('id');
		expect(forged.error).not.toBeNull();

		const { data, error } = await decide(teacher.client, s.sessionId, s.kid, 'approved');
		expect(error).toBeNull();
		expect(data).toEqual({ decision: 'approved', decided_by: teacher.id });

		const { data: after } = await adminClient
			.from('student_streaks')
			.select('updated_at')
			.eq('student_id', s.kid)
			.single();
		expect(Date.parse(after!.updated_at)).toBeGreaterThan(Date.parse(before!.updated_at));

		// AC: the parent reads the decision next to the (still current) Sick answer.
		const { data: seen } = await s.parent.client
			.from('sick_leave_decisions')
			.select('decision')
			.eq('class_session_id', s.sessionId)
			.eq('student_id', s.kid);
		expect(seen).toEqual([{ decision: 'approved' }]);

		// No UPDATE / DELETE: the decision is final.
		await teacher.client
			.from('sick_leave_decisions')
			.update({ decision: 'rejected' })
			.eq('class_session_id', s.sessionId);
		await admin.client.from('sick_leave_decisions').delete().eq('class_session_id', s.sessionId);
		expect(await decisionsFor(s.sessionId, s.kid)).toEqual([
			{ decision: 'approved', decided_by: teacher.id }
		]);
	});

	it('Reject: the admin (backup) rejects', async () => {
		const s = await sickYesterday();
		const { data, error } = await decide(admin.client, s.sessionId, s.kid, 'rejected');
		expect(error).toBeNull();
		expect(data).toEqual({ decision: 'rejected', decided_by: admin.id });
	});

	it("Self-decision: a teacher or admin who is the student's parent is refused (42501) and sees no controls flag", async () => {
		for (const role of ['teacher', 'admin'] as const) {
			const dual = await dualRole(role);
			const cls = await createClass('Own child', role === 'teacher' ? dual.id : teacher.id);
			const kid = await child(dual.email, cls);
			const sessionId = await sessionFor(cls, yesterday);
			expect((await setLeave(dual.client, sessionId, kid, 'sick')).error).toBeNull();

			const refused = await decide(dual.client, sessionId, kid, 'approved');
			expect(refused.error?.code).toBe('42501');
			expect(await decisionsFor(sessionId, kid)).toEqual([]);

			// The queue lists the row, flagged as their own child.
			const { data: queue, error } = await dual.client.rpc('sick_leave_queue');
			expect(error).toBeNull();
			expect(
				queue?.filter((r) => r.student_id === kid).map((r) => [r.decision, r.own_child])
			).toEqual([[null, true]]);
		}
	});

	it('Self-decision (has_link_to): a teacher or admin with a pending parents row linked to the student is refused (42501) and the queue flags their own child', async () => {
		for (const role of ['teacher', 'admin'] as const) {
			const pendingDual = await createSignedInUser(role);
			const { error: rowError } = await adminClient
				.from('parents')
				.insert({ id: pendingDual.id, status: 'pending' });
			if (rowError) throw new Error(`Failed to add parents row: ${rowError.message}`);
			const s = await sickYesterday(role === 'teacher' ? pendingDual.id : teacher.id);
			await linkParent(adminClient, s.kid, pendingDual.id);
			expect((await pendingDual.client.rpc('is_parent_of', { p_student_id: s.kid })).data).toBe(
				false
			);

			const refused = await decide(pendingDual.client, s.sessionId, s.kid, 'approved');
			expect(refused.error?.code).toBe('42501');
			expect(await decisionsFor(s.sessionId, s.kid)).toEqual([]);

			const { data: queue, error } = await pendingDual.client.rpc('sick_leave_queue');
			expect(error).toBeNull();
			expect(
				queue?.filter((r) => r.student_id === s.kid).map((r) => [r.decision, r.own_child])
			).toEqual([[null, true]]);
		}
	});

	it('Other teacher: a teacher of another class is refused (42501) and sees nothing in the queue', async () => {
		const s = await sickYesterday();
		const outsider = await createSignedInUser('teacher');
		await createClass('Other', outsider.id);
		const refused = await decide(outsider.client, s.sessionId, s.kid, 'approved');
		expect(refused.error?.code).toBe('42501');
		expect(await decisionsFor(s.sessionId, s.kid)).toEqual([]);

		const { data: queue } = await outsider.client.rpc('sick_leave_queue');
		expect(queue?.some((r) => r.student_id === s.kid)).toBe(false);
		const { data: teacherQueue } = await teacher.client.rpc('sick_leave_queue');
		expect(
			teacherQueue
				?.filter((r) => r.student_id === s.kid)
				.map((r) => [r.class_session_id, r.decision])
		).toEqual([[s.sessionId, null]]);
		const { data: adminQueue } = await admin.client.rpc('sick_leave_queue');
		expect(adminQueue?.some((r) => r.student_id === s.kid)).toBe(true);
	});

	it('Not sick: deciding a coming / on_leave / unanswered session is refused', async () => {
		const cls = await createClass('Not sick');
		const p = await newParent();
		const kid = await child(p.email, cls);
		for (const answer of ['coming', 'on_leave', null] as const) {
			const sessionId = await sessionFor(cls, futureDay());
			if (answer) expect((await setLeave(p.client, sessionId, kid, answer)).error).toBeNull();
			const { error } = await decide(teacher.client, sessionId, kid, 'approved');
			expect(error?.hint).toBe('leave_not_sick');
			expect(await decisionsFor(sessionId, kid)).toEqual([]);
		}
		// Sick then Coming: the current answer is no longer Sick. Today's
		// session gets a late start so Coming is still allowed.
		const sessionId = await sessionFor(cls, today);
		await adminClient
			.from('class_sessions')
			.update({ start_time_override: '23:59' })
			.eq('id', sessionId);
		expect((await setLeave(p.client, sessionId, kid, 'sick')).error).toBeNull();
		expect((await setLeave(p.client, sessionId, kid, 'coming')).error).toBeNull();
		expect((await decide(teacher.client, sessionId, kid, 'approved')).error?.hint).toBe(
			'leave_not_sick'
		);
		const { data: queue } = await teacher.client.rpc('sick_leave_queue');
		expect(queue?.some((r) => r.class_session_id === sessionId && r.student_id === kid)).toBe(
			false
		);
		// Even once the session is long past, the job leaves it alone.
		await moveSession(sessionId, plusDays(today, -15));
		expect((await adminClient.rpc('approve_stale_sick_leave')).error).toBeNull();
		expect(await decisionsFor(sessionId, kid)).toEqual([]);
	});

	it('Future: Sick for a session dated after today is refused (leave_sick_closed)', async () => {
		const cls = await createClass('Future sick');
		const p = await newParent();
		const kid = await child(p.email, cls);
		for (const day of [plusDays(today, 1), futureDay()]) {
			const sessionId = await sessionFor(cls, day);
			const { error } = await setLeave(p.client, sessionId, kid, 'sick');
			expect(error?.hint).toBe('leave_sick_closed');
		}
	});

	it('Cancelled: pending Sick on a session later cancelled (session or class day) leaves the queue and is never auto-approved', async () => {
		const bySession = await sickYesterday();
		await adminClient
			.from('class_sessions')
			.update({ cancelled: true })
			.eq('id', bySession.sessionId);

		// Class day cancelled: move the session to a unique far-past day of
		// its own (long past, so the job would otherwise approve it), so no
		// real class day is cancelled.
		const byDay = await sickYesterday();
		const dayOff = `${1700 + Math.floor(Math.random() * 90)}-03-0${1 + Math.floor(Math.random() * 9)}`;
		await moveSession(byDay.sessionId, dayOff);
		await adminClient.from('class_days').update({ cancelled: true }).eq('day', dayOff);
		// The cancelled session is long past too.
		await moveSession(bySession.sessionId, plusDays(today, -15));

		const { data: queue } = await teacher.client.rpc('sick_leave_queue');
		for (const s of [bySession, byDay]) {
			expect(queue?.some((r) => r.class_session_id === s.sessionId)).toBe(false);
		}

		expect((await adminClient.rpc('approve_stale_sick_leave')).error).toBeNull();
		expect(await decisionsFor(bySession.sessionId, bySession.kid)).toEqual([]);
		expect(await decisionsFor(byDay.sessionId, byDay.kid)).toEqual([]);
	});

	it('Final: a second decision is refused, and so is any new answer from the parent (leave_decided)', async () => {
		const s = await sickYesterday();
		expect((await decide(teacher.client, s.sessionId, s.kid, 'rejected')).error).toBeNull();

		const second = await decide(admin.client, s.sessionId, s.kid, 'approved');
		expect(second.error?.code).toBe('23505');

		for (const answer of ['sick', 'coming'] as const) {
			const { error } = await setLeave(s.parent.client, s.sessionId, s.kid, answer);
			expect(error?.hint).toBe('leave_decided');
		}
		expect(await decisionsFor(s.sessionId, s.kid)).toEqual([
			{ decision: 'rejected', decided_by: teacher.id }
		]);
		const { data: answers } = await adminClient
			.from('session_leave_history')
			.select('answer')
			.eq('class_session_id', s.sessionId)
			.eq('student_id', s.kid);
		expect(answers).toEqual([{ answer: 'sick' }]);
	});

	it('Auto: undecided Sick 15 days after the session is approved by the system; 13 days is untouched; running twice adds nothing', async () => {
		const cls = await createClass('Auto');
		const p = await newParent();
		const kid = await child(p.email, cls);

		const stale = await sessionFor(cls, yesterday);
		expect((await setLeave(p.client, stale, kid, 'sick')).error).toBeNull();
		await moveSession(stale, plusDays(today, -15));

		const recent = await sessionFor(cls, yesterday);
		expect((await setLeave(p.client, recent, kid, 'sick')).error).toBeNull();
		await moveSession(recent, plusDays(today, -13));

		const first = await adminClient.rpc('approve_stale_sick_leave');
		expect(first.error).toBeNull();
		expect(first.data).toBeGreaterThanOrEqual(1);
		const second = await adminClient.rpc('approve_stale_sick_leave');
		expect(second).toMatchObject({ data: 0, error: null });

		expect(await decisionsFor(stale, kid)).toEqual([{ decision: 'approved', decided_by: null }]);
		expect(await decisionsFor(recent, kid)).toEqual([]);

		const { data: queue } = await teacher.client.rpc('sick_leave_queue');
		expect(
			queue
				?.filter((r) => r.student_id === kid)
				.map((r) => [r.class_session_id, r.decision, r.decided_by_system])
				.sort((a, b) => String(a[0]).localeCompare(String(b[0])))
		).toEqual(
			[
				[stale, 'approved', true],
				[recent, null, false]
			].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
		);
	});

	it('Streak: an absent week with Sick pending -> reset, approved -> unbroken, rejected -> reset (grace 0)', async () => {
		// Weeks 0 and 2: X present with homework done; week 1 (yesterday): X absent, Sick.
		const days = [plusDays(yesterday, -7), yesterday, plusDays(yesterday, 7)];

		async function scenario() {
			const cls = await createClass('Streak');
			const p = await newParent();
			const x = await child(p.email, cls);
			const y = await child(p.email, cls);
			const sessions: string[] = [];
			for (const day of days) sessions.push(await sessionFor(cls, day));
			const { data: assignment } = await adminClient
				.from('homework_assignments')
				.insert({
					class_id: cls,
					title: name('HW'),
					skill_area: 'language',
					created_by: teacher.id
				})
				.select('id')
				.single();
			for (const [i, day] of days.entries()) {
				for (const mark of [
					{ student_id: y, present: true },
					{ student_id: x, present: i !== 1 }
				]) {
					const { error } = await adminClient.from('attendance_records').insert({
						...mark,
						class_id: cls,
						class_session_id: sessions[i],
						recorded_by: teacher.id
					});
					if (error) throw new Error(`Failed to mark: ${error.message}`);
				}
				if (i === 1) continue;
				const { data: instance } = await adminClient
					.from('homework_instances')
					.insert({
						assignment_id: assignment!.id,
						class_id: cls,
						period_start: mondayOf(day),
						due_date: plusDays(mondayOf(day), 6)
					})
					.select('id')
					.single();
				for (const status of ['assigned', 'done'] as const) {
					await adminClient.from('homework_status_history').insert({
						instance_id: instance!.id,
						student_id: x,
						class_id: cls,
						status,
						recorded_by: teacher.id
					});
				}
			}
			expect((await setLeave(p.client, sessions[1], x, 'sick')).error).toBeNull();
			const streak = async () => {
				const { data, error } = await adminClient.rpc('compute_student_streak', {
					p_student_id: x,
					p_class_id: cls,
					p_as_of_week: mondayOf(days[2])
				});
				expect(error).toBeNull();
				return data?.current_streak;
			};
			return { x, sessionId: sessions[1], streak };
		}

		const approved = await scenario();
		const rejected = await scenario();

		await withGrace0(async () => {
			// Pending Sick protects nothing.
			expect(await approved.streak()).toBe(1);
			expect(await rejected.streak()).toBe(1);

			expect(
				(await decide(teacher.client, approved.sessionId, approved.x, 'approved')).error
			).toBeNull();
			expect(await approved.streak()).toBe(2);

			expect(
				(await decide(teacher.client, rejected.sessionId, rejected.x, 'rejected')).error
			).toBeNull();
			expect(await rejected.streak()).toBe(1);
		});

		async function withGrace0(fn: () => Promise<void>) {
			const { data: before } = await adminClient
				.from('app_settings')
				.select('value')
				.eq('key', 'streak_grace_weeks')
				.single();
			await adminClient
				.from('app_settings')
				.update({ value: { weeks: 0 } })
				.eq('key', 'streak_grace_weeks');
			try {
				await fn();
			} finally {
				await adminClient
					.from('app_settings')
					.update({ value: before!.value })
					.eq('key', 'streak_grace_weeks');
			}
		}
	});

	it('Read: the student, their parent, the class teacher and the admin read the decision; another student, parent or teacher reads nothing', async () => {
		const s = await sickYesterday();
		expect((await decide(teacher.client, s.sessionId, s.kid, 'approved')).error).toBeNull();

		const kidClient = await signInStudent(s.kid);
		const other = await newParent();
		const otherKid = await child(other.email, s.cls);
		const otherKidClient = await signInStudent(otherKid);
		const outsideTeacher = await createSignedInUser('teacher');

		const read = (client: Client) =>
			client
				.from('sick_leave_decisions')
				.select('decision')
				.eq('class_session_id', s.sessionId)
				.eq('student_id', s.kid);

		for (const client of [kidClient, s.parent.client, teacher.client, admin.client]) {
			expect((await read(client)).data).toEqual([{ decision: 'approved' }]);
		}
		for (const client of [otherKidClient, other.client, outsideTeacher.client]) {
			expect((await read(client)).data).toEqual([]);
		}
		// The queue is staff-only: a parent or student gets no rows.
		for (const client of [kidClient, s.parent.client]) {
			const { data } = await client.rpc('sick_leave_queue');
			expect(data).toEqual([]);
		}
	});

	it('Job access: an authenticated teacher or admin cannot run approve_stale_sick_leave (42501)', async () => {
		for (const client of [teacher.client, admin.client]) {
			const { error } = await client.rpc('approve_stale_sick_leave');
			expect(error?.code).toBe('42501');
		}
	});
});

/**
 * Story 7-6: parent deletion requests (migration 0029). One test per I/O
 * matrix row. Each test builds its own parent and children, since an
 * approval erases the child for good.
 */
describe.skipIf(!reachable)('7-6 deletion requests (requires local Supabase)', () => {
	type Client = ReturnType<typeof anonClient>;
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teamId: string;

	const today = todayInBerlin();
	const plusDays = (isoDate: string, days: number) => {
		const date = new Date(`${isoDate}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() + days);
		return date.toISOString().slice(0, 10);
	};
	const name = (label: string) => `7-6 ${label} ${crypto.randomUUID().slice(0, 8)}`;

	async function createClass(label: string, teacherId = teacher.id) {
		const { data, error } = await adminClient
			.from('classes')
			.insert({ name: name(label), code: `D${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		await adminClient.from('class_teachers').insert({ class_id: data.id, teacher_id: teacherId });
		return data.id;
	}

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	async function newParent() {
		const p = await createApprovedParent();
		return { ...p, client: await signIn(p.email, p.password) };
	}

	async function child(parentEmail: string, cls: string, approve = true) {
		const { id, error } = await signUpStudent({
			classId: cls,
			registrationName: name('Kid'),
			guardianEmail: parentEmail
		});
		if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
		if (approve) {
			const { error: approveError } = await adminClient
				.from('profiles')
				.update({ status: 'approved', team_id: teamId })
				.eq('id', id);
			if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
		}
		return id;
	}

	async function signInStudent(id: string) {
		const password = crypto.randomUUID();
		const { data } = await adminClient.auth.admin.updateUserById(id, { password });
		return signIn(data.user!.email!, password);
	}

	function request(client: Client, studentId: string) {
		return client
			.from('deletion_requests')
			.insert({ student_id: studentId })
			.select('id, student_id, requested_by, requester_role, status, requested_at')
			.single();
	}

	function decide(client: Client, id: string, status: 'approved' | 'rejected') {
		return client
			.from('deletion_requests')
			.update({ status })
			.eq('id', id)
			.select('id, status, reviewed_by')
			.single();
	}

	async function requestRow(id: string) {
		const { data } = await adminClient.from('deletion_requests').select('*').eq('id', id).single();
		return data!;
	}

	async function dualRoleAdmin() {
		const dual = await createSignedInUser('admin');
		const { error } = await adminClient.from('parents').insert({ id: dual.id, status: 'approved' });
		if (error) throw new Error(`Failed to make parent: ${error.message}`);
		return dual;
	}

	beforeAll(async () => {
		teacher = await createSignedInUser('teacher');
		admin = await createSignedInUser('admin');
		const { data: team, error: teamError } = await adminClient
			.from('teams')
			.insert({ name: name('Team') })
			.select('id')
			.single();
		if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
		teamId = team.id;
	}, 30000);

	it('Parent submits: a pending row stamped with requester_role parent and requested_by = the parent', async () => {
		const cls = await createClass('Submit');
		const p = await newParent();
		const kid = await child(p.email, cls);
		const before = Date.now();
		const { data, error } = await p.client
			.from('deletion_requests')
			.insert({
				student_id: kid,
				// Client values are ignored: the trigger stamps them.
				requested_by: admin.id,
				status: 'approved'
			} as never)
			.select('student_id, requested_by, requester_role, status, requested_at')
			.single();
		// requested_by / status carry no insert grant: the client can only send student_id.
		expect(error?.code).toBe('42501');

		const ok = await request(p.client, kid);
		expect(ok.error).toBeNull();
		expect(ok.data).toMatchObject({
			student_id: kid,
			requested_by: p.id,
			requester_role: 'parent',
			status: 'pending'
		});
		expect(Date.parse(ok.data!.requested_at)).toBeGreaterThanOrEqual(before - 5000);
		expect(data).toBeNull();
	});

	it('Not own child: another parent, a pending child, a teacher, the student and the service role are refused', async () => {
		const cls = await createClass('Not own');
		const p = await newParent();
		const kid = await child(p.email, cls);
		const pendingKid = await child(p.email, cls, false);
		const other = await newParent();
		const kidClient = await signInStudent(kid);

		for (const [client, target] of [
			[other.client, kid],
			[p.client, pendingKid],
			[teacher.client, kid],
			[kidClient, kid]
		] as const) {
			const { error } = await request(client, target);
			expect(error?.code).toBe('42501');
		}
		// The service role is not exempt: no parent is signed in.
		const { error: serviceError } = await adminClient
			.from('deletion_requests')
			.insert({ student_id: kid });
		expect(serviceError?.code).toBe('42501');

		const { data: rows } = await adminClient
			.from('deletion_requests')
			.select('id')
			.in('student_id', [kid, pendingKid]);
		expect(rows).toEqual([]);
	});

	it('Duplicate: a second request while one is pending is refused (23505)', async () => {
		const cls = await createClass('Duplicate');
		const p = await newParent();
		const kid = await child(p.email, cls);
		expect((await request(p.client, kid)).error).toBeNull();
		const second = await request(p.client, kid);
		expect(second.error?.code).toBe('23505');
	});

	it("Approve: the child's account and every student-keyed row are erased; the request is kept de-identified; the parent is intact", async () => {
		const cls = await createClass('Approve');
		const p = await newParent();
		const kid = await child(p.email, cls);
		const sibling = await child(p.email, cls);

		// Data in every student-keyed table.
		const pastSession = await sessionFor(cls, plusDays(today, -8));
		const { error: attendanceError } = await teacher.client.from('attendance_records').insert({
			student_id: kid,
			class_id: cls,
			present: true,
			class_session_id: pastSession,
			recorded_by: teacher.id
		});
		expect(attendanceError).toBeNull();
		const { error: skillError } = await teacher.client.from('skill_status_history').insert({
			student_id: kid,
			class_id: cls,
			skill_area: 'language',
			level: 'learning',
			recorded_by: teacher.id
		});
		expect(skillError).toBeNull();
		const { data: assignment } = await adminClient
			.from('homework_assignments')
			.insert({ class_id: cls, title: name('Homework'), skill_area: 'language' })
			.select('id')
			.single();
		const { data: instance } = await adminClient
			.from('homework_instances')
			.insert({
				assignment_id: assignment!.id,
				class_id: cls,
				period_start: plusDays(today, -8),
				due_date: plusDays(today, -1)
			})
			.select('id')
			.single();
		const { error: homeworkError } = await adminClient.from('homework_status_history').insert({
			instance_id: instance!.id,
			student_id: kid,
			class_id: cls,
			status: 'done'
		});
		expect(homeworkError).toBeNull();
		const yesterdaySession = await sessionFor(cls, plusDays(today, -1));
		const { error: leaveError } = await p.client
			.from('session_leave_history')
			.insert({ class_session_id: yesterdaySession, student_id: kid, answer: 'sick' });
		expect(leaveError).toBeNull();
		const { error: decisionError } = await teacher.client
			.from('sick_leave_decisions')
			.insert({ class_session_id: yesterdaySession, student_id: kid, decision: 'approved' });
		expect(decisionError).toBeNull();

		const tables = [
			'class_enrollments',
			'attendance_records',
			'skill_status_history',
			'homework_status_history',
			'session_leave_history',
			'sick_leave_decisions',
			'student_streaks',
			'badges_earned'
		] as const;
		const countFor = async (table: (typeof tables)[number]) => {
			const { count, error } = await adminClient
				.from(table)
				.select('*', { count: 'exact', head: true })
				.eq('student_id', kid);
			expect(error).toBeNull();
			return count ?? 0;
		};
		for (const table of tables.filter((t) => t !== 'badges_earned')) {
			expect(await countFor(table), table).toBeGreaterThan(0);
		}

		const { data: req } = await request(p.client, kid);
		const approved = await decide(admin.client, req!.id, 'approved');
		expect(approved.error).toBeNull();

		// The child is gone: auth user, profile and every student-keyed row.
		const { data: authUser } = await adminClient.auth.admin.getUserById(kid);
		expect(authUser.user).toBeNull();
		const { data: profile } = await adminClient.from('profiles').select('id').eq('id', kid);
		expect(profile).toEqual([]);
		for (const table of tables) {
			expect(await countFor(table), table).toBe(0);
		}

		// The request row stays, de-identified, with its audit trail.
		const row = await requestRow(req!.id);
		expect(row).toMatchObject({
			student_id: null,
			requested_by: p.id,
			requester_role: 'parent',
			status: 'approved',
			reviewed_by: admin.id
		});
		expect(row.requested_at).not.toBeNull();
		expect(row.reviewed_at).not.toBeNull();

		// The parent account is intact and still signs in; only the sibling remains.
		const { data: parentRow } = await adminClient
			.from('parents')
			.select('status')
			.eq('id', p.id)
			.single();
		expect(parentRow?.status).toBe('approved');
		const again = await signIn(p.email, p.password);
		const { data: linked } = await again.rpc('linked_children');
		expect(linked?.map((c) => c.id)).toEqual([sibling]);
		// spec-second-parent story 2 (AD-9, 0055): reads follow is_parent_of,
		// not requested_by, so the de-identified row is the admin's only.
		const { data: own } = await again.from('deletion_requests').select('id, student_id');
		expect(own).toEqual([]);
	});

	it('Reject: nothing is erased, the status is rejected, and a new request is allowed later', async () => {
		const cls = await createClass('Reject');
		const p = await newParent();
		const kid = await child(p.email, cls);
		const { data: req } = await request(p.client, kid);
		const rejected = await decide(admin.client, req!.id, 'rejected');
		expect(rejected.error).toBeNull();
		expect(rejected.data).toMatchObject({ status: 'rejected', reviewed_by: admin.id });

		const { data: profile } = await adminClient.from('profiles').select('id').eq('id', kid);
		expect(profile).toEqual([{ id: kid }]);
		const { count } = await adminClient
			.from('class_enrollments')
			.select('*', { count: 'exact', head: true })
			.eq('student_id', kid);
		expect(count).toBe(1);
		expect(await requestRow(req!.id)).toMatchObject({ student_id: kid, status: 'rejected' });

		expect((await request(p.client, kid)).error).toBeNull();
	});

	it("Self-decision: an admin who is the child's parent cannot approve", async () => {
		const dual = await dualRoleAdmin();
		const cls = await createClass('Own child');
		const kid = await child(dual.email, cls);
		const { data: req, error } = await request(dual.client, kid);
		expect(error).toBeNull();
		const refused = await decide(dual.client, req!.id, 'approved');
		expect(refused.error?.code).toBe('42501');
		expect(await requestRow(req!.id)).toMatchObject({ status: 'pending', student_id: kid });
		const { data: profile } = await adminClient.from('profiles').select('id').eq('id', kid);
		expect(profile).toEqual([{ id: kid }]);
	});

	it('Self-decision (has_link_to): an admin with a pending parents row linked to the child cannot approve', async () => {
		const pendingAdmin = await createSignedInUser('admin');
		const { error: rowError } = await adminClient
			.from('parents')
			.insert({ id: pendingAdmin.id, status: 'pending' });
		if (rowError) throw new Error(`Failed to add parents row: ${rowError.message}`);
		const p = await newParent();
		const cls = await createClass('Pending own child');
		const kid = await child(p.email, cls);
		await linkParent(adminClient, kid, pendingAdmin.id);
		const { data: req, error } = await request(p.client, kid);
		expect(error).toBeNull();

		const refused = await decide(pendingAdmin.client, req!.id, 'approved');
		expect(refused.error?.code).toBe('42501');
		expect(await requestRow(req!.id)).toMatchObject({ status: 'pending', student_id: kid });
		const { data: profile } = await adminClient.from('profiles').select('id').eq('id', kid);
		expect(profile).toEqual([{ id: kid }]);
	});

	it('Not admin: a teacher or the parent cannot decide a request', async () => {
		const cls = await createClass('Not admin');
		const p = await newParent();
		const kid = await child(p.email, cls);
		const { data: req } = await request(p.client, kid);
		for (const client of [teacher.client, p.client]) {
			const { data, error } = await client
				.from('deletion_requests')
				.update({ status: 'approved' })
				.eq('id', req!.id)
				.select('id');
			// RLS: no row is visible to update (teacher) or the policy refuses it (parent).
			expect(error !== null || (data ?? []).length === 0).toBe(true);
		}
		expect(await requestRow(req!.id)).toMatchObject({ status: 'pending', student_id: kid });
		// No DELETE either.
		const { data: deleted } = await p.client
			.from('deletion_requests')
			.delete()
			.eq('id', req!.id)
			.select('id');
		expect(deleted ?? []).toEqual([]);
		expect((await requestRow(req!.id)).id).toBe(req!.id);
	});

	it('Frozen: a decided row cannot change, and no column but status can be edited', async () => {
		const cls = await createClass('Frozen');
		const p = await newParent();
		const kid = await child(p.email, cls);
		const otherKid = await child(p.email, cls);
		const { data: req } = await request(p.client, kid);
		expect((await decide(admin.client, req!.id, 'rejected')).error).toBeNull();

		// Admin: rejected -> approved / pending refused by the trigger.
		for (const status of ['approved', 'pending'] as const) {
			const { error } = await admin.client
				.from('deletion_requests')
				.update({ status })
				.eq('id', req!.id)
				.select('id')
				.single();
			expect(error?.code).toBe('42501');
		}
		// Admin editing student_id: no column grant.
		const { error: grantError } = await admin.client
			.from('deletion_requests')
			.update({ student_id: otherKid } as never)
			.eq('id', req!.id)
			.select('id')
			.single();
		expect(grantError?.code).toBe('42501');
		// Even the service role hits the trigger.
		const { error: triggerError } = await adminClient
			.from('deletion_requests')
			.update({ student_id: otherKid })
			.eq('id', req!.id);
		expect(triggerError?.code).toBe('42501');
		const { error: pendingEditError } = await adminClient
			.from('deletion_requests')
			.update({ status: 'approved', requested_by: admin.id })
			.eq('id', req!.id);
		expect(pendingEditError?.code).toBe('42501');

		expect(await requestRow(req!.id)).toMatchObject({
			student_id: kid,
			status: 'rejected',
			requested_by: p.id
		});
	});

	it('Read: the requester, the parent, the student and the admin see the row; another parent and a teacher do not', async () => {
		const cls = await createClass('Read');
		const p = await newParent();
		const kid = await child(p.email, cls);
		const { data: req } = await request(p.client, kid);
		const kidClient = await signInStudent(kid);
		const other = await newParent();

		const read = (client: Client) =>
			client.from('deletion_requests').select('id, status').eq('id', req!.id);
		for (const client of [p.client, kidClient, admin.client]) {
			expect((await read(client)).data).toEqual([{ id: req!.id, status: 'pending' }]);
		}
		for (const client of [other.client, teacher.client]) {
			expect((await read(client)).data).toEqual([]);
		}
	});
});

/**
 * B11 (#57): date-range leave (migration 0030). preview_leave_range /
 * set_leave_range, one test per I/O matrix row. Each test uses fresh classes
 * whose schedule lies in the past (2000-01-02), so the only sessions in the
 * period are the ones the test creates with sessionFor().
 */
describe.skipIf(!reachable)('B11 leave range (requires local Supabase)', () => {
	type Client = ReturnType<typeof anonClient>;
	type Outcome = { session_id: string; outcome: string };
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teamId: string;

	const today = todayInBerlin();
	const plusDays = (isoDate: string, days: number) => {
		const date = new Date(`${isoDate}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() + days);
		return date.toISOString().slice(0, 10);
	};
	const name = (label: string) => `B11 ${label} ${crypto.randomUUID().slice(0, 8)}`;

	async function createClass(label: string) {
		const { data, error } = await adminClient
			.from('classes')
			.insert({
				name: name(label),
				code: `R${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
				schedule_starts_on: '2000-01-02',
				schedule_ends_on: '2000-01-02'
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		const { error: teacherError } = await adminClient
			.from('class_teachers')
			.insert({ class_id: data.id, teacher_id: teacher.id });
		if (teacherError) throw new Error(`Failed to assign teacher: ${teacherError.message}`);
		return data.id;
	}

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	async function newParent() {
		const p = await createApprovedParent();
		return { id: p.id, email: p.email, client: await signIn(p.email, p.password) };
	}

	/** An approved child of `parentEmail` in `classes[0]`, also enrolled in the rest. */
	async function child(parentEmail: string, ...classes: string[]) {
		const { id, error } = await signUpStudent({
			classId: classes[0],
			registrationName: name('Kid'),
			guardianEmail: parentEmail
		});
		if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
		const { error: approveError } = await adminClient
			.from('profiles')
			.update({ status: 'approved', team_id: teamId })
			.eq('id', id);
		if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
		for (const cls of classes.slice(1)) {
			const { error: enrollError } = await adminClient
				.from('class_enrollments')
				.insert({ student_id: id, class_id: cls });
			if (enrollError) throw new Error(`Failed to enroll child: ${enrollError.message}`);
		}
		return id;
	}

	async function signInStudent(id: string) {
		const password = crypto.randomUUID();
		const { data, error } = await adminClient.auth.admin.updateUserById(id, { password });
		if (error || !data.user?.email) throw new Error(`Failed to set password: ${error?.message}`);
		return signIn(data.user.email, password);
	}

	function preview(
		client: Client,
		student: string,
		from: string,
		to: string,
		cls: string | null = null,
		answer: 'on_leave' | 'coming' = 'on_leave'
	) {
		return client.rpc('preview_leave_range', {
			p_student: student,
			p_from: from,
			p_to: to,
			p_class: cls,
			p_answer: answer
		});
	}

	function setRange(
		client: Client,
		student: string,
		from: string,
		to: string,
		cls: string | null = null,
		answer: 'on_leave' | 'coming' = 'on_leave'
	) {
		return client.rpc('set_leave_range', {
			p_student: student,
			p_from: from,
			p_to: to,
			p_class: cls,
			p_answer: answer
		});
	}

	function setLeave(
		client: Client,
		sessionId: string,
		studentId: string,
		answer: 'coming' | 'on_leave' | 'sick'
	) {
		return client
			.from('session_leave_history')
			.insert({ class_session_id: sessionId, student_id: studentId, answer })
			.select('answer, classification')
			.single();
	}

	async function history(studentId: string) {
		const { data, error } = await adminClient
			.from('session_leave_history')
			.select('class_session_id, answer, classification, answered_by')
			.eq('student_id', studentId)
			.order('answered_at')
			.order('id');
		if (error) throw new Error(`Failed to read leave history: ${error.message}`);
		return data ?? [];
	}

	async function latest(sessionId: string, studentId: string) {
		const { data, error } = await adminClient
			.from('session_leave_history')
			.select('answer, classification')
			.eq('class_session_id', sessionId)
			.eq('student_id', studentId)
			.order('answered_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) throw new Error(`Failed to read the latest answer: ${error.message}`);
		return data;
	}

	const outcomes = (rows: Outcome[] | null) =>
		Object.fromEntries((rows ?? []).map((r) => [r.session_id, r.outcome]));

	beforeAll(async () => {
		teacher = await createSignedInUser('teacher');
		admin = await createSignedInUser('admin');
		const { data: team, error: teamError } = await adminClient
			.from('teams')
			.insert({ name: name('Team') })
			.select('id')
			.single();
		if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
		teamId = team.id;
	}, 30000);

	it('Two-week leave: the preview classifies each session and the save freezes the same classification', async () => {
		const cls = await createClass('Two weeks');
		const parent = await newParent();
		const kid = await child(parent.email, cls);
		const short = await sessionFor(cls, plusDays(today, 10));
		const planned = await sessionFor(cls, plusDays(today, 15));
		const planned2 = await sessionFor(cls, plusDays(today, 22));
		const outside = await sessionFor(cls, plusDays(today, 25));
		const from = plusDays(today, 10);
		const to = plusDays(today, 24);

		const before = await preview(parent.client, kid, from, to);
		expect(before.error).toBeNull();
		expect((before.data ?? []).map((r) => [r.session_id, r.outcome])).toEqual([
			[short, 'short_notice'],
			[planned, 'planned'],
			[planned2, 'planned']
		]);
		expect(before.data?.[0]).toMatchObject({ day: from, class_id: cls });
		// The preview writes nothing.
		expect(await history(kid)).toEqual([]);

		const saved = await setRange(parent.client, kid, from, to);
		expect(saved.error).toBeNull();
		expect(outcomes(saved.data)).toEqual(outcomes(before.data));

		expect(await history(kid)).toEqual([
			{
				class_session_id: short,
				answer: 'on_leave',
				classification: 'short_notice',
				answered_by: parent.id
			},
			{
				class_session_id: planned,
				answer: 'on_leave',
				classification: 'planned',
				answered_by: parent.id
			},
			{
				class_session_id: planned2,
				answer: 'on_leave',
				classification: 'planned',
				answered_by: parent.id
			}
		]);
		expect(await latest(outside, kid)).toBeNull();
	});

	it('One class: only the picked class is covered', async () => {
		const clsA = await createClass('A');
		const clsB = await createClass('B');
		const parent = await newParent();
		const kid = await child(parent.email, clsA, clsB);
		const inA = await sessionFor(clsA, plusDays(today, 20));
		const inB = await sessionFor(clsB, plusDays(today, 21));
		const from = plusDays(today, 18);
		const to = plusDays(today, 30);

		const all = await preview(parent.client, kid, from, to);
		expect(Object.keys(outcomes(all.data)).sort()).toEqual([inA, inB].sort());

		const one = await setRange(parent.client, kid, from, to, clsA);
		expect(one.error).toBeNull();
		expect(outcomes(one.data)).toEqual({ [inA]: 'planned' });
		expect(await latest(inA, kid)).toEqual({ answer: 'on_leave', classification: 'planned' });
		expect(await latest(inB, kid)).toBeNull();

		// A class the child is not enrolled in covers nothing.
		const other = await createClass('Other');
		await sessionFor(other, plusDays(today, 20));
		expect((await preview(parent.client, kid, from, to, other)).data).toEqual([]);
	});

	it('Already on leave: a Planned session is left untouched (not re-frozen as Short-notice)', async () => {
		const cls = await createClass('Already');
		const parent = await newParent();
		const kid = await child(parent.email, cls);
		const early = await sessionFor(cls, plusDays(today, 16));
		expect((await setLeave(parent.client, early, kid, 'on_leave')).data).toEqual({
			answer: 'on_leave',
			classification: 'planned'
		});
		const fresh = await sessionFor(cls, plusDays(today, 5));

		const saved = await setRange(parent.client, kid, today, plusDays(today, 20));
		expect(saved.error).toBeNull();
		expect(outcomes(saved.data)).toEqual({ [early]: 'already_on_leave', [fresh]: 'short_notice' });
		const rows = await history(kid);
		expect(rows.filter((r) => r.class_session_id === early)).toHaveLength(1);
		expect(await latest(early, kid)).toEqual({ answer: 'on_leave', classification: 'planned' });
	});

	it('Started / cancelled / decided / sick: skipped, reported, and the rest still saves', async () => {
		const started = await createClass('Started');
		const decided = await createClass('Decided');
		const sick = await createClass('Sick');
		const parent = await newParent();
		const kid = await child(parent.email, started, decided, sick);

		// Today at 00:00 (no start time): already started.
		const startedSession = await sessionFor(started, today);
		// Cancelled, three days ahead.
		const cancelledSession = await sessionFor(started, plusDays(today, 3));
		await adminClient.from('class_sessions').update({ cancelled: true }).eq('id', cancelledSession);
		// Sick today, decided by the teacher.
		const decidedSession = await sessionFor(decided, today);
		expect((await setLeave(parent.client, decidedSession, kid, 'sick')).error).toBeNull();
		const { error: decideError } = await teacher.client
			.from('sick_leave_decisions')
			.insert({ class_session_id: decidedSession, student_id: kid, decision: 'approved' });
		expect(decideError).toBeNull();
		// Sick today, not started yet (23:59), undecided.
		const sickSession = await sessionFor(sick, today);
		await adminClient
			.from('class_sessions')
			.update({ start_time_override: '23:59' })
			.eq('id', sickSession);
		expect((await setLeave(parent.client, sickSession, kid, 'sick')).error).toBeNull();
		// One open session that does change.
		const open = await sessionFor(sick, plusDays(today, 4));
		const before = (await history(kid)).length;

		const expected = {
			[startedSession]: 'started',
			[cancelledSession]: 'cancelled',
			[decidedSession]: 'decided',
			[sickSession]: 'sick',
			[open]: 'short_notice'
		};
		const previewed = await preview(parent.client, kid, today, plusDays(today, 6));
		expect(outcomes(previewed.data)).toEqual(expected);

		const saved = await setRange(parent.client, kid, today, plusDays(today, 6));
		expect(saved.error).toBeNull();
		expect(outcomes(saved.data)).toEqual(expected);
		const after = await history(kid);
		expect(after).toHaveLength(before + 1);
		expect(after.at(-1)).toMatchObject({ class_session_id: open, answer: 'on_leave' });
		expect(await latest(sickSession, kid)).toMatchObject({ answer: 'sick' });
	});

	it('Undo: Coming over the same range resets only the On leave sessions', async () => {
		const cls = await createClass('Undo');
		const parent = await newParent();
		const kid = await child(parent.email, cls);
		const a = await sessionFor(cls, plusDays(today, 12));
		const b = await sessionFor(cls, plusDays(today, 19));
		const from = plusDays(today, 10);
		const to = plusDays(today, 24);
		expect((await setRange(parent.client, kid, from, to, cls)).error).toBeNull();
		// Added after the leave was set: never answered.
		const later = await sessionFor(cls, plusDays(today, 23));

		const previewed = await preview(parent.client, kid, from, to, null, 'coming');
		expect(outcomes(previewed.data)).toEqual({
			[a]: 'coming',
			[b]: 'coming',
			[later]: 'already_coming'
		});

		const undo = await setRange(parent.client, kid, from, to, null, 'coming');
		expect(undo.error).toBeNull();
		expect(outcomes(undo.data)).toEqual(outcomes(previewed.data));
		expect(await latest(a, kid)).toEqual({ answer: 'coming', classification: null });
		expect(await latest(b, kid)).toEqual({ answer: 'coming', classification: null });
		expect(await latest(later, kid)).toBeNull();

		// Again: nothing is On leave any more, nothing is written.
		const count = (await history(kid)).length;
		const again = await setRange(parent.client, kid, from, to, null, 'coming');
		expect(Object.values(outcomes(again.data))).toEqual([
			'already_coming',
			'already_coming',
			'already_coming'
		]);
		expect(await history(kid)).toHaveLength(count);
	});

	it('Invalid range: past start, end before start, over 26 weeks, a bad answer -> 22023 leave_range_invalid, nothing written', async () => {
		const cls = await createClass('Limits');
		const parent = await newParent();
		const kid = await child(parent.email, cls);
		await sessionFor(cls, plusDays(today, 3));

		const bad: [string, string][] = [
			[plusDays(today, -1), plusDays(today, 5)],
			[plusDays(today, 5), plusDays(today, 4)],
			// 26 weeks inclusive is to - from = 181: one day more is refused.
			[today, plusDays(today, 182)]
		];
		for (const [from, to] of bad) {
			for (const call of [preview, setRange]) {
				const { error } = await call(parent.client, kid, from, to);
				expect(error).toMatchObject({ code: '22023', hint: 'leave_range_invalid' });
			}
		}
		const badAnswer = await parent.client.rpc('set_leave_range', {
			p_student: kid,
			p_from: today,
			p_to: plusDays(today, 5),
			p_class: null,
			p_answer: 'sick' as 'coming'
		});
		expect(badAnswer.error).toMatchObject({ code: '22023', hint: 'leave_range_invalid' });
		expect(await history(kid)).toEqual([]);

		// Exactly 26 weeks (182 days including both dates) is allowed.
		expect((await preview(parent.client, kid, today, plusDays(today, 181))).error).toBeNull();
	});

	it('Not the parent: another parent, a teacher, the admin, the student and the service role are refused (42501)', async () => {
		const cls = await createClass('Not parent');
		const parent = await newParent();
		const kid = await child(parent.email, cls);
		await sessionFor(cls, plusDays(today, 8));
		const other = await newParent();
		const kidClient = await signInStudent(kid);
		const to = plusDays(today, 14);

		for (const client of [other.client, teacher.client, admin.client, kidClient, adminClient]) {
			for (const call of [preview, setRange]) {
				const { error } = await call(client, kid, today, to);
				expect(error?.code).toBe('42501');
			}
		}
		expect(await history(kid)).toEqual([]);

		// Permission comes first: a bad answer from a non-parent is still 42501.
		const otherBadAnswer = await other.client.rpc('set_leave_range', {
			p_student: kid,
			p_from: today,
			p_to: to,
			p_class: null,
			p_answer: 'sick' as 'coming'
		});
		expect(otherBadAnswer.error?.code).toBe('42501');
	});

	it('Answered since the preview: an answer saved after the preview is left alone', async () => {
		const cls = await createClass('Since preview');
		const parent = await newParent();
		const kid = await child(parent.email, cls);
		// Not started yet today, so Sick is allowed and On leave would be too.
		const sickLater = await sessionFor(cls, today);
		const { error: timeError } = await adminClient
			.from('class_sessions')
			.update({ start_time_override: '23:59' })
			.eq('id', sickLater);
		if (timeError) throw new Error(`Failed to set start time: ${timeError.message}`);
		const plannedLater = await sessionFor(cls, plusDays(today, 16));
		const range = [today, plusDays(today, 20)] as const;

		const previewed = await preview(parent.client, kid, ...range);
		expect(outcomes(previewed.data)).toEqual({
			[sickLater]: 'short_notice',
			[plannedLater]: 'planned'
		});

		// Another tab / the other parent answers in between.
		expect((await setLeave(parent.client, sickLater, kid, 'sick')).error).toBeNull();
		expect((await setLeave(parent.client, plannedLater, kid, 'on_leave')).data).toEqual({
			answer: 'on_leave',
			classification: 'planned'
		});
		const count = (await history(kid)).length;

		const saved = await setRange(parent.client, kid, ...range);
		expect(saved.error).toBeNull();
		expect(outcomes(saved.data)).toEqual({
			[sickLater]: 'sick',
			[plannedLater]: 'already_on_leave'
		});
		expect(await history(kid)).toHaveLength(count);
		expect(await latest(sickLater, kid)).toEqual({ answer: 'sick', classification: null });
		expect(await latest(plannedLater, kid)).toEqual({
			answer: 'on_leave',
			classification: 'planned'
		});
	});

	it('A teacher who is also a parent sets a range for their own child', async () => {
		const teacherParent = await createSignedInUser('teacher');
		const { error: parentError } = await adminClient
			.from('parents')
			.insert({ id: teacherParent.id, status: 'approved' });
		expect(parentError).toBeNull();
		const cls = await createClass('Teacher parent');
		const kid = await child(teacherParent.email, cls);
		const session = await sessionFor(cls, plusDays(today, 9));

		const saved = await setRange(teacherParent.client, kid, today, plusDays(today, 14));
		expect(saved.error).toBeNull();
		expect(outcomes(saved.data)).toEqual({ [session]: 'short_notice' });
		expect(await history(kid)).toEqual([
			{
				class_session_id: session,
				answer: 'on_leave',
				classification: 'short_notice',
				answered_by: teacherParent.id
			}
		]);
	});

	it("Two children: a range on one child leaves the sibling's sessions unchanged", async () => {
		const cls = await createClass('Siblings');
		const parent = await newParent();
		const kid = await child(parent.email, cls);
		const sibling = await child(parent.email, cls);
		const session = await sessionFor(cls, plusDays(today, 11));

		expect((await setRange(parent.client, kid, today, plusDays(today, 14))).error).toBeNull();
		expect(await latest(session, kid)).toMatchObject({ answer: 'on_leave' });
		expect(await history(sibling)).toEqual([]);
		expect(await latest(session, sibling)).toBeNull();
	});

	it('Empty range: no sessions -> an empty preview and nothing saved', async () => {
		const cls = await createClass('Empty');
		const parent = await newParent();
		const kid = await child(parent.email, cls);
		const from = plusDays(today, 40);
		const to = plusDays(today, 50);
		expect(await preview(parent.client, kid, from, to)).toMatchObject({ data: [], error: null });
		expect(await setRange(parent.client, kid, from, to)).toMatchObject({ data: [], error: null });
		expect(await history(kid)).toEqual([]);
	});

	it('Streak: each saved answer recomputes the child streak (the AFTER INSERT trigger)', async () => {
		const cls = await createClass('Streak');
		const parent = await newParent();
		const kid = await child(parent.email, cls);
		await sessionFor(cls, plusDays(today, 20));
		await adminClient.from('student_streaks').delete().eq('student_id', kid);

		expect(
			(await setRange(parent.client, kid, plusDays(today, 15), plusDays(today, 25))).error
		).toBeNull();
		const { data: streak } = await adminClient
			.from('student_streaks')
			.select('student_id')
			.eq('student_id', kid);
		expect(streak).toEqual([{ student_id: kid }]);
	});
});

/**
 * B12a (#67): class join requests (migration 0031). One test per I/O matrix
 * row, plus direct client writes being refused. Every student starts in a
 * class of their own and asks to join another.
 */
describe.skipIf(!reachable)('B12a class join requests (requires local Supabase)', () => {
	type Client = ReturnType<typeof anonClient>;
	type Fixture = { id: string; client: Client };
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teamId: string;

	const name = (label: string) => `B12a ${label} ${crypto.randomUUID().slice(0, 8)}`;

	async function createClass(label: string, teacherId = teacher.id) {
		const code = `J${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
		const className = name(label);
		const { data, error } = await adminClient
			.from('classes')
			.insert({ name: className, code })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		await adminClient.from('class_teachers').insert({ class_id: data.id, teacher_id: teacherId });
		return { id: data.id, code, name: className };
	}

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	/** A student registered into `classId`, approved unless `approve` is false, signed in. */
	async function student(
		classId: string,
		{ approve = true, guardianEmail }: { approve?: boolean; guardianEmail?: string } = {}
	): Promise<Fixture> {
		const { id, error } = await signUpStudent({
			classId,
			registrationName: name('Student'),
			guardianEmail
		});
		if (error || !id) throw new Error(`Failed to register student: ${error?.message}`);
		if (approve) {
			const { error: approveError } = await adminClient
				.from('profiles')
				.update({ status: 'approved', team_id: teamId })
				.eq('id', id);
			if (approveError) throw new Error(`Failed to approve student: ${approveError.message}`);
		}
		const password = crypto.randomUUID();
		const { data } = await adminClient.auth.admin.updateUserById(id, { password });
		return { id, client: await signIn(data.user!.email!, password) };
	}

	function request(client: Client, code: string) {
		return client.rpc('request_class_join', { p_code: code });
	}

	function decide(client: Client, requestId: string, decision: 'approved' | 'rejected') {
		return client.rpc('decide_class_join', { p_request_id: requestId, p_decision: decision });
	}

	async function requestsOf(studentId: string) {
		const { data, error } = await adminClient
			.from('class_join_requests')
			.select('id, class_id, status, reviewed_by, dismissed_at')
			.eq('student_id', studentId)
			.order('requested_at');
		if (error) throw new Error(`Failed to read requests: ${error.message}`);
		return data ?? [];
	}

	async function pendingId(studentId: string, classId: string) {
		const row = (await requestsOf(studentId)).find(
			(r) => r.class_id === classId && r.status === 'pending'
		);
		if (!row) throw new Error('No pending request');
		return row.id;
	}

	async function mine(client: Client) {
		const { data, error } = await client.rpc('my_class_join_requests');
		if (error) throw new Error(`my_class_join_requests failed: ${error.message}`);
		return (data ?? []).map((r) => [r.class_name, r.status]);
	}

	async function enrolled(studentId: string, classId: string) {
		const { data } = await adminClient
			.from('class_enrollments')
			.select('enrolled_by')
			.eq('student_id', studentId)
			.eq('class_id', classId);
		return data ?? [];
	}

	beforeAll(async () => {
		teacher = await createSignedInUser('teacher');
		admin = await createSignedInUser('admin');
		const { data: team, error: teamError } = await adminClient
			.from('teams')
			.insert({ name: name('Team') })
			.select('id')
			.single();
		if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
		teamId = team.id;
	}, 30000);

	it('Request: an approved student sends a (lower-case, padded) code and sees Pending', async () => {
		const home = await createClass('Home');
		const target = await createClass('Target');
		const s = await student(home.id);

		const { data, error } = await request(s.client, `  ${target.code.toLowerCase()} `);
		expect(error).toBeNull();
		expect(data).toBe(target.name);
		expect(await mine(s.client)).toEqual([[target.name, 'pending']]);
		expect(await requestsOf(s.id)).toMatchObject([{ class_id: target.id, status: 'pending' }]);
		// The student reads their own row directly too.
		const { data: own } = await s.client.from('class_join_requests').select('status');
		expect(own).toEqual([{ status: 'pending' }]);

		// Newest first.
		const second = await createClass('Second');
		expect((await request(s.client, second.code)).error).toBeNull();
		expect(await mine(s.client)).toEqual([
			[second.name, 'pending'],
			[target.name, 'pending']
		]);
	});

	it('Unknown or own class: the same refusal, nothing created', async () => {
		const home = await createClass('Home');
		const s = await student(home.id);

		const unknown = await request(s.client, 'ZZZZZZZZ');
		const own = await request(s.client, home.code);
		for (const refused of [unknown, own]) {
			expect(refused.error?.code).toBe('22023');
			expect(refused.error?.hint).toBe('join_code_invalid');
		}
		expect(unknown.error?.message).toBe(own.error?.message);
		expect(await requestsOf(s.id)).toEqual([]);
	});

	it('Duplicate: a second request for a pending class is refused (23505)', async () => {
		const home = await createClass('Home');
		const target = await createClass('Target');
		const s = await student(home.id);
		expect((await request(s.client, target.code)).error).toBeNull();

		const again = await request(s.client, target.code);
		expect(again.error?.code).toBe('23505');
		expect(again.error?.hint).toBe('join_already_pending');
		expect(await requestsOf(s.id)).toHaveLength(1);
	});

	it('Cap: a 4th pending request is refused', async () => {
		const home = await createClass('Home');
		const s = await student(home.id);
		for (const label of ['One', 'Two', 'Three']) {
			const cls = await createClass(label);
			expect((await request(s.client, cls.code)).error).toBeNull();
		}
		const fourth = await createClass('Four');
		const refused = await request(s.client, fourth.code);
		expect(refused.error?.code).toBe('22023');
		expect(refused.error?.hint).toBe('join_limit');
		expect(await requestsOf(s.id)).toHaveLength(3);
	});

	it('Cap: 3 rejected / approved requests do not block a new one', async () => {
		const home = await createClass('Home');
		const s = await student(home.id);
		for (const decision of ['rejected', 'approved', 'rejected'] as const) {
			const cls = await createClass(decision);
			expect((await request(s.client, cls.code)).error).toBeNull();
			const id = await pendingId(s.id, cls.id);
			expect((await decide(teacher.client, id, decision)).error).toBeNull();
		}
		const next = await createClass('Next');
		expect((await request(s.client, next.code)).error).toBeNull();
	});

	it('Enrolled another way: the pending request leaves both lists and the cap; approving it just marks it approved', async () => {
		const home = await createClass('Home');
		const target = await createClass('Target');
		const s = await student(home.id);
		expect((await request(s.client, target.code)).error).toBeNull();
		const id = await pendingId(s.id, target.id);
		for (const label of ['Two', 'Three']) {
			const cls = await createClass(label);
			expect((await request(s.client, cls.code)).error).toBeNull();
		}

		// The teacher enrols the student directly (enroll_student, 0016).
		const { error: enrollError } = await teacher.client.rpc('enroll_student', {
			p_class_id: target.id,
			p_student_id: s.id
		});
		expect(enrollError).toBeNull();

		expect((await mine(s.client)).map(([className]) => className)).not.toContain(target.name);
		for (const client of [teacher.client, admin.client]) {
			const { data: queue } = await client.rpc('list_class_join_requests');
			expect(queue?.some((r) => r.request_id === id)).toBe(false);
		}
		// Only 2 pending count now: a third is allowed.
		const fourth = await createClass('Four');
		expect((await request(s.client, fourth.code)).error).toBeNull();

		// Approving it anyway: no error, no second enrolment.
		expect((await decide(admin.client, id, 'approved')).error).toBeNull();
		expect(await enrolled(s.id, target.id)).toEqual([{ enrolled_by: teacher.id }]);
		expect((await requestsOf(s.id)).find((r) => r.id === id)).toMatchObject({
			status: 'approved'
		});
	});

	it('Not allowed: a pending student, a teacher, a parent and the admin are refused (42501)', async () => {
		const home = await createClass('Home');
		const target = await createClass('Target');
		const pendingStudent = await student(home.id, { approve: false });
		const rejectedStudent = await student(home.id, { approve: false });
		const { error: rejectError } = await adminClient
			.from('profiles')
			.update({ status: 'rejected' })
			.eq('id', rejectedStudent.id);
		if (rejectError) throw new Error(`Failed to reject student: ${rejectError.message}`);
		const parent = await createApprovedParent();
		const parentClient = await signIn(parent.email, parent.password);

		for (const client of [
			pendingStudent.client,
			rejectedStudent.client,
			teacher.client,
			parentClient,
			admin.client
		]) {
			const { error } = await request(client, target.code);
			expect(error?.code).toBe('42501');
		}
		const { count } = await adminClient
			.from('class_join_requests')
			.select('id', { count: 'exact', head: true })
			.eq('class_id', target.id);
		expect(count).toBe(0);

		// Signed out: no execute grant at all.
		const anonCall = await request(anonClient(), target.code);
		expect(anonCall.error).not.toBeNull();
	});

	it("Approve: the class's teacher approves; the student is enrolled, gets the open homework and sees the class", async () => {
		const home = await createClass('Home');
		const target = await createClass('Target');
		const { data: assignment, error: assignmentError } = await adminClient
			.from('homework_assignments')
			.insert({
				class_id: target.id,
				title: name('Homework'),
				skill_area: 'song',
				whole_class: true
			})
			.select('id')
			.single();
		if (assignmentError || !assignment)
			throw new Error(`Failed to create homework: ${assignmentError?.message}`);
		const due = `${new Date().getUTCFullYear() + 1}-06-01`;
		const { data: instance, error: instanceError } = await adminClient
			.from('homework_instances')
			.insert({
				assignment_id: assignment.id,
				class_id: target.id,
				period_start: due,
				due_date: due
			})
			.select('id')
			.single();
		if (instanceError || !instance)
			throw new Error(`Failed to create instance: ${instanceError?.message}`);

		const s = await student(home.id);
		expect((await request(s.client, target.code)).error).toBeNull();

		const { data: queue } = await teacher.client.rpc('list_class_join_requests');
		const row = queue?.find((r) => r.student_id === s.id);
		expect(row).toMatchObject({
			class_id: target.id,
			class_name: target.name,
			current_classes: home.name,
			own_child: false
		});
		expect(row?.student_name).toBeTruthy();

		const { error } = await decide(teacher.client, row!.request_id, 'approved');
		expect(error).toBeNull();
		expect(await requestsOf(s.id)).toMatchObject([{ status: 'approved', reviewed_by: teacher.id }]);
		expect(await enrolled(s.id, target.id)).toEqual([{ enrolled_by: teacher.id }]);
		for (const client of [teacher.client, admin.client]) {
			const { data: after } = await client.rpc('list_class_join_requests');
			expect(after?.some((r) => r.request_id === row!.request_id)).toBe(false);
		}

		const { data: history } = await adminClient
			.from('homework_status_history')
			.select('status')
			.eq('instance_id', instance.id)
			.eq('student_id', s.id);
		expect(history).toEqual([{ status: 'assigned' }]);

		// My classes: the student now reads the class; the request is gone from the card.
		const { data: classes } = await s.client.from('classes').select('id').eq('id', target.id);
		expect(classes).toEqual([{ id: target.id }]);
		expect(await mine(s.client)).toEqual([]);
		// Now a class they're in: the same refusal as an unknown code.
		expect((await request(s.client, target.code)).error?.hint).toBe('join_code_invalid');
	});

	it('Reject then retry: Rejected shows until a new request, then Pending', async () => {
		const home = await createClass('Home');
		const target = await createClass('Target');
		const s = await student(home.id);
		expect((await request(s.client, target.code)).error).toBeNull();
		const first = await pendingId(s.id, target.id);

		expect((await decide(admin.client, first, 'rejected')).error).toBeNull();
		expect(await enrolled(s.id, target.id)).toEqual([]);
		for (const client of [teacher.client, admin.client]) {
			const { data: queue } = await client.rpc('list_class_join_requests');
			expect(queue?.some((r) => r.request_id === first)).toBe(false);
		}
		expect(await mine(s.client)).toEqual([[target.name, 'rejected']]);

		expect((await request(s.client, target.code)).error).toBeNull();
		expect(await mine(s.client)).toEqual([[target.name, 'pending']]);
		const rows = await requestsOf(s.id);
		expect(rows.map((r) => r.status)).toEqual(['rejected', 'pending']);
		expect(rows[0].dismissed_at).not.toBeNull();
	});

	it('Dismiss: the student hides their rejected request; nobody else can, and not a pending one', async () => {
		const home = await createClass('Home');
		const target = await createClass('Target');
		const other = await createClass('Other');
		const s = await student(home.id);
		const someoneElse = await student(home.id);
		expect((await request(s.client, target.code)).error).toBeNull();
		expect((await request(s.client, other.code)).error).toBeNull();
		const rejected = await pendingId(s.id, target.id);
		const stillPending = await pendingId(s.id, other.id);
		expect((await decide(teacher.client, rejected, 'rejected')).error).toBeNull();

		const notMine = await someoneElse.client.rpc('dismiss_class_join', {
			p_request_id: rejected
		});
		expect(notMine.error?.code).toBe('42501');
		const pendingOne = await s.client.rpc('dismiss_class_join', { p_request_id: stillPending });
		expect(pendingOne.error?.hint).toBe('join_not_rejected');

		const { error } = await s.client.rpc('dismiss_class_join', { p_request_id: rejected });
		expect(error).toBeNull();
		expect(await mine(s.client)).toEqual([[other.name, 'pending']]);
	});

	it('Own child (has_link_to): a teacher of the class with a pending parents row linked to the student sees own_child and is refused', async () => {
		const pendingDual = await createSignedInUser('teacher');
		const { error: rowError } = await adminClient
			.from('parents')
			.insert({ id: pendingDual.id, status: 'pending' });
		if (rowError) throw new Error(`Failed to add parents row: ${rowError.message}`);
		const home = await createClass('Home');
		const target = await createClass('Target', pendingDual.id);
		const kid = await student(home.id);
		await linkParent(adminClient, kid.id, pendingDual.id);
		expect((await request(kid.client, target.code)).error).toBeNull();
		const id = await pendingId(kid.id, target.id);

		const { data: queue } = await pendingDual.client.rpc('list_class_join_requests');
		expect(queue?.filter((r) => r.student_id === kid.id).map((r) => r.own_child)).toEqual([true]);

		const refused = await decide(pendingDual.client, id, 'approved');
		expect(refused.error?.code).toBe('42501');
		expect(await enrolled(kid.id, target.id)).toEqual([]);
		expect((await requestsOf(kid.id))[0].status).toBe('pending');
	});

	it("Own child: a teacher of the class or an admin who is the student's parent is refused; another admin decides", async () => {
		const dual = await createSignedInUser('teacher');
		const { error: parentError } = await adminClient
			.from('parents')
			.insert({ id: dual.id, status: 'approved' });
		if (parentError) throw new Error(`Failed to make parent: ${parentError.message}`);
		const home = await createClass('Home');
		const target = await createClass('Target', dual.id);
		const kid = await student(home.id, { guardianEmail: dual.email });
		expect((await request(kid.client, target.code)).error).toBeNull();
		const id = await pendingId(kid.id, target.id);

		const { data: queue } = await dual.client.rpc('list_class_join_requests');
		expect(queue?.filter((r) => r.student_id === kid.id).map((r) => r.own_child)).toEqual([true]);

		const refused = await decide(dual.client, id, 'approved');
		expect(refused.error?.code).toBe('42501');
		expect(await enrolled(kid.id, target.id)).toEqual([]);

		// An admin who is the student's parent is refused too (AD-4).
		const dualAdmin = await createSignedInUser('admin');
		const { error: adminParentError } = await adminClient
			.from('parents')
			.insert({ id: dualAdmin.id, status: 'approved' });
		if (adminParentError) throw new Error(`Failed to make parent: ${adminParentError.message}`);
		const adminKid = await student(home.id, { guardianEmail: dualAdmin.email });
		expect((await request(adminKid.client, target.code)).error).toBeNull();
		const adminKidRequest = await pendingId(adminKid.id, target.id);
		const { data: adminQueue } = await dualAdmin.client.rpc('list_class_join_requests');
		expect(adminQueue?.filter((r) => r.student_id === adminKid.id).map((r) => r.own_child)).toEqual(
			[true]
		);
		expect((await decide(dualAdmin.client, adminKidRequest, 'rejected')).error?.code).toBe('42501');
		expect((await requestsOf(adminKid.id))[0].status).toBe('pending');

		// The admin who isn't the parent decides.
		expect((await decide(admin.client, id, 'approved')).error).toBeNull();
		expect(await enrolled(kid.id, target.id)).toEqual([{ enrolled_by: admin.id }]);
	});

	it("Other class's teacher: not listed, can't read the row, and deciding is refused", async () => {
		const outsider = await createSignedInUser('teacher');
		await createClass('Outsider', outsider.id);
		const home = await createClass('Home');
		const target = await createClass('Target');
		const s = await student(home.id);
		expect((await request(s.client, target.code)).error).toBeNull();
		const id = await pendingId(s.id, target.id);

		const { data: queue, error: queueError } = await outsider.client.rpc(
			'list_class_join_requests'
		);
		expect(queueError).toBeNull();
		expect(queue?.some((r) => r.request_id === id)).toBe(false);
		const { data: rows } = await outsider.client
			.from('class_join_requests')
			.select('id')
			.eq('id', id);
		expect(rows).toEqual([]);

		expect((await decide(outsider.client, id, 'approved')).error?.code).toBe('42501');
		expect(await enrolled(s.id, target.id)).toEqual([]);

		// The admin and the class's teacher both list it; students can't list at all.
		const { data: adminQueue } = await admin.client.rpc('list_class_join_requests');
		expect(adminQueue?.some((r) => r.request_id === id)).toBe(true);
		const { data: teacherQueue } = await teacher.client.rpc('list_class_join_requests');
		expect(teacherQueue?.some((r) => r.request_id === id)).toBe(true);
		expect((await s.client.rpc('list_class_join_requests')).error?.code).toBe('42501');
		// Nor decide their own request.
		expect((await decide(s.client, id, 'approved')).error?.code).toBe('42501');
	});

	it('Decided twice: a request that is no longer pending is refused', async () => {
		const home = await createClass('Home');
		const target = await createClass('Target');
		const s = await student(home.id);
		expect((await request(s.client, target.code)).error).toBeNull();
		const id = await pendingId(s.id, target.id);
		expect((await decide(teacher.client, id, 'rejected')).error).toBeNull();

		const again = await decide(admin.client, id, 'approved');
		expect(again.error?.code).toBe('22023');
		expect(again.error?.hint).toBe('join_not_pending');
		expect(await requestsOf(s.id)).toMatchObject([{ status: 'rejected', reviewed_by: teacher.id }]);
		expect(await enrolled(s.id, target.id)).toEqual([]);
	});

	it('Invalid decision: anything but approved / rejected is refused', async () => {
		const home = await createClass('Home');
		const target = await createClass('Target');
		const s = await student(home.id);
		expect((await request(s.client, target.code)).error).toBeNull();
		const id = await pendingId(s.id, target.id);

		const { error } = await teacher.client.rpc('decide_class_join', {
			p_request_id: id,
			p_decision: 'maybe' as 'approved'
		});
		expect(error?.code).toBe('22023');
		expect(error?.hint).toBe('join_decision_invalid');
		expect(await requestsOf(s.id)).toMatchObject([{ status: 'pending' }]);
	});

	it('No longer approved: the request leaves the queue and approving it is refused with a hint', async () => {
		const home = await createClass('Home');
		const target = await createClass('Target');
		const s = await student(home.id);
		expect((await request(s.client, target.code)).error).toBeNull();
		const id = await pendingId(s.id, target.id);
		const { error: rejectError } = await adminClient
			.from('profiles')
			.update({ status: 'rejected' })
			.eq('id', s.id);
		if (rejectError) throw new Error(`Failed to reject student: ${rejectError.message}`);

		const { data: queue } = await admin.client.rpc('list_class_join_requests');
		expect(queue?.some((r) => r.request_id === id)).toBe(false);
		const refused = await decide(admin.client, id, 'approved');
		expect(refused.error?.code).toBe('22023');
		expect(refused.error?.hint).toBe('join_student_not_approved');
		expect(await enrolled(s.id, target.id)).toEqual([]);
	});

	it('Direct writes: clients cannot insert, update or delete requests', async () => {
		const home = await createClass('Home');
		const target = await createClass('Target');
		const s = await student(home.id);

		const inserted = await s.client
			.from('class_join_requests')
			.insert({ student_id: s.id, class_id: target.id });
		expect(inserted.error).not.toBeNull();
		expect(await requestsOf(s.id)).toEqual([]);

		expect((await request(s.client, target.code)).error).toBeNull();
		const id = await pendingId(s.id, target.id);
		for (const client of [s.client, teacher.client, admin.client]) {
			const updated = await client
				.from('class_join_requests')
				.update({ status: 'approved' })
				.eq('id', id);
			expect(updated.error).not.toBeNull();
			const deleted = await client.from('class_join_requests').delete().eq('id', id).select('id');
			expect(deleted.error).not.toBeNull();
			expect(deleted.data).toBeNull();
		}
		expect(await requestsOf(s.id)).toMatchObject([{ id, status: 'pending' }]);
		expect(await enrolled(s.id, target.id)).toEqual([]);
	});
});

describe.skipIf(!reachable)('B14a request parent access (requires local Supabase)', () => {
	type Client = ReturnType<typeof anonClient>;
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let classTeacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let teamId: string;

	const name = (label: string) => `B14a ${label} ${crypto.randomUUID().slice(0, 8)}`;

	async function createClass(label: string, teacherId: string) {
		const code = `P${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
		const { data, error } = await adminClient
			.from('classes')
			.insert({ name: name(label), code })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		await adminClient.from('class_teachers').insert({ class_id: data.id, teacher_id: teacherId });
		return { id: data.id, code };
	}

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	/** A /join student with `guardianEmail`, approved and signed in. */
	async function child(classId: string, guardianEmail?: string) {
		const { id, error } = await signUpStudent({
			classId,
			registrationName: name('Kid'),
			guardianEmail
		});
		if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
		const { error: approveError } = await adminClient
			.from('profiles')
			.update({ status: 'approved', team_id: teamId })
			.eq('id', id);
		if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
		const password = crypto.randomUUID();
		const { data } = await adminClient.auth.admin.updateUserById(id, { password });
		return { id, client: await signIn(data.user!.email!, password) };
	}

	const request = (client: Client) => client.rpc('request_parent_access');

	async function parentRow(id: string) {
		const { data } = await adminClient.from('parents').select('status').eq('id', id);
		return data ?? [];
	}

	/** The admin decides the request the way /requests does (RLS path). */
	async function decideAs(client: Client, id: string, status: 'approved' | 'rejected') {
		const { error } = await client
			.from('parents')
			.update({ status })
			.eq('id', id)
			.eq('status', 'pending')
			.select('id')
			.single();
		return error;
	}

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		classTeacher = await createSignedInUser('teacher');
		const { data: team, error: teamError } = await adminClient
			.from('teams')
			.insert({ name: name('Team') })
			.select('id')
			.single();
		if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
		teamId = team.id;
	}, 30000);

	it('Request: a teacher creates their own pending row; a duplicate is refused; the admin approves it', async () => {
		const teacher = await createSignedInUser('teacher');
		expect((await teacher.client.rpc('is_parent')).data).toBe(false);

		const { data, error } = await request(teacher.client);
		expect(error).toBeNull();
		expect(data).toBe('pending');
		expect(await parentRow(teacher.id)).toEqual([{ status: 'pending' }]);
		const { data: own } = await teacher.client.from('parents').select('status');
		expect(own).toEqual([{ status: 'pending' }]);
		// Pending grants nothing yet.
		expect((await teacher.client.rpc('is_parent')).data).toBe(false);

		const again = await request(teacher.client);
		expect(again.error?.code).toBe('22023');
		expect(again.error?.hint).toBe('already_pending');

		// The admin's queue lists it.
		const { data: queue } = await admin.client
			.from('parents')
			.select('id')
			.eq('status', 'pending')
			.eq('id', teacher.id);
		expect(queue).toEqual([{ id: teacher.id }]);

		expect(await decideAs(admin.client, teacher.id, 'approved')).toBeNull();
		expect((await teacher.client.rpc('is_parent')).data).toBe(true);
		const approved = await request(teacher.client);
		expect(approved.error?.hint).toBe('already_parent');
		// Still a teacher.
		const { data: profile } = await teacher.client
			.from('profiles')
			.select('role')
			.eq('id', teacher.id)
			.single();
		expect(profile).toEqual({ role: 'teacher' });
	});

	it("Link: a /join child with the approved staff member's email links to them", async () => {
		const teacher = await createSignedInUser('teacher');
		const home = await createClass('Home', classTeacher.id);

		// Before approval the guardian email matches no approved parent.
		expect((await request(teacher.client)).error).toBeNull();
		const early = await signUpStudent({
			classId: home.id,
			registrationName: name('Early'),
			guardianEmail: teacher.email
		});
		expect(early.error).not.toBeNull();

		expect(await decideAs(admin.client, teacher.id, 'approved')).toBeNull();
		const kid = await child(home.id, teacher.email);
		const { data: link } = await adminClient
			.from('profiles')
			.select('registered_by_parent_id')
			.eq('id', kid.id)
			.single();
		expect(link).toEqual({ registered_by_parent_id: teacher.id });
		expect((await teacher.client.rpc('is_parent_of', { p_student_id: kid.id })).data).toBe(true);
	});

	it("Admin's own: the admin requests and approves their own row", async () => {
		const dualAdmin = await createSignedInUser('admin');
		expect((await request(dualAdmin.client)).data).toBe('pending');
		const { data: queue } = await dualAdmin.client
			.from('parents')
			.select('id')
			.eq('status', 'pending')
			.eq('id', dualAdmin.id);
		expect(queue).toEqual([{ id: dualAdmin.id }]);
		expect(await decideAs(dualAdmin.client, dualAdmin.id, 'approved')).toBeNull();
		expect((await dualAdmin.client.rpc('is_parent')).data).toBe(true);
	});

	it('Reject: the row stays rejected, the login keeps working, and a re-request is refused', async () => {
		const teacher = await createSignedInUser('teacher');
		expect((await request(teacher.client)).error).toBeNull();
		expect(await decideAs(admin.client, teacher.id, 'rejected')).toBeNull();
		expect(await parentRow(teacher.id)).toEqual([{ status: 'rejected' }]);

		const again = await request(teacher.client);
		expect(again.error?.code).toBe('22023');
		expect(again.error?.hint).toBe('rejected');
		expect(await parentRow(teacher.id)).toEqual([{ status: 'rejected' }]);
		expect((await teacher.client.rpc('is_parent')).data).toBe(false);
		const { data: profile } = await teacher.client
			.from('profiles')
			.select('role')
			.eq('id', teacher.id)
			.single();
		expect(profile).toEqual({ role: 'teacher' });
	});

	it('Self-approve: a teacher cannot approve their own pending row', async () => {
		const teacher = await createSignedInUser('teacher');
		expect((await request(teacher.client)).error).toBeNull();
		await teacher.client.from('parents').update({ status: 'approved' }).eq('id', teacher.id);
		expect(await parentRow(teacher.id)).toEqual([{ status: 'pending' }]);
		expect((await teacher.client.rpc('is_parent')).data).toBe(false);
	});

	it('Not staff: a parent-only login, a student and anon are refused', async () => {
		const parent = await createApprovedParent();
		const parentClient = await signIn(parent.email, parent.password);
		const home = await createClass('Home', classTeacher.id);
		const kid = await child(home.id);
		for (const client of [parentClient, kid.client]) {
			const { error } = await request(client);
			expect(error?.code).toBe('42501');
		}
		const { error: anonError } = await request(anonClient());
		expect(anonError).not.toBeNull();
		expect(await parentRow(kid.id)).toEqual([]);
		expect(await parentRow(parent.id)).toEqual([{ status: 'approved' }]);
	});

	it('Direct insert: a client cannot insert or delete a parents row', async () => {
		const teacher = await createSignedInUser('teacher');
		const { error } = await teacher.client
			.from('parents')
			.insert({ id: teacher.id, status: 'approved' })
			.select('id');
		expect(error).not.toBeNull();
		expect(await parentRow(teacher.id)).toEqual([]);

		expect((await request(teacher.client)).error).toBeNull();
		await teacher.client.from('parents').delete().eq('id', teacher.id);
		expect(await parentRow(teacher.id)).toEqual([{ status: 'pending' }]);
	});

	it("Own child (B12): a teacher made a parent via the RPC can't decide their child's join request", async () => {
		const teacher = await createSignedInUser('teacher');
		expect((await request(teacher.client)).error).toBeNull();
		expect(await decideAs(admin.client, teacher.id, 'approved')).toBeNull();

		const home = await createClass('Home', classTeacher.id);
		const target = await createClass('Target', teacher.id);
		const kid = await child(home.id, teacher.email);
		expect((await kid.client.rpc('request_class_join', { p_code: target.code })).error).toBeNull();
		const { data: rows } = await adminClient
			.from('class_join_requests')
			.select('id')
			.eq('student_id', kid.id)
			.eq('class_id', target.id)
			.eq('status', 'pending');
		const requestId = rows![0].id;

		const { data: queue } = await teacher.client.rpc('list_class_join_requests');
		expect(queue?.filter((r) => r.student_id === kid.id).map((r) => r.own_child)).toEqual([true]);
		const refused = await teacher.client.rpc('decide_class_join', {
			p_request_id: requestId,
			p_decision: 'approved'
		});
		expect(refused.error?.code).toBe('42501');
	});
});

describe.skipIf(!reachable)(
	'B14b promote a parent-only login to teacher (requires local Supabase)',
	() => {
		type Client = ReturnType<typeof anonClient>;
		let admin: Awaited<ReturnType<typeof createSignedInUser>>;
		let classTeacher: Awaited<ReturnType<typeof createSignedInUser>>;
		let teamId: string;

		const name = (label: string) => `B14b ${label} ${crypto.randomUUID().slice(0, 8)}`;

		async function createClass(label: string) {
			const code = `Q${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
			const { data, error } = await adminClient
				.from('classes')
				.insert({ name: name(label), code })
				.select('id')
				.single();
			if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
			await adminClient
				.from('class_teachers')
				.insert({ class_id: data.id, teacher_id: classTeacher.id });
			return data.id;
		}

		async function signIn(email: string, password: string) {
			const client = anonClient();
			const { error } = await client.auth.signInWithPassword({ email, password });
			if (error) throw new Error(`Failed to sign in: ${error.message}`);
			return client;
		}

		/** A /join student with `guardianEmail`, approved and signed in. */
		async function child(classId: string, guardianEmail?: string) {
			const { id, error } = await signUpStudent({
				classId,
				registrationName: name('Kid'),
				guardianEmail
			});
			if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
			const { error: approveError } = await adminClient
				.from('profiles')
				.update({ status: 'approved', team_id: teamId })
				.eq('id', id);
			if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
			const password = crypto.randomUUID();
			const { data } = await adminClient.auth.admin.updateUserById(id, { password });
			return { id, client: await signIn(data.user!.email!, password) };
		}

		/** A parent-only login whose parents row stays pending. */
		async function createPendingParent() {
			const email = `b14b-pending-${crypto.randomUUID()}@example.test`;
			const { data, error } = await adminClient.auth.admin.createUser({
				email,
				password: crypto.randomUUID(),
				email_confirm: true,
				app_metadata: { role: 'parent' }
			});
			if (error || !data.user) throw new Error(`Failed to create parent: ${error?.message}`);
			return { id: data.user.id, email };
		}

		const promote = (client: Client, id: string) =>
			client.rpc('promote_parent_to_teacher', { p_user_id: id });

		async function roleOf(id: string) {
			const { data } = await adminClient.from('profiles').select('role').eq('id', id).single();
			return data?.role;
		}

		async function parentRow(id: string) {
			const { data } = await adminClient.from('parents').select('status').eq('id', id);
			return data ?? [];
		}

		beforeAll(async () => {
			admin = await createSignedInUser('admin');
			classTeacher = await createSignedInUser('teacher');
			const { data: team, error: teamError } = await adminClient
				.from('teams')
				.insert({ name: name('Team') })
				.select('id')
				.single();
			if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
			teamId = team.id;
		}, 30000);

		it('Promote: the admin makes an approved parent a teacher; parents row and child link stay; classes can be assigned', async () => {
			const parent = await createApprovedParent();
			const home = await createClass('Home');
			const kid = await child(home, parent.email);

			const { data, error } = await promote(admin.client, parent.id);
			expect(error).toBeNull();
			expect(data).toBe(parent.id);
			expect(await roleOf(parent.id)).toBe('teacher');
			expect(await parentRow(parent.id)).toEqual([{ status: 'approved' }]);
			const { data: link } = await adminClient
				.from('profiles')
				.select('registered_by_parent_id')
				.eq('id', kid.id)
				.single();
			expect(link).toEqual({ registered_by_parent_id: parent.id });

			// The same password still signs in; the login is a teacher and a parent.
			const promoted = await signIn(parent.email, parent.password);
			expect((await promoted.rpc('is_parent')).data).toBe(true);
			expect((await promoted.rpc('is_parent_of', { p_student_id: kid.id })).data).toBe(true);

			// The admin assigns a class through RLS, as /admin/teachers does.
			const taught = await createClass('Taught');
			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: taught, teacher_id: parent.id });
			expect(assignError).toBeNull();
			expect((await promoted.rpc('is_teacher_of_class', { target_class_id: taught })).data).toBe(
				true
			);

			// Twice: no longer parent-only.
			const again = await promote(admin.client, parent.id);
			expect(again.error?.code).toBe('22023');
			expect(again.error?.hint).toBe('not_parent_only');
			expect(await roleOf(parent.id)).toBe('teacher');
		});

		it('Pending: a pending parent sign-up is refused and stays a parent', async () => {
			const parent = await createPendingParent();
			const { error } = await promote(admin.client, parent.id);
			expect(error?.code).toBe('22023');
			expect(error?.hint).toBe('parent_not_approved');
			expect(await roleOf(parent.id)).toBe('parent');
			expect(await parentRow(parent.id)).toEqual([{ status: 'pending' }]);
		});

		it('Not parent-only: teacher, student and admin targets are refused', async () => {
			const teacher = await createSignedInUser('teacher');
			const otherAdmin = await createSignedInUser('admin');
			const home = await createClass('Home');
			const kid = await child(home);
			for (const [id, role] of [
				[teacher.id, 'teacher'],
				[otherAdmin.id, 'admin'],
				[kid.id, 'student'],
				[crypto.randomUUID(), undefined]
			] as const) {
				const { error } = await promote(admin.client, id);
				expect(error?.code).toBe('22023');
				expect(error?.hint).toBe('not_parent_only');
				if (role) expect(await roleOf(id)).toBe(role);
			}
		});

		it('Not admin: a teacher, the parent itself, a student and anon are refused', async () => {
			const parent = await createApprovedParent();
			const parentClient = await signIn(parent.email, parent.password);
			const teacher = await createSignedInUser('teacher');
			const home = await createClass('Home');
			const kid = await child(home, parent.email);
			for (const client of [teacher.client, parentClient, kid.client]) {
				const { error } = await promote(client, parent.id);
				expect(error?.code).toBe('42501');
			}
			const { error: anonError } = await promote(anonClient(), parent.id);
			expect(anonError).not.toBeNull();
			expect(await roleOf(parent.id)).toBe('parent');
		});

		it('Guard: a client still cannot change a role directly (42501)', async () => {
			// A pending student is a row the admin may update (registration
			// review policy), so the role change reaches the guard trigger.
			const home = await createClass('Home');
			const { id: pendingId, error: signUpError } = await signUpStudent({
				classId: home,
				registrationName: name('Pending')
			});
			if (signUpError || !pendingId) throw new Error(`sign up: ${signUpError?.message}`);
			const refused = await admin.client
				.from('profiles')
				.update({ role: 'teacher' })
				.eq('id', pendingId)
				.select('id');
			expect(refused.error?.code).toBe('42501');
			expect(await roleOf(pendingId)).toBe('student');

			// A parent updating its own row: no policy matches, nothing changes.
			const parent = await createApprovedParent();
			const parentClient = await signIn(parent.email, parent.password);
			await parentClient.from('profiles').update({ role: 'teacher' }).eq('id', parent.id);
			expect(await roleOf(parent.id)).toBe('parent');
		});

		const demote = (client: Client, id: string) =>
			client.rpc('demote_teacher_to_parent', { p_user_id: id });

		async function classTeacherRows(id: string) {
			const { data } = await adminClient
				.from('class_teachers')
				.select('class_id')
				.eq('teacher_id', id);
			return data ?? [];
		}

		/** An approved parent with a linked child, promoted and teaching one class. */
		async function dualRoleTeacher() {
			const parent = await createApprovedParent();
			const home = await createClass('Home');
			const kid = await child(home, parent.email);
			const { error } = await promote(admin.client, parent.id);
			if (error) throw new Error(`promote: ${error.message}`);
			const taught = await createClass('Taught');
			const { error: assignError } = await admin.client
				.from('class_teachers')
				.insert({ class_id: taught, teacher_id: parent.id });
			if (assignError) throw new Error(`assign: ${assignError.message}`);
			return { ...parent, kid, taught };
		}

		it('Demote: the admin makes a dual-role teacher parent-only; classes go, child link stays', async () => {
			const dual = await dualRoleTeacher();
			expect(await classTeacherRows(dual.id)).toHaveLength(1);

			const { data, error } = await demote(admin.client, dual.id);
			expect(error).toBeNull();
			expect(data).toBe(dual.id);
			expect(await roleOf(dual.id)).toBe('parent');
			expect(await classTeacherRows(dual.id)).toEqual([]);
			expect(await parentRow(dual.id)).toEqual([{ status: 'approved' }]);

			// Same password; still the parent of the child, no longer a teacher.
			const client = await signIn(dual.email, dual.password);
			expect((await client.rpc('is_parent_of', { p_student_id: dual.kid.id })).data).toBe(true);
			expect((await client.rpc('is_teacher_of_class', { target_class_id: dual.taught })).data).toBe(
				false
			);

			// Twice: no longer a teacher.
			const again = await demote(admin.client, dual.id);
			expect(again.error?.code).toBe('22023');
			expect(again.error?.hint).toBe('not_teacher');
		});

		it('Demote not admin: a teacher, the dual-role teacher itself, a student and anon are refused', async () => {
			const dual = await dualRoleTeacher();
			const self = await signIn(dual.email, dual.password);
			const teacher = await createSignedInUser('teacher');
			for (const client of [teacher.client, self, dual.kid.client]) {
				const { error } = await demote(client, dual.id);
				expect(error?.code).toBe('42501');
			}
			const { error: anonError } = await demote(anonClient(), dual.id);
			expect(anonError).not.toBeNull();
			expect(await roleOf(dual.id)).toBe('teacher');
			expect(await classTeacherRows(dual.id)).toHaveLength(1);
		});

		it('Demote refused: a teacher without an approved parents row, and admin targets', async () => {
			const teacher = await createSignedInUser('teacher');
			const plain = await demote(admin.client, teacher.id);
			expect(plain.error?.code).toBe('22023');
			expect(plain.error?.hint).toBe('parent_not_approved');
			expect(await roleOf(teacher.id)).toBe('teacher');

			const otherAdmin = await createSignedInUser('admin');
			for (const id of [otherAdmin.id, admin.id]) {
				const { error } = await demote(admin.client, id);
				expect(error?.code).toBe('22023');
				expect(error?.hint).toBe('not_teacher');
				expect(await roleOf(id)).toBe('admin');
			}
		});
	}
);

describe.skipIf(!reachable)('#76 localized class and team names (requires local Supabase)', () => {
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	const tag = crypto.randomUUID().slice(0, 8);
	const name = (label: string) => `76 ${label} ${tag}`;
	const code = () => `L${crypto.randomUUID().slice(0, 5).toUpperCase()}`;

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacher = await createSignedInUser('teacher');
	}, 30000);

	it('a class has a name per language, each unique on its own (case and spaces ignored)', async () => {
		const first = await admin.client
			.from('classes')
			.insert({
				name: name('Grammar'),
				name_bo: name('བརྡ་སྤྲོད།'),
				name_de: name('Grammatik'),
				code: code()
			})
			.select('name, name_bo, name_de')
			.single();
		expect(first.error).toBeNull();
		expect(first.data).toEqual({
			name: name('Grammar'),
			name_bo: name('བརྡ་སྤྲོད།'),
			name_de: name('Grammatik')
		});

		const sameTibetan = await admin.client
			.from('classes')
			.insert({ name: name('Other'), name_bo: ` ${name('བརྡ་སྤྲོད།')} `, code: code() });
		expect(sameTibetan.error?.code).toBe('23505');
		expect(sameTibetan.error?.message).toContain('classes_name_bo_unique_idx');

		const sameGerman = await admin.client
			.from('classes')
			.insert({ name: name('Other'), name_de: name('grammatik').toUpperCase(), code: code() });
		expect(sameGerman.error?.code).toBe('23505');
		expect(sameGerman.error?.message).toContain('classes_name_de_unique_idx');
	});

	it('classes without a Tibetan or German name do not collide; a blank one is refused', async () => {
		for (const label of ['Plain A', 'Plain B']) {
			const { error } = await admin.client
				.from('classes')
				.insert({ name: name(label), code: code() });
			expect(error).toBeNull();
		}
		const blank = await admin.client
			.from('classes')
			.insert({ name: name('Blank'), name_bo: '  ', code: code() });
		expect(blank.error?.code).toBe('23514');
	});

	it('only the admin renames a team; team names are unique per language too', async () => {
		const { data: team, error } = await admin.client
			.from('teams')
			.insert({ name: name('Yaks'), name_bo: name('གཡག') })
			.select('id')
			.single();
		expect(error).toBeNull();

		// RLS (teams_update_admin): a teacher's update changes no row.
		const byTeacher = await teacher.client
			.from('teams')
			.update({ name_de: name('Yaks DE') })
			.eq('id', team!.id)
			.select('id');
		expect(byTeacher.data ?? []).toEqual([]);

		const byAdmin = await admin.client
			.from('teams')
			.update({ name_de: name('Yaks DE') })
			.eq('id', team!.id)
			.select('name, name_bo, name_de');
		expect(byAdmin.error).toBeNull();
		expect(byAdmin.data).toEqual([
			{ name: name('Yaks'), name_bo: name('གཡག'), name_de: name('Yaks DE') }
		]);

		const duplicate = await admin.client
			.from('teams')
			.insert({ name: name('Other team'), name_bo: name('གཡག') });
		expect(duplicate.error?.code).toBe('23505');
		expect(duplicate.error?.message).toContain('teams_name_bo_unique_idx');
	});

	it('validate_class_code and team_leaderboard return the names in every language', async () => {
		const classCode = code();
		const { error } = await admin.client
			.from('classes')
			.insert({ name: name('Songs'), name_bo: name('གླུ'), code: classCode });
		expect(error).toBeNull();

		// The join wizard looks a class up before the visitor has a session.
		const lookup = await anonClient().rpc('validate_class_code', { p_code: classCode });
		expect(lookup.error).toBeNull();
		expect(lookup.data).toEqual([
			{ id: expect.any(String), name: name('Songs'), name_bo: name('གླུ'), name_de: null }
		]);

		const { data: team } = await admin.client
			.from('teams')
			.insert({ name: name('Snow Lions'), name_bo: name('གངས་སེང') })
			.select('id')
			.single();
		const board = await admin.client.rpc('team_leaderboard');
		expect(board.error).toBeNull();
		expect((board.data ?? []).find((row) => row.team_id === team!.id)).toEqual({
			team_id: team!.id,
			team_name: name('Snow Lions'),
			team_name_bo: name('གངས་སེང'),
			team_name_de: null,
			total_streak: 0
		});
	});
});

/**
 * #92: homework push notifications (migration 0037). Subscriptions are
 * written as the real caller; homework fixtures and the targets function
 * use the service role, as the app's sender does. The database holds other
 * tests' homework too, so every targets assertion looks only at this
 * block's own instances.
 */
describe.skipIf(!reachable)('#92 push notifications (requires local Supabase)', () => {
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let classId: string;
	let teamId: string;

	const today = todayInBerlin();
	const addDays = (isoDate: string, days: number) => {
		const date = new Date(`${isoDate}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() + days);
		return date.toISOString().slice(0, 10);
	};
	const name = (label: string) => `92 ${label} ${crypto.randomUUID().slice(0, 8)}`;
	const endpoint = () => `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;

	beforeAll(async () => {
		teacher = await createSignedInUser('teacher');
		const { data: cls, error } = await adminClient
			.from('classes')
			.insert({
				name: name('Class'),
				name_de: name('Klasse'),
				code: `N${crypto.randomUUID().slice(0, 5).toUpperCase()}`
			})
			.select('id')
			.single();
		if (error || !cls) throw new Error(`Failed to create class: ${error?.message}`);
		classId = cls.id;
		await adminClient.from('class_teachers').insert({ class_id: classId, teacher_id: teacher.id });

		const { data: team, error: teamError } = await adminClient
			.from('teams')
			.insert({ name: name('Team') })
			.select('id')
			.single();
		if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
		teamId = team.id;
	}, 30000);

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	/** An approved (and so enrolled) child of `parentEmail`. */
	async function child(parentEmail: string) {
		const { id, error } = await signUpStudent({
			classId,
			registrationName: name('Kid'),
			guardianEmail: parentEmail
		});
		if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
		const { error: approveError } = await adminClient
			.from('profiles')
			.update({ status: 'approved', team_id: teamId, display_name: name('Kid') })
			.eq('id', id);
		if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
		return id;
	}

	async function signInStudent(id: string) {
		const password = crypto.randomUUID();
		const { data } = await adminClient.auth.admin.updateUserById(id, { password });
		return signIn(data.user!.email!, password);
	}

	/** A parent and one child, each signed in. */
	async function family() {
		const parent = await createApprovedParent();
		const studentId = await child(parent.email);
		return {
			parentId: parent.id,
			studentId,
			parentClient: await signIn(parent.email, parent.password),
			studentClient: await signInStudent(studentId)
		};
	}

	function subscribe(client: ReturnType<typeof anonClient>, url = endpoint(), locale = 'en') {
		return client.rpc('save_push_subscription', {
			p_endpoint: url,
			p_p256dh: 'B'.repeat(87),
			p_auth: 'a'.repeat(22),
			p_locale: locale
		});
	}

	async function setStatus(instanceId: string, studentIds: string[], status: 'assigned' | 'done') {
		const { error } = await adminClient.from('homework_status_history').insert(
			studentIds.map((student_id) => ({
				instance_id: instanceId,
				class_id: classId,
				student_id,
				status,
				recorded_by: teacher.id
			}))
		);
		if (error) throw new Error(`Failed to set homework status: ${error.message}`);
	}

	/** One homework instance due on `dueDate`, assigned to `targets`. */
	async function homework(dueDate: string, targets: string[], archived = false) {
		const title = name('Homework');
		const { data: assignment, error: assignmentError } = await adminClient
			.from('homework_assignments')
			.insert({ class_id: classId, title, skill_area: 'language', created_by: teacher.id })
			.select('id')
			.single();
		if (assignmentError || !assignment)
			throw new Error(`Failed to create assignment: ${assignmentError?.message}`);
		const { data: instance, error: instanceError } = await adminClient
			.from('homework_instances')
			.insert({
				assignment_id: assignment.id,
				class_id: classId,
				period_start: dueDate,
				due_date: dueDate,
				...(archived ? { archived_at: new Date().toISOString() } : {})
			})
			.select('id')
			.single();
		if (instanceError || !instance)
			throw new Error(`Failed to create instance: ${instanceError?.message}`);
		await setStatus(instance.id, targets, 'assigned');
		return { id: instance.id, title };
	}

	/** The targets of `kind` among `instanceIds`, as [instance, student, recipient]. */
	async function targets(kind: string, instanceIds: string[], instanceId?: string) {
		const { data, error } = await adminClient.rpc('homework_push_targets', {
			p_kind: kind,
			p_instance_id: instanceId
		});
		if (error) throw new Error(`homework_push_targets failed: ${error.message}`);
		return (data ?? [])
			.filter((row) => instanceIds.includes(row.instance_id))
			.map((row) => [row.instance_id, row.student_id, row.recipient_id].join(' '))
			.sort();
	}
	const row = (...ids: string[]) => ids.join(' ');

	it('a student and an approved parent can save a subscription; a teacher and a signed-out visitor cannot', async () => {
		const { parentId, studentId, parentClient, studentClient } = await family();
		const studentUrl = endpoint();
		const parentUrl = endpoint();

		expect((await subscribe(studentClient, studentUrl, 'bo')).error).toBeNull();
		expect((await subscribe(parentClient, parentUrl, 'de')).error).toBeNull();
		expect((await subscribe(teacher.client)).error?.code).toBe('42501');
		expect((await subscribe(anonClient())).error).not.toBeNull();

		const { data: rows } = await adminClient
			.from('push_subscriptions')
			.select('profile_id, endpoint, locale')
			.in('endpoint', [studentUrl, parentUrl]);
		expect((rows ?? []).sort((a, b) => a.locale.localeCompare(b.locale))).toEqual([
			{ profile_id: studentId, endpoint: studentUrl, locale: 'bo' },
			{ profile_id: parentId, endpoint: parentUrl, locale: 'de' }
		]);
	});

	it('refuses an endpoint that is not https and a language the app does not have', async () => {
		const { studentClient } = await family();
		expect((await subscribe(studentClient, 'http://fcm.googleapis.com/x')).error?.code).toBe(
			'23514'
		);
		expect((await subscribe(studentClient, endpoint(), 'fr')).error?.code).toBe('23514');
	});

	it('an endpoint saved again moves to the caller: a shared phone follows who is signed in', async () => {
		const { parentId, studentId, parentClient, studentClient } = await family();
		const shared = endpoint();
		const owner = async () =>
			(await adminClient.from('push_subscriptions').select('profile_id').eq('endpoint', shared))
				.data;

		expect((await subscribe(parentClient, shared)).error).toBeNull();
		expect(await owner()).toEqual([{ profile_id: parentId }]);
		expect((await subscribe(studentClient, shared)).error).toBeNull();
		expect(await owner()).toEqual([{ profile_id: studentId }]);
	});

	it("delete removes the caller's own subscription and leaves another account's alone", async () => {
		const { parentClient, studentClient } = await family();
		const url = endpoint();
		await subscribe(studentClient, url);
		const count = async () =>
			(await adminClient.from('push_subscriptions').select('id').eq('endpoint', url)).data?.length;

		expect(
			(await parentClient.rpc('delete_push_subscription', { p_endpoint: url })).error
		).toBeNull();
		expect(await count()).toBe(1);
		expect(
			(await studentClient.rpc('delete_push_subscription', { p_endpoint: url })).error
		).toBeNull();
		expect(await count()).toBe(0);
	});

	it('no signed-in user can read the tables or call the sender functions', async () => {
		const { studentClient, parentClient } = await family();
		await subscribe(studentClient);

		for (const client of [studentClient, parentClient, teacher.client]) {
			const subscriptions = await client.from('push_subscriptions').select('id');
			expect(subscriptions.data ?? []).toEqual([]);
			expect(subscriptions.error).not.toBeNull();
			const log = await client.from('push_notification_log').select('kind');
			expect(log.data ?? []).toEqual([]);
			expect(log.error).not.toBeNull();
			expect(
				(await client.rpc('homework_push_targets', { p_kind: 'due_soon' })).error
			).not.toBeNull();
			expect((await client.rpc('trigger_homework_push', {})).error).not.toBeNull();
		}
	});

	it('added: the students of that homework and their parents, only those with a subscription', async () => {
		const a = await family();
		const b = await family();
		await subscribe(a.studentClient);
		await subscribe(a.parentClient);
		// Family B: only the parent has a subscription.
		await subscribe(b.parentClient);
		const hw = await homework(addDays(today, 3), [a.studentId, b.studentId]);
		const other = await homework(addDays(today, 3), [a.studentId]);

		expect(await targets('added', [hw.id, other.id], hw.id)).toEqual(
			[
				row(hw.id, a.studentId, a.studentId),
				row(hw.id, a.studentId, a.parentId),
				row(hw.id, b.studentId, b.parentId)
			].sort()
		);
		// Without an instance there is nothing to announce.
		expect(await targets('added', [hw.id, other.id])).toEqual([]);
	});

	it('spec-second-parent: every actively linked parent gets the notice; a removed link does not', async () => {
		const a = await family();
		const second = await createApprovedParent();
		await linkParent(adminClient, a.studentId, second.id);
		const secondClient = await signIn(second.email, second.password);
		await subscribe(a.parentClient);
		await subscribe(secondClient);
		const hw = await homework(addDays(today, 3), [a.studentId]);

		expect(await targets('added', [hw.id], hw.id)).toEqual(
			[row(hw.id, a.studentId, a.parentId), row(hw.id, a.studentId, second.id)].sort()
		);

		const { error } = await adminClient
			.from('student_parents')
			.update({ removed_at: new Date().toISOString(), removed_by: teacher.id })
			.eq('student_id', a.studentId)
			.eq('parent_id', second.id);
		expect(error).toBeNull();
		expect(await targets('added', [hw.id], hw.id)).toEqual([row(hw.id, a.studentId, a.parentId)]);
	});

	it('added: the row carries what the notice shows', async () => {
		const a = await family();
		await subscribe(a.studentClient);
		const hw = await homework(addDays(today, 2), [a.studentId]);

		const { data } = await adminClient.rpc('homework_push_targets', {
			p_kind: 'added',
			p_instance_id: hw.id
		});
		expect(data).toEqual([
			{
				recipient_id: a.studentId,
				student_id: a.studentId,
				student_name: expect.stringContaining('92 Kid'),
				instance_id: hw.id,
				title: hw.title,
				class_name: expect.stringContaining('92 Class'),
				class_name_bo: null,
				class_name_de: expect.stringContaining('92 Klasse'),
				due_date: addDays(today, 2)
			}
		]);
	});

	it('due soon: open homework due from today to today + 6, to the student and the parent', async () => {
		const a = await family();
		await subscribe(a.studentClient);
		await subscribe(a.parentClient);
		const dueToday = await homework(today, [a.studentId]);
		const dueLast = await homework(addDays(today, 6), [a.studentId]);
		const tooLate = await homework(addDays(today, 7), [a.studentId]);
		const overdue = await homework(addDays(today, -1), [a.studentId]);
		const done = await homework(addDays(today, 2), [a.studentId]);
		await setStatus(done.id, [a.studentId], 'done');
		const archived = await homework(addDays(today, 2), [a.studentId], true);
		const all = [dueToday, dueLast, tooLate, overdue, done, archived].map((hw) => hw.id);

		expect(await targets('due_soon', all)).toEqual(
			[
				row(dueToday.id, a.studentId, a.studentId),
				row(dueToday.id, a.studentId, a.parentId),
				row(dueLast.id, a.studentId, a.studentId),
				row(dueLast.id, a.studentId, a.parentId)
			].sort()
		);
	});

	it('overdue: open homework due in the last 7 days, to the parent only', async () => {
		const a = await family();
		await subscribe(a.studentClient);
		await subscribe(a.parentClient);
		const yesterday = await homework(addDays(today, -1), [a.studentId]);
		const weekAgo = await homework(addDays(today, -7), [a.studentId]);
		const tooOld = await homework(addDays(today, -8), [a.studentId]);
		const dueToday = await homework(today, [a.studentId]);
		const done = await homework(addDays(today, -2), [a.studentId]);
		await setStatus(done.id, [a.studentId], 'done');
		const all = [yesterday, weekAgo, tooOld, dueToday, done].map((hw) => hw.id);

		expect(await targets('overdue', all)).toEqual(
			[row(yesterday.id, a.studentId, a.parentId), row(weekAgo.id, a.studentId, a.parentId)].sort()
		);
	});

	it('a student who left the class is owed nothing', async () => {
		const a = await family();
		await subscribe(a.studentClient);
		await subscribe(a.parentClient);
		const hw = await homework(addDays(today, 1), [a.studentId]);
		expect(await targets('due_soon', [hw.id])).toHaveLength(2);

		const { error } = await adminClient
			.from('class_enrollments')
			.delete()
			.eq('student_id', a.studentId)
			.eq('class_id', classId);
		expect(error).toBeNull();
		expect(await targets('due_soon', [hw.id])).toEqual([]);
	});

	it('a logged notice is not owed again, per kind and recipient', async () => {
		const a = await family();
		await subscribe(a.studentClient);
		await subscribe(a.parentClient);
		const hw = await homework(addDays(today, 1), [a.studentId]);

		const { error } = await adminClient.from('push_notification_log').insert({
			kind: 'due_soon',
			instance_id: hw.id,
			student_id: a.studentId,
			recipient_id: a.studentId
		});
		expect(error).toBeNull();

		// The parent is still owed Due soon, and "added" is a different notice.
		expect(await targets('due_soon', [hw.id])).toEqual([row(hw.id, a.studentId, a.parentId)]);
		expect(await targets('added', [hw.id], hw.id)).toHaveLength(2);
	});

	it('an unknown kind is owed to nobody', async () => {
		const a = await family();
		await subscribe(a.studentClient);
		const hw = await homework(addDays(today, 1), [a.studentId]);
		expect(await targets('weekly', [hw.id], hw.id)).toEqual([]);
	});

	it('the job function runs for the service role', async () => {
		// Without the Vault secrets (the default here) it sends nothing and
		// returns NULL; with them it returns the request id.
		const { error } = await adminClient.rpc('trigger_homework_push', {});
		expect(error).toBeNull();
	});
});

describe.skipIf(!reachable)('0038 syllabus sections (requires local Supabase)', () => {
	type SignedIn = Awaited<ReturnType<typeof createSignedInUser>>;
	let admin: SignedIn;
	let teacher: SignedIn;
	let otherTeacher: SignedIn;
	let enrolled: ReturnType<typeof anonClient>;
	let outsider: ReturnType<typeof anonClient>;
	let classId: string;
	let otherClassId: string;
	let syllabusId: string;
	let otherSyllabusId: string;

	const name = (label: string) => `0038 ${label} ${crypto.randomUUID().slice(0, 8)}`;
	const body = { type: 'doc', content: [{ type: 'paragraph' }] };

	async function makeClass(label: string, teacherId: string) {
		const { data, error } = await adminClient
			.from('classes')
			.insert({ name: name(label), code: `S${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		const { error: assignError } = await adminClient
			.from('class_teachers')
			.insert({ class_id: data.id, teacher_id: teacherId });
		if (assignError) throw new Error(`Failed to assign teacher: ${assignError.message}`);
		return data.id;
	}

	/** A syllabus row as the service role makes it; `school_year` only has to be free. */
	async function makeSyllabus(
		forClass: string,
		schoolYear: number,
		own: { content_doc?: unknown; content_language?: string; links?: unknown[] } = {}
	) {
		const { data, error } = await adminClient
			.from('class_syllabi')
			.insert({
				class_id: forClass,
				school_year: schoolYear,
				...(own as Record<string, never>)
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create syllabus: ${error?.message}`);
		return data.id;
	}

	/** An approved student enrolled in `forClass`, signed in. */
	async function student(forClass: string) {
		const email = `0038-student-${crypto.randomUUID()}@students.internal.invalid`;
		const password = crypto.randomUUID();
		const { data, error } = await adminClient.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
			app_metadata: { role: 'student' }
		});
		if (error || !data.user) throw new Error(`Failed to create student: ${error?.message}`);
		const { error: approveError } = await adminClient
			.from('profiles')
			.update({
				class_id: forClass,
				status: 'approved',
				registration_name: name('Student'),
				display_name: name('Student')
			})
			.eq('id', data.user.id);
		if (approveError) throw new Error(`Failed to approve student: ${approveError.message}`);
		const { data: rows } = await adminClient
			.from('class_enrollments')
			.select('class_id')
			.eq('student_id', data.user.id)
			.eq('class_id', forClass);
		if (!rows?.length) {
			const { error: enrollError } = await adminClient
				.from('class_enrollments')
				.insert({ student_id: data.user.id, class_id: forClass });
			if (enrollError) throw new Error(`Failed to enrol student: ${enrollError.message}`);
		}
		const client = anonClient();
		const { error: signInError } = await client.auth.signInWithPassword({ email, password });
		if (signInError) throw new Error(`Failed to sign in student: ${signInError.message}`);
		return client;
	}

	async function addSection(client: ReturnType<typeof anonClient>, title: string, to = syllabusId) {
		const { data: last } = await adminClient
			.from('class_syllabus_sections')
			.select('position')
			.eq('syllabus_id', to)
			.order('position', { ascending: false })
			.limit(1);
		return client
			.from('class_syllabus_sections')
			.insert({ syllabus_id: to, position: (last?.[0]?.position ?? 0) + 1, title })
			.select('id');
	}

	async function titles(client: ReturnType<typeof anonClient>, of = syllabusId) {
		const { data, error } = await client
			.from('class_syllabus_sections')
			.select('title')
			.eq('syllabus_id', of)
			.order('position');
		if (error) throw new Error(`Failed to read sections: ${error.message}`);
		return (data ?? []).map((row) => row.title);
	}

	const move = (client: ReturnType<typeof anonClient>, sectionId: string, direction: string) =>
		client.rpc('move_syllabus_section', {
			p_section_id: sectionId,
			p_syllabus_id: syllabusId,
			p_class_id: classId,
			p_direction: direction
		});

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacher = await createSignedInUser('teacher');
		otherTeacher = await createSignedInUser('teacher');
		classId = await makeClass('Class', teacher.id);
		otherClassId = await makeClass('Other', otherTeacher.id);
		syllabusId = await makeSyllabus(classId, 2030);
		otherSyllabusId = await makeSyllabus(otherClassId, 2030);
		enrolled = await student(classId);
		outsider = await student(otherClassId);
	}, 60000);

	it("the class's teacher adds, edits, reorders and deletes sections; the admin too", async () => {
		const one = await addSection(teacher.client, 'Song 1');
		const two = await addSection(teacher.client, 'Song 2');
		const three = await addSection(admin.client, 'Dance');
		expect(one.error ?? two.error ?? three.error).toBeNull();
		const [first, second, third] = [one.data![0].id, two.data![0].id, three.data![0].id];
		expect(await titles(teacher.client)).toEqual(['Song 1', 'Song 2', 'Dance']);

		const edited = await teacher.client
			.from('class_syllabus_sections')
			.update({
				title: 'Song 1 (new)',
				content_doc: body,
				content_language: 'bo',
				links: [{ url: 'https://a.example', label: 'A' }]
			})
			.eq('id', first)
			.select('title, content_doc, content_language, links');
		expect(edited.error).toBeNull();
		expect(edited.data).toEqual([
			{
				title: 'Song 1 (new)',
				content_doc: body,
				content_language: 'bo',
				links: [{ url: 'https://a.example', label: 'A' }]
			}
		]);

		// First up and last down change nothing.
		expect((await move(teacher.client, first, 'up')).data).toBe('unchanged');
		expect((await move(teacher.client, third, 'down')).data).toBe('unchanged');
		expect(await titles(teacher.client)).toEqual(['Song 1 (new)', 'Song 2', 'Dance']);

		expect((await move(teacher.client, third, 'up')).data).toBe('moved');
		expect(await titles(teacher.client)).toEqual(['Song 1 (new)', 'Dance', 'Song 2']);
		expect((await move(admin.client, first, 'down')).data).toBe('moved');
		expect(await titles(admin.client)).toEqual(['Dance', 'Song 1 (new)', 'Song 2']);

		// Deleting the middle one leaves the others in order.
		const removed = await teacher.client
			.from('class_syllabus_sections')
			.delete()
			.eq('id', first)
			.select('id');
		expect(removed.data).toHaveLength(1);
		expect(await titles(teacher.client)).toEqual(['Dance', 'Song 2']);
		expect((await move(teacher.client, second, 'up')).data).toBe('moved');
		expect(await titles(teacher.client)).toEqual(['Song 2', 'Dance']);
	});

	it('an enrolled student reads the sections in order but cannot add, change, move or delete', async () => {
		const before = await titles(teacher.client);
		expect(before.length).toBeGreaterThan(0);
		expect(await titles(enrolled)).toEqual(before);

		const { data: rows } = await enrolled
			.from('class_syllabus_sections')
			.select('id')
			.eq('syllabus_id', syllabusId)
			.order('position');
		const target = rows![0].id;

		const added = await addSection(enrolled, 'By a student');
		expect(added.error?.code).toBe('42501');
		const changed = await enrolled
			.from('class_syllabus_sections')
			.update({ title: 'Changed' })
			.eq('id', target)
			.select('id');
		expect(changed.data ?? []).toEqual([]);
		const moved = await move(enrolled, target, 'down');
		expect(moved.data).toBeNull();
		const removed = await enrolled
			.from('class_syllabus_sections')
			.delete()
			.eq('id', target)
			.select('id');
		expect(removed.data ?? []).toEqual([]);

		expect(await titles(teacher.client)).toEqual(before);
	});

	it("another class's teacher, a student who is not enrolled and a signed-out visitor get nothing", async () => {
		const before = await titles(teacher.client);
		const { data: rows } = await adminClient
			.from('class_syllabus_sections')
			.select('id')
			.eq('syllabus_id', syllabusId)
			.order('position');
		const target = rows![0].id;

		for (const client of [otherTeacher.client, outsider, anonClient()]) {
			const read = await client
				.from('class_syllabus_sections')
				.select('id')
				.eq('syllabus_id', syllabusId);
			expect(read.data ?? []).toEqual([]);
			const added = await addSection(client, 'Not mine');
			expect(added.error).not.toBeNull();
			const changed = await client
				.from('class_syllabus_sections')
				.update({ title: 'Changed' })
				.eq('id', target)
				.select('id');
			expect(changed.data ?? []).toEqual([]);
			const moved = await move(client, target, 'down');
			expect(moved.data ?? null).toBeNull();
			const removed = await client
				.from('class_syllabus_sections')
				.delete()
				.eq('id', target)
				.select('id');
			expect(removed.data ?? []).toEqual([]);
		}
		expect(await titles(teacher.client)).toEqual(before);

		// The other teacher works in their own class's syllabus.
		const own = await addSection(otherTeacher.client, 'Theirs', otherSyllabusId);
		expect(own.error).toBeNull();
		expect(await titles(outsider, otherSyllabusId)).toEqual(['Theirs']);
	});

	it('wrong class or syllabus: a move that names another class or syllabus changes nothing', async () => {
		const before = await titles(teacher.client);
		const { data: rows } = await adminClient
			.from('class_syllabus_sections')
			.select('id')
			.eq('syllabus_id', syllabusId)
			.order('position');
		const target = rows![0].id;
		const wrongClass = await admin.client.rpc('move_syllabus_section', {
			p_section_id: target,
			p_syllabus_id: syllabusId,
			p_class_id: otherClassId,
			p_direction: 'down'
		});
		expect(wrongClass.data).toBeNull();
		const wrongSyllabus = await admin.client.rpc('move_syllabus_section', {
			p_section_id: target,
			p_syllabus_id: otherSyllabusId,
			p_class_id: otherClassId,
			p_direction: 'down'
		});
		expect(wrongSyllabus.data).toBeNull();
		expect((await move(admin.client, target, 'sideways')).data).toBeNull();
		expect(await titles(teacher.client)).toEqual(before);
	});

	it('tied positions: a move swaps neighbours in position, created_at, id order and leaves distinct positions', async () => {
		const tied = await makeSyllabus(classId, 2032);
		const { data: rows, error } = await adminClient
			.from('class_syllabus_sections')
			.insert([
				{ syllabus_id: tied, position: 1, title: 'A', created_at: '2026-09-01T00:00:00Z' },
				// Same position: B was added before C.
				{ syllabus_id: tied, position: 2, title: 'C', created_at: '2026-09-03T00:00:00Z' },
				{ syllabus_id: tied, position: 2, title: 'B', created_at: '2026-09-02T00:00:00Z' }
			])
			.select('id, title');
		if (error || !rows) throw new Error(`Failed to create tied sections: ${error?.message}`);
		const c = rows.find((row) => row.title === 'C')!.id;

		const moved = await teacher.client.rpc('move_syllabus_section', {
			p_section_id: c,
			p_syllabus_id: tied,
			p_class_id: classId,
			p_direction: 'up'
		});
		expect(moved.data).toBe('moved');

		const { data: after } = await adminClient
			.from('class_syllabus_sections')
			.select('title, position')
			.eq('syllabus_id', tied)
			.order('position');
		expect(after).toEqual([
			{ title: 'A', position: 1 },
			{ title: 'C', position: 2 },
			{ title: 'B', position: 3 }
		]);
	});

	it('a section cannot change syllabus, and its title must be 1 to 200 characters', async () => {
		const { data: rows } = await adminClient
			.from('class_syllabus_sections')
			.select('id')
			.eq('syllabus_id', syllabusId)
			.order('position');
		const target = rows![0].id;
		const moved = await admin.client
			.from('class_syllabus_sections')
			.update({ syllabus_id: otherSyllabusId })
			.eq('id', target)
			.select('id');
		expect(moved.error?.code).toBe('42501');

		for (const title of ['', '   ', 'a'.repeat(201)]) {
			const { error } = await addSection(teacher.client, title);
			expect(error?.code).toBe('23514');
		}
		const longest = await addSection(teacher.client, 'ཀ'.repeat(200));
		expect(longest.error).toBeNull();
		await adminClient.from('class_syllabus_sections').delete().eq('id', longest.data![0].id);
	});

	it('deleting the syllabus deletes its sections', async () => {
		const gone = await makeSyllabus(classId, 2031);
		expect((await addSection(teacher.client, 'Soon gone', gone)).error).toBeNull();
		const { error } = await teacher.client.from('class_syllabi').delete().eq('id', gone);
		expect(error).toBeNull();
		const { data } = await adminClient
			.from('class_syllabus_sections')
			.select('id')
			.eq('syllabus_id', gone);
		expect(data).toEqual([]);
	});

	it('migration copy: a syllabus with text or links gets one section, titled in its language, once', async () => {
		const text = {
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Woche 1' }] }]
		};
		const links = [{ url: 'https://a.example', label: 'Lieder' }];
		const german = await makeSyllabus(classId, 2040, {
			content_doc: text,
			content_language: 'de',
			links
		});
		const tibetanLinksOnly = await makeSyllabus(classId, 2041, { content_language: 'bo', links });
		const englishTextOnly = await makeSyllabus(classId, 2042, { content_doc: text });
		const empty = await makeSyllabus(classId, 2043);
		const ids = [german, tibetanLinksOnly, englishTextOnly, empty];

		const sections = async () => {
			const { data, error } = await adminClient
				.from('class_syllabus_sections')
				.select('syllabus_id, position, title, content_doc, content_language, links')
				.in('syllabus_id', ids);
			if (error) throw new Error(`Failed to read sections: ${error.message}`);
			return new Map((data ?? []).map((row) => [row.syllabus_id, row]));
		};

		const first = await adminClient.rpc('syllabus_sections_backfill');
		expect(first.error).toBeNull();
		expect(first.data).toBeGreaterThanOrEqual(3);

		const copied = await sections();
		expect(copied.size).toBe(3);
		expect(copied.get(german)).toMatchObject({
			position: 1,
			title: 'Lehrplan',
			content_doc: text,
			content_language: 'de',
			links
		});
		expect(copied.get(tibetanLinksOnly)).toMatchObject({
			title: 'སློབ་ཚན་ཐོ་གཞུང་།',
			content_doc: null,
			content_language: 'bo',
			links
		});
		expect(copied.get(englishTextOnly)).toMatchObject({
			title: 'Syllabus',
			content_doc: text,
			content_language: 'en',
			links: []
		});
		expect(copied.has(empty)).toBe(false);

		// Run again: nothing shows twice.
		const second = await adminClient.rpc('syllabus_sections_backfill');
		expect(second.data).toBe(0);
		const { count } = await adminClient
			.from('class_syllabus_sections')
			.select('id', { count: 'exact', head: true })
			.in('syllabus_id', ids);
		expect(count).toBe(3);

		// Only the service role runs it.
		const refused = await teacher.client.rpc('syllabus_sections_backfill');
		expect(refused.error).not.toBeNull();
	});
});

/**
 * 0039: PDF files on a syllabus section. The table's policies and the
 * storage bucket's, against the local bucket, as each kind of caller; and
 * the app's own removal and signed-link helpers with real clients.
 */
describe.skipIf(!reachable)('0039 syllabus section files (requires local Supabase)', () => {
	type SignedIn = Awaited<ReturnType<typeof createSignedInUser>>;
	type Client = ReturnType<typeof anonClient>;
	let admin: SignedIn;
	let teacher: SignedIn;
	let otherTeacher: SignedIn;
	let enrolled: Client;
	let outsider: Client;
	let parent: Client;
	const signedOut = anonClient();
	let classId: string;
	let otherClassId: string;
	let syllabusId: string;
	let otherSyllabusId: string;
	let otherSectionId: string;

	const name = (label: string) => `0039 ${label} ${crypto.randomUUID().slice(0, 8)}`;
	const bucket = (client: Client | typeof adminClient) =>
		client.storage.from(SYLLABUS_FILES_BUCKET);
	const pathIn = (cls: string, section: string) => `${cls}/${section}/${crypto.randomUUID()}.pdf`;

	function pdfBytes(size = 2048): ArrayBuffer {
		const bytes = new Uint8Array(size);
		bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
		return bytes.buffer;
	}

	const put = (
		client: Client,
		path: string,
		body: ArrayBuffer = pdfBytes(),
		type = 'application/pdf'
	) => bucket(client).upload(path, body, { contentType: type, upsert: false });

	const record = (
		client: Client | typeof adminClient,
		section: string,
		path: string,
		fileName = 'Lyrics.pdf'
	) =>
		client
			.from('class_syllabus_section_files')
			.insert({ section_id: section, object_path: path, file_name: fileName, size_bytes: 2048 })
			.select('id');

	/** A stored file made by the service role: object and row. */
	async function stored(cls: string, section: string, fileName = 'Lyrics.pdf') {
		const path = pathIn(cls, section);
		const { error } = await bucket(adminClient).upload(path, pdfBytes(), {
			contentType: 'application/pdf'
		});
		if (error) throw new Error(`Failed to store object: ${error.message}`);
		const { data, error: rowError } = await record(adminClient, section, path, fileName);
		if (rowError || !data) throw new Error(`Failed to record file: ${rowError?.message}`);
		return { id: data[0].id, path };
	}

	const objectExists = async (path: string) =>
		(await bucket(adminClient).exists(path)).data === true;

	async function makeClass(label: string, teacherId: string) {
		const { data, error } = await adminClient
			.from('classes')
			.insert({ name: name(label), code: `F${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		const { error: assignError } = await adminClient
			.from('class_teachers')
			.insert({ class_id: data.id, teacher_id: teacherId });
		if (assignError) throw new Error(`Failed to assign teacher: ${assignError.message}`);
		return data.id;
	}

	async function makeSyllabus(forClass: string, schoolYear = 2030) {
		const { data, error } = await adminClient
			.from('class_syllabi')
			.insert({ class_id: forClass, school_year: schoolYear })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create syllabus: ${error?.message}`);
		return data.id;
	}

	async function makeSection(forSyllabus: string) {
		const { data, error } = await adminClient
			.from('class_syllabus_sections')
			.insert({ syllabus_id: forSyllabus, position: 1, title: name('Section') })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create section: ${error?.message}`);
		return data.id;
	}

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	/** An approved student enrolled in `forClass`, signed in; `guardianEmail` links a parent. */
	async function student(forClass: string, guardianEmail?: string) {
		const { id, error } = await signUpStudent({
			classId: forClass,
			registrationName: name('Student'),
			guardianEmail
		});
		if (error || !id) throw new Error(`Failed to register student: ${error?.message}`);
		const { error: approveError } = await adminClient
			.from('profiles')
			.update({ status: 'approved', display_name: name('Student') })
			.eq('id', id);
		if (approveError) throw new Error(`Failed to approve student: ${approveError.message}`);
		const { data: rows } = await adminClient
			.from('class_enrollments')
			.select('class_id')
			.eq('student_id', id)
			.eq('class_id', forClass);
		if (!rows?.length) throw new Error('The approved student is not enrolled.');
		const password = crypto.randomUUID();
		const { data } = await adminClient.auth.admin.updateUserById(id, { password });
		return signIn(data.user!.email!, password);
	}

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacher = await createSignedInUser('teacher');
		otherTeacher = await createSignedInUser('teacher');
		classId = await makeClass('Class', teacher.id);
		otherClassId = await makeClass('Other', otherTeacher.id);
		syllabusId = await makeSyllabus(classId);
		otherSyllabusId = await makeSyllabus(otherClassId);
		otherSectionId = await makeSection(otherSyllabusId);
		// The parent of a child enrolled in the class: still no access.
		const guardian = await createApprovedParent();
		enrolled = await student(classId, guardian.email);
		parent = await signIn(guardian.email, guardian.password);
		outsider = await student(otherClassId);
	}, 60000);

	afterAll(async () => {
		// Leave no objects of these classes in the local bucket.
		for (const cls of [classId, otherClassId]) {
			const { data: folders } = await bucket(adminClient).list(cls);
			for (const folder of folders ?? []) {
				const { data: objects } = await bucket(adminClient).list(`${cls}/${folder.name}`);
				const paths = (objects ?? []).map((o) => `${cls}/${folder.name}/${o.name}`);
				if (paths.length) await bucket(adminClient).remove(paths);
			}
		}
	});

	it('the bucket is private, 1 MB, PDF only', async () => {
		const { data, error } = await adminClient.storage.getBucket(SYLLABUS_FILES_BUCKET);
		expect(error).toBeNull();
		expect(data).toMatchObject({
			public: false,
			file_size_limit: 1048576,
			allowed_mime_types: ['application/pdf']
		});
	});

	it("the class's teacher and the admin upload and record files; they and an enrolled student read them", async () => {
		// Its own section: a section holds at most 5 files.
		const sectionId = await makeSection(syllabusId);
		const teacherPath = pathIn(classId, sectionId);
		const adminPath = pathIn(classId, sectionId);
		expect((await put(teacher.client, teacherPath)).error).toBeNull();
		expect((await put(admin.client, adminPath)).error).toBeNull();
		const first = await record(teacher.client, sectionId, teacherPath, 'Song 1 lyrics.pdf');
		const second = await record(admin.client, sectionId, adminPath, 'གཞས་ཚིག.pdf');
		expect(first.error ?? second.error).toBeNull();

		for (const [who, client] of [
			['teacher', teacher.client],
			['admin', admin.client],
			['enrolled student', enrolled]
		] as const) {
			const rows = await client
				.from('class_syllabus_section_files')
				.select('file_name')
				.in('object_path', [teacherPath, adminPath])
				.order('created_at');
			expect(rows.data, who).toEqual([
				{ file_name: 'Song 1 lyrics.pdf' },
				{ file_name: 'གཞས་ཚིག.pdf' }
			]);

			const download = await bucket(client).download(teacherPath);
			expect(download.error, who).toBeNull();
			expect(await download.data!.slice(0, 5).text(), who).toBe('%PDF-');

			const signed = await bucket(client).createSignedUrl(adminPath, 60);
			expect(signed.error, who).toBeNull();
			const response = await fetch(signed.data!.signedUrl);
			expect(response.status, who).toBe(200);
			expect(response.headers.get('content-type'), who).toBe('application/pdf');
			await response.arrayBuffer();
		}
	});

	it("another class's teacher, a student of another class, a parent and a signed-out visitor see no row and get no object or link", async () => {
		// Its own section: a section holds at most 5 files.
		const sectionId = await makeSection(syllabusId);
		const file = await stored(classId, sectionId);
		for (const [who, client] of [
			['other teacher', otherTeacher.client],
			['other student', outsider],
			['parent of an enrolled child', parent],
			['signed out', signedOut]
		] as const) {
			const rows = await client
				.from('class_syllabus_section_files')
				.select('id')
				.eq('section_id', sectionId);
			expect(rows.data ?? [], who).toEqual([]);

			const download = await bucket(client).download(file.path);
			expect(download.error, who).not.toBeNull();
			expect(download.data, who).toBeNull();

			const signed = await bucket(client).createSignedUrl(file.path, 60);
			expect(signed.error, who).not.toBeNull();
			expect(signed.data?.signedUrl, who).toBeUndefined();

			const listed = await bucket(client).list(`${classId}/${sectionId}`);
			expect(listed.data ?? [], who).toEqual([]);

			expect(await signedFileUrl(client as never, file.id, false), who).toBeNull();
		}

		// No public address, and a guessed signed address without a token, work.
		const base = `${PUBLIC_SUPABASE_URL}/storage/v1/object`;
		for (const url of [
			`${base}/public/${SYLLABUS_FILES_BUCKET}/${file.path}`,
			`${base}/${SYLLABUS_FILES_BUCKET}/${file.path}`,
			`${base}/sign/${SYLLABUS_FILES_BUCKET}/${file.path}`,
			`${base}/sign/${SYLLABUS_FILES_BUCKET}/${file.path}?token=guess`
		]) {
			const response = await fetch(url);
			expect(response.status, url).toBeGreaterThanOrEqual(400);
			expect(await response.text()).not.toContain('%PDF-');
		}
	});

	it('students, parents, other teachers and signed-out visitors cannot upload or record a file', async () => {
		// Its own section: a section holds at most 5 files.
		const sectionId = await makeSection(syllabusId);
		const existing = await stored(classId, sectionId);
		for (const [who, client] of [
			['enrolled student', enrolled],
			['other teacher', otherTeacher.client],
			['other student', outsider],
			['parent', parent],
			['signed out', signedOut]
		] as const) {
			const path = pathIn(classId, sectionId);
			expect((await put(client, path)).error, who).not.toBeNull();
			expect(await objectExists(path), who).toBe(false);

			const inserted = await record(client, sectionId, pathIn(classId, sectionId));
			expect(inserted.error, who).not.toBeNull();

			const renamed = await client
				.from('class_syllabus_section_files')
				.update({ file_name: 'hijacked.pdf' })
				.eq('id', existing.id)
				.select('id');
			expect(renamed.data ?? [], who).toEqual([]);

			const deleted = await client
				.from('class_syllabus_section_files')
				.delete()
				.eq('id', existing.id)
				.select('id');
			expect(deleted.data ?? [], who).toEqual([]);

			// Storage answers a refused removal with "nothing removed".
			const removed = await bucket(client).remove([existing.path]);
			expect(removed.data ?? [], who).toEqual([]);
		}
		expect(await objectExists(existing.path)).toBe(true);
		const { data } = await adminClient
			.from('class_syllabus_section_files')
			.select('file_name')
			.eq('id', existing.id);
		expect(data).toEqual([{ file_name: 'Lyrics.pdf' }]);
	});

	it('the bucket refuses a file over 1 MB and a file that is not declared a PDF', async () => {
		// Its own section: a section holds at most 5 files.
		const sectionId = await makeSection(syllabusId);
		const big = pathIn(classId, sectionId);
		expect((await put(teacher.client, big, pdfBytes(1048577))).error).not.toBeNull();
		expect(await objectExists(big)).toBe(false);

		const exact = pathIn(classId, sectionId);
		expect((await put(teacher.client, exact, pdfBytes(1048576))).error).toBeNull();
		await bucket(adminClient).remove([exact]);

		const image = pathIn(classId, sectionId);
		expect((await put(teacher.client, image, pdfBytes(), 'image/png')).error).not.toBeNull();
		expect(await objectExists(image)).toBe(false);
	});

	it("a teacher uploads only into a section's folder of their own class, under a name the app makes", async () => {
		// Its own section: a section holds at most 5 files.
		const sectionId = await makeSection(syllabusId);
		const refused = [
			// Another class's folder.
			pathIn(otherClassId, otherSectionId),
			// A section of another class under the teacher's own class id.
			pathIn(classId, otherSectionId),
			// A section that does not exist.
			pathIn(classId, crypto.randomUUID()),
			// The file's own name as the path, other types, other depths.
			`${classId}/${sectionId}/Song 1 lyrics.pdf`,
			`${classId}/${sectionId}/${crypto.randomUUID()}.docx`,
			`${classId}/${crypto.randomUUID()}.pdf`,
			`${classId}/${sectionId}/deeper/${crypto.randomUUID()}.pdf`,
			`${crypto.randomUUID()}.pdf`
		];
		for (const path of refused) {
			expect((await put(teacher.client, path)).error, path).not.toBeNull();
			expect(await objectExists(path), path).toBe(false);
		}
	});

	it('a stored object is never overwritten or moved', async () => {
		// Its own section: a section holds at most 5 files.
		const sectionId = await makeSection(syllabusId);
		const file = await stored(classId, sectionId);
		const again = await bucket(teacher.client).upload(file.path, pdfBytes(4096), {
			contentType: 'application/pdf',
			upsert: true
		});
		expect(again.error).not.toBeNull();
		const moved = await bucket(teacher.client).move(file.path, pathIn(classId, sectionId));
		expect(moved.error).not.toBeNull();
		const download = await bucket(adminClient).download(file.path);
		expect(download.data!.size).toBe(2048);
	});

	it("a row points only into its own section's folder, has a sane name and size, and stays in its section", async () => {
		// Its own section: a section holds at most 5 files.
		const sectionId = await makeSection(syllabusId);
		const elsewhere = await stored(otherClassId, otherSectionId);
		// Another class's object, as a new row or by changing an own row.
		const stolen = await record(teacher.client, sectionId, pathIn(otherClassId, otherSectionId));
		expect(stolen.error).not.toBeNull();
		const own = await stored(classId, sectionId);
		const repointed = await teacher.client
			.from('class_syllabus_section_files')
			.update({ object_path: pathIn(otherClassId, otherSectionId) })
			.eq('id', own.id)
			.select('id');
		expect(repointed.error).not.toBeNull();
		// The same object twice.
		expect((await record(teacher.client, sectionId, own.path)).error?.code).toBe('23505');
		// A path the app does not make.
		expect(
			(await record(teacher.client, sectionId, `${classId}/${sectionId}/Song.pdf`)).error
		).not.toBeNull();

		const base = { section_id: sectionId, file_name: 'a.pdf', size_bytes: 10 };
		for (const wrong of [
			{ file_name: '' },
			{ file_name: ' a.pdf' },
			{ file_name: 'a'.repeat(256) },
			{ size_bytes: 0 },
			{ size_bytes: 1048577 }
		]) {
			const { error } = await adminClient
				.from('class_syllabus_section_files')
				.insert({ ...base, object_path: pathIn(classId, sectionId), ...wrong });
			expect(error, JSON.stringify(wrong).slice(0, 40)).not.toBeNull();
		}

		// Not movable to another section (no column privilege).
		const moved = await teacher.client
			.from('class_syllabus_section_files')
			.update({ section_id: otherSectionId })
			.eq('id', own.id)
			.select('id');
		expect(moved.error).not.toBeNull();
		expect(elsewhere.id).toBeTruthy();
	});

	it('a section holds at most 5 files, also when six arrive at once', async () => {
		// Its own section: a section holds at most 5 files.
		const sectionId = await makeSection(syllabusId);
		const section = await makeSection(syllabusId);
		for (let i = 0; i < 5; i += 1) {
			expect((await record(teacher.client, section, pathIn(classId, section))).error).toBeNull();
		}
		const sixth = await record(teacher.client, section, pathIn(classId, section));
		expect(sixth.error?.code).toBe(FILE_LIMIT_ERROR_CODE);
		// The service role is held to it too.
		expect((await record(adminClient, section, pathIn(classId, section))).error?.code).toBe(
			FILE_LIMIT_ERROR_CODE
		);
		// Other sections are not affected.
		expect((await record(teacher.client, sectionId, pathIn(classId, sectionId))).error).toBeNull();

		const racing = await makeSection(syllabusId);
		const results = await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				record(i % 2 ? teacher.client : admin.client, racing, pathIn(classId, racing))
			)
		);
		expect(results.filter((r) => !r.error)).toHaveLength(5);
		expect(
			results.filter((r) => r.error).every((r) => r.error!.code === FILE_LIMIT_ERROR_CODE)
		).toBe(true);
		const { count } = await adminClient
			.from('class_syllabus_section_files')
			.select('id', { count: 'exact', head: true })
			.eq('section_id', racing);
		expect(count).toBe(5);
	});

	it('removeStoredFiles: a deleted section leaves no object in the bucket; other sections keep theirs', async () => {
		// Its own section: a section holds at most 5 files.
		const sectionId = await makeSection(syllabusId);
		const section = await makeSection(syllabusId);
		const kept = await stored(classId, sectionId);
		const one = await stored(classId, section);
		const two = await stored(classId, section);

		// A scope whose parents do not match removes nothing.
		expect(
			(
				await removeStoredFiles(teacher.client as never, {
					classId: otherClassId,
					syllabusId,
					sectionId: section
				})
			).ok
		).toBe(true);
		expect(
			(
				await removeStoredFiles(teacher.client as never, {
					classId,
					syllabusId: otherSyllabusId,
					sectionId: section
				})
			).ok
		).toBe(true);
		// Someone who may not touch the class removes nothing either.
		expect(
			(
				await removeStoredFiles(otherTeacher.client as never, {
					classId,
					syllabusId,
					sectionId: section
				})
			).ok
		).toBe(true);
		expect(await objectExists(one.path)).toBe(true);
		expect(await objectExists(two.path)).toBe(true);

		expect(
			(
				await removeStoredFiles(teacher.client as never, {
					classId,
					syllabusId,
					sectionId: section
				})
			).ok
		).toBe(true);
		const deleted = await teacher.client
			.from('class_syllabus_sections')
			.delete()
			.eq('id', section)
			.select('id');
		expect(deleted.data).toHaveLength(1);

		expect((await bucket(adminClient).list(`${classId}/${section}`)).data).toEqual([]);
		expect(await objectExists(kept.path)).toBe(true);
		const { data: rows } = await adminClient
			.from('class_syllabus_section_files')
			.select('id')
			.in('id', [one.id, two.id]);
		expect(rows).toEqual([]);
	});

	it('removeStoredFiles: a syllabus, and a whole class, as the admin', async () => {
		// Its own section: a section holds at most 5 files.
		const sectionId = await makeSection(syllabusId);
		const cls = await makeClass('Gone', teacher.id);
		const year1 = await makeSyllabus(cls, 2030);
		const year2 = await makeSyllabus(cls, 2031);
		const s1 = await makeSection(year1);
		const s2 = await makeSection(year2);
		const a = await stored(cls, s1);
		const b = await stored(cls, s2);
		const untouched = await stored(classId, sectionId);

		expect(
			(await removeStoredFiles(teacher.client as never, { classId: cls, syllabusId: year1 })).ok
		).toBe(true);
		expect(await objectExists(a.path)).toBe(false);
		expect(await objectExists(b.path)).toBe(true);

		const c = await stored(cls, s1);
		expect((await removeStoredFiles(admin.client as never, { classId: cls })).ok).toBe(true);
		expect(await objectExists(b.path)).toBe(false);
		expect(await objectExists(c.path)).toBe(false);
		const deleted = await admin.client.from('classes').delete().eq('id', cls).select('id');
		expect(deleted.data).toHaveLength(1);
		expect((await bucket(adminClient).list(cls)).data).toEqual([]);
		expect(await objectExists(untouched.path)).toBe(true);
	});

	it('deleting a section by SQL alone removes the rows but cannot reach the object (why the app removes it first)', async () => {
		const section = await makeSection(syllabusId);
		const file = await stored(classId, section);
		await adminClient.from('class_syllabus_sections').delete().eq('id', section);
		const { data } = await adminClient
			.from('class_syllabus_section_files')
			.select('id')
			.eq('id', file.id);
		expect(data).toEqual([]);
		expect(await objectExists(file.path)).toBe(true);
		await bucket(adminClient).remove([file.path]);
	});

	it('signedFileUrl: a link for the class, with the original name for a download, that stops working', async () => {
		// Its own section: a section holds at most 5 files.
		const sectionId = await makeSection(syllabusId);
		const file = await stored(classId, sectionId, 'Song 1 – གཞས་ཚིག.pdf');
		for (const client of [teacher.client, admin.client, enrolled]) {
			const url = await signedFileUrl(client as never, file.id, false);
			expect(url).toContain(`/object/sign/${SYLLABUS_FILES_BUCKET}/${file.path}?token=`);
			const response = await fetch(url!);
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('application/pdf');
			// Shown in the browser, not saved.
			expect(response.headers.get('content-disposition') ?? '').not.toContain('attachment');
			expect(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
		}

		const download = await signedFileUrl(enrolled as never, file.id, true);
		const saved = await fetch(download!);
		expect(saved.status).toBe(200);
		const disposition = saved.headers.get('content-disposition') ?? '';
		expect(disposition).toContain('attachment');
		expect(disposition).toContain(encodeURIComponent('Song 1 – གཞས་ཚིག.pdf'));
		await saved.arrayBuffer();

		expect(await signedFileUrl(enrolled as never, crypto.randomUUID(), false)).toBeNull();

		// A link's time runs out (here 1 second instead of the app's 60).
		const short = await bucket(enrolled).createSignedUrl(file.path, 1);
		expect((await fetch(short.data!.signedUrl)).status).toBe(200);
		await new Promise((resolve) => setTimeout(resolve, 2500));
		const late = await fetch(short.data!.signedUrl);
		expect(late.status).toBeGreaterThanOrEqual(400);
		expect(await late.text()).not.toContain('%PDF-');
	}, 20000);
});

/**
 * #97 (0041): who may see a team's students -- team_students(),
 * can_view_team() and viewable_team_ids(). One test per row of the spec's
 * I/O matrix.
 */
describe.skipIf(!reachable)('#97 team students (requires local Supabase)', () => {
	type Client = ReturnType<typeof anonClient>;

	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let parent: { id: string; email: string; client: Client };
	let classId: string;
	/** Three approved students (one is `parent`'s child), one pending, one rejected. */
	let teamA: string;
	/** One approved student; no child of `parent`. */
	let teamB: string;
	/** No students. */
	let teamEmpty: string;
	let studentInA: Client;
	let studentInB: Client;
	let pendingStudent: Client;
	let rejectedStudent: Client;

	const tag = crypto.randomUUID().slice(0, 8);
	const name = (label: string) => `97 ${label} ${tag}`;
	const NAMES_A = [name('anna'), name('Bkra shis'), name('Chodon')];
	/** Registered under this name, shown as NAMES_A[1]: it would sort last. */
	const REGISTERED_AS = name('Zzz registered');

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	async function newParent() {
		const p = await createApprovedParent();
		return { id: p.id, email: p.email, client: await signIn(p.email, p.password) };
	}

	async function createTeam(label: string, extra: Record<string, string> = {}) {
		const { data, error } = await adminClient
			.from('teams')
			.insert({ name: name(label), ...extra })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create team: ${error?.message}`);
		return data.id;
	}

	/** A student in `teamId` with the given status, optionally a child of `parentEmail`. */
	async function student(params: {
		registrationName: string;
		teamId: string;
		status?: 'approved' | 'pending' | 'rejected';
		parentEmail?: string;
		/** A display name different from the registration name. */
		displayName?: string;
	}) {
		const { id, error } = await signUpStudent({
			classId,
			registrationName: params.registrationName,
			guardianEmail: params.parentEmail
		});
		if (error || !id) throw new Error(`Failed to register student: ${error?.message}`);
		const { error: updateError } = await adminClient
			.from('profiles')
			.update({
				status: params.status ?? 'approved',
				team_id: params.teamId,
				...(params.displayName ? { display_name: params.displayName } : {})
			})
			.eq('id', id);
		if (updateError) throw new Error(`Failed to set up student: ${updateError.message}`);
		return id;
	}

	async function signInStudent(id: string) {
		const password = crypto.randomUUID();
		const { data, error } = await adminClient.auth.admin.updateUserById(id, { password });
		if (error || !data.user?.email) {
			throw new Error(`Failed to set a password for student ${id}: ${error?.message}`);
		}
		return signIn(data.user.email, password);
	}

	/** Sets a status with the service role and fails if no row changed. */
	async function setStatus(table: 'profiles' | 'parents', id: string, status: 'rejected') {
		const { data, error } = await adminClient
			.from(table)
			.update({ status })
			.eq('id', id)
			.select('status');
		if (error || data?.[0]?.status !== status) {
			throw new Error(`Failed to set ${table} ${id} to ${status}: ${error?.message}`);
		}
	}

	const studentsOf = (client: Client, teamId: string) =>
		client.rpc('team_students', { p_team_id: teamId });

	async function viewable(client: Client) {
		const { data, error } = await client.rpc('viewable_team_ids');
		expect(error).toBeNull();
		return (data ?? []).map((row) => row.team_id);
	}

	async function expectRefused(client: Client, teamId: string) {
		const { data, error } = await studentsOf(client, teamId);
		expect(error?.code).toBe('42501');
		expect(data).toBeNull();
		expect((await client.rpc('can_view_team', { p_team_id: teamId })).data).not.toBe(true);
	}

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacher = await createSignedInUser('teacher');
		const { data: cls, error: classError } = await adminClient
			.from('classes')
			.insert({ name: name('Class'), code: `T${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
			.select('id')
			.single();
		if (classError || !cls) throw new Error(`Failed to create class: ${classError?.message}`);
		classId = cls.id;

		teamA = await createTeam('Team A', { name_bo: 'རུ་ཁག་ཀ', name_de: 'Mannschaft A' });
		teamB = await createTeam('Team B');
		teamEmpty = await createTeam('Team Empty');
		parent = await newParent();

		// Registered out of name order, so the sort is the function's.
		const chodon = await student({ registrationName: NAMES_A[2], teamId: teamA });
		await student({
			registrationName: NAMES_A[0],
			teamId: teamA,
			parentEmail: parent.email
		});
		await student({
			registrationName: REGISTERED_AS,
			displayName: NAMES_A[1],
			teamId: teamA
		});
		const pending = await student({
			registrationName: name('Pending'),
			teamId: teamA,
			status: 'pending'
		});
		const rejected = await student({
			registrationName: name('Rejected'),
			teamId: teamA,
			status: 'rejected'
		});
		const inB = await student({ registrationName: name('Dawa'), teamId: teamB });

		studentInA = await signInStudent(chodon);
		studentInB = await signInStudent(inB);
		pendingStudent = await signInStudent(pending);
		rejectedStudent = await signInStudent(rejected);
	}, 60000);

	it("Student opens any team: the team's names and its 3 approved students, sorted by name", async () => {
		for (const client of [studentInA, studentInB]) {
			const { data, error } = await studentsOf(client, teamA);
			expect(error).toBeNull();
			expect(data).toEqual(
				NAMES_A.map((student_name) => ({
					team_name: name('Team A'),
					team_name_bo: 'རུ་ཁག་ཀ',
					team_name_de: 'Mannschaft A',
					student_name
				}))
			);
		}
		expect(await viewable(studentInB)).toEqual(expect.arrayContaining([teamA, teamB, teamEmpty]));
	});

	it('The name shown is the display name, else the registration name; sorted by the shown name', async () => {
		const { data, error } = await studentsOf(admin.client, teamA);
		expect(error).toBeNull();
		const names = data?.map((row) => row.student_name) ?? [];
		// Second by its display name; by its registration name it would be last.
		expect(names[1]).toBe(NAMES_A[1]);
		expect(names).not.toContain(REGISTERED_AS);
		// The others have no display name: their registration name is shown.
		expect(names[0]).toBe(NAMES_A[0]);
		expect(names[2]).toBe(NAMES_A[2]);
	});

	it('Teacher or admin: the same list for any team', async () => {
		for (const client of [teacher.client, admin.client]) {
			const { data, error } = await studentsOf(client, teamA);
			expect(error).toBeNull();
			expect(data?.map((row) => row.student_name)).toEqual(NAMES_A);
			const other = await studentsOf(client, teamB);
			expect(other.data?.map((row) => row.student_name)).toEqual([name('Dawa')]);
			expect(await viewable(client)).toEqual(expect.arrayContaining([teamA, teamB, teamEmpty]));
		}
	});

	it("Parent, child's team: the same list; that team is the only one they may open", async () => {
		const { data, error } = await studentsOf(parent.client, teamA);
		expect(error).toBeNull();
		expect(data?.map((row) => row.student_name)).toEqual(NAMES_A);
		expect(await viewable(parent.client)).toEqual([teamA]);
	});

	it('Parent, another team / direct database call: refused with no rows', async () => {
		await expectRefused(parent.client, teamB);
		await expectRefused(parent.client, teamEmpty);
		// The other ways to the same names stay closed to a parent.
		const { data: profiles } = await parent.client
			.from('profiles')
			.select('id')
			.eq('team_id', teamB);
		expect(profiles).toEqual([]);
	});

	it('Parent with two children in two teams: both open, a third does not', async () => {
		const two = await newParent();
		const first = await createTeam('Team Kid 1');
		const second = await createTeam('Team Kid 2');
		await student({ registrationName: name('Kid 1'), teamId: first, parentEmail: two.email });
		await student({ registrationName: name('Kid 2'), teamId: second, parentEmail: two.email });

		const one = await studentsOf(two.client, first);
		expect(one.error).toBeNull();
		expect(one.data?.map((row) => row.student_name)).toEqual([name('Kid 1')]);
		const other = await studentsOf(two.client, second);
		expect(other.error).toBeNull();
		expect(other.data?.map((row) => row.student_name)).toEqual([name('Kid 2')]);
		await expectRefused(two.client, teamA);
		await expectRefused(two.client, teamEmpty);
		expect((await viewable(two.client)).sort()).toEqual([first, second].sort());
	});

	it("Parent whose only child in the team is pending or rejected: refused (not 'their own approved child')", async () => {
		const other = await newParent();
		const team = await createTeam('Team Pending Child');
		const kid = await student({
			registrationName: name('Waiting Kid'),
			teamId: team,
			status: 'pending',
			parentEmail: other.email
		});
		await expectRefused(other.client, team);
		await setStatus('profiles', kid, 'rejected');
		await expectRefused(other.client, team);
		expect(await viewable(other.client)).toEqual([]);
	});

	it('Parent who is not approved: refused for the team of their child', async () => {
		const approved = await newParent();
		const team = await createTeam('Team Former Parent');
		const kid = await student({
			registrationName: name('Former Kid'),
			teamId: team,
			parentEmail: approved.email
		});
		expect((await studentsOf(approved.client, team)).error).toBeNull();

		// spec-second-parent (0054): a parent with a linked child cannot be
		// rejected, so the parent who is not approved is a pending one.
		const pending = await createPendingParent();
		await linkParent(adminClient, kid, pending.id);
		const pendingClient = await signIn(pending.email, pending.password);
		await expectRefused(pendingClient, team);
		expect(await viewable(pendingClient)).toEqual([]);
	});

	it('Pending or rejected student, signed out: refused for every team', async () => {
		for (const client of [pendingStudent, rejectedStudent, anonClient()]) {
			await expectRefused(client, teamA);
			await expectRefused(client, teamB);
			const { data } = await client.rpc('viewable_team_ids');
			expect(data ?? []).toEqual([]);
		}
	});

	it('Team without students: one row with the team name and no student', async () => {
		const { data, error } = await studentsOf(studentInA, teamEmpty);
		expect(error).toBeNull();
		expect(data).toEqual([
			{
				team_name: name('Team Empty'),
				team_name_bo: null,
				team_name_de: null,
				student_name: null
			}
		]);
	});

	it('Pending or rejected student in the team: not listed', async () => {
		const { data } = await studentsOf(admin.client, teamA);
		const names = data?.map((row) => row.student_name) ?? [];
		expect(names).not.toContain(name('Pending'));
		expect(names).not.toContain(name('Rejected'));
		// Both are in the team: the function leaves them out, not the fixture.
		const { count } = await adminClient
			.from('profiles')
			.select('id', { count: 'exact', head: true })
			.eq('team_id', teamA)
			.in('status', ['pending', 'rejected']);
		expect(count).toBe(2);
	});

	it('Unknown team id: no rows for a viewer who may open teams, refused for a parent', async () => {
		const unknown = crypto.randomUUID();
		for (const client of [studentInA, teacher.client, admin.client]) {
			const { data, error } = await studentsOf(client, unknown);
			expect(error).toBeNull();
			expect(data).toEqual([]);
		}
		await expectRefused(parent.client, unknown);
	});

	it('Names only: nothing else about a student is returned, and the leaderboard still has totals only', async () => {
		const { data } = await studentsOf(studentInA, teamA);
		for (const row of data ?? []) {
			expect(Object.keys(row).sort()).toEqual([
				'student_name',
				'team_name',
				'team_name_bo',
				'team_name_de'
			]);
		}
		const { data: board } = await studentInA.rpc('team_leaderboard');
		expect(Object.keys(board![0]).sort()).toEqual([
			'team_id',
			'team_name',
			'team_name_bo',
			'team_name_de',
			'total_streak'
		]);
	});

	it('class_people is unchanged: a parent still gets no classmates', async () => {
		const { data, error } = await parent.client.rpc('class_people', { p_class_id: classId });
		expect(error).toBeNull();
		expect((data ?? []).filter((person) => !person.is_teacher)).toEqual([]);
	});
});

/**
 * #99 (0043): at approval the database puts the student in a team with the
 * fewest students, at random among the smallest.
 *
 * The rule is over every team in the database, and this file's other blocks
 * leave teams of many sizes behind. So the tests compare against the sizes
 * of all teams read just before, not against teams of their own alone:
 *   * one approval: the student's team was one of the smallest then;
 *   * several approvals: the sizes afterwards are the sizes before with one
 *     student added to a smallest team, once per approval (`filled`). Which
 *     of several smallest teams gets a student is random, but the sizes that
 *     come out are the same whichever it is.
 * "No team at all" cannot be built here (teams with students cannot be
 * deleted); the approve action's spec covers how that refusal is shown.
 */
describe.skipIf(!reachable)('#99 team assigned at approval (requires local Supabase)', () => {
	type Client = ReturnType<typeof anonClient>;
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let classId: string;
	/** A team with five students: larger than a new team for every test here. */
	let bigTeam: string;

	const name = (label: string) => `T99 ${label} ${crypto.randomUUID().slice(0, 8)}`;

	async function createTeam(label: string) {
		const { data, error } = await adminClient
			.from('teams')
			.insert({ name: name(label) })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create team: ${error?.message}`);
		return data.id;
	}

	/** The number of students of every team in the database, empty teams included. */
	async function teamSizes() {
		const sizes = new Map<string, number>();
		const { data: teams, error: teamsError } = await adminClient.from('teams').select('id');
		if (teamsError) throw new Error(`Failed to read teams: ${teamsError.message}`);
		for (const team of teams ?? []) sizes.set(team.id, 0);
		const pageSize = 1000;
		for (let from = 0; ; from += pageSize) {
			const { data, error } = await adminClient
				.from('profiles')
				.select('team_id')
				.eq('role', 'student')
				.not('team_id', 'is', null)
				.order('id')
				.range(from, from + pageSize - 1);
			if (error) throw new Error(`Failed to read students: ${error.message}`);
			for (const row of data ?? []) sizes.set(row.team_id!, (sizes.get(row.team_id!) ?? 0) + 1);
			if ((data ?? []).length < pageSize) break;
		}
		return sizes;
	}

	const sorted = (sizes: Iterable<number>) => [...sizes].sort((a, b) => a - b);

	/** `sizes` after `count` students each joined a smallest team, sorted. */
	function filled(sizes: Iterable<number>, count: number) {
		const result = sorted(sizes);
		for (let i = 0; i < count; i++) {
			result[0] += 1;
			result.sort((a, b) => a - b);
		}
		return result;
	}

	async function pendingStudent(label: string) {
		const { id, error } = await signUpStudent({ classId, registrationName: name(label) });
		if (error || !id) throw new Error(`Failed to sign up student: ${error?.message}`);
		return id;
	}

	/** The approval as /requests sends it (no team), plus whatever `extra` adds. */
	function approve(client: Client, studentId: string, extra: { team_id?: string } = {}) {
		return client
			.from('profiles')
			.update({ status: 'approved', reviewed_at: new Date().toISOString(), ...extra })
			.eq('id', studentId)
			.select('status, team_id')
			.single();
	}

	async function profileOf(studentId: string) {
		const { data, error } = await adminClient
			.from('profiles')
			.select('status, team_id')
			.eq('id', studentId)
			.single();
		if (error) throw new Error(`Failed to read student: ${error.message}`);
		return data;
	}

	/** Approves as `client` and checks the student's team was one of the smallest. */
	async function approveIntoSmallest(
		client: Client,
		studentId: string,
		extra: { team_id?: string } = {}
	) {
		const before = await teamSizes();
		const { data, error } = await approve(client, studentId, extra);
		expect(error).toBeNull();
		expect(data?.status).toBe('approved');
		const teamId = data?.team_id ?? '';
		expect(before.has(teamId)).toBe(true);
		expect(before.get(teamId)).toBe(Math.min(...before.values()));
		return teamId;
	}

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacher = await createSignedInUser('teacher');
		const { data: cls, error: classError } = await adminClient
			.from('classes')
			.insert({ name: name('Class'), code: `N${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
			.select('id')
			.single();
		if (classError || !cls) throw new Error(`Failed to create class: ${classError?.message}`);
		classId = cls.id;
		const { error: assignError } = await adminClient
			.from('class_teachers')
			.insert({ class_id: classId, teacher_id: teacher.id });
		if (assignError) throw new Error(`Failed to assign teacher: ${assignError.message}`);

		// Service role sets a team: the team it names is kept, whatever its size.
		bigTeam = await createTeam('Big');
		for (let i = 0; i < 5; i++) {
			const id = await pendingStudent(`Big ${i}`);
			const { data, error } = await approve(adminClient, id, { team_id: bigTeam });
			if (error) throw new Error(`Failed to fill the big team: ${error.message}`);
			expect(data).toEqual({ status: 'approved', team_id: bigTeam });
		}
	}, 60000);

	it('Service role sets a team: that team is kept, also when it is the largest', async () => {
		await createTeam('Empty next to big');
		const before = await teamSizes();
		expect(before.get(bigTeam)).toBeGreaterThan(Math.min(...before.values()));

		const id = await pendingStudent('Service Named');
		const { data, error } = await approve(adminClient, id, { team_id: bigTeam });
		expect(error).toBeNull();
		expect(data).toEqual({ status: 'approved', team_id: bigTeam });
	});

	it('Service role without a team: the database chooses one of the smallest', async () => {
		const id = await pendingStudent('Service Unnamed');
		const teamId = await approveIntoSmallest(adminClient, id);
		expect(teamId).not.toBe(bigTeam);
	});

	it('Seven approvals one after another: each goes to a team that is one of the smallest at that moment, and the sizes end as if each had joined a smallest team', async () => {
		// Three new empty teams, so several teams are the smallest at the start.
		await createTeam('Even A');
		await createTeam('Even B');
		await createTeam('Even C');
		const start = await teamSizes();

		for (let i = 0; i < 7; i++) {
			const id = await pendingStudent(`Even ${i}`);
			const teamId = await approveIntoSmallest(teacher.client, id);
			expect(teamId).not.toBe(bigTeam);
		}

		const end = await teamSizes();
		expect(sorted(end.values())).toEqual(filled(start.values(), 7));
	}, 60000);

	it('Next to a big team and a new empty one: each of three approvals goes to a team that is one of the smallest at that moment, never to the big team', async () => {
		await createTeam('Catch Up');
		for (let i = 0; i < 3; i++) {
			const id = await pendingStudent(`Catch Up ${i}`);
			const teamId = await approveIntoSmallest(teacher.client, id);
			expect(teamId).not.toBe(bigTeam);
		}
	}, 60000);

	it("Client sends a team: a teacher's or the admin's team_id of a larger team is ignored", async () => {
		await createTeam('Empty next to big');
		for (const client of [teacher.client, admin.client]) {
			const bigBefore = (await teamSizes()).get(bigTeam);
			const id = await pendingStudent('Client Named');
			const teamId = await approveIntoSmallest(client, id, { team_id: bigTeam });
			expect(teamId).not.toBe(bigTeam);
			expect((await profileOf(id)).team_id).toBe(teamId);
			expect((await teamSizes()).get(bigTeam)).toBe(bigBefore);
		}
	}, 60000);

	it('Same moment: eight approvals at once leave the sizes as if they came one after another', async () => {
		// Two new teams: without the lock, approvals that count at the same
		// moment pile into the same smallest team.
		await createTeam('Race A');
		await createTeam('Race B');
		const ids: string[] = [];
		for (let i = 0; i < 8; i++) ids.push(await pendingStudent(`Race ${i}`));
		const before = await teamSizes();

		const results = await Promise.all(ids.map((id) => approve(teacher.client, id)));
		for (const { data, error } of results) {
			expect(error).toBeNull();
			expect(data?.status).toBe('approved');
			expect(before.has(data?.team_id ?? '')).toBe(true);
		}

		const after = await teamSizes();
		expect(sorted(after.values())).toEqual(filled(before.values(), ids.length));
	}, 60000);

	it('Rejection: no team is assigned', async () => {
		const id = await pendingStudent('Rejected');
		const { data, error } = await teacher.client
			.from('profiles')
			.update({ status: 'rejected', reviewed_at: new Date().toISOString() })
			.eq('id', id)
			.select('status, team_id')
			.single();
		expect(error).toBeNull();
		expect(data).toEqual({ status: 'rejected', team_id: null });
	});

	it('Team already set: an approval keeps it, and one that would change it is refused', async () => {
		// Only the service role can give a pending student a team.
		const withTeam = async (label: string) => {
			const id = await pendingStudent(label);
			const { error } = await adminClient
				.from('profiles')
				.update({ team_id: bigTeam })
				.eq('id', id);
			if (error) throw new Error(`Failed to set the team: ${error.message}`);
			return id;
		};
		const other = await createTeam('Other');

		const kept = await withTeam('Team Kept');
		const approved = await approve(teacher.client, kept);
		expect(approved.error).toBeNull();
		expect(approved.data).toEqual({ status: 'approved', team_id: bigTeam });

		const refused = await withTeam('Team Refused');
		const change = await approve(teacher.client, refused, { team_id: other });
		expect(change.error?.code).toBe('42501');
		expect(await profileOf(refused)).toEqual({ status: 'pending', team_id: bigTeam });
	});
});

// #101 (0044): the account remembers which guided page tours it has seen.
describe.skipIf(!reachable)('#101 tours seen (requires local Supabase)', () => {
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let other: Awaited<ReturnType<typeof createSignedInUser>>;

	const seenBy = async (id: string) => {
		const { data, error } = await adminClient
			.from('profiles')
			.select('tours_seen')
			.eq('id', id)
			.single();
		if (error) throw new Error(`Failed to read tours_seen: ${error.message}`);
		return data.tours_seen;
	};

	beforeAll(async () => {
		teacher = await createSignedInUser('teacher');
		other = await createSignedInUser('teacher');
	});

	afterAll(async () => {
		await adminClient.auth.admin.deleteUser(teacher.id);
		await adminClient.auth.admin.deleteUser(other.id);
	});

	it('a new account has seen no tour', async () => {
		expect(await seenBy(teacher.id)).toEqual([]);
	});

	it("mark_tour_seen adds the id to the caller's own row, once", async () => {
		expect(
			(await teacher.client.rpc('mark_tour_seen', { p_tour: 'teacher-class' })).error
		).toBeNull();
		expect(
			(await teacher.client.rpc('mark_tour_seen', { p_tour: 'teacher-home' })).error
		).toBeNull();
		expect(
			(await teacher.client.rpc('mark_tour_seen', { p_tour: 'teacher-class' })).error
		).toBeNull();
		expect(await seenBy(teacher.id)).toEqual(['teacher-class', 'teacher-home']);
		expect(await seenBy(other.id)).toEqual([]);

		// The account reads it with its own profile (the layout's `select('*')`).
		const { data } = await teacher.client
			.from('profiles')
			.select('tours_seen')
			.eq('id', teacher.id)
			.single();
		expect(data?.tours_seen).toEqual(['teacher-class', 'teacher-home']);
	});

	it('refuses text that cannot be a tour id and a signed-out caller', async () => {
		for (const bad of ['', 'Teacher-Class', 'a b', '<script>', 'x'.repeat(41)]) {
			const { error } = await other.client.rpc('mark_tour_seen', { p_tour: bad });
			expect(error?.code, bad).toBe('22023');
		}
		const signedOut = await anonClient().rpc('mark_tour_seen', { p_tour: 'teacher-class' });
		expect(signedOut.error).not.toBeNull();
		expect(await seenBy(other.id)).toEqual([]);
	});

	it('stores at most 64 ids', async () => {
		for (let i = 0; i < 66; i += 1) {
			const { error } = await other.client.rpc('mark_tour_seen', { p_tour: `t-${i}` });
			expect(error).toBeNull();
		}
		expect(await seenBy(other.id)).toHaveLength(64);
	});

	it('an account cannot write tours_seen directly', async () => {
		const before = await seenBy(teacher.id);
		await teacher.client.from('profiles').update({ tours_seen: [] }).eq('id', teacher.id);
		expect(await seenBy(teacher.id)).toEqual(before);
	});
});

// #102 (0045): marks are append-only, and the latest mark per session and
// student (attendance_current) is the one that counts everywhere.
describe.skipIf(!reachable)('#102 attendance corrections (requires local Supabase)', () => {
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let otherTeacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let teamId: string;

	const today = todayInBerlin();
	const name = (label: string) => `#102 ${label} ${crypto.randomUUID().slice(0, 8)}`;
	/** A day far in the past, so the shared calendar's real class days are left alone. */
	const pastDay = (n: number) => `1898-03-${String(n).padStart(2, '0')}`;

	/** A fresh class per test: the streak rule looks at every mark of a class. */
	async function createClass(label: string) {
		const { data, error } = await adminClient
			.from('classes')
			.insert({
				name: name(label),
				code: `K${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
				badge_subject: 'dance'
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		const { error: assignError } = await adminClient
			.from('class_teachers')
			.insert({ class_id: data.id, teacher_id: teacher.id });
		if (assignError) throw new Error(`Failed to assign the teacher: ${assignError.message}`);
		return data.id;
	}

	/** An approved (and so enrolled) student of `classId`. */
	async function createStudent(classId: string, guardianEmail?: string) {
		const { id, error } = await signUpStudent({
			classId,
			registrationName: name('Kid'),
			guardianEmail
		});
		if (error || !id) throw new Error(`Failed to register the student: ${error?.message}`);
		const { error: approveError } = await adminClient
			.from('profiles')
			.update({ status: 'approved', team_id: teamId })
			.eq('id', id);
		if (approveError) throw new Error(`Failed to approve the student: ${approveError.message}`);
		return id;
	}

	/** One mark, saved by the class's teacher through the insert policy. */
	async function mark(classId: string, sessionId: string, studentId: string, present: boolean) {
		const { error } = await teacher.client.from('attendance_records').insert({
			student_id: studentId,
			class_id: classId,
			class_session_id: sessionId,
			present,
			recorded_by: teacher.id
		});
		if (error) throw new Error(`Failed to mark attendance: ${error.message}`);
	}

	/** Homework of this week, done by the student: the other half of a qualifying week. */
	async function homeworkDoneThisWeek(classId: string, studentId: string, periodStart = today) {
		const { data: assignment, error: assignmentError } = await adminClient
			.from('homework_assignments')
			.insert({
				class_id: classId,
				title: name('Homework'),
				skill_area: 'language',
				created_by: teacher.id
			})
			.select('id')
			.single();
		if (assignmentError || !assignment)
			throw new Error(`Failed to create assignment: ${assignmentError?.message}`);
		const { data: instance, error: instanceError } = await adminClient
			.from('homework_instances')
			.insert({
				assignment_id: assignment.id,
				class_id: classId,
				period_start: periodStart,
				due_date: periodStart
			})
			.select('id')
			.single();
		if (instanceError || !instance)
			throw new Error(`Failed to create instance: ${instanceError?.message}`);
		for (const status of ['assigned', 'done'] as const) {
			const { error } = await adminClient.from('homework_status_history').insert({
				instance_id: instance.id,
				class_id: classId,
				student_id: studentId,
				status,
				recorded_by: teacher.id
			});
			if (error) throw new Error(`Failed to set homework ${status}: ${error.message}`);
		}
	}

	async function streakOf(studentId: string) {
		const { data, error } = await adminClient
			.from('student_streaks')
			.select('current_streak')
			.eq('student_id', studentId)
			.maybeSingle();
		if (error) throw new Error(`Failed to read the streak: ${error.message}`);
		return data?.current_streak ?? 0;
	}

	async function attendanceBadgesOf(studentId: string) {
		const { data, error } = await adminClient
			.from('badges_earned')
			.select('milestone')
			.eq('student_id', studentId)
			.eq('badge_type', 'attendance')
			.order('milestone');
		if (error) throw new Error(`Failed to read the badges: ${error.message}`);
		return data.map((b) => b.milestone);
	}

	async function signInStudent(id: string) {
		const password = crypto.randomUUID();
		const { data, error } = await adminClient.auth.admin.updateUserById(id, { password });
		if (error || !data.user?.email) throw new Error(`Failed to set a password: ${error?.message}`);
		const client = anonClient();
		const { error: signInError } = await client.auth.signInWithPassword({
			email: data.user.email,
			password
		});
		if (signInError) throw new Error(`Failed to sign in: ${signInError.message}`);
		return client;
	}

	beforeAll(async () => {
		teacher = await createSignedInUser('teacher');
		otherTeacher = await createSignedInUser('teacher');
		const { data: team, error } = await adminClient
			.from('teams')
			.insert({ name: name('Team') })
			.select('id')
			.single();
		if (error || !team) throw new Error(`Failed to create team: ${error?.message}`);
		teamId = team.id;
	}, 30000);

	it('attendance_current has one row per session and student, the latest mark; no earlier row is changed', async () => {
		const classId = await createClass('Latest');
		const a = await createStudent(classId);
		const b = await createStudent(classId);
		const sessionId = await sessionFor(classId, pastDay(1));

		await mark(classId, sessionId, a, true);
		await mark(classId, sessionId, b, false);
		const { data: firstRows } = await adminClient
			.from('attendance_records')
			.select('*')
			.eq('class_session_id', sessionId)
			.order('id');

		// A corrected to absent, B to present.
		await mark(classId, sessionId, a, false);
		await mark(classId, sessionId, b, true);

		const { data: current, error } = await teacher.client
			.from('attendance_current')
			.select('student_id, present')
			.eq('class_id', classId);
		expect(error).toBeNull();
		expect(current).toHaveLength(2);
		expect(current).toEqual(
			expect.arrayContaining([
				{ student_id: a, present: false },
				{ student_id: b, present: true }
			])
		);

		// Append-only: four rows, the first two as they were.
		const { data: allRows } = await adminClient
			.from('attendance_records')
			.select('*')
			.eq('class_session_id', sessionId)
			.order('id');
		expect(allRows).toHaveLength(4);
		expect(firstRows).toHaveLength(2);
		for (const row of firstRows ?? []) expect(allRows).toContainEqual(row);

		// The current row is the newest raw row of its pair.
		const { data: currentIds } = await adminClient
			.from('attendance_current')
			.select('id, student_id')
			.eq('class_session_id', sessionId);
		for (const row of currentIds ?? []) {
			const newest = (allRows ?? [])
				.filter((r) => r.student_id === row.student_id)
				.sort((x, y) => y.recorded_at.localeCompare(x.recorded_at))[0];
			expect(row.id).toBe(newest.id);
		}
	});

	it("attendance_current follows the table's RLS: another teacher, the student and a signed-out caller read nothing, and nobody writes through it", async () => {
		const classId = await createClass('RLS');
		const kid = await createStudent(classId);
		const sessionId = await sessionFor(classId, pastDay(2));
		await mark(classId, sessionId, kid, true);

		const asTeacher = await teacher.client
			.from('attendance_current')
			.select('id')
			.eq('class_id', classId);
		expect(asTeacher.error).toBeNull();
		expect(asTeacher.data).toHaveLength(1);

		const asOther = await otherTeacher.client
			.from('attendance_current')
			.select('id')
			.eq('class_id', classId);
		expect(asOther.data ?? []).toEqual([]);

		const student = await signInStudent(kid);
		const asStudent = await student.from('attendance_current').select('id').eq('student_id', kid);
		expect(asStudent.data ?? []).toEqual([]);

		const signedOut = await anonClient()
			.from('attendance_current')
			.select('id')
			.eq('class_id', classId);
		expect(signedOut.data ?? []).toEqual([]);

		// The view is read-only, also for the class's own teacher.
		const write = await teacher.client
			.from('attendance_current' as 'attendance_records')
			.update({ present: false })
			.eq('class_id', classId)
			.select('id');
		expect(write.data ?? []).toEqual([]);
		const { data: raw } = await adminClient
			.from('attendance_records')
			.select('present')
			.eq('class_session_id', sessionId);
		expect(raw).toEqual([{ present: true }]);
	});

	it('streak: a week whose only present mark is corrected to absent no longer qualifies; corrected back, it does', async () => {
		const classId = await createClass('Streak');
		const kid = await createStudent(classId);
		const sessionId = await sessionFor(classId, today);
		await homeworkDoneThisWeek(classId, kid);

		await mark(classId, sessionId, kid, true);
		expect(await streakOf(kid)).toBe(1);

		await mark(classId, sessionId, kid, false);
		expect(await streakOf(kid)).toBe(0);

		await mark(classId, sessionId, kid, true);
		expect(await streakOf(kid)).toBe(1);

		// The pure rule agrees with the stored value.
		const { data: computed, error } = await adminClient.rpc('compute_student_streak', {
			p_student_id: kid,
			p_class_id: classId
		});
		expect(error).toBeNull();
		const row = Array.isArray(computed) ? computed[0] : computed;
		expect(row?.current_streak).toBe(1);
	});

	it('streak: a present mark corrected to absent in a week with planned leave makes the week protected (grace 0)', async () => {
		const plusDays = (isoDate: string, n: number) => {
			const date = new Date(`${isoDate}T00:00:00Z`);
			date.setUTCDate(date.getUTCDate() + n);
			return date.toISOString().slice(0, 10);
		};
		const mondayOf = (day: string) =>
			plusDays(day, 1 - (new Date(`${day}T00:00:00Z`).getUTCDay() || 7));
		// Three consecutive far-future weeks (class days are unique school-wide),
		// so the leave is answered with long notice: planned.
		const d0 = `${3000 + Math.floor(Math.random() * 6000)}-06-0${1 + Math.floor(Math.random() * 9)}`;
		const days = [plusDays(d0, -7), d0, plusDays(d0, 7)];

		const parent = await createApprovedParent();
		const classId = await createClass('Planned Leave');
		const kid = await createStudent(classId, parent.email);
		const sessions: string[] = [];
		for (const day of days) sessions.push(await sessionFor(classId, day));
		/** Future sessions: the insert policy refuses them, so with the service role. */
		const markFuture = async (sessionId: string, present: boolean) => {
			const { error } = await adminClient.from('attendance_records').insert({
				student_id: kid,
				class_id: classId,
				class_session_id: sessionId,
				present,
				recorded_by: teacher.id
			});
			if (error) throw new Error(`Failed to mark: ${error.message}`);
		};
		// Present in all three weeks; homework done in weeks 0 and 2 only.
		for (const sessionId of sessions) await markFuture(sessionId, true);
		await homeworkDoneThisWeek(classId, kid, mondayOf(days[0]));
		await homeworkDoneThisWeek(classId, kid, mondayOf(days[2]));

		// The parent's latest answer for the middle session: on leave, planned.
		const client = anonClient();
		const { error: signInError } = await client.auth.signInWithPassword({
			email: parent.email,
			password: parent.password
		});
		expect(signInError).toBeNull();
		const leave = await client
			.from('session_leave_history')
			.insert({ class_session_id: sessions[1], student_id: kid, answer: 'on_leave' })
			.select('classification')
			.single();
		expect(leave.error).toBeNull();
		expect(leave.data?.classification).toBe('planned');

		const streak = async () => {
			const { data, error } = await adminClient.rpc('compute_student_streak', {
				p_student_id: kid,
				p_class_id: classId,
				p_as_of_week: mondayOf(days[2])
			});
			expect(error).toBeNull();
			return (Array.isArray(data) ? data[0] : data)?.current_streak;
		};

		const { data: grace } = await adminClient
			.from('app_settings')
			.select('value')
			.eq('key', 'streak_grace_weeks')
			.single();
		await adminClient
			.from('app_settings')
			.update({ value: { weeks: 0 } })
			.eq('key', 'streak_grace_weeks');
		try {
			// Marked present without homework: the middle week is a gap, and a
			// week the student attended is never protected.
			expect(await streak()).toBe(1);

			// Corrected to absent: the student attended no session that week and
			// the missed one has planned leave, so the week is protected.
			await markFuture(sessions[1], false);
			expect(await streak()).toBe(2);
		} finally {
			await adminClient
				.from('app_settings')
				.update({ value: grace!.value })
				.eq('key', 'streak_grace_weeks');
		}
	});

	it('badges: a day corrected to absent is not counted, a day corrected to present is', async () => {
		const classId = await createClass('Badge Count');
		const kid = await createStudent(classId);
		const sessions: string[] = [];
		for (let i = 1; i <= 5; i += 1) sessions.push(await sessionFor(classId, pastDay(10 + i)));

		for (const sessionId of sessions.slice(0, 4)) await mark(classId, sessionId, kid, true);
		// Day 4 was a mistake: four "present" rows on four days, three days current.
		await mark(classId, sessions[3], kid, false);
		// A fifth day present: five days have a "present" row, four count.
		await mark(classId, sessions[4], kid, true);
		expect(await attendanceBadgesOf(kid)).toEqual([1]);

		// Day 4 corrected back to present: five days count.
		await mark(classId, sessions[3], kid, true);
		expect(await attendanceBadgesOf(kid)).toEqual([1, 5]);
	});

	it('badges: an earned badge stays when the count falls below its milestone', async () => {
		const classId = await createClass('Badge Stays');
		const kid = await createStudent(classId);
		const sessionId = await sessionFor(classId, pastDay(20));

		await mark(classId, sessionId, kid, true);
		expect(await attendanceBadgesOf(kid)).toEqual([1]);

		await mark(classId, sessionId, kid, false);
		expect(await attendanceBadgesOf(kid)).toEqual([1]);
	});

	it('child_attendance returns one row per session, the current mark', async () => {
		const parent = await createApprovedParent();
		const classId = await createClass('Parent');
		const kid = await createStudent(classId, parent.email);
		const corrected = await sessionFor(classId, pastDay(21));
		const kept = await sessionFor(classId, pastDay(22));

		await mark(classId, corrected, kid, true);
		await mark(classId, kept, kid, true);
		await mark(classId, corrected, kid, false);
		// Re-saved unchanged: still one line.
		await mark(classId, kept, kid, true);

		const client = anonClient();
		const { error: signInError } = await client.auth.signInWithPassword({
			email: parent.email,
			password: parent.password
		});
		expect(signInError).toBeNull();
		const { data, error } = await client.rpc('child_attendance', { p_student_id: kid });
		expect(error).toBeNull();
		expect(data?.map((r) => ({ session_date: r.session_date, present: r.present }))).toEqual([
			{ session_date: pastDay(22), present: true },
			{ session_date: pastDay(21), present: false }
		]);
	});
});

describe.skipIf(!reachable)('#105 class day move and delete (requires local Supabase)', () => {
	let admin: Awaited<ReturnType<typeof createSignedInUser>>;
	let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
	let parent: { id: string; email: string; client: ReturnType<typeof anonClient> };
	let student: ReturnType<typeof anonClient>;
	let classId: string;
	let kid: string;

	const today = todayInBerlin();
	const plusDays = (isoDate: string, days: number) => {
		const date = new Date(`${isoDate}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() + days);
		return date.toISOString().slice(0, 10);
	};
	/**
	 * A random far-future Sunday (class days are unique school-wide and the
	 * test database is shared by every run).
	 */
	function futureSunday() {
		const start = `${3000 + Math.floor(Math.random() * 6000)}-01-01`;
		const dow = new Date(`${start}T00:00:00Z`).getUTCDay();
		return plusDays(start, ((7 - dow) % 7) + 7 * Math.floor(Math.random() * 50));
	}
	/** A random long-past Sunday. */
	function pastSunday() {
		const start = `${1000 + Math.floor(Math.random() * 800)}-01-01`;
		const dow = new Date(`${start}T00:00:00Z`).getUTCDay();
		return plusDays(start, ((7 - dow) % 7) + 7 * Math.floor(Math.random() * 50));
	}

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	/** A Sunday-only class (schedule since 1900) taught by `teacher`. */
	async function createClass(label: string) {
		const { data, error } = await adminClient
			.from('classes')
			.insert({
				name: `#105 ${label} ${crypto.randomUUID().slice(0, 8)}`,
				code: `M${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
				schedule_weekdays: [7],
				schedule_starts_on: '1900-01-01'
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		await adminClient.from('class_teachers').insert({ class_id: data.id, teacher_id: teacher.id });
		return data.id;
	}

	/** An approved child of the shared parent in `cls`. */
	async function childIn(cls: string, parentEmail: string) {
		const { id, error } = await signUpStudent({
			classId: cls,
			registrationName: `#105 Kid ${crypto.randomUUID().slice(0, 6)}`,
			guardianEmail: parentEmail
		});
		if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
		const { error: approveError } = await adminClient
			.from('profiles')
			.update({ status: 'approved', team_id: await fixtureTeamId() })
			.eq('id', id);
		if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
		return id;
	}

	/** Adds a class day with the service role (any date) and returns its id. */
	async function addDay(day: string) {
		const { data, error } = await adminClient
			.from('class_days')
			.insert({ day })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to add class day ${day}: ${error?.message}`);
		return data.id;
	}

	async function sessionOn(cls: string, dayId: string) {
		const { data } = await adminClient
			.from('class_sessions')
			.select('id')
			.eq('class_id', cls)
			.eq('class_day_id', dayId)
			.maybeSingle();
		return data?.id ?? null;
	}

	async function dayRow(id: string) {
		const { data } = await adminClient
			.from('class_days')
			.select('day, moved, cancelled')
			.eq('id', id)
			.maybeSingle();
		return data;
	}

	function answer(sessionId: string, studentId = kid) {
		return parent.client
			.from('session_leave_history')
			.insert({ class_session_id: sessionId, student_id: studentId, answer: 'coming' })
			.select('id')
			.single();
	}

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacher = await createSignedInUser('teacher');
		classId = await createClass('Sunday');
		const p = await createApprovedParent();
		parent = { id: p.id, email: p.email, client: await signIn(p.email, p.password) };
		kid = await childIn(classId, p.email);
		const password = crypto.randomUUID();
		const { data } = await adminClient.auth.admin.updateUserById(kid, { password });
		student = await signIn(data.user!.email!, password);
	}, 60000);

	it('move: the day, its sessions and their answers go to the new free future date', async () => {
		const sunday = futureSunday();
		const saturday = plusDays(sunday, -1);
		const id = await addDay(sunday);
		const sessionId = await sessionOn(classId, id);
		expect(sessionId).not.toBeNull();
		const { data: ans, error: ansError } = await answer(sessionId!);
		expect(ansError).toBeNull();

		const { data, error } = await admin.client
			.from('class_days')
			.update({ day: saturday })
			.eq('id', id)
			.select('id');
		expect(error).toBeNull();
		expect(data).toEqual([{ id }]);

		expect(await dayRow(id)).toMatchObject({ day: saturday, moved: true });
		expect(await sessionOn(classId, id)).toBe(sessionId);
		const { data: eff } = await adminClient
			.from('class_sessions_effective')
			.select('day')
			.eq('id', sessionId!)
			.single();
		expect(eff?.day).toBe(saturday);
		const { data: kept } = await adminClient
			.from('session_leave_history')
			.select('id, class_session_id')
			.eq('id', ans!.id)
			.single();
		expect(kept?.class_session_id).toBe(sessionId);
		const { data: oldDate } = await adminClient.from('class_days').select('id').eq('day', sunday);
		expect(oldDate).toEqual([]);
	});

	it('move onto a date that already has a class day is refused (23505) and nothing changes', async () => {
		const sunday = futureSunday();
		const other = plusDays(sunday, 7);
		const id = await addDay(sunday);
		await addDay(other);
		const { error } = await admin.client
			.from('class_days')
			.update({ day: other })
			.eq('id', id)
			.select('id');
		expect(error?.code).toBe('23505');
		expect(await dayRow(id)).toMatchObject({ day: sunday, moved: false });
	});

	it('move of a past day, or onto today or the past, is refused (CD001)', async () => {
		const future = await addDay(futureSunday());
		const past = pastSunday();
		const pastId = await addDay(past);
		const before = await dayRow(future);

		for (const target of [today, plusDays(today, -1), pastSunday()]) {
			const { error } = await admin.client
				.from('class_days')
				.update({ day: target })
				.eq('id', future)
				.select('id');
			expect(error?.code).toBe('CD001');
		}
		expect(await dayRow(future)).toEqual(before);

		const { error: pastError } = await admin.client
			.from('class_days')
			.update({ day: futureSunday() })
			.eq('id', pastId)
			.select('id');
		expect(pastError?.code).toBe('CD001');
		expect(await dayRow(pastId)).toMatchObject({ day: past, moved: false });
	});

	it('delete: an untouched future day and its sessions are gone', async () => {
		const id = await addDay(futureSunday());
		const sessionId = await sessionOn(classId, id);
		expect(sessionId).not.toBeNull();

		const { data, error } = await admin.client
			.from('class_days')
			.delete()
			.eq('id', id)
			.select('id');
		expect(error).toBeNull();
		expect(data).toEqual([{ id }]);
		expect(await dayRow(id)).toBeNull();
		const { data: sessions } = await adminClient
			.from('class_sessions')
			.select('id')
			.eq('id', sessionId!);
		expect(sessions).toEqual([]);
	});

	it('delete of a day with a leave answer, attendance or a sick-leave decision is refused (CD002)', async () => {
		const withAnswer = await addDay(futureSunday());
		expect((await answer((await sessionOn(classId, withAnswer))!)).error).toBeNull();

		const withMark = await addDay(futureSunday());
		const { error: markError } = await adminClient.from('attendance_records').insert({
			student_id: kid,
			class_id: classId,
			class_session_id: (await sessionOn(classId, withMark))!,
			present: true
		});
		expect(markError).toBeNull();

		// A decision needs a current Sick answer, which is only possible on a
		// session dated today or yesterday. So the fixture uses its own class
		// and child: their session today gets the answer and the decision, the
		// answer is removed and the session is re-pointed at a future day, so
		// only the decision references that day. Only rows this test created
		// are touched.
		const decisionClass = await createClass('Decision');
		const decisionKid = await childIn(decisionClass, parent.email);
		const withDecision = await addDay(futureSunday());
		const ownAutoSession = await sessionOn(decisionClass, withDecision);
		expect(ownAutoSession, 'the Sunday class has a session on the new day').not.toBeNull();
		await adminClient.from('class_sessions').delete().eq('id', ownAutoSession!);
		const { data: todayBefore } = await adminClient
			.from('class_days')
			.select('id')
			.eq('day', today)
			.maybeSingle();
		const decisionSession = await sessionFor(decisionClass, today);
		const { error: sickError } = await parent.client
			.from('session_leave_history')
			.insert({ class_session_id: decisionSession, student_id: decisionKid, answer: 'sick' });
		expect(sickError).toBeNull();
		const { error: decisionError } = await adminClient.from('sick_leave_decisions').insert({
			class_session_id: decisionSession,
			student_id: decisionKid,
			decision: 'approved'
		});
		expect(decisionError).toBeNull();
		await adminClient
			.from('session_leave_history')
			.delete()
			.eq('class_session_id', decisionSession)
			.eq('student_id', decisionKid);
		const { data: leftAnswers } = await adminClient
			.from('session_leave_history')
			.select('id')
			.eq('class_session_id', decisionSession);
		expect(leftAnswers).toEqual([]);
		const { error: repointError } = await adminClient
			.from('class_sessions')
			.update({ class_day_id: withDecision })
			.eq('id', decisionSession)
			.eq('class_id', decisionClass);
		expect(repointError).toBeNull();
		// Today's class day is removed again only when this fixture created it.
		if (!todayBefore) {
			const { data: created } = await adminClient
				.from('class_days')
				.select('id')
				.eq('day', today)
				.single();
			await adminClient.from('class_days').delete().eq('id', created!.id);
		}

		const { error: decisionDelete } = await admin.client
			.from('class_days')
			.delete()
			.eq('id', withDecision)
			.select('id');
		expect(decisionDelete?.code).toBe('CD002');
		expect(await sessionOn(decisionClass, withDecision)).toBe(decisionSession);

		for (const id of [withAnswer, withMark]) {
			const { error } = await admin.client.from('class_days').delete().eq('id', id).select('id');
			expect(error?.code).toBe('CD002');
			expect(await dayRow(id)).not.toBeNull();
			expect(await sessionOn(classId, id)).not.toBeNull();
		}
	});

	it('delete of a past day is refused (CD001)', async () => {
		const id = await addDay(pastSunday());
		const { error } = await admin.client.from('class_days').delete().eq('id', id).select('id');
		expect(error?.code).toBe('CD001');
		expect(await dayRow(id)).not.toBeNull();
	});

	it('teacher, parent and student can neither move nor delete a class day', async () => {
		const sunday = futureSunday();
		const id = await addDay(sunday);
		for (const client of [teacher.client, parent.client, student]) {
			const { data: moved } = await client
				.from('class_days')
				.update({ day: plusDays(sunday, -1) })
				.eq('id', id)
				.select('id');
			expect(moved ?? []).toEqual([]);
			const { data: deleted } = await client.from('class_days').delete().eq('id', id).select('id');
			expect(deleted ?? []).toEqual([]);
		}
		expect(await dayRow(id)).toMatchObject({ day: sunday, moved: false });
	});

	it('cancel and restore of a past day still work for the admin', async () => {
		const id = await addDay(pastSunday());
		const { data: cancelled, error } = await admin.client
			.from('class_days')
			.update({ cancelled: true })
			.eq('id', id)
			.select('id');
		expect(error).toBeNull();
		expect(cancelled).toEqual([{ id }]);
		const { data: restored } = await admin.client
			.from('class_days')
			.update({ cancelled: false })
			.eq('id', id)
			.select('id');
		expect(restored).toEqual([{ id }]);
		expect(await dayRow(id)).toMatchObject({ cancelled: false, moved: false });
	});

	it("a schedule edit after a move keeps the moved day's sessions and answers", async () => {
		const ownClass = await createClass('Regenerate');
		const ownKid = await childIn(ownClass, parent.email);

		const sunday = futureSunday();
		const movedId = await addDay(sunday);
		const stayId = await addDay(plusDays(sunday, 7));
		const movedSession = (await sessionOn(ownClass, movedId))!;
		const { data: ans, error: ansError } = await answer(movedSession, ownKid);
		expect(ansError).toBeNull();

		const { error: moveError } = await admin.client
			.from('class_days')
			.update({ day: plusDays(sunday, -1) })
			.eq('id', movedId)
			.select('id');
		expect(moveError).toBeNull();

		// Sunday-only -> Monday-only: neither Saturday nor Sunday matches now.
		const { error: scheduleError } = await admin.client.rpc('set_class_schedule', {
			p_class_id: ownClass,
			p_weekdays: [1],
			p_start_time: null,
			p_duration_minutes: null,
			p_starts_on: '1900-01-01',
			p_ends_on: null,
			p_interval_weeks: 1
		});
		expect(scheduleError).toBeNull();

		expect(await sessionOn(ownClass, movedId)).toBe(movedSession);
		const { data: kept } = await adminClient
			.from('session_leave_history')
			.select('id')
			.eq('id', ans!.id);
		expect(kept).toHaveLength(1);
		// An unmoved non-matching future day still loses its session.
		expect(await sessionOn(ownClass, stayId)).toBeNull();
	});
	/**
	 * Runs `fn` with the class day on `day`: the existing one, or one this
	 * test adds (service role) and removes again afterwards.
	 */
	async function withDayOn(day: string, fn: (id: string) => Promise<void>) {
		const { data: existing } = await adminClient
			.from('class_days')
			.select('id')
			.eq('day', day)
			.maybeSingle();
		const id = existing?.id ?? (await addDay(day));
		try {
			await fn(id);
		} finally {
			if (!existing) await adminClient.from('class_days').delete().eq('id', id);
		}
	}

	it("today's class day can be neither moved to a free future date nor deleted (CD001)", async () => {
		await withDayOn(today, async (id) => {
			const before = await dayRow(id);
			const { error: moveError } = await admin.client
				.from('class_days')
				.update({ day: futureSunday() })
				.eq('id', id)
				.select('id');
			expect(moveError?.code).toBe('CD001');
			const { error: deleteError } = await admin.client
				.from('class_days')
				.delete()
				.eq('id', id)
				.select('id');
			expect(deleteError?.code).toBe('CD001');
			expect(await dayRow(id)).toEqual(before);
		});
	});

	it("tomorrow's class day can be moved (the boundary is today)", async () => {
		const tomorrow = plusDays(today, 1);
		await withDayOn(tomorrow, async (id) => {
			const before = await dayRow(id);
			const target = futureSunday();
			const { data, error } = await admin.client
				.from('class_days')
				.update({ day: target })
				.eq('id', id)
				.select('id');
			expect(error).toBeNull();
			expect(data).toEqual([{ id }]);
			expect(await dayRow(id)).toMatchObject({ day: target, moved: true });
			// Put a day that existed before back as it was (service role: no guard).
			await adminClient.from('class_days').update({ day: tomorrow }).eq('id', id);
			await adminClient.from('class_days').update({ moved: before!.moved }).eq('id', id);
		});
	});

	it("a move carries the day's attendance session_date to the new date", async () => {
		const sunday = futureSunday();
		const id = await addDay(sunday);
		const sessionId = (await sessionOn(classId, id))!;
		const { data: mark, error: markError } = await adminClient
			.from('attendance_records')
			.insert({ student_id: kid, class_id: classId, class_session_id: sessionId, present: true })
			.select('id, session_date')
			.single();
		expect(markError).toBeNull();
		expect(mark?.session_date).toBe(sunday);

		const saturday = plusDays(sunday, -1);
		const { error } = await admin.client
			.from('class_days')
			.update({ day: saturday })
			.eq('id', id)
			.select('id');
		expect(error).toBeNull();
		const { data: after } = await adminClient
			.from('attendance_records')
			.select('session_date')
			.eq('id', mark!.id)
			.single();
		expect(after?.session_date).toBe(saturday);
	});

	it('a schedule edit adds no session to a moved day', async () => {
		const sunday = futureSunday();
		const saturday = plusDays(sunday, -1);
		const movedId = await addDay(sunday);
		const plainSaturday = await addDay(plusDays(saturday, 7));
		const { error: moveError } = await admin.client
			.from('class_days')
			.update({ day: saturday })
			.eq('id', movedId)
			.select('id');
		expect(moveError).toBeNull();

		// Sunday-only -> Saturday-only: the moved day (now a Saturday) matches.
		const otherClass = await createClass('Saturday Later');
		expect(await sessionOn(otherClass, movedId)).toBeNull();
		const { error: scheduleError } = await admin.client.rpc('set_class_schedule', {
			p_class_id: otherClass,
			p_weekdays: [6],
			p_start_time: null,
			p_duration_minutes: null,
			p_starts_on: '1900-01-01',
			p_ends_on: null,
			p_interval_weeks: 1
		});
		expect(scheduleError).toBeNull();

		expect(await sessionOn(otherClass, movedId)).toBeNull();
		// An unmoved matching future day does get one.
		expect(await sessionOn(otherClass, plainSaturday)).not.toBeNull();
	});
});

/**
 * #110 (0053): PDF files on a homework. The table's policies and the storage
 * bucket's, against the local bucket, as each kind of caller: the class's
 * teacher and the admin change them; the students the homework is set for
 * and their approved parents read them; nobody else. Also the app's own
 * removal and signed-link helpers with real clients, and a weekly series'
 * next copy showing the series' files.
 */
describe.skipIf(!reachable)('0053 homework files (requires local Supabase)', () => {
	type SignedIn = Awaited<ReturnType<typeof createSignedInUser>>;
	type Client = ReturnType<typeof anonClient>;
	let admin: SignedIn;
	let teacher: SignedIn;
	let otherTeacher: SignedIn;
	let targeted: { id: string; client: Client };
	let untargeted: { id: string; client: Client };
	let outsider: Client;
	let targetedParent: Client;
	let untargetedParent: Client;
	const signedOut = anonClient();
	let classId: string;
	let otherClassId: string;
	let otherAssignmentId: string;

	const name = (label: string) => `0053 ${label} ${crypto.randomUUID().slice(0, 8)}`;
	const bucket = (client: Client | typeof adminClient) =>
		client.storage.from(HOMEWORK_FILES_BUCKET);
	const pathIn = (cls: string, assignment: string) =>
		`${cls}/${assignment}/${crypto.randomUUID()}.pdf`;

	function pdfBytes(size = 2048): ArrayBuffer {
		const bytes = new Uint8Array(size);
		bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
		return bytes.buffer;
	}

	const put = (
		client: Client,
		path: string,
		body: ArrayBuffer = pdfBytes(),
		type = 'application/pdf'
	) => bucket(client).upload(path, body, { contentType: type, upsert: false });

	const record = (
		client: Client | typeof adminClient,
		assignment: string,
		path: string,
		fileName = 'Worksheet.pdf'
	) =>
		client
			.from('homework_assignment_files')
			.insert({
				assignment_id: assignment,
				object_path: path,
				file_name: fileName,
				size_bytes: 2048
			})
			.select('id');

	/** A stored file made by the service role: object and row. */
	async function stored(cls: string, assignment: string, fileName = 'Worksheet.pdf') {
		const path = pathIn(cls, assignment);
		const { error } = await bucket(adminClient).upload(path, pdfBytes(), {
			contentType: 'application/pdf'
		});
		if (error) throw new Error(`Failed to store object: ${error.message}`);
		const { data, error: rowError } = await record(adminClient, assignment, path, fileName);
		if (rowError || !data) throw new Error(`Failed to record file: ${rowError?.message}`);
		return { id: data[0].id, path };
	}

	const objectExists = async (path: string) =>
		(await bucket(adminClient).exists(path)).data === true;

	async function makeClass(label: string, teacherId: string) {
		const { data, error } = await adminClient
			.from('classes')
			.insert({ name: name(label), code: `H${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create class: ${error?.message}`);
		const { error: assignError } = await adminClient
			.from('class_teachers')
			.insert({ class_id: data.id, teacher_id: teacherId });
		if (assignError) throw new Error(`Failed to assign teacher: ${assignError.message}`);
		return data.id;
	}

	/** A one-off homework in `forClass`, set for `students` only. */
	async function oneOff(forClass: string, createdBy: string, students: string[]) {
		const { data, error } = await adminClient
			.from('homework_assignments')
			.insert({
				class_id: forClass,
				title: name('Homework'),
				skill_area: 'language',
				whole_class: false,
				created_by: createdBy
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(`Failed to create homework: ${error?.message}`);
		const due = todayInBerlin();
		const { data: instance, error: instanceError } = await adminClient
			.from('homework_instances')
			.insert({ assignment_id: data.id, class_id: forClass, period_start: due, due_date: due })
			.select('id')
			.single();
		if (instanceError || !instance) {
			throw new Error(`Failed to create copy: ${instanceError?.message}`);
		}
		for (const studentId of students) {
			const { error: historyError } = await adminClient.from('homework_status_history').insert({
				instance_id: instance.id,
				student_id: studentId,
				class_id: forClass,
				status: 'assigned',
				recorded_by: createdBy
			});
			if (historyError) throw new Error(`Failed to assign: ${historyError.message}`);
		}
		return data.id;
	}

	async function signIn(email: string, password: string) {
		const client = anonClient();
		const { error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Failed to sign in: ${error.message}`);
		return client;
	}

	/** An approved student enrolled in `forClass`, signed in; `guardianEmail` links a parent. */
	async function student(forClass: string, guardianEmail?: string) {
		const { id, error } = await signUpStudent({
			classId: forClass,
			registrationName: name('Student'),
			guardianEmail
		});
		if (error || !id) throw new Error(`Failed to register student: ${error?.message}`);
		const { error: approveError } = await adminClient
			.from('profiles')
			// #99: an approval needs a team; the fixture team, so this block
			// does not depend on teams left by earlier blocks.
			.update({
				status: 'approved',
				display_name: name('Student'),
				team_id: await fixtureTeamId()
			})
			.eq('id', id);
		if (approveError) throw new Error(`Failed to approve student: ${approveError.message}`);
		const password = crypto.randomUUID();
		const { data } = await adminClient.auth.admin.updateUserById(id, { password });
		return { id, client: await signIn(data.user!.email!, password) };
	}

	beforeAll(async () => {
		admin = await createSignedInUser('admin');
		teacher = await createSignedInUser('teacher');
		otherTeacher = await createSignedInUser('teacher');
		classId = await makeClass('Class', teacher.id);
		otherClassId = await makeClass('Other', otherTeacher.id);
		const guardian = await createApprovedParent();
		const otherGuardian = await createApprovedParent();
		targeted = await student(classId, guardian.email);
		untargeted = await student(classId, otherGuardian.email);
		targetedParent = await signIn(guardian.email, guardian.password);
		untargetedParent = await signIn(otherGuardian.email, otherGuardian.password);
		outsider = (await student(otherClassId)).client;
		otherAssignmentId = await oneOff(otherClassId, otherTeacher.id, []);
	}, 60000);

	afterAll(async () => {
		// Leave no objects of these classes in the local bucket.
		for (const cls of [classId, otherClassId]) {
			const { data: folders } = await bucket(adminClient).list(cls);
			for (const folder of folders ?? []) {
				const { data: objects } = await bucket(adminClient).list(`${cls}/${folder.name}`);
				const paths = (objects ?? []).map((o) => `${cls}/${folder.name}/${o.name}`);
				if (paths.length) await bucket(adminClient).remove(paths);
			}
		}
	});

	it('the bucket is private, 5 MB, PDF only', async () => {
		const { data, error } = await adminClient.storage.getBucket(HOMEWORK_FILES_BUCKET);
		expect(error).toBeNull();
		expect(data).toMatchObject({
			public: false,
			file_size_limit: 5242880,
			allowed_mime_types: ['application/pdf']
		});
	});

	it("the class's teacher and the admin upload and record files; they, the targeted student and that student's parent read them", async () => {
		const assignmentId = await oneOff(classId, teacher.id, [targeted.id]);
		const teacherPath = pathIn(classId, assignmentId);
		const adminPath = pathIn(classId, assignmentId);
		expect((await put(teacher.client, teacherPath)).error).toBeNull();
		expect((await put(admin.client, adminPath)).error).toBeNull();
		const first = await record(teacher.client, assignmentId, teacherPath, 'Worksheet 1.pdf');
		const second = await record(admin.client, assignmentId, adminPath, 'གཞས་ཚིག.pdf');
		expect(first.error ?? second.error).toBeNull();

		for (const [who, client] of [
			['teacher', teacher.client],
			['admin', admin.client],
			['targeted student', targeted.client],
			['parent of the targeted student', targetedParent]
		] as const) {
			const rows = await client
				.from('homework_assignment_files')
				.select('file_name')
				.eq('assignment_id', assignmentId)
				.order('created_at');
			expect(rows.data, who).toEqual([
				{ file_name: 'Worksheet 1.pdf' },
				{ file_name: 'གཞས་ཚིག.pdf' }
			]);

			const download = await bucket(client).download(teacherPath);
			expect(download.error, who).toBeNull();
			expect(await download.data!.slice(0, 5).text(), who).toBe('%PDF-');

			const url = await signedHomeworkFileUrl(client as never, first.data![0].id, false);
			expect(url, who).toContain(`/object/sign/${HOMEWORK_FILES_BUCKET}/${teacherPath}?token=`);
			const response = await fetch(url!);
			expect(response.status, who).toBe(200);
			expect(response.headers.get('content-type'), who).toBe('application/pdf');
			await response.arrayBuffer();
		}
	});

	it("another class's teacher, a student it is not set for, the parent of an untargeted child, a student of another class and a signed-out visitor see no row and get no object or link", async () => {
		const assignmentId = await oneOff(classId, teacher.id, [targeted.id]);
		const file = await stored(classId, assignmentId);
		for (const [who, client] of [
			['other teacher', otherTeacher.client],
			['student not set the homework', untargeted.client],
			['parent of an untargeted child', untargetedParent],
			['student of another class', outsider],
			['signed out', signedOut]
		] as const) {
			const rows = await client
				.from('homework_assignment_files')
				.select('id')
				.eq('assignment_id', assignmentId);
			expect(rows.data ?? [], who).toEqual([]);

			const download = await bucket(client).download(file.path);
			expect(download.error, who).not.toBeNull();
			expect(download.data, who).toBeNull();

			const signed = await bucket(client).createSignedUrl(file.path, 60);
			expect(signed.error, who).not.toBeNull();
			expect(signed.data?.signedUrl, who).toBeUndefined();

			const listed = await bucket(client).list(`${classId}/${assignmentId}`);
			expect(listed.data ?? [], who).toEqual([]);

			expect(await signedHomeworkFileUrl(client as never, file.id, false), who).toBeNull();
		}

		// No public address, and a guessed signed address without a token, work.
		const base = `${PUBLIC_SUPABASE_URL}/storage/v1/object`;
		for (const url of [
			`${base}/public/${HOMEWORK_FILES_BUCKET}/${file.path}`,
			`${base}/${HOMEWORK_FILES_BUCKET}/${file.path}`,
			`${base}/sign/${HOMEWORK_FILES_BUCKET}/${file.path}?token=guess`
		]) {
			const response = await fetch(url);
			expect(response.status, url).toBeGreaterThanOrEqual(400);
			expect(await response.text()).not.toContain('%PDF-');
		}
	});

	it('students, parents, other teachers and signed-out visitors cannot upload, record, change or remove a file', async () => {
		const assignmentId = await oneOff(classId, teacher.id, [targeted.id]);
		const existing = await stored(classId, assignmentId);
		for (const [who, client] of [
			['targeted student', targeted.client],
			['parent of the targeted student', targetedParent],
			['other teacher', otherTeacher.client],
			['signed out', signedOut]
		] as const) {
			const path = pathIn(classId, assignmentId);
			expect((await put(client, path)).error, who).not.toBeNull();
			expect(await objectExists(path), who).toBe(false);

			const inserted = await record(client, assignmentId, pathIn(classId, assignmentId));
			expect(inserted.error, who).not.toBeNull();

			const renamed = await client
				.from('homework_assignment_files')
				.update({ file_name: 'hijacked.pdf' })
				.eq('id', existing.id)
				.select('id');
			expect(renamed.data ?? [], who).toEqual([]);

			const deleted = await client
				.from('homework_assignment_files')
				.delete()
				.eq('id', existing.id)
				.select('id');
			expect(deleted.data ?? [], who).toEqual([]);

			const removed = await bucket(client).remove([existing.path]);
			expect(removed.data ?? [], who).toEqual([]);
		}
		expect(await objectExists(existing.path)).toBe(true);
		const { data } = await adminClient
			.from('homework_assignment_files')
			.select('file_name')
			.eq('id', existing.id);
		expect(data).toEqual([{ file_name: 'Worksheet.pdf' }]);
	});

	it('the bucket refuses a file over 5 MB and a file that is not declared a PDF', async () => {
		const assignmentId = await oneOff(classId, teacher.id, []);
		const big = pathIn(classId, assignmentId);
		expect((await put(teacher.client, big, pdfBytes(5242881))).error).not.toBeNull();
		expect(await objectExists(big)).toBe(false);

		const exact = pathIn(classId, assignmentId);
		expect((await put(teacher.client, exact, pdfBytes(5242880))).error).toBeNull();
		await bucket(adminClient).remove([exact]);

		const image = pathIn(classId, assignmentId);
		expect((await put(teacher.client, image, pdfBytes(), 'image/png')).error).not.toBeNull();
		expect(await objectExists(image)).toBe(false);
	});

	it("a teacher uploads only into a homework's folder of their own class, and a row only points into its own homework's folder", async () => {
		const assignmentId = await oneOff(classId, teacher.id, []);
		for (const path of [
			pathIn(otherClassId, otherAssignmentId),
			pathIn(classId, otherAssignmentId),
			pathIn(classId, crypto.randomUUID()),
			`${classId}/${assignmentId}/Worksheet.pdf`,
			`${classId}/${assignmentId}/${crypto.randomUUID()}.docx`,
			`${classId}/${crypto.randomUUID()}.pdf`
		]) {
			expect((await put(teacher.client, path)).error, path).not.toBeNull();
			expect(await objectExists(path), path).toBe(false);
		}
		// A row of this homework pointing at another homework's folder.
		const otherHomework = await oneOff(classId, teacher.id, []);
		const misplaced = await record(teacher.client, assignmentId, pathIn(classId, otherHomework));
		expect(misplaced.error).not.toBeNull();
		// A file of another class's homework: refused.
		const foreign = await record(
			teacher.client,
			otherAssignmentId,
			pathIn(otherClassId, otherAssignmentId)
		);
		expect(foreign.error).not.toBeNull();
	});

	it("the class's teacher cannot point a file at another homework's or class's folder, nor move it to another homework", async () => {
		const assignmentId = await oneOff(classId, teacher.id, []);
		const otherHomework = await oneOff(classId, teacher.id, []);
		const file = await stored(classId, assignmentId);
		const read = async () =>
			(
				await adminClient
					.from('homework_assignment_files')
					.select('assignment_id, object_path')
					.eq('id', file.id)
					.single()
			).data;
		const before = await read();

		for (const [what, values] of [
			["another homework's folder", { object_path: pathIn(classId, otherHomework) }],
			["another class's folder", { object_path: pathIn(otherClassId, otherAssignmentId) }],
			['another homework', { assignment_id: otherHomework }]
		] as const) {
			const { data, error } = await teacher.client
				.from('homework_assignment_files')
				.update(values)
				.eq('id', file.id)
				.select('id');
			expect(error, what).not.toBeNull();
			expect(data ?? [], what).toEqual([]);
		}
		expect(await read()).toEqual(before);
		expect(before).toEqual({ assignment_id: assignmentId, object_path: file.path });
	});

	it('a homework holds at most 2 files (HF001)', async () => {
		const assignmentId = await oneOff(classId, teacher.id, []);
		await stored(classId, assignmentId);
		await stored(classId, assignmentId);
		const third = await record(teacher.client, assignmentId, pathIn(classId, assignmentId));
		expect(third.error?.code).toBe(HOMEWORK_FILE_LIMIT_ERROR_CODE);
	});

	it('archiving a copy keeps the files', async () => {
		const assignmentId = await oneOff(classId, teacher.id, [targeted.id]);
		const file = await stored(classId, assignmentId);
		const { error } = await teacher.client
			.from('homework_instances')
			.update({ archived_at: new Date().toISOString(), archived_by: teacher.id })
			.eq('assignment_id', assignmentId);
		expect(error).toBeNull();
		const rows = await targeted.client
			.from('homework_assignment_files')
			.select('id')
			.eq('assignment_id', assignmentId);
		expect(rows.data).toEqual([{ id: file.id }]);
		expect(await objectExists(file.path)).toBe(true);
	});

	it("a weekly series' next copy, made by the nightly job, shows the series' two files to a targeted student", async () => {
		const today = todayInBerlin();
		const d = new Date(`${today}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() - 7);
		const startDate = d.toISOString().slice(0, 10);
		const { data: series, error } = await teacher.client
			.from('homework_assignments')
			.insert({
				class_id: classId,
				title: name('Weekly'),
				skill_area: 'song',
				created_by: teacher.id,
				recurrence_rule: { frequency: 'weekly' },
				recurrence_start_date: startDate,
				due_offset_days: 7
			})
			.select('id')
			.single();
		expect(error).toBeNull();
		const generateUpTo = (day: string) =>
			adminClient.rpc('generate_recurring_homework_for_series', {
				p_assignment_id: series!.id,
				p_today: day
			});
		// The first week, then the files, then the next week by the job.
		expect((await generateUpTo(startDate)).data).toBe(1);
		await stored(classId, series!.id, 'Lyrics.pdf');
		await stored(classId, series!.id, 'Chords.pdf');
		expect((await generateUpTo(today)).data).toBe(1);

		const { data: copies } = await targeted.client
			.from('homework_instances')
			.select('id, assignment_id, period_start')
			.eq('assignment_id', series!.id)
			.order('period_start');
		expect(copies?.map((c) => c.period_start)).toEqual([startDate, today]);
		const { files } = await loadHomeworkFiles(targeted.client as never, [copies![1].assignment_id]);
		expect(files.get(series!.id)?.map((f) => f.name)).toEqual(['Lyrics.pdf', 'Chords.pdf']);
	});

	it("deleting the class: the app's removal leaves no object of the class in the bucket", async () => {
		const doomedClass = await makeClass('Doomed', teacher.id);
		const assignmentId = await oneOff(doomedClass, teacher.id, []);
		const a = await stored(doomedClass, assignmentId);
		const b = await stored(doomedClass, assignmentId);

		// A teacher of the class may remove; the admin is who deletes a class.
		const result = await removeStoredHomeworkFiles(admin.client as never, {
			classId: doomedClass
		});
		expect(result).toEqual({ ok: true, removed: 2 });
		expect(await objectExists(a.path)).toBe(false);
		expect(await objectExists(b.path)).toBe(false);
		const { error } = await admin.client.from('classes').delete().eq('id', doomedClass);
		expect(error).toBeNull();
		const { data: left } = await bucket(adminClient).list(doomedClass);
		expect(left ?? []).toEqual([]);
	});
});

describe.skipIf(!reachable)(
	'spec-second-parent story 1: student_parents (requires local Supabase)',
	() => {
		type Client = ReturnType<typeof anonClient>;
		let admin: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
		let classId: string;
		let teamId: string;

		const name = (label: string) => `SSP1 ${label} ${crypto.randomUUID().slice(0, 8)}`;

		async function signIn(email: string, password: string): Promise<Client> {
			const client = anonClient();
			const { error } = await client.auth.signInWithPassword({ email, password });
			if (error) throw new Error(`Failed to sign in: ${error.message}`);
			return client;
		}

		/** A child registered by `parent` through the sign-up, then approved. */
		async function child(parentEmail: string, approve = true) {
			const { id, error } = await signUpStudent({
				classId,
				registrationName: name('Kid'),
				guardianEmail: parentEmail
			});
			if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
			if (approve) {
				const { error: approveError } = await adminClient
					.from('profiles')
					.update({ status: 'approved', team_id: teamId })
					.eq('id', id);
				if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
			}
			return id;
		}

		async function activeLinks(studentId: string) {
			const { data, error } = await adminClient
				.from('student_parents')
				.select('parent_id, slot, invited_by, removed_at')
				.eq('student_id', studentId)
				.is('removed_at', null)
				.order('slot');
			if (error) throw new Error(`read links: ${error.message}`);
			return data ?? [];
		}

		/** A child of parent A with parent B linked in slot 2. */
		async function twoParentFamily() {
			const a = await createApprovedParent();
			const b = await createApprovedParent();
			const studentId = await child(a.email);
			await linkParent(adminClient, studentId, b.id);
			return { a, b, studentId };
		}

		const removeLink = (studentId: string, parentId: string) =>
			adminClient
				.from('student_parents')
				.update({ removed_at: new Date().toISOString(), removed_by: admin.id })
				.eq('student_id', studentId)
				.eq('parent_id', parentId)
				.is('removed_at', null)
				.select('id');

		beforeAll(async () => {
			admin = await createSignedInUser('admin');
			teacher = await createSignedInUser('teacher');
			const { data: cls, error } = await adminClient
				.from('classes')
				.insert({ name: name('Class'), code: `P${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
				.select('id')
				.single();
			if (error || !cls) throw new Error(`Failed to create class: ${error?.message}`);
			classId = cls.id;
			await adminClient
				.from('class_teachers')
				.insert({ class_id: classId, teacher_id: teacher.id });
			const { data: team, error: teamError } = await adminClient
				.from('teams')
				.insert({ name: name('Team') })
				.select('id')
				.single();
			if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
			teamId = team.id;
		}, 30000);

		it('Sign-up: the profile records who registered it and a slot-1 link is created in the same transaction', async () => {
			const parent = await createApprovedParent();
			const id = await child(parent.email, false);

			const { data: profile } = await adminClient
				.from('profiles')
				.select('registered_by_parent_id')
				.eq('id', id)
				.single();
			expect(profile).toEqual({ registered_by_parent_id: parent.id });
			expect(await activeLinks(id)).toEqual([
				{ parent_id: parent.id, slot: 1, invited_by: null, removed_at: null }
			]);
		});

		it('Sign-up: no approved parent for the guardian email rolls back the profile and the link', async () => {
			const registrationName = name('Orphan');
			const { error } = await signUpStudent({
				classId,
				registrationName,
				guardianEmail: `ssp-nobody-${crypto.randomUUID()}@example.test`
			});
			expect(error).not.toBeNull();
			const { data } = await adminClient
				.from('profiles')
				.select('id')
				.eq('registration_name', registrationName);
			expect(data).toEqual([]);
		});

		it('Third link: slot 3, a duplicate active slot and a duplicate active parent are refused', async () => {
			const { a, b, studentId } = await twoParentFamily();
			const c = await createApprovedParent();

			const slot3 = await adminClient
				.from('student_parents')
				.insert({ student_id: studentId, parent_id: c.id, slot: 3 as 1 });
			expect(slot3.error?.code).toBe('23514');

			const sameSlot = await adminClient
				.from('student_parents')
				.insert({ student_id: studentId, parent_id: c.id, slot: 2 });
			expect(sameSlot.error?.code).toBe('23505');
			expect(sameSlot.error?.message).toContain('student_parents_active_slot_unique');

			// A removed slot is free again, but the same parent twice is not.
			expect((await removeLink(studentId, b.id)).error).toBeNull();
			const samePerson = await adminClient
				.from('student_parents')
				.insert({ student_id: studentId, parent_id: a.id, slot: 2 });
			expect(samePerson.error?.code).toBe('23505');
			expect(samePerson.error?.message).toContain('student_parents_active_parent_unique');

			expect((await activeLinks(studentId)).map((l) => l.parent_id)).toEqual([a.id]);
		});

		it('Last link: deleting or removing the only active link of an existing student is refused', async () => {
			const parent = await createApprovedParent();
			const studentId = await child(parent.email);

			const deleted = await adminClient
				.from('student_parents')
				.delete()
				.eq('student_id', studentId);
			expect(deleted.error?.hint).toBe('last_parent_link');
			const removed = await removeLink(studentId, parent.id);
			expect(removed.error?.hint).toBe('last_parent_link');

			expect(await activeLinks(studentId)).toEqual([
				{ parent_id: parent.id, slot: 1, invited_by: null, removed_at: null }
			]);
		});

		it('Concurrent removals: of two removals at once, exactly one succeeds and one link stays', async () => {
			const { a, b, studentId } = await twoParentFamily();

			const results = await Promise.all([removeLink(studentId, a.id), removeLink(studentId, b.id)]);
			const failed = results.filter((r) => r.error);
			expect(failed).toHaveLength(1);
			expect(failed[0].error?.hint).toBe('last_parent_link');
			expect(await activeLinks(studentId)).toHaveLength(1);
		});

		it('Removed row: set once and never changed again', async () => {
			const { b, studentId } = await twoParentFamily();
			expect((await removeLink(studentId, b.id)).error).toBeNull();

			const { data: removed } = await adminClient
				.from('student_parents')
				.select('id, removed_at')
				.eq('student_id', studentId)
				.eq('parent_id', b.id)
				.single();
			expect(removed?.removed_at).not.toBeNull();

			for (const change of [
				{ removed_at: null },
				{ removed_at: new Date(Date.now() + 60_000).toISOString() },
				{ removed_by: teacher.id },
				{ slot: 1 as const }
			]) {
				const { error } = await adminClient
					.from('student_parents')
					.update(change)
					.eq('id', removed!.id);
				expect(error?.code, JSON.stringify(change)).toBe('42501');
			}
			const { data: after } = await adminClient
				.from('student_parents')
				.select('removed_at, removed_by')
				.eq('id', removed!.id)
				.single();
			expect(after).toEqual({ removed_at: removed!.removed_at, removed_by: admin.id });
		});

		it('Removal without removed_by is refused (the audit)', async () => {
			const { a, b, studentId } = await twoParentFamily();
			const { error } = await adminClient
				.from('student_parents')
				.update({ removed_at: new Date().toISOString() })
				.eq('student_id', studentId)
				.eq('parent_id', b.id);
			expect(error?.code).toBe('23514');
			expect((await activeLinks(studentId)).map((l) => l.parent_id)).toEqual([a.id, b.id]);
		});

		it('Insert: a link to a non-student, to a profile without a parents row, or already removed is refused', async () => {
			const parent = await createApprovedParent();
			const studentId = await child(parent.email);
			const other = await createApprovedParent();
			const noParentsRow = await createSignedInUser('teacher');

			const toTeacher = await adminClient
				.from('student_parents')
				.insert({ student_id: teacher.id, parent_id: other.id, slot: 1 });
			expect(toTeacher.error?.code).toBe('23514');
			expect(toTeacher.error?.message).toContain('needs a student');

			const withoutRow = await adminClient
				.from('student_parents')
				.insert({ student_id: studentId, parent_id: noParentsRow.id, slot: 2 });
			expect(withoutRow.error?.code).toBe('23514');
			expect(withoutRow.error?.message).toContain('needs a parent account');

			const removed = await adminClient.from('student_parents').insert({
				student_id: studentId,
				parent_id: other.id,
				slot: 2,
				removed_at: new Date().toISOString(),
				removed_by: admin.id
			});
			expect(removed.error?.code).toBe('23514');

			expect((await activeLinks(studentId)).map((l) => l.parent_id)).toEqual([parent.id]);
		});

		it('Active link: only removal is allowed, not moving it to another student or parent', async () => {
			const { a, b, studentId } = await twoParentFamily();
			const other = await createApprovedParent();
			for (const change of [{ parent_id: other.id }, { student_id: a.id }, { slot: 2 as const }]) {
				const { error } = await adminClient
					.from('student_parents')
					.update(change)
					.eq('student_id', studentId)
					.eq('parent_id', a.id);
				expect(error?.code, JSON.stringify(change)).toBe('42501');
			}
			expect((await activeLinks(studentId)).map((l) => l.parent_id)).toEqual([a.id, b.id]);
		});

		it('Student deleted: the links cascade and the delete succeeds', async () => {
			const { studentId } = await twoParentFamily();
			const { error } = await adminClient.auth.admin.deleteUser(studentId);
			expect(error).toBeNull();
			const { data } = await adminClient
				.from('student_parents')
				.select('id')
				.eq('student_id', studentId);
			expect(data).toEqual([]);
		});

		it('Parent revoked: an approved parent with links cannot be rejected or deleted', async () => {
			const parent = await createApprovedParent();
			await child(parent.email);

			const rejected = await adminClient
				.from('parents')
				.update({ status: 'rejected' })
				.eq('id', parent.id);
			expect(rejected.error?.hint).toBe('parent_has_links');
			// Through the admin's own update policy too.
			const viaAdmin = await admin.client
				.from('parents')
				.update({ status: 'rejected' })
				.eq('id', parent.id);
			expect(viaAdmin.error?.hint).toBe('parent_has_links');

			const deletedRow = await adminClient.from('parents').delete().eq('id', parent.id);
			expect(deletedRow.error?.hint).toBe('parent_has_links');
			const deletedUser = await adminClient.auth.admin.deleteUser(parent.id);
			expect(deletedUser.error).not.toBeNull();

			const { data } = await adminClient.from('parents').select('status').eq('id', parent.id);
			expect(data).toEqual([{ status: 'approved' }]);
		});

		it('Parent revoked: a pending parent with an active link cannot be rejected', async () => {
			const parent = await createApprovedParent();
			const studentId = await child(parent.email);
			const pending = await createPendingParent();
			await linkParent(adminClient, studentId, pending.id);

			const { error } = await adminClient
				.from('parents')
				.update({ status: 'rejected' })
				.eq('id', pending.id);
			expect(error?.hint).toBe('parent_has_links');
			const { data } = await adminClient.from('parents').select('status').eq('id', pending.id);
			expect(data).toEqual([{ status: 'pending' }]);
		});

		it('Parent without links: a pending parent can still be rejected', async () => {
			const pending = await createPendingParent();
			const { error } = await adminClient
				.from('parents')
				.update({ status: 'rejected' })
				.eq('id', pending.id);
			expect(error).toBeNull();
		});

		it('RLS: each active parent sees the active links of their child, the admin sees all; others, the student and clients writing see nothing', async () => {
			const { a, b, studentId } = await twoParentFamily();
			const stranger = await createApprovedParent();
			const clientA = await signIn(a.email, a.password);
			const clientB = await signIn(b.email, b.password);
			const strangerClient = await signIn(stranger.email, stranger.password);
			const read = async (client: Client) =>
				(
					await client
						.from('student_parents')
						.select('parent_id')
						.eq('student_id', studentId)
						.order('slot')
				).data?.map((r) => r.parent_id) ?? [];

			expect(await read(clientA)).toEqual([a.id, b.id]);
			expect(await read(clientB)).toEqual([a.id, b.id]);
			expect(await read(admin.client)).toEqual([a.id, b.id]);
			expect(await read(strangerClient)).toEqual([]);
			expect(await read(teacher.client)).toEqual([]);

			const password = crypto.randomUUID();
			const { data: auth } = await adminClient.auth.admin.updateUserById(studentId, { password });
			const studentClient = await signIn(auth.user!.email!, password);
			expect(await read(studentClient)).toEqual([]);

			// No client writes: not the parent, not the admin.
			for (const client of [clientA, admin.client]) {
				const insert = await client
					.from('student_parents')
					.insert({ student_id: studentId, parent_id: stranger.id, slot: 2 });
				expect(insert.error).not.toBeNull();
				await client
					.from('student_parents')
					.update({ removed_at: new Date().toISOString() })
					.eq('student_id', studentId);
				await client.from('student_parents').delete().eq('student_id', studentId);
			}
			expect((await activeLinks(studentId)).map((l) => l.parent_id)).toEqual([a.id, b.id]);

			// After B's link is removed, B no longer reads the links, A reads
			// only the active one, and the admin still reads both.
			expect((await removeLink(studentId, b.id)).error).toBeNull();
			expect(await read(clientB)).toEqual([]);
			expect(await read(clientA)).toEqual([a.id]);
			expect(await read(admin.client)).toEqual([a.id, b.id]);
		});

		it('Both parents: is_parent_of and linked_children cover the second parent; a removed link loses access', async () => {
			const { a, b, studentId } = await twoParentFamily();
			const clientA = await signIn(a.email, a.password);
			const clientB = await signIn(b.email, b.password);
			for (const client of [clientA, clientB]) {
				expect((await client.rpc('is_parent_of', { p_student_id: studentId })).data).toBe(true);
				expect((await client.rpc('linked_children')).data?.map((c) => c.id)).toEqual([studentId]);
				expect((await client.rpc('has_link_to', { p_student_id: studentId })).data).toBe(true);
			}

			expect((await removeLink(studentId, b.id)).error).toBeNull();
			expect((await clientB.rpc('is_parent_of', { p_student_id: studentId })).data).toBe(false);
			expect((await clientB.rpc('linked_children')).data).toEqual([]);
			expect((await clientB.rpc('has_link_to', { p_student_id: studentId })).data).toBe(false);
			expect((await clientA.rpc('is_parent_of', { p_student_id: studentId })).data).toBe(true);
		});

		it('Guard: a teacher cannot change registered_by_parent_id; the link is not moved by it', async () => {
			const parent = await createApprovedParent();
			const other = await createApprovedParent();
			const studentId = await child(parent.email, false);

			const { error } = await teacher.client
				.from('profiles')
				.update({ registered_by_parent_id: other.id })
				.eq('id', studentId)
				.select('id');
			expect(error?.message).toContain('cannot be changed here');

			// The service role may change it, and it grants nothing (AD-10).
			expect(
				(
					await adminClient
						.from('profiles')
						.update({ registered_by_parent_id: other.id })
						.eq('id', studentId)
				).error
			).toBeNull();
			expect((await activeLinks(studentId)).map((l) => l.parent_id)).toEqual([parent.id]);
			const otherClient = await signIn(other.email, other.password);
			expect((await otherClient.rpc('linked_children')).data).toEqual([]);
		});

		it('has_link_to: a pending teacher-parent cannot approve their own pending child; another teacher can', async () => {
			const teacherParent = await createSignedInUser('teacher');
			const otherTeacher = await createSignedInUser('teacher');
			for (const id of [teacherParent.id, otherTeacher.id]) {
				await adminClient.from('class_teachers').insert({ class_id: classId, teacher_id: id });
			}
			// A pending parents row, as request_parent_access() makes it.
			expect(
				(await adminClient.from('parents').insert({ id: teacherParent.id, status: 'pending' }))
					.error
			).toBeNull();

			const { data: created, error: createError } = await adminClient.auth.admin.createUser({
				email: `ssp-own-${crypto.randomUUID()}@${STUDENT_EMAIL_DOMAIN}`,
				password: crypto.randomUUID(),
				email_confirm: true,
				app_metadata: { role: 'student' },
				user_metadata: { class_id: classId, registration_name: name('Own Kid') }
			});
			if (createError || !created.user) throw new Error(`create student: ${createError?.message}`);
			const kid = created.user.id;
			await linkParent(adminClient, kid, teacherParent.id);

			// is_parent_of alone would not stop them: they are not an approved parent.
			expect((await teacherParent.client.rpc('is_parent_of', { p_student_id: kid })).data).toBe(
				false
			);
			expect((await teacherParent.client.rpc('has_link_to', { p_student_id: kid })).data).toBe(
				true
			);

			const decide = (client: Client, reviewer: string) =>
				client
					.from('profiles')
					.update({
						status: 'approved',
						reviewed_by: reviewer,
						reviewed_at: new Date().toISOString()
					})
					.eq('id', kid)
					.select('status');
			const own = await decide(teacherParent.client, teacherParent.id);
			expect(own.error?.code).toBe('42501');
			const { data: still } = await adminClient
				.from('profiles')
				.select('status')
				.eq('id', kid)
				.single();
			expect(still).toEqual({ status: 'pending' });

			const other = await decide(otherTeacher.client, otherTeacher.id);
			expect(other.error).toBeNull();
			expect(other.data).toEqual([{ status: 'approved' }]);
		});
	}
);

/**
 * spec-second-parent story 2 (migration 0055): the second parent sees
 * everything. One test per I/O matrix row; B is always linked as slot 2
 * through linkParent (the service role), never through the sign-up.
 */
describe.skipIf(!reachable)(
	'spec-second-parent story 2: second parent reads (requires local Supabase)',
	() => {
		type Client = ReturnType<typeof anonClient>;
		type Parent = { id: string; email: string; client: Client; name: string };
		let admin: Awaited<ReturnType<typeof createSignedInUser>>;
		let teacher: Awaited<ReturnType<typeof createSignedInUser>>;
		let classId: string;
		let teamId: string;

		const name = (label: string) => `SSP2 ${label} ${crypto.randomUUID().slice(0, 8)}`;
		/** A random far-future day (class days are unique school-wide). */
		const futureDay = () =>
			`${3000 + Math.floor(Math.random() * 6000)}-06-0${1 + Math.floor(Math.random() * 9)}`;

		async function signIn(email: string, password: string): Promise<Client> {
			const client = anonClient();
			const { error } = await client.auth.signInWithPassword({ email, password });
			if (error) throw new Error(`Failed to sign in: ${error.message}`);
			return client;
		}

		/** An approved parent with a distinct display name, signed in. */
		async function newParent(label: string): Promise<Parent> {
			const p = await createApprovedParent();
			const displayName = name(label);
			const { error } = await adminClient
				.from('profiles')
				.update({ display_name: displayName })
				.eq('id', p.id);
			if (error) throw new Error(`Failed to name parent: ${error.message}`);
			return {
				id: p.id,
				email: p.email,
				client: await signIn(p.email, p.password),
				name: displayName
			};
		}

		/** A child registered by A through the sign-up, approved, with B linked in slot 2. */
		async function twoParentFamily() {
			const a = await newParent('A');
			const b = await newParent('B');
			const { id, error } = await signUpStudent({
				classId,
				registrationName: name('Kid'),
				guardianEmail: a.email
			});
			if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
			const { error: approveError } = await adminClient
				.from('profiles')
				.update({ status: 'approved', team_id: teamId })
				.eq('id', id);
			if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
			await linkParent(adminClient, id, b.id);
			return { a, b, kid: id };
		}

		async function signInStudent(id: string) {
			const password = crypto.randomUUID();
			const { data } = await adminClient.auth.admin.updateUserById(id, { password });
			return signIn(data.user!.email!, password);
		}

		const requestDeletion = (client: Client, studentId: string) =>
			client
				.from('deletion_requests')
				.insert({ student_id: studentId })
				.select('id, requested_by')
				.single();

		const readRequests = (client: Client, studentId: string) =>
			client
				.from('deletion_requests')
				.select('id, status, requested_by')
				.eq('student_id', studentId);

		const actorName = (client: Client, studentId: string, actorId: string) =>
			client.rpc('actor_display_name', { p_student_id: studentId, p_actor_id: actorId });

		beforeAll(async () => {
			admin = await createSignedInUser('admin');
			teacher = await createSignedInUser('teacher');
			const { data: cls, error } = await adminClient
				.from('classes')
				.insert({ name: name('Class'), code: `S${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
				.select('id')
				.single();
			if (error || !cls) throw new Error(`Failed to create class: ${error?.message}`);
			classId = cls.id;
			await adminClient
				.from('class_teachers')
				.insert({ class_id: classId, teacher_id: teacher.id });
			const { data: team, error: teamError } = await adminClient
				.from('teams')
				.insert({ name: name('Team') })
				.select('id')
				.single();
			if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
			teamId = team.id;
		}, 30000);

		it('Slot-2 calendar: B reads the same children, enrollments and leave answers as A', async () => {
			const { a, b, kid } = await twoParentFamily();
			const sessionId = await sessionFor(classId, futureDay());
			const { error: leaveError } = await a.client
				.from('session_leave_history')
				.insert({ class_session_id: sessionId, student_id: kid, answer: 'on_leave' });
			expect(leaveError).toBeNull();

			for (const p of [a, b]) {
				const { data: children } = await p.client.rpc('linked_children');
				expect(children?.map((c) => c.id)).toContain(kid);
				const { data: enrollments } = await p.client
					.from('class_enrollments')
					.select('class_id')
					.in('student_id', [kid]);
				expect(enrollments).toEqual([{ class_id: classId }]);
				const { data: answers } = await p.client
					.from('session_leave_history')
					.select('class_session_id, answer')
					.in('student_id', [kid]);
				expect(answers).toEqual([{ class_session_id: sessionId, answer: 'on_leave' }]);
			}
		});

		it('Admin parents page: the active links list the child under both A and B; a removed link drops B', async () => {
			const { a, b, kid } = await twoParentFamily();
			const activeLinks = () =>
				admin.client
					.from('student_parents')
					.select(
						'parent_id, student_id, student:profiles!student_parents_student_id_fkey ( display_name, registration_name, status )'
					)
					.is('removed_at', null)
					.eq('student_id', kid);
			const { data, error } = await activeLinks();
			expect(error).toBeNull();
			expect(data?.map((l) => l.parent_id).sort()).toEqual([a.id, b.id].sort());
			for (const link of data ?? []) {
				expect(link.student).toMatchObject({ status: 'approved' });
			}

			// The admin reads removed rows too, so removed_at is null is the only guard.
			const { error: removeError } = await adminClient
				.from('student_parents')
				.update({ removed_at: new Date().toISOString(), removed_by: admin.id })
				.eq('student_id', kid)
				.eq('parent_id', b.id)
				.is('removed_at', null)
				.select('id')
				.single();
			expect(removeError).toBeNull();
			const { data: after, error: afterError } = await activeLinks();
			expect(afterError).toBeNull();
			expect(after?.map((l) => l.parent_id)).toEqual([a.id]);
		});

		it("Pending deletion: B sees A's request named A; A is named to themselves too", async () => {
			const { a, b, kid } = await twoParentFamily();
			const { data: req, error } = await requestDeletion(a.client, kid);
			expect(error).toBeNull();
			expect(req?.requested_by).toBe(a.id);

			for (const p of [a, b]) {
				expect((await readRequests(p.client, kid)).data).toEqual([
					{ id: req!.id, status: 'pending', requested_by: a.id }
				]);
				expect((await actorName(p.client, kid, a.id)).data).toBe(a.name);
			}
		});

		it('Duplicate: B submitting while A\'s request is pending gets 23505 (mapped to "already requested")', async () => {
			const { a, b, kid } = await twoParentFamily();
			expect((await requestDeletion(a.client, kid)).error).toBeNull();
			const second = await requestDeletion(b.client, kid);
			expect(second.error?.code).toBe('23505');
		});

		it('Leave setter: B marks leave; A, the student, the teacher and the admin see it set by B', async () => {
			const { a, b, kid } = await twoParentFamily();
			const sessionId = await sessionFor(classId, futureDay());
			const { data: row, error } = await b.client
				.from('session_leave_history')
				.insert({ class_session_id: sessionId, student_id: kid, answer: 'on_leave' })
				.select('answered_by')
				.single();
			expect(error).toBeNull();
			expect(row).toEqual({ answered_by: b.id });

			const { data: seen } = await a.client
				.from('session_leave_history')
				.select('answer, answered_by')
				.eq('class_session_id', sessionId)
				.eq('student_id', kid);
			expect(seen).toEqual([{ answer: 'on_leave', answered_by: b.id }]);

			const kidClient = await signInStudent(kid);
			for (const client of [a.client, b.client, kidClient, teacher.client, admin.client]) {
				expect((await actorName(client, kid, b.id)).data).toBe(b.name);
			}
		});

		it('Name probe: a caller without access, or an actor never linked, gets null', async () => {
			const { a, kid } = await twoParentFamily();
			const stranger = await newParent('Stranger');
			const otherTeacher = await createSignedInUser('teacher');

			// No access to the student: another parent, a teacher of another class.
			expect((await actorName(stranger.client, kid, a.id)).data).toBeNull();
			expect((await actorName(otherTeacher.client, kid, a.id)).data).toBeNull();
			// Access, but the actor was never linked to this student.
			expect((await actorName(a.client, kid, stranger.id)).data).toBeNull();
			expect((await actorName(a.client, kid, teacher.id)).data).toBeNull();
			// Anonymous callers cannot call it at all.
			const anon = await anonClient().rpc('actor_display_name', {
				p_student_id: kid,
				p_actor_id: a.id
			});
			expect(anon.data).toBeNull();
			expect(anon.error).not.toBeNull();
		});

		it('Removed requester: B still sees the request named A; A no longer reads it', async () => {
			const { a, b, kid } = await twoParentFamily();
			const { data: req, error } = await requestDeletion(a.client, kid);
			expect(error).toBeNull();

			const { error: removeError } = await adminClient
				.from('student_parents')
				.update({ removed_at: new Date().toISOString(), removed_by: admin.id })
				.eq('student_id', kid)
				.eq('parent_id', a.id)
				.is('removed_at', null)
				.select('id')
				.single();
			expect(removeError).toBeNull();

			expect((await readRequests(b.client, kid)).data).toEqual([
				{ id: req!.id, status: 'pending', requested_by: a.id }
			]);
			expect((await actorName(b.client, kid, a.id)).data).toBe(a.name);
			expect((await readRequests(a.client, kid)).data).toEqual([]);
			expect((await actorName(a.client, kid, a.id)).data).toBeNull();
			// The request stays for the admin to decide.
			expect((await readRequests(admin.client, kid)).data).toEqual([
				{ id: req!.id, status: 'pending', requested_by: a.id }
			]);
		});

		it("Admin is co-parent: the admin, linked as B, cannot decide A's request and reads the link", async () => {
			const a = await newParent('A');
			const dual = await createSignedInUser('admin');
			const { error: rowError } = await adminClient
				.from('parents')
				.insert({ id: dual.id, status: 'approved' });
			if (rowError) throw new Error(`Failed to make parent: ${rowError.message}`);
			const { id: kid, error } = await signUpStudent({
				classId,
				registrationName: name('Kid'),
				guardianEmail: a.email
			});
			if (error || !kid) throw new Error(`Failed to register child: ${error?.message}`);
			await adminClient
				.from('profiles')
				.update({ status: 'approved', team_id: teamId })
				.eq('id', kid);
			await linkParent(adminClient, kid, dual.id);

			const { data: req, error: reqError } = await requestDeletion(a.client, kid);
			expect(reqError).toBeNull();
			expect(req?.requested_by).toBe(a.id);

			// What the app reads to hide the buttons and the count.
			const { data: own } = await dual.client
				.from('student_parents')
				.select('student_id')
				.eq('parent_id', dual.id)
				.is('removed_at', null);
			expect(own).toEqual([{ student_id: kid }]);

			const refused = await dual.client
				.from('deletion_requests')
				.update({ status: 'approved' })
				.eq('id', req!.id)
				.select('id')
				.single();
			expect(refused.error?.code).toBe('42501');
			const { data: still } = await adminClient
				.from('deletion_requests')
				.select('status')
				.eq('id', req!.id)
				.single();
			expect(still).toEqual({ status: 'pending' });
		});
	}
);

describe.skipIf(!reachable)(
	'spec-second-parent story 3: parent invites (requires local Supabase)',
	() => {
		type Client = ReturnType<typeof anonClient>;
		type Parent = { id: string; email: string; client: Client; name: string };
		let admin: Awaited<ReturnType<typeof createSignedInUser>>;
		let classId: string;
		let teamId: string;

		const name = (label: string) => `SSP3 ${label} ${crypto.randomUUID().slice(0, 8)}`;
		const freshEmail = (label: string) =>
			`ssp3-${label.toLowerCase()}-${crypto.randomUUID()}@example.test`;

		async function signIn(email: string, password: string): Promise<Client> {
			const client = anonClient();
			const { error } = await client.auth.signInWithPassword({ email, password });
			if (error) throw new Error(`Failed to sign in: ${error.message}`);
			return client;
		}

		/** An approved parent with a distinct display name, signed in. */
		async function newParent(label: string, email = freshEmail(label)): Promise<Parent> {
			const p = await createApprovedParent(email);
			const displayName = name(label);
			const { error } = await adminClient
				.from('profiles')
				.update({ display_name: displayName })
				.eq('id', p.id);
			if (error) throw new Error(`Failed to name parent: ${error.message}`);
			return { id: p.id, email, client: await signIn(email, p.password), name: displayName };
		}

		/** A child registered by `parent` through the sign-up and approved. */
		async function child(parent: Parent, registrationName = name('Kid')) {
			const { id, error } = await signUpStudent({
				classId,
				registrationName,
				guardianEmail: parent.email
			});
			if (error || !id) throw new Error(`Failed to register child: ${error?.message}`);
			const { error: approveError } = await adminClient
				.from('profiles')
				.update({ status: 'approved', team_id: teamId })
				.eq('id', id);
			if (approveError) throw new Error(`Failed to approve child: ${approveError.message}`);
			return id;
		}

		const invite = (p: Parent, studentId: string, email: string) =>
			p.client.rpc('create_parent_invite', { p_student_id: studentId, p_email: email });
		const cancel = (p: Parent, inviteId: string) =>
			p.client.rpc('cancel_parent_invite', { p_invite_id: inviteId });
		const accept = (p: Parent, inviteId: string) =>
			p.client.rpc('accept_parent_invite', { p_invite_id: inviteId });
		const listMine = (p: Parent) => p.client.rpc('list_my_parent_invites');

		async function inviteRow(id: string) {
			const { data, error } = await adminClient
				.from('parent_invites')
				.select('student_id, invited_email, invited_by, status, created_at, expires_at')
				.eq('id', id)
				.single();
			if (error || !data) throw new Error(`read invite: ${error?.message}`);
			return data;
		}

		async function activeLinks(studentId: string) {
			const { data, error } = await adminClient
				.from('student_parents')
				.select('parent_id, slot, invited_by')
				.eq('student_id', studentId)
				.is('removed_at', null)
				.order('slot');
			if (error) throw new Error(`read links: ${error.message}`);
			return data ?? [];
		}

		const removeLink = (studentId: string, parentId: string) =>
			adminClient
				.from('student_parents')
				.update({ removed_at: new Date().toISOString(), removed_by: admin.id })
				.eq('student_id', studentId)
				.eq('parent_id', parentId)
				.is('removed_at', null)
				.select('id');

		/** A's only child with a pending invite for B's email. */
		async function invitedFamily() {
			const a = await newParent('A');
			const b = await newParent('B');
			const kid = await child(a);
			const { data: inviteId, error } = await invite(a, kid, b.email);
			if (error || !inviteId) throw new Error(`Failed to invite: ${error?.message}`);
			return { a, b, kid, inviteId };
		}

		beforeAll(async () => {
			admin = await createSignedInUser('admin');
			const { data: cls, error } = await adminClient
				.from('classes')
				.insert({ name: name('Class'), code: `I${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
				.select('id')
				.single();
			if (error || !cls) throw new Error(`Failed to create class: ${error?.message}`);
			classId = cls.id;
			const { data: team, error: teamError } = await adminClient
				.from('teams')
				.insert({ name: name('Team') })
				.select('id')
				.single();
			if (teamError || !team) throw new Error(`Failed to create team: ${teamError?.message}`);
			teamId = team.id;
		}, 30000);

		it('Invite: the only parent invites a padded, mixed-case email; it is stored normalised with a 30-day expiry and shown to A', async () => {
			const a = await newParent('A');
			const kid = await child(a);
			const email = freshEmail('B');
			const before = Date.now();

			const { data: id, error } = await invite(a, kid, `  ${email.toUpperCase()} `);
			expect(error).toBeNull();
			expect(typeof id).toBe('string');

			const row = await inviteRow(id!);
			expect(row).toMatchObject({
				student_id: kid,
				invited_email: email,
				invited_by: a.id,
				status: 'pending'
			});
			const days = (Date.parse(row.expires_at) - before) / 86_400_000;
			expect(days).toBeGreaterThan(29.9);
			expect(days).toBeLessThan(30.1);

			// What the child page reads (RLS: the child's active parents).
			const { data: seen } = await a.client
				.from('parent_invites')
				.select('id, invited_email, status')
				.eq('student_id', kid);
			expect(seen).toEqual([{ id, invited_email: email, status: 'pending' }]);
		});

		it('Refusals: not your child, two parents, own or linked email, a second invite', async () => {
			const { a, b, kid } = await invitedFamily();
			const c = await newParent('C');

			const notMine = await invite(c, kid, freshEmail('X'));
			expect(notMine.error).toMatchObject({ code: '42501', hint: 'not_your_child' });

			const own = await invite(a, kid, ` ${a.email.toUpperCase()}`);
			expect(own.error).toMatchObject({ code: '22023', hint: 'own_or_linked_email' });

			const second = await invite(a, kid, freshEmail('Y'));
			expect(second.error).toMatchObject({ code: '22023', hint: 'invite_pending' });

			// Two parents: refused for either of them, whatever the email.
			const kid2 = await child(a);
			await linkParent(adminClient, kid2, b.id);
			for (const p of [a, b]) {
				const full = await invite(p, kid2, freshEmail('Z'));
				expect(full.error).toMatchObject({ code: '22023', hint: 'child_has_two_parents' });
			}

			// The email check is per child: B is linked to kid2, not to kid3.
			const kid3 = await child(a);
			const linkedElsewhere = await invite(a, kid3, b.email);
			expect(linkedElsewhere.error).toBeNull();

			// No client write path.
			const direct = await a.client.from('parent_invites').insert({
				student_id: kid3,
				invited_email: freshEmail('direct'),
				invited_by: a.id,
				expires_at: new Date(Date.now() + 86_400_000).toISOString()
			});
			expect(direct.error).not.toBeNull();
			const { data: tampered } = await a.client
				.from('parent_invites')
				.update({ status: 'accepted' })
				.eq('student_id', kid3)
				.select('id');
			expect(tampered ?? []).toEqual([]);
			const { data: deleted } = await a.client
				.from('parent_invites')
				.delete()
				.eq('student_id', kid3)
				.select('id');
			expect(deleted ?? []).toEqual([]);
			const { data: kept } = await adminClient
				.from('parent_invites')
				.select('status')
				.eq('student_id', kid3);
			expect(kept).toEqual([{ status: 'pending' }]);
		});

		it('Lifetime: the invite expires after parent_invite_days', async () => {
			const a = await newParent('A');
			const kid = await child(a);
			const setDays = (days: number) =>
				adminClient
					.from('app_settings')
					.update({ value: { days } })
					.eq('key', 'parent_invite_days')
					.select('key')
					.single();
			try {
				expect((await setDays(7)).error).toBeNull();
				const before = Date.now();
				const { data: id, error } = await invite(a, kid, freshEmail('week'));
				expect(error).toBeNull();
				const days = (Date.parse((await inviteRow(id!)).expires_at) - before) / 86_400_000;
				expect(days).toBeGreaterThan(6.9);
				expect(days).toBeLessThan(7.1);
			} finally {
				await setDays(30);
			}
		});

		it('Unconfirmed email: an approved parent whose matching address is not confirmed lists nothing and cannot accept', async () => {
			const a = await newParent('A');
			const kid = await child(a);
			const c = await newParent('C');
			// C asks to change the login email to the invited address; until
			// that is confirmed, auth.users.email stays the old, confirmed one.
			const unconfirmed = freshEmail('unconfirmed');
			const { error: changeError } = await c.client.auth.updateUser({ email: unconfirmed });
			expect(changeError).toBeNull();
			const { data: inviteId, error } = await invite(a, kid, unconfirmed);
			expect(error).toBeNull();

			expect((await listMine(c)).data).toEqual([]);
			expect((await accept(c, inviteId!)).error).toMatchObject({ code: '42501' });
			expect((await inviteRow(inviteId!)).status).toBe('pending');
		});

		it('Unknown email: the same success as an email with an account', async () => {
			const a = await newParent('A');
			const known = await newParent('Known');
			const kid1 = await child(a);
			const kid2 = await child(a);

			const withAccount = await invite(a, kid1, known.email);
			const withoutAccount = await invite(a, kid2, freshEmail('nobody'));
			expect(withAccount.error).toBeNull();
			expect(withoutAccount.error).toBeNull();
			expect(typeof withAccount.data).toBe('string');
			expect(typeof withoutAccount.data).toBe('string');
			expect(withAccount.status).toBe(withoutAccount.status);
		});

		it('Cancel: A cancels, the invite is gone and a new one can be made; others cannot cancel', async () => {
			const { a, kid, inviteId } = await invitedFamily();
			const c = await newParent('C');

			expect((await cancel(c, inviteId)).error).toMatchObject({ code: '42501' });
			expect((await cancel(a, inviteId)).error).toBeNull();
			expect((await inviteRow(inviteId)).status).toBe('cancelled');
			expect((await cancel(a, inviteId)).error).toMatchObject({
				code: '22023',
				hint: 'invite_not_live'
			});

			const { data: live } = await a.client
				.from('parent_invites')
				.select('id')
				.eq('student_id', kid)
				.eq('status', 'pending');
			expect(live).toEqual([]);
			expect((await invite(a, kid, freshEmail('again'))).error).toBeNull();
		});

		it('Accept: B lists the invite and accepting links B in slot 2, invited by A', async () => {
			const { a, b, kid, inviteId } = await invitedFamily();

			const { data: mine, error } = await listMine(b);
			expect(error).toBeNull();
			expect(mine).toEqual([
				{
					id: inviteId,
					child_name: expect.any(String),
					invited_by_name: a.name,
					expires_at: expect.any(String)
				}
			]);

			const { data: accepted, error: acceptError } = await accept(b, inviteId);
			expect(acceptError).toBeNull();
			expect(accepted).toBe(kid);
			expect((await inviteRow(inviteId)).status).toBe('accepted');
			expect(await activeLinks(kid)).toEqual([
				{ parent_id: a.id, slot: 1, invited_by: null },
				{ parent_id: b.id, slot: 2, invited_by: a.id }
			]);

			const { data: children } = await b.client.rpc('linked_children');
			expect(children?.map((c) => c.id)).toEqual([kid]);
			expect((await listMine(b)).data).toEqual([]);

			// A's card: two parents now, so nothing to invite.
			const { data: links } = await a.client
				.from('student_parents')
				.select('parent_id')
				.eq('student_id', kid)
				.is('removed_at', null);
			expect(links).toHaveLength(2);
		});

		it('Wrong email: an approved parent with another email lists nothing and cannot accept', async () => {
			const { b, inviteId } = await invitedFamily();
			const c = await newParent('C');

			expect((await listMine(c)).data).toEqual([]);
			expect((await accept(c, inviteId)).error).toMatchObject({ code: '42501' });
			// Neither may C read the row.
			const { data: rows } = await c.client.from('parent_invites').select('id').eq('id', inviteId);
			expect(rows).toEqual([]);
			expect((await inviteRow(inviteId)).status).toBe('pending');
			expect((await listMine(b)).data).toHaveLength(1);

			// A pending parent with the invited email lists nothing and cannot accept.
			const a2 = await newParent('A2');
			const kid2 = await child(a2);
			const waiting = await createPendingParent(freshEmail('waiting'));
			const { data: waitingInvite } = await invite(a2, kid2, waiting.email);
			const waitingClient = await signIn(waiting.email, waiting.password);
			expect((await waitingClient.rpc('list_my_parent_invites')).data).toEqual([]);
			expect(
				(await waitingClient.rpc('accept_parent_invite', { p_invite_id: waitingInvite! })).error
			).toMatchObject({ code: '42501' });
		});

		it('Not live: expired, cancelled, or the inviter link removed -> not listed, accept refused', async () => {
			// Expired.
			const expired = await invitedFamily();
			const { error: ageError } = await adminClient
				.from('parent_invites')
				.update({
					created_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
					expires_at: new Date(Date.now() - 86_400_000).toISOString()
				})
				.eq('id', expired.inviteId);
			expect(ageError).toBeNull();
			expect((await listMine(expired.b)).data).toEqual([]);
			expect((await accept(expired.b, expired.inviteId)).error).toMatchObject({
				code: '22023',
				hint: 'invite_not_live'
			});
			// A new invite retires the stale row.
			expect((await invite(expired.a, expired.kid, freshEmail('new'))).error).toBeNull();
			expect((await inviteRow(expired.inviteId)).status).toBe('expired');

			// Cancelled.
			const cancelled = await invitedFamily();
			expect((await cancel(cancelled.a, cancelled.inviteId)).error).toBeNull();
			expect((await listMine(cancelled.b)).data).toEqual([]);
			expect((await accept(cancelled.b, cancelled.inviteId)).error).toMatchObject({
				hint: 'invite_not_live'
			});

			// The inviter's link removed: the removal cancels the invite.
			const a = await newParent('A');
			const x = await newParent('X');
			const b = await newParent('B');
			const kid = await child(a);
			await linkParent(adminClient, kid, x.id);
			const { data: row, error: insertError } = await adminClient
				.from('parent_invites')
				.insert({
					student_id: kid,
					invited_email: b.email,
					invited_by: x.id,
					expires_at: new Date(Date.now() + 86_400_000).toISOString()
				})
				.select('id')
				.single();
			expect(insertError).toBeNull();
			expect((await removeLink(kid, x.id)).error).toBeNull();
			expect((await inviteRow(row!.id)).status).toBe('cancelled');
			expect((await listMine(b)).data).toEqual([]);
			expect((await accept(b, row!.id)).error).toMatchObject({ hint: 'invite_not_live' });

			// A pending row whose inviter is not linked is not live either.
			const kid2 = await child(a);
			const { data: orphan } = await adminClient
				.from('parent_invites')
				.insert({
					student_id: kid2,
					invited_email: b.email,
					invited_by: x.id,
					expires_at: new Date(Date.now() + 86_400_000).toISOString()
				})
				.select('id')
				.single();
			expect((await listMine(b)).data).toEqual([]);
			expect((await accept(b, orphan!.id)).error).toMatchObject({ hint: 'invite_not_live' });
		});

		it('Race: two accepts at once, or an accept with two links already, never make three links', async () => {
			const { b, kid, inviteId } = await invitedFamily();
			const bAgain = await signIn(b.email, await resetPassword(b.id));
			const results = await Promise.all([
				accept(b, inviteId),
				bAgain.rpc('accept_parent_invite', { p_invite_id: inviteId })
			]);
			expect(results.filter((r) => r.error === null)).toHaveLength(1);
			expect(results.find((r) => r.error)?.error).toMatchObject({ hint: 'invite_not_live' });
			expect(await activeLinks(kid)).toHaveLength(2);

			const late = await invitedFamily();
			const x = await newParent('X');
			await linkParent(adminClient, late.kid, x.id);
			expect((await accept(late.b, late.inviteId)).error).toMatchObject({
				code: '22023',
				hint: 'child_has_two_parents'
			});
			expect(await activeLinks(late.kid)).toHaveLength(2);
		});

		it("Removed parent: B's earlier link was removed, so B cannot accept a new invite", async () => {
			const a = await newParent('A');
			const b = await newParent('B');
			const kid = await child(a);
			await linkParent(adminClient, kid, b.id);
			expect((await removeLink(kid, b.id)).error).toBeNull();

			const { data: inviteId, error } = await invite(a, kid, b.email);
			expect(error).toBeNull();
			expect((await accept(b, inviteId!)).error).toMatchObject({
				code: '22023',
				hint: 'removed_parent'
			});
			expect((await activeLinks(kid)).map((l) => l.parent_id)).toEqual([a.id]);
		});

		it('Same name: B already has a child with the same registration_name', async () => {
			const a = await newParent('A');
			const b = await newParent('B');
			const shared = name('Tenzin');
			const kid = await child(a, shared);
			await child(b, ` ${shared.toLowerCase()} `);

			const { data: inviteId, error } = await invite(a, kid, b.email);
			expect(error).toBeNull();
			expect((await accept(b, inviteId!)).error).toMatchObject({
				code: '22023',
				hint: 'duplicate_child_name'
			});
			expect(await activeLinks(kid)).toHaveLength(1);
		});

		it('Student rejected: the pending invite becomes cancelled', async () => {
			const { b, kid, inviteId } = await invitedFamily();
			const { error } = await adminClient
				.from('profiles')
				.update({ status: 'rejected' })
				.eq('id', kid);
			expect(error).toBeNull();
			expect((await inviteRow(inviteId)).status).toBe('cancelled');
			expect((await listMine(b)).data).toEqual([]);
		});

		it('The admin reads every invite; deleting the student removes its invites', async () => {
			const { kid, inviteId } = await invitedFamily();
			const { data: seen } = await admin.client
				.from('parent_invites')
				.select('id')
				.eq('id', inviteId);
			expect(seen).toEqual([{ id: inviteId }]);

			const { error } = await adminClient.auth.admin.deleteUser(kid);
			expect(error).toBeNull();
			const { data: gone } = await adminClient
				.from('parent_invites')
				.select('id')
				.eq('id', inviteId);
			expect(gone).toEqual([]);
		});

		async function resetPassword(id: string) {
			const password = crypto.randomUUID();
			const { error } = await adminClient.auth.admin.updateUserById(id, { password });
			if (error) throw new Error(`reset password: ${error.message}`);
			return password;
		}
	}
);
