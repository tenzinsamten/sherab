import { createClient } from '@supabase/supabase-js';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Database } from '../src/lib/supabase/database.types';
import {
	berlinToday,
	env,
	fixtureTeam,
	helpSheet,
	openHelp,
	service,
	signIn,
	type TestUser
} from './fixtures';

/**
 * Mobile-first redesign, story 5 (shared pages): Requests, My account, the
 * leaderboard, Help and a team's page on the new component system. One
 * test per row of the story's I/O matrix, at 375px (phone) and 820px (iPad
 * portrait) -- Requests for the admin at 1440px -- plus the fit check (no
 * sideways scroll, every button at least 44×44px) in en, de and bo.
 *
 * Its own fixture: a teacher of class K with, per viewport, two waiting
 * registrations, a sick note and a class join request, plus one more of
 * each that stays (the tour and the admin's tables); an older registration
 * (one-time PIN at approval) and one that is decided meanwhile (the error
 * row); a planned leave and a decided sick note. A parent of K's sick
 * students asks for one child's deletion (and had one rejected); another
 * parent waits for approval. Two more teachers use My account, one per
 * viewport. The empty states are vitest render specs (page.render.spec.ts
 * next to each page).
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);

const VIEWPORTS = [
	{ name: 'phone', width: 375, height: 740 },
	{ name: 'tablet', width: 820, height: 1180 }
] as const;
type ViewportName = (typeof VIEWPORTS)[number]['name'];

const kName = `SH class K ${tag}`;
const jName = `SH class J ${tag}`;
let classK = '';
let classJ = '';

let teacher: TestUser;
/** #116: the teacher of class J, whose only request is one registration. */
let lastTeacher: TestUser;
let admin: TestUser;
let parent: TestUser;
let student: TestUser;
const account: Record<ViewportName, TestUser> = {} as Record<ViewportName, TestUser>;
const userIds: string[] = [];
const team = fixtureTeam(tag);
/** A second team, so the leaderboard has more than one row. */
const otherTeam = fixtureTeam(`${tag}-b`);
const createdDays: string[] = [];

/** Names of the requests, per use. */
const reg = (v: string, key: string) => `SH Reg ${v} ${key} ${tag}`;
const sickName = (v: string) => `SH Sick ${v} ${tag}`;
const joinName = (v: string) => `SH Join ${v} ${tag}`;
const credsName = `SH Reg creds ${tag}`;
const goneName = `SH Reg gone ${tag}`;
const lastName = `SH Reg last ${tag}`;
const leaveName = `SH Leave ${tag}`;
const sickDoneName = `SH Sick done ${tag}`;
const delPendingName = `SH Del pending ${tag}`;
const delDecidedName = `SH Del decided ${tag}`;
const delEraseName = `SH Del erase ${tag}`;
let delEraseRequest = '';
const parentPendingName = `SH Parent pending ${tag}`;
const studentName = `SH Student ${tag}`;
/** The fixture team's name (fixtureTeam adds a random suffix; read once created). */
let ourTeam = '';
const teamName = () => ourTeam;
const ids: Record<string, string> = {};

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

function plusDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}
const day = (offset: number) => plusDays(berlinToday(), offset);

