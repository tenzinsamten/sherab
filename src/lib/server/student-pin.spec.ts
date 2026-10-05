/**
 * #88: resetStudentPin against a real local Supabase instance, like
 * rls.spec.ts: who may reset is decided by reads through the caller's own
 * (RLS-scoped) client, so a stubbed client would prove nothing. Skipped when
 * local Supabase isn't reachable. Every user and class it creates is removed
 * again.
 */
import { createClient, type User } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { Database } from './../supabase/database.types';

// The real service-role client, wrapped so a refusal can be shown to never
// reach the privileged call.
vi.mock('$lib/supabase/admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/supabase/admin')>();
	return { ...actual, createSupabaseAdminClient: vi.fn(actual.createSupabaseAdminClient) };
});

const { createSupabaseAdminClient } = await import('$lib/supabase/admin');
const { resetStudentPin } = await import('./student-pin');
const { STUDENT_EMAIL_DOMAIN } = await import('./temp-password');
const m = await import('$lib/paraglide/messages.js');

const service = createClient<Database>(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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
	return createClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
}

const tag = crypto.randomUUID().slice(0, 8);
const userIds: string[] = [];
const classIds: string[] = [];

type Login = { id: string; email: string; password: string };

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createLogin(
	role: 'admin' | 'teacher' | 'student' | 'parent',
	name: string
): Promise<Login> {
	const domain = role === 'student' ? STUDENT_EMAIL_DOMAIN : 'example.test';
	const email = `pin88-${name}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${name}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

async function createClass(name: string): Promise<string> {
	const { data, error } = await service
		.from('classes')
		.insert({
			name: `PIN88 ${name} ${tag}`,
			code: `P${crypto.randomUUID().slice(0, 5).toUpperCase()}`
		})
		.select('id')
		.single();
	if (error || !data) throw new Error(`create class ${name}: ${error?.message}`);
	classIds.push(data.id);
	return data.id;
}

/** A student who registered into `classId` and is enrolled in it. */
async function createStudent(name: string, classId: string, status: 'approved' | 'pending') {
	const login = await createLogin('student', name);
	check(
		await service
			.from('profiles')
			.update({
				class_id: classId,
				status,
				registration_name: `PIN88 ${name}`,
				display_name: `PIN88 ${name}`
			})
			.eq('id', login.id),
		`set up ${name}`
	);
	// The pending one too, so its refusal rests on the status alone.
	const enrolled = check(
		await service
			.from('class_enrollments')
			.select('class_id')
			.eq('student_id', login.id)
			.eq('class_id', classId),
		'read enrollment'
	);
	if (!enrolled?.length) {
		check(
			await service.from('class_enrollments').insert({ student_id: login.id, class_id: classId }),
			`enroll ${name}`
		);
	}
	return login;
}

async function signedIn(login: Login) {
	const client = anonClient();
	const { error } = await client.auth.signInWithPassword({
		email: login.email,
		password: login.password
	});
	if (error) throw new Error(`sign in ${login.email}: ${error.message}`);
	return client;
}

async function canSignIn(email: string, password: string): Promise<boolean> {
	const { error } = await anonClient().auth.signInWithPassword({ email, password });
	return !error;
}

/** Calls the action as `caller`, posting `studentId` from the page of `classId`. */
async function reset(caller: Login | null, classId: string, studentId: string) {
	const body = new FormData();
	body.set('studentId', studentId);
	return resetStudentPin({
		request: new Request('http://localhost/', { method: 'POST', body }),
		classId,
		supabase: caller ? await signedIn(caller) : anonClient(),
		user: caller ? ({ id: caller.id } as User) : null
	});
}

const reachable = await isSupabaseReachable();

describe.skipIf(!reachable)('resetStudentPin (#88, requires local Supabase)', () => {
	let admin: Login;
	let teacherA: Login;
	let teacherB: Login;
	let parent: Login;
	let classA: string;
	let classB: string;
	let studentA: Login;
	let studentB: Login;
	let pendingA: Login;
	let ownChild: Login;

	beforeAll(async () => {
		admin = await createLogin('admin', 'admin');
		teacherA = await createLogin('teacher', 'teacher-a');
		teacherB = await createLogin('teacher', 'teacher-b');
		parent = await createLogin('parent', 'parent');
		classA = await createClass('A');
		classB = await createClass('B');
		check(
			await service.from('class_teachers').insert([
				{ class_id: classA, teacher_id: teacherA.id },
				{ class_id: classB, teacher_id: teacherB.id }
			]),
			'assign teachers'
		);
		studentA = await createStudent('student-a', classA, 'approved');
		studentB = await createStudent('student-b', classB, 'approved');
		pendingA = await createStudent('pending-a', classA, 'pending');
		ownChild = await createStudent('own-child', classA, 'approved');

		// studentA's parent, and teacher A as the approved parent of ownChild.
		check(
			await service
				.from('parents')
				.upsert([{ id: teacherA.id }, { id: parent.id }], { onConflict: 'id' }),
			'add parents rows'
		);
		check(
			await service
				.from('parents')
				.update({ status: 'approved' })
				.in('id', [teacherA.id, parent.id]),
			'approve parents'
		);
		check(
			await service.from('profiles').update({ parent_id: parent.id }).eq('id', studentA.id),
			'link parent'
		);
		check(
			await service.from('profiles').update({ parent_id: teacherA.id }).eq('id', ownChild.id),
			'link own child'
		);
	}, 60_000);

	afterAll(async () => {
		// Students first: a class with students, or a parent with children,
		// cannot be deleted.
		const students = [studentA, studentB, pendingA, ownChild].flatMap((s) => (s ? [s.id] : []));
		const rest = userIds.filter((id) => !students.includes(id));
		for (const id of [...students, ...rest]) await service.auth.admin.deleteUser(id);
		if (classIds.length) await service.from('classes').delete().in('id', classIds);
	}, 60_000);

	beforeEach(() => {
		vi.mocked(createSupabaseAdminClient).mockClear();
	});

	/** A refusal: the status and message, no PIN, and the old one still works. */
	async function expectRefused(
		result: Awaited<ReturnType<typeof reset>>,
		status: number,
		message: string,
		target: Login
	) {
		expect(result).toMatchObject({ status, data: { error: message } });
		expect(JSON.stringify(result)).not.toMatch(/"pin"/);
		expect(createSupabaseAdminClient).not.toHaveBeenCalled();
		expect(await canSignIn(target.email, target.password)).toBe(true);
	}

	it('refuses a caller who is not signed in', async () => {
		await expectRefused(
			await reset(null, classA, studentA.id),
			401,
			m.pin_reset_error_failed(),
			studentA
		);
	});

	it('refuses a student id that is not a uuid', async () => {
		const result = await reset(teacherA, classA, `${studentA.id}' or 1=1`);
		expect(result).toMatchObject({ status: 400, data: { error: m.pin_reset_error_not_found() } });
		expect(createSupabaseAdminClient).not.toHaveBeenCalled();
	});

	it("refuses another class's teacher, on the student's class page", async () => {
		await expectRefused(
			await reset(teacherB, classA, studentA.id),
			403,
			m.pin_reset_error_not_allowed(),
			studentA
		);
	});

	it("refuses a teacher posting another class's student from their own class page", async () => {
		await expectRefused(
			await reset(teacherA, classA, studentB.id),
			404,
			m.pin_reset_error_not_found(),
			studentB
		);
	});

	it('refuses a pending student', async () => {
		await expectRefused(
			await reset(teacherA, classA, pendingA.id),
			404,
			m.pin_reset_error_not_found(),
			pendingA
		);
		await expectRefused(
			await reset(admin, classA, pendingA.id),
			404,
			m.pin_reset_error_not_found(),
			pendingA
		);
	});

	it.each([
		['a teacher', () => teacherB],
		['the teacher themself', () => teacherA],
		['the admin', () => admin],
		['a parent', () => parent]
	])('refuses a target that is not a student: %s', async (_label, target) => {
		await expectRefused(
			await reset(admin, classA, target().id),
			404,
			m.pin_reset_error_not_found(),
			target()
		);
		await expectRefused(
			await reset(teacherA, classA, target().id),
			404,
			m.pin_reset_error_not_found(),
			target()
		);
	});

	it("refuses the student's parent and the student, although both can read the profile", async () => {
		await expectRefused(
			await reset(parent, classA, studentA.id),
			403,
			m.pin_reset_error_not_allowed(),
			studentA
		);
		await expectRefused(
			await reset(studentA, classA, studentA.id),
			403,
			m.pin_reset_error_not_allowed(),
			studentA
		);
	});

	it('lets the class teacher reset: new 6-digit PIN, old one dead, sessions ended', async () => {
		const before = await signedIn(studentA);
		expect((await before.auth.getUser()).error).toBeNull();

		const result = await reset(teacherA, classA, studentA.id);
		expect(result).toMatchObject({
			success: true,
			action: 'pinReset',
			studentId: studentA.id,
			studentName: 'PIN88 student-a',
			username: `pin88-student-a-${tag}`
		});
		const pin = (result as { pin: string }).pin;
		expect(pin).toMatch(/^\d{6}$/);

		expect(await canSignIn(studentA.email, studentA.password)).toBe(false);
		expect(await canSignIn(studentA.email, pin)).toBe(true);
		// The session from before the reset is refused by Supabase Auth
		// (what safeGetSession's getUser() asks on every request).
		expect((await before.auth.getUser()).error).not.toBeNull();
		studentA.password = pin;
	});

	it('lets the admin reset, from any class the student is in', async () => {
		const result = await reset(admin, classB, studentB.id);
		expect(result).toMatchObject({ success: true, action: 'pinReset', studentId: studentB.id });
		const pin = (result as { pin: string }).pin;
		expect(await canSignIn(studentB.email, studentB.password)).toBe(false);
		expect(await canSignIn(studentB.email, pin)).toBe(true);
		studentB.password = pin;

		// Not from a class the student is not enrolled in.
		vi.mocked(createSupabaseAdminClient).mockClear();
		await expectRefused(
			await reset(admin, classA, studentB.id),
			404,
			m.pin_reset_error_not_found(),
			studentB
		);
	});

	it('lets a teacher reset the PIN of their own child in their class', async () => {
		// Unlike approvals and sick leave there is no own-child rule: the
		// parent is handed the child's PIN anyway.
		const result = await reset(teacherA, classA, ownChild.id);
		expect(result).toMatchObject({ success: true, action: 'pinReset', studentId: ownChild.id });
		expect(await canSignIn(ownChild.email, (result as { pin: string }).pin)).toBe(true);
	});
});
