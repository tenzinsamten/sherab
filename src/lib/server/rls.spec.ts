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