async function createUser(
	role: 'admin' | 'teacher' | 'student' | 'parent',
	key: string,
	options: { pendingAddress?: boolean; name?: string } = {}
): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = options.pendingAddress
		? `pending-${crypto.randomUUID()}@students.internal.invalid`
		: `e2e-sh-${key}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role },
		user_metadata: options.name ? { display_name: options.name } : undefined
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	// Students first on cleanup: a class or team with students cannot be deleted.
	if (role === 'student') userIds.unshift(data.user.id);
	else userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

async function cleanup() {
	const problems: string[] = [];
	for (const id of userIds.slice()) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error && !/not found/i.test(error.message))
			problems.push(`delete user ${id}: ${error.message}`);
		else userIds.splice(userIds.indexOf(id), 1);
	}
	for (const fixture of [team, otherTeam]) {
		const teamProblem = await fixture.remove();
		if (teamProblem) problems.push(teamProblem);
	}
	for (const id of [classK, classJ].filter(Boolean)) {
		const { error } = await service.from('classes').delete().eq('id', id);
		if (error) problems.push(`delete class: ${error.message}`);
	}
	if (createdDays.length) {
		const { error } = await service.from('class_days').delete().in('day', createdDays);
		if (error) problems.push(`delete class days: ${error.message}`);
		else createdDays.length = 0;
	}
	if (problems.length) throw new Error(problems.join('; '));
}

/** An approved student of `classId` (enrolled), optionally the parent's child. */
async function approvedStudent(key: string, name: string, classId: string, parentId?: string) {
	const user = await createUser('student', key);
	check(
		await service
			.from('profiles')
			.update({
				class_id: classId,
				status: 'approved',
				registration_name: name,
				display_name: name,
				parent_id: parentId ?? null,
				team_id: await team.id()
			})
			.eq('id', user.id),
		`set up ${key}`
	);
	const enrolled = check(
		await service
			.from('class_enrollments')
			.select('class_id')
			.eq('student_id', user.id)
			.eq('class_id', classId),
		`read enrollment ${key}`
	);
	if (!enrolled?.length) {
		check(
			await service.from('class_enrollments').insert({ student_id: user.id, class_id: classId }),
			`enroll ${key}`
		);
	}
	return user;
}

/** A registration waiting in class K (or `classId`). */
async function pendingRegistration(
	key: string,
	name: string,
	pendingAddress = false,
	classId = classK
) {
	const user = await createUser('student', key, { pendingAddress });
	check(
		await service
			.from('profiles')
			.update({ class_id: classId, status: 'pending', registration_name: name })
			.eq('id', user.id),
		`make ${key} pending`
	);
	ids[name] = user.id;
	return user;
}

/** The parent's own client: leave answers and deletion requests are theirs (triggers check). */
let asParent: ReturnType<typeof createClient<Database>>;

/** A sick (or on-leave) answer for the parent's child `user` on a session of K. */
async function answer(user: TestUser, sessionId: string, value: 'sick' | 'on_leave') {
	check(
		await asParent.from('session_leave_history').insert({
			class_session_id: sessionId,
			student_id: user.id,
			answer: value,
			classification: value === 'on_leave' ? 'planned' : null
		}),
		`answer ${value}`
	);
}

test.beforeAll(async () => {
	try {
		ourTeam = check(
			await service
				.from('teams')
				.select('name')
				.eq('id', await team.id())
				.single(),
			'read team'
		).name;
		await otherTeam.id();
		teacher = await createUser('teacher', 'teacher');
		admin = await createUser('admin', 'admin');
		for (const v of VIEWPORTS) {
			account[v.name] = await createUser('teacher', `account-${v.name}`, {
				name: `SH Account ${v.name} ${tag}`
			});
		}
		parent = await createUser('parent', 'parent', { name: `SH Parent ${tag}` });
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);
		await createUser('parent', 'parent-pending', { name: parentPendingName });
		asParent = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		check(
			await asParent.auth.signInWithPassword({ email: parent.email, password: parent.password }),
			'parent sign-in'
		);

		for (const [key, name] of [
			['k', kName],
			['j', jName]
		] as const) {
			const id = check(
				await service
					.from('classes')
					.insert({
						name,
						code: `H${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
						badge_subject: 'language',
						default_start_time: '10:00',
						default_duration_minutes: 60,
						schedule_starts_on: '2000-01-02',
						schedule_ends_on: '2000-01-02'
					})
					.select('id')
					.single(),
				`create class ${key}`
			).id;
			if (key === 'k') classK = id;
			else classJ = id;
		}
		check(
			await service.from('class_teachers').insert({ class_id: classK, teacher_id: teacher.id }),
			'assign teacher'
		);

		// Two sessions of K: today (a sick note is for today or yesterday) and
		// next week (planned leave).
		const days = [day(0), day(8)];
		const existing = check(
			await service.from('class_days').select('day').in('day', days),
			'read class days'
		);
		const had = new Set((existing ?? []).map((d) => d.day));
		createdDays.push(...days.filter((d) => !had.has(d)));
		const sessions: string[] = [];
		for (const d of days) {
			sessions.push(
				check(
					await service.rpc('attendance_backfill_session', { p_class_id: classK, p_day: d }),
					`session on ${d}`
				) as string
			);
		}

		student = await approvedStudent('student', studentName, classJ);

		for (const v of [...VIEWPORTS.map((x) => x.name), 'desk']) {
			await pendingRegistration(`reg-${v}-a`, reg(v, 'A'));
			if (v !== 'desk') await pendingRegistration(`reg-${v}-b`, reg(v, 'B'));
			const sick = await approvedStudent(`sick-${v}`, sickName(v), classK, parent.id);
			await answer(sick, sessions[0], 'sick');
			const joiner = await approvedStudent(`join-${v}`, joinName(v), classJ);
			check(
				await service
					.from('class_join_requests')
					.insert({ student_id: joiner.id, class_id: classK }),
				`join request ${v}`
			);
		}
		await pendingRegistration('reg-creds', credsName, true);
		await pendingRegistration('reg-gone', goneName);
		lastTeacher = await createUser('teacher', 'teacher-last');
		check(
			await service.from('class_teachers').insert({ class_id: classJ, teacher_id: lastTeacher.id }),
			'assign last teacher'
		);
		await pendingRegistration('reg-last', lastName, false, classJ);

		const leave = await approvedStudent('leave', leaveName, classK, parent.id);
		await answer(leave, sessions[1], 'on_leave');
		const sickDone = await approvedStudent('sick-done', sickDoneName, classK, parent.id);
		await answer(sickDone, sessions[0], 'sick');
		check(
			await service.from('sick_leave_decisions').insert({
				class_session_id: sessions[0],
				student_id: sickDone.id,
				decision: 'approved'
			}),
			'decide sick note'
		);

		// Deletion requests are the parent's own (a trigger stamps who asked).
		const delPending = await approvedStudent('del-pending', delPendingName, classK, parent.id);
		const delDecided = await approvedStudent('del-decided', delDecidedName, classK, parent.id);
		const delErase = await approvedStudent('del-erase', delEraseName, classK, parent.id);
		for (const child of [delPending, delDecided, delErase]) {
			const request = check(
				await asParent
					.from('deletion_requests')
					.insert({ student_id: child.id })
					.select('id')
					.single(),
				'request deletion'
			);
			if (child === delErase) delEraseRequest = request.id;
		}
		await asParent.auth.signOut({ scope: 'local' });
		check(
			await service
				.from('deletion_requests')
				.update({ status: 'rejected' })
				.eq('student_id', delDecided.id),
			'reject deletion'
		);
	} catch (error) {
		await cleanup().catch(() => undefined);
		throw error;
	}
});

