import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { expect, type Page } from '@playwright/test';
import type { Database } from '../src/lib/supabase/database.types';

/**
 * Fixtures for the /calendar E2E tests, created through the service-role
 * client against local Supabase (like src/lib/server/rls.spec.ts). Every
 * run uses its own random far-future year and uniquely named users and
 * classes, and `cleanup()` removes them again. Nothing here resets or
 * truncates the database.
 */

function loadEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	try {
		const text = readFileSync(resolve(import.meta.dirname, '../.env'), 'utf8');
		for (const line of text.split('\n')) {
			const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
			if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
		}
	} catch {
		// Fall back to process.env below.
	}
	return { ...env, ...(process.env as Record<string, string>) };
}

const env = loadEnv();
const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
	throw new Error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env).');
}

export const service = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false }
});

export type TestUser = { id: string; email: string; password: string };

export type CalendarFixture = {
	tag: string;
	year: number;
	/** `YYYY-10`, the month the fixtures live in. */
	month: string;
	/** The three class days (Y-10-04, -11, -18). */
	days: string[];
	/** A date in the month that is not a class day. */
	emptyDate: string;
	classA: { id: string; name: string };
	classB: { id: string; name: string };
	/** No teacher and no default start time: only the admin sees it, as "Time not set". */
	classC: { id: string; name: string };
	admin: TestUser;
	teacher: TestUser;
	student: TestUser;
	/** Session ids by `${classKey}:${date}`, e.g. `A:3456-10-11` (C included). */
	sessions: Record<string, string>;
	cleanup(): Promise<void>;
};

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(
	role: 'admin' | 'teacher' | 'student',
	tag: string,
	created: string[]
): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-47-${role}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		user_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${role}: ${error?.message}`);
	created.push(data.user.id);
	return { id: data.user.id, email, password };
}

export async function createCalendarFixture(): Promise<CalendarFixture> {
	const tag = crypto.randomUUID().slice(0, 8);
	// class_days.day is unique school-wide and the database is shared with
	// other test runs: work in a random far-future year.
	const year = 3000 + Math.floor(Math.random() * 6000);
	const month = `${year}-10`;
	const days = [`${month}-04`, `${month}-11`, `${month}-18`];
	const emptyDate = `${month}-06`;

	const userIds: string[] = [];
	const classIds: string[] = [];

	const cleanup = async () => {
		const problems: string[] = [];
		// Students first: a class with students cannot be deleted (0011).
		for (const id of userIds.slice().reverse()) {
			const { error } = await service.auth.admin.deleteUser(id);
			if (error) problems.push(`delete user ${id}: ${error.message}`);
		}
		if (classIds.length) {
			const { error } = await service.from('classes').delete().in('id', classIds);
			if (error) problems.push(`delete classes: ${error.message}`);
		}
		const { error: dayError } = await service
			.from('class_days')
			.delete()
			.gte('day', `${year}-01-01`)
			.lte('day', `${year}-12-31`);
		if (dayError) problems.push(`delete class days: ${dayError.message}`);
		if (problems.length) throw new Error(problems.join('; '));
	};

	try {
		const admin = await createUser('admin', tag, userIds);
		const teacher = await createUser('teacher', tag, userIds);

		const makeClass = async (key: string, start: string, duration: number) => {
			const name = `E2E47 ${tag} ${key}`;
			const row = check(
				await service
					.from('classes')
					.insert({
						name,
						code: `E${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
						default_start_time: start,
						default_duration_minutes: duration
					})
					.select('id')
					.single(),
				`create class ${key}`
			);
			classIds.push(row.id);
			check(
				await service.from('class_teachers').insert({ class_id: row.id, teacher_id: teacher.id }),
				`assign teacher ${key}`
			);
			return { id: row.id as string, name };
		};
		const classA = await makeClass('A', '10:00', 90);
		const classB = await makeClass('B', '12:00', 60);
		const classC = { id: '', name: `E2E47 ${tag} C` };
		classC.id = check(
			await service
				.from('classes')
				.insert({ name: classC.name, code: `E${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
				.select('id')
				.single(),
			'create class C'
		).id;
		classIds.push(classC.id);

		// Created last, so cleanup (reverse order) deletes it first: a class
		// with students cannot be deleted (0011).
		const student = await createUser('student', tag, userIds);
		check(
			await service
				.from('profiles')
				.update({
					class_id: classA.id,
					status: 'approved',
					registration_name: `E2E47 Student ${tag}`,
					display_name: `E2E47 Student ${tag}`
				})
				.eq('id', student.id),
			'approve student'
		);
		const enrolled = check(
			await service
				.from('class_enrollments')
				.select('class_id')
				.eq('student_id', student.id)
				.eq('class_id', classA.id),
			'read enrollment'
		);
		if (!enrolled?.length) {
			check(
				await service
					.from('class_enrollments')
					.insert({ student_id: student.id, class_id: classA.id }),
				'enroll A'
			);
		}
		check(
			await service
				.from('class_enrollments')
				.insert({ student_id: student.id, class_id: classB.id }),
			'enroll B'
		);

		check(await service.from('class_days').insert(days.map((day) => ({ day }))), 'add class days');

		const rows = check(
			await service
				.from('class_sessions_effective')
				.select('id, class_id, day')
				.in('class_id', [classA.id, classB.id])
				.gte('day', `${month}-01`)
				.lte('day', `${month}-31`),
			'read sessions'
		);
		const sessions: Record<string, string> = {};
		for (const row of rows ?? []) {
			const key = row.class_id === classA.id ? 'A' : 'B';
			sessions[`${key}:${row.day}`] = row.id!;
		}
		if (Object.keys(sessions).length !== 6) {
			throw new Error(`expected 6 sessions, got ${Object.keys(sessions).length}`);
		}
		const cRows = check(
			await service
				.from('class_sessions_effective')
				.select('id, day')
				.eq('class_id', classC.id)
				.in('day', days),
			'read class C sessions'
		);
		for (const row of cRows ?? []) sessions[`C:${row.day}`] = row.id!;

		// Matrix "Cancelled": class B's session on the first day is cancelled.
		check(
			await service
				.from('class_sessions')
				.update({ cancelled: true })
				.eq('id', sessions[`B:${days[0]}`]),
			'cancel session'
		);

		return {
			tag,
			year,
			month,
			days,
			emptyDate,
			classA,
			classB,
			classC,
			admin,
			teacher,
			student,
			sessions,
			cleanup
		};
	} catch (error) {
		await cleanup().catch(() => undefined);
		throw error;
	}
}

export async function signIn(page: Page, user: TestUser) {
	await page.goto('/login');
	// Wait for hydration (which resets the fields) and for iX: the submit
	// control is an <ix-button>, not a native submit button.
	await page.waitForFunction(() => customElements.get('ix-button') !== undefined);
	await page.waitForLoadState('networkidle');
	await page.locator('#email').fill(user.email);
	await page.locator('#password').fill(user.password);
	await expect(page.locator('#email')).toHaveValue(user.email);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).not.toHaveURL(/\/login/);
}

/** Open /calendar (optionally `?month=`) and wait for the calendar to render. */
export async function openCalendar(page: Page, month?: string) {
	await page.goto(month ? `/calendar?month=${month}` : '/calendar');
	await page.locator('.ec').waitFor();
	// iX components (the dialogs) upgrade asynchronously.
	await page.waitForFunction(() => customElements.get('ix-modal') !== undefined);
}

/** Today's date in Europe/Berlin (`YYYY-MM-DD`). */
export function berlinToday(): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Berlin',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date());
}