test.afterAll(async () => {
	await cleanup();
});

/** The migrated page's root marks itself hydrated (its controls work from then on). */
async function ready(page: Page) {
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

async function openPage(page: Page, path: string) {
	await page.goto(path);
	await ready(page);
}

/** A signed-in page at a viewport (a context of its own). */
async function signedIn(browser: Browser, width: number, height: number, who: TestUser) {
	const context = await browser.newContext({ viewport: { width, height } });
	const page = await context.newPage();
	await signIn(page, who);
	return page;
}

/**
 * No sideways scroll, and every visible button, breadcrumb link and
 * navigation link (the Help tabs) in the page is at least 44×44px.
 */
async function expectFits(page: Page) {
	const result = await page.evaluate(() => {
		const doc = document.documentElement;
		const small = [
			...document.querySelectorAll(
				'main button, main [data-slot="button"], main [data-slot="breadcrumb-link"], main nav a, main summary'
			)
		]
			.filter((el) => el.getClientRects().length > 0)
			.map((el) => ({ el, box: el.getBoundingClientRect() }))
			.filter(({ box }) => box.width < 43.5 || box.height < 43.5)
			.map(
				({ el, box }) =>
					`${el.textContent?.trim() || el.getAttribute('aria-label')}: ${Math.round(box.width)}×${Math.round(box.height)}`
			);
		return { scrollWidth: doc.scrollWidth, width: doc.clientWidth, small };
	});
	expect(result.scrollWidth).toBeLessThanOrEqual(result.width);
	expect(result.small).toEqual([]);
}

const toast = (page: Page, text: string | RegExp) =>
	page.locator('[data-sonner-toast]').getByText(text).first();
const confirmDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Are you sure?' });
const section = (page: Page, testid: string) => page.getByTestId(testid);
const row = (page: Page, testid: string, text: string) =>
	section(page, testid).getByTestId('request-row').filter({ hasText: text });
/** #116: the decided lists sit in the History group, closed on load. */
async function openHistory(page: Page) {
	const history = section(page, 'requests-history');
	if (!(await history.evaluate((el) => (el as HTMLDetailsElement).open)))
		await history.locator('summary').click();
	await expect(history).toHaveAttribute('open', '');
}
const countPill = (page: Page) => page.getByTestId('requests-count').locator('.sr-only');

async function pendingCount(page: Page): Promise<number> {
	const text = (await countPill(page).textContent()) ?? '';
	return Number(/\d+/.exec(text)?.[0] ?? 'NaN');
}

/** The rows of a list are stacked cards (below 80em) or table rows (from 80em). */
async function layoutOf(page: Page, testid: string) {
	return section(page, testid).evaluate((el) => {
		const table = el.querySelector('table');
		const tr = el.querySelector('tbody tr');
		return {
			table: table ? getComputedStyle(table).display : null,
			row: tr ? getComputedStyle(tr).display : null,
			header: el.querySelector('thead')
				? getComputedStyle(el.querySelector('thead')!).display
				: null
		};
	});
}

/** Where focus is: a request row or a section heading, and in which section. */
async function focusedSpot(page: Page) {
	return page.evaluate(() => {
		const el = document.activeElement;
		const where = el?.closest('section')?.getAttribute('data-testid') ?? '';
		if (el?.hasAttribute('data-request-row')) return `row:${where}`;
		if (el?.hasAttribute('data-section-heading')) return `heading:${where}`;
		return `other:${el?.tagName}`;
	});
}

async function profileStatus(id: string) {
	return check(await service.from('profiles').select('status').eq('id', id).single(), 'read status')
		.status;
}

for (const viewport of VIEWPORTS) {
	const v = viewport.name;

	test.describe(`at ${viewport.width}px`, () => {
		test(`requests (${v}): cards with every column's data, no sideways scroll, the count pill`, async ({
			browser
		}) => {
			const page = await signedIn(browser, viewport.width, viewport.height, teacher);
			try {
				await openPage(page, '/requests');
				await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible();
				await expect(countPill(page)).toHaveText(/^\d+ pending$/);

				for (const testid of ['requests-registrations', 'requests-sick', 'requests-join']) {
					expect(await layoutOf(page, testid)).toEqual({
						table: 'block',
						row: 'flex',
						header: 'none'
					});
				}
				// Every column's data in the card: name, class, date; the actions.
				const registration = row(page, 'requests-registrations', reg(v, 'A'));
				await expect(registration).toContainText(kName);
				await expect(registration.getByRole('button', { name: 'Approve' })).toBeVisible();
				await expect(registration.getByRole('button', { name: 'Reject' })).toBeVisible();
				const sick = row(page, 'requests-sick', sickName(v));
				await expect(sick).toContainText('Sick · Pending');
				await expect(sick).toContainText(kName);
				await expect(sick.locator('time')).toHaveAttribute('datetime', day(0));
				await expect(sick.getByRole('button', { name: 'Approve' })).toBeVisible();
				const join = row(page, 'requests-join', joinName(v));
				await expect(join).toContainText(kName);
				await expect(join).toContainText(jName);
				await expect(join.getByRole('button', { name: 'Reject' })).toBeVisible();
				// Planned leave and the decided sick note (in the History) are listed too.
				await expect(row(page, 'requests-upcoming-leave', leaveName)).toContainText('On leave');
				await expect(section(page, 'requests-history')).not.toHaveAttribute('open');
				await openHistory(page);
				await expect(row(page, 'requests-sick-decided', sickDoneName)).toContainText('Approved');
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`approve / reject (${v}): an alert dialog, Cancel does nothing, Confirm decides and the pill drops`, async ({
			browser
		}) => {
			const page = await signedIn(browser, viewport.width, viewport.height, teacher);
			try {
				await openPage(page, '/requests');
				const before = await pendingCount(page);

				// Reject a registration: Cancel first.
				const rejected = row(page, 'requests-registrations', reg(v, 'B'));
				await rejected.getByRole('button', { name: 'Reject' }).click();
				await expect(confirmDialog(page)).toContainText(reg(v, 'B'));
				await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click();
				await expect(confirmDialog(page)).toHaveCount(0);
				await expect(rejected.getByRole('button', { name: 'Reject' })).toBeFocused();
				expect(await profileStatus(ids[reg(v, 'B')])).toBe('pending');

				// Confirm: toast, the row leaves, the pill drops, focus moves on.
				await rejected.getByRole('button', { name: 'Reject' }).click();
				await confirmDialog(page).getByRole('button', { name: 'Reject' }).click();
				await expect(toast(page, `${reg(v, 'B')} was rejected.`)).toBeVisible();
				await expect(rejected).toHaveCount(0);
				await expect.poll(() => profileStatus(ids[reg(v, 'B')])).toBe('rejected');
				await expect.poll(() => pendingCount(page)).toBe(before - 1);
				await expect(section(page, 'requests-registrations').locator(':focus')).toHaveAttribute(
					'data-request-row',
					''
				);
				// Listed as decided now, in the History.
				await openHistory(page);
				await expect(row(page, 'requests-decided', reg(v, 'B'))).toContainText('Rejected');

				// Approve a sick note.
				const sick = row(page, 'requests-sick', sickName(v));
				await sick.getByRole('button', { name: 'Approve' }).click();
				await confirmDialog(page).getByRole('button', { name: 'Approve' }).click();
				await expect(toast(page, `Sick leave for ${sickName(v)} was approved.`)).toBeVisible();
				await expect(sick).toHaveCount(0);
				await expect.poll(() => pendingCount(page)).toBe(before - 2);
				// The next sick note took its place (other sick notes remain).
				await expect.poll(() => focusedSpot(page)).toBe('row:requests-sick');

				// Approve a class join request (a shared hidden form posts it).
				const join = row(page, 'requests-join', joinName(v));
				await join.getByRole('button', { name: 'Approve' }).click();
				await expect(confirmDialog(page)).toContainText(joinName(v));
				await confirmDialog(page).getByRole('button', { name: 'Approve' }).click();
				await expect(toast(page, `${joinName(v)} now belongs to ${kName}.`)).toBeVisible();
				await expect(join).toHaveCount(0);
				await expect.poll(() => pendingCount(page)).toBe(before - 3);
				// Focus is on the join request now in its place (others remain).
				await expect.poll(() => focusedSpot(page)).toBe('row:requests-join');
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`account (${v}): name, password with the password manager's fields, parent access`, async ({
			browser
		}) => {
			const who = account[v];
			const page = await signedIn(browser, viewport.width, viewport.height, who);
			try {
				await openPage(page, '/account');
				// Native fields with visible labels; the email is read-only.
				const name = page.getByLabel('Display name');
				await expect(name).toHaveValue(`SH Account ${v} ${tag}`);
				await expect(page.getByLabel('Email (used to sign in)')).toHaveValue(who.email);
				await expect(page.getByLabel('Email (used to sign in)')).toHaveAttribute('readonly', '');
				await name.fill(`SH Renamed ${v} ${tag}`);
				await page.getByRole('button', { name: 'Save name' }).click();
				await expect(toast(page, 'Name updated.')).toBeVisible();
				await expect(name).toHaveValue(`SH Renamed ${v} ${tag}`);

				// What a password manager reads: the account's username and the
				// fields' purposes.
				const form = page.locator('form[action="?/changePassword"]');
				await expect(form.locator('input[name="username"]')).toHaveAttribute(
					'autocomplete',
					'username'
				);
				await expect(form.locator('input[name="username"]')).toHaveValue(who.email);
				const current = page.getByLabel('Current password');
				await expect(current).toHaveAttribute('autocomplete', 'current-password');
				await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute(
					'autocomplete',
					'new-password'
				);
				await expect(page.getByLabel('Confirm new password')).toHaveAttribute(
					'autocomplete',
					'new-password'
				);

				// A wrong current password: the error under the field.
				const next = `New-${crypto.randomUUID()}`;
				await current.fill('not-the-password');
				await page.getByLabel('New password', { exact: true }).fill(next);
				await page.getByLabel('Confirm new password').fill(next);
				await page.getByRole('button', { name: 'Change password' }).click();
				await expect(page.locator('#currentPassword-error')).toHaveText(
					'Your current password is not correct.'
				);
				await expect(current).toHaveAttribute('aria-invalid', 'true');
				await expect(current).toHaveAttribute('aria-describedby', 'currentPassword-error');

				// The right one: saved.
				await current.fill(who.password);
				await page.getByLabel('New password', { exact: true }).fill(next);
				await page.getByLabel('Confirm new password').fill(next);
				await page.getByRole('button', { name: 'Change password' }).click();
				await expect(toast(page, /^Password changed\./)).toBeVisible();
				await expect(page.locator('#currentPassword-error')).toHaveCount(0);
				who.password = next;

				// Homework notifications are not set up locally (no push key): no card.
				await expect(page.getByRole('heading', { name: 'Notifications' })).toHaveCount(0);

				// Parent access.
				const card = page.getByRole('region', { name: 'Parent access' });
				await card.getByRole('button', { name: 'Request parent access' }).click();
				await expect(toast(page, 'Request sent. The admin will review it.')).toBeVisible();
				await expect(card).toContainText('Awaiting admin approval.');
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`leaderboard (${v}): ranked rows, the top rank highlighted${viewport.width >= 768 ? ', two columns' : ''}`, async ({
			browser
		}) => {
			const page = await signedIn(browser, viewport.width, viewport.height, student);
			try {
				await openPage(page, '/leaderboard');
				const rows = page.getByTestId('leaderboard').getByTestId('leaderboard-row');
				expect(await rows.count()).toBeGreaterThan(1);
				await expect(rows.first()).toHaveAttribute('data-top', 'true');
				await expect(rows.nth(1)).not.toHaveAttribute('data-top', 'true');
				await expect(rows.first()).toHaveAttribute('aria-label', /^Rank 1/);
				const ours = rows.filter({ hasText: teamName() });
				await expect(ours).toHaveCount(1);
				const first = (await rows.nth(0).boundingBox())!;
				const second = (await rows.nth(1).boundingBox())!;
				if (viewport.width >= 768) {
					// Side by side.
					expect(Math.abs(first.y - second.y)).toBeLessThan(2);
					expect(second.x).toBeGreaterThan(first.x + first.width - 1);
				} else {
					expect(second.y).toBeGreaterThan(first.y + first.height - 1);
				}
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`team (${v}): the breadcrumb and the member list, no sideways scroll`, async ({
			browser
		}) => {
			const page = await signedIn(browser, viewport.width, viewport.height, student);
			try {
				await openPage(page, '/leaderboard');
				await page.getByRole('link', { name: `Students of team ${teamName()}` }).click();
				await ready(page);
				await expect(page.getByRole('heading', { level: 1, name: teamName() })).toBeVisible();
				const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
				await expect(trail.getByRole('link', { name: 'Team Leaderboard' })).toBeVisible();
				await expect(trail.locator('[aria-current="page"]')).toHaveText(teamName());
				await expect(
					page.getByTestId('team-students').getByRole('listitem').filter({ hasText: studentName })
				).toHaveCount(1);
				await expectFits(page);
			} finally {
				await page.context().close();
			}
		});

		test(`help (${v}): role tabs at least 44px with aria-current, the same guide in the shell sheet`, async ({
			browser
		}) => {
			const page = await signedIn(browser, viewport.width, viewport.height, teacher);
			try {
				await openPage(page, '/help');
				const tabs = page.getByRole('navigation', { name: 'Guides' });
				const teacherTab = tabs.getByRole('link', { name: 'For teachers' });
				const parentTab = tabs.getByRole('link', { name: 'For parents' });
				// A teacher starts on their own guide.
				await expect(teacherTab).toHaveAttribute('aria-current', 'page');
				await parentTab.click();
				await expect(page).toHaveURL(/\?role=parent$/);
				await expect(parentTab).toHaveAttribute('aria-current', 'page');
				await expect(teacherTab).not.toHaveAttribute('aria-current', 'page');
				await expectFits(page);

				await teacherTab.click();
				await expect(teacherTab).toHaveAttribute('aria-current', 'page');
				const pageSteps = await page
					.locator('main')
					.getByTestId('help-guide')
					.locator('h3')
					.allTextContents();
				expect(pageSteps.length).toBeGreaterThan(1);
				const sheet = await openHelp(page);
				await expect(sheet.getByTestId('help-guide').first().locator('h3')).toHaveText(pageSteps);
				// A question opens from its summary.
				await sheet.getByRole('tab', { name: 'Common questions' }).click();
				const question = sheet.getByTestId('help-faq').locator('details').first();
				await question.locator('summary').click();
				await expect(question).toHaveAttribute('open', '');
				await page.keyboard.press('Escape');
				await expect(helpSheet(page)).toHaveCount(0);
			} finally {
				await page.context().close();
			}
		});
	});
}

test('approve with credentials at 375px: the one-time sign-in, Copy and Copy both', async ({
	browser
}) => {
	const page = await signedIn(browser, 375, 740, teacher);
	try {
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
			origin: new URL(page.url()).origin
		});
		await openPage(page, '/requests');
		await row(page, 'requests-registrations', credsName)
			.getByRole('button', { name: 'Approve' })
			.click();
		const outcome = page.getByTestId('requests-outcome');
		await expect(outcome).toContainText(`${credsName} was approved`);
		await expect(outcome).toContainText('One-time sign-in');
		const values = outcome.locator('.credential');
		await expect(values).toHaveCount(2);
		await expect(values.nth(1)).toHaveText(/^\d{6}$/);
		const username = (await values.nth(0).textContent())?.trim() ?? '';
		const pin = (await values.nth(1).textContent())?.trim() ?? '';

		await outcome.getByRole('button', { name: 'Copy PIN' }).click();
		await expect(toast(page, 'Copied')).toBeVisible();
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(pin);
		await outcome.getByRole('button', { name: 'Copy both' }).click();
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
			`Username: ${username}\nPIN: ${pin}`
		);
		await expectFits(page);
	} finally {
		await page.context().close();
	}
});

test('a request decided meanwhile at 375px: the error toast, nothing else changes', async ({
	browser
}) => {
	const page = await signedIn(browser, 375, 740, teacher);
	try {
		await openPage(page, '/requests');
		const gone = row(page, 'requests-registrations', goneName);
		await expect(gone).toHaveCount(1);
		check(
			await service.from('profiles').update({ status: 'rejected' }).eq('id', ids[goneName]),
			'decide meanwhile'
		);
		await gone.getByRole('button', { name: 'Approve' }).click();
		await expect(
			toast(page, 'That request could not be found — it may already have been decided.')
		).toBeVisible();
		await expect(page.getByTestId('requests-outcome')).toHaveCount(0);
		expect(await profileStatus(ids[goneName])).toBe('rejected');
	} finally {
		await page.context().close();
	}
});

test('the last request decided at 375px (#116): the card leaves, Nothing waiting, focus on the heading', async ({
	browser
}) => {
	const page = await signedIn(browser, 375, 740, lastTeacher);
	try {
		await openPage(page, '/requests');
		await expect(page.getByTestId('requests-empty')).toHaveCount(0);
		const last = row(page, 'requests-registrations', lastName);
		await last.getByRole('button', { name: 'Reject' }).click();
		await confirmDialog(page).getByRole('button', { name: 'Reject' }).click();
		await expect(toast(page, `${lastName} was rejected.`)).toBeVisible();
		await expect(section(page, 'requests-registrations')).toHaveCount(0);
		await expect(page.getByTestId('requests-empty')).toContainText('Nothing waiting');
		await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeFocused();
		await expect.poll(() => profileStatus(ids[lastName])).toBe('rejected');
	} finally {
		await page.context().close();
	}
});

/** A context whose browser looks like a person's: tours start by themselves. */
async function personPage(browser: Browser, width: number, height: number, who: TestUser) {
	const context: BrowserContext = await browser.newContext({ viewport: { width, height } });
	const page = await context.newPage();
	// Signed in first, so the dashboard's own tour does not start.
	await signIn(page, who);
	await context.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
	});
	return page;
}

const popover = (page: Page) => page.locator('.driver-popover');
const highlighted = (page: Page) => page.locator('.driver-active-element');

for (const [width, height] of [
	[375, 740],
	[1440, 900]
] as const) {
	test(`teacher tour at ${width}px: every step highlights a visible element`, async ({
		browser
	}) => {
		const page = await personPage(browser, width, height, teacher);
		try {
			await openPage(page, '/requests');
			if (!(await popover(page).isVisible())) {
				// Seen at the other width already: start it again from Help.
				const help = await openHelp(page);
				await help
					.getByRole('button', { name: 'Show me around this page' })
					.filter({ visible: true })
					.click();
			}
			for (const [index, target] of [
				'requests-registrations',
				'requests-sick',
				'requests-join'
			].entries()) {
				await expect(popover(page)).toContainText(`${index + 1} of 3`);
				await expect(highlighted(page)).toHaveAttribute('data-tour', target);
				await expect(highlighted(page)).toBeVisible();
				const box = (await highlighted(page).boundingBox())!;
				expect(box.width).toBeGreaterThan(0);
				expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
				await popover(page)
					.getByRole('button', { name: index === 2 ? 'Done' : 'Next' })
					.click();
			}
			await expect(popover(page)).toHaveCount(0);
		} finally {
			await page.context().close();
		}
	});
}

test('requests at 1440px for the admin: full tables for all ten sections, actions in reach', async ({
	browser
}) => {
	const page = await signedIn(browser, 1440, 900, admin);
	try {
		await openPage(page, '/requests');
		await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
		// The decided tables are in the History, closed on load.
		await openHistory(page);
		const sections = [
			'requests-registrations',
			'requests-decided',
			'requests-sick',
			'requests-sick-decided',
			'requests-upcoming-leave',
			'requests-join',
			'requests-deletion',
			'requests-deletion-decided',
			'requests-parents',
			'requests-parents-decided'
		];
		for (const testid of sections) {
			const layout = await layoutOf(page, testid);
			expect(layout.table, testid).toBe('table');
			expect(layout.row, testid).toBe('table-row');
			if (layout.header !== null) expect(layout.header, testid).toBe('table-header-group');
		}
		await expect(row(page, 'requests-deletion', delPendingName)).toBeVisible();
		await expect(row(page, 'requests-deletion-decided', delDecidedName)).toContainText('Rejected');
		await expect(row(page, 'requests-parents', parentPendingName)).toContainText('Email confirmed');
		// Every action button is on screen, none past the right edge.
		const outside = await page.evaluate(
			() =>
				[...document.querySelectorAll('main table button')]
					.map((el) => el.getBoundingClientRect())
					.filter((box) => box.right > document.documentElement.clientWidth || box.width < 43.5)
					.length
		);
		expect(outside).toBe(0);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
		// The deletion approval asks first; Cancel does nothing.
		await row(page, 'requests-deletion', delPendingName)
			.getByRole('button', { name: 'Approve' })
			.click();
		await expect(confirmDialog(page)).toContainText(delPendingName);
		await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click();
		await expect(confirmDialog(page)).toHaveCount(0);
		await expect(row(page, 'requests-deletion', delPendingName)).toHaveCount(1);

		// Approve, then Erase: the toast, the row leaves, the request is approved.
		const erase = row(page, 'requests-deletion', delEraseName);
		await erase.getByRole('button', { name: 'Approve' }).click();
		await expect(confirmDialog(page)).toContainText(delEraseName);
		await confirmDialog(page).getByRole('button', { name: 'Erase' }).click();
		await expect(toast(page, new RegExp(delEraseName))).toBeVisible();
		await expect(erase).toHaveCount(0);
		await expect
			.poll(
				async () =>
					check(
						await service
							.from('deletion_requests')
							.select('status')
							.eq('id', delEraseRequest)
							.single(),
						'read deletion request'
					).status
			)
			.toBe('approved');
	} finally {
		await page.context().close();
	}
});

for (const locale of ['en', 'de', 'bo']) {
	test(`every shared page at 375px in ${locale}: no sideways scroll, buttons at least 44×44px`, async ({
		browser
	}) => {
		const setLocale = async (page: Page) =>
			page
				.context()
				.addCookies([{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }]);

		const staff = await signedIn(browser, 375, 740, teacher);
		try {
			await setLocale(staff);
			for (const path of ['/requests', '/account', '/help', '/help?role=student']) {
				await openPage(staff, path);
				await expect(staff.locator('html')).toHaveAttribute('lang', locale);
				await expectFits(staff);
			}
		} finally {
			await staff.context().close();
		}

		// The admin's sections (deletion and parent requests) too.
		const boss = await signedIn(browser, 375, 740, admin);
		try {
			await setLocale(boss);
			await openPage(boss, '/requests');
			await expect(boss.locator('html')).toHaveAttribute('lang', locale);
			await expect(boss.getByTestId('requests-parents')).toBeVisible();
			await expectFits(boss);
		} finally {
			await boss.context().close();
		}

		const kid = await signedIn(browser, 375, 740, student);
		try {
			await setLocale(kid);
			const teamId = check(
				await service.from('profiles').select('team_id').eq('id', student.id).single(),
				'read team'
			).team_id!;
			for (const path of ['/leaderboard', `/teams/${teamId}`, '/account']) {
				await openPage(kid, path);
				await expect(kid.locator('html')).toHaveAttribute('lang', locale);
				await expectFits(kid);
			}
		} finally {
			await kid.context().close();
		}

		// Help is open without signing in too.
		const context = await browser.newContext({ viewport: { width: 375, height: 740 } });
		const visitor = await context.newPage();
		try {
			await visitor.goto(`/${locale}/help`);
			await visitor.locator('main > [data-ui="new"][data-hydrated]').waitFor();
			await expect(visitor.locator('html')).toHaveAttribute('lang', locale);
			await expectFits(visitor);
		} finally {
			await context.close();
		}
	});
}
