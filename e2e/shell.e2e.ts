import { expect, test, type Browser, type Page } from '@playwright/test';
import {
	fixtureTeam,
	helpSheet,
	mainNav,
	openAccountMenu,
	openHelp,
	service,
	signIn,
	type TestUser
} from './fixtures';

/**
 * Mobile-first redesign, story 2: the signed-in app shell -- header,
 * bottom tab bar below 80em, side nav from 80em, Help sheet. One test per
 * row of the story's I/O matrix, at 375, 820, 1180 and 1440px.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const userIds: string[] = [];
const team = fixtureTeam(tag);

let teacher: TestUser;
let admin: TestUser;
let parent: TestUser;
let student: TestUser;
let pendingStudent: TestUser;
let teacherParent: TestUser;
/** #108: a class taught by `teacher`, for the Classes tab. */
let classId: string | undefined;
const className = `Shell class ${tag}`;

type Role = 'teacher' | 'admin' | 'parent' | 'student';

async function createUser(role: Role, key: string): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-shell-${key}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role },
		user_metadata: { display_name: `Shell ${key}` }
	});
	if (error || !data.user) throw new Error(`create ${key}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

async function check(promise: PromiseLike<{ error: { message: string } | null }>, what: string) {
	const { error } = await promise;
	if (error) throw new Error(`${what}: ${error.message}`);
}

test.beforeAll(async () => {
	teacher = await createUser('teacher', 'teacher');
	admin = await createUser('admin', 'admin');
	parent = await createUser('parent', 'parent');
	await check(
		service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
		'approve parent'
	);
	student = await createUser('student', 'student');
	await check(
		service
			.from('profiles')
			.update({ status: 'approved', team_id: await team.id() })
			.eq('id', student.id),
		'approve student'
	);
	// Pending: also gives the admin at least one pending request.
	pendingStudent = await createUser('student', 'pending');
	teacherParent = await createUser('teacher', 'dual');
	await check(
		service.from('parents').upsert({ id: teacherParent.id, status: 'approved' }),
		'dual parents row'
	);
	const { data: cls, error: classError } = await service
		.from('classes')
		.insert({ name: className, code: `S${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
		.select('id')
		.single();
	if (classError || !cls) throw new Error(`create class: ${classError?.message}`);
	classId = cls.id;
	await check(
		service.from('class_teachers').insert({ class_id: cls.id, teacher_id: teacher.id }),
		'assign teacher'
	);
});

test.afterAll(async () => {
	const problems: string[] = [];
	if (classId) {
		const { error } = await service.from('classes').delete().eq('id', classId);
		if (error) problems.push(`delete class: ${error.message}`);
	}
	for (const id of userIds) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	const teamProblem = await team.remove();
	if (teamProblem) problems.push(teamProblem);
	if (problems.length) throw new Error(problems.join('; '));
});

const bottomNav = (page: Page) => page.getByTestId('bottom-nav');
const sideNav = (page: Page) => page.getByTestId('side-nav');

/** What the shown navigation's entries read out (aria-hidden parts left out), in order. */
async function navNames(page: Page): Promise<string[]> {
	const entries = mainNav(page).locator(':is(a, button):not([data-testid="side-nav-toggle"])');
	return entries.evaluateAll((els) =>
		els.map((el) => {
			const copy = el.cloneNode(true) as HTMLElement;
			for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
			return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
		})
	);
}

async function newPage(browser: Browser, width: number) {
	const context = await browser.newContext({ viewport: { width, height: 800 } });
	return context.newPage();
}

/** Switches the interface language (the paraglide cookie) and reloads. */
async function useLocale(page: Page, locale: string) {
	await page
		.context()
		.addCookies([{ name: 'PARAGLIDE_LOCALE', value: locale, url: new URL(page.url()).origin }]);
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

test('phone nav: a teacher at 375px gets the bottom bar, no hamburger and no side nav', async ({
	browser
}) => {
	const page = await newPage(browser, 375);
	try {
		await signIn(page, teacher);
		await expect(page).toHaveURL(/\/teacher$/);
		await expect(bottomNav(page)).toBeVisible();
		await expect(sideNav(page)).toBeHidden();
		// #108: Classes is a tab; Leaderboard and Help are in More.
		expect(await navNames(page)).toEqual([
			'Dashboard',
			'Classes',
			'Calendar',
			expect.stringMatching(/^Requests/),
			'More'
		]);
		const dashboard = mainNav(page).getByRole('link', { name: 'Dashboard' });
		await expect(dashboard).toHaveAttribute('aria-current', 'page');

		// One tap to another destination; the active item follows.
		await mainNav(page).getByRole('link', { name: 'Calendar' }).click();
		await expect(page).toHaveURL(/\/calendar$/);
		await expect(mainNav(page).getByRole('link', { name: 'Calendar' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(dashboard).not.toHaveAttribute('aria-current');

		// Every target is at least 44x44px, inside the screen.
		for (const box of await mainNav(page)
			.locator('a, button')
			.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))) {
			expect(box.width).toBeGreaterThanOrEqual(44);
			expect(box.height).toBeGreaterThanOrEqual(44);
			expect(box.right).toBeLessThanOrEqual(375);
		}

		// More holds Leaderboard, Board and Help; More is active on Leaderboard.
		await mainNav(page).getByRole('button', { name: 'More' }).click();
		const sheet = page.getByRole('dialog', { name: 'More pages' });
		await expect(sheet).toBeVisible();
		await expect(sheet.locator('ul').locator(':is(a, button)')).toHaveText([
			'Leaderboard',
			'Board',
			'Help'
		]);
		await sheet.getByRole('link', { name: 'Leaderboard' }).click();
		await expect(page).toHaveURL(/\/leaderboard$/);
		await expect(sheet).toBeHidden();
		await expect(mainNav(page).getByRole('button', { name: 'More' })).toHaveAttribute(
			'aria-current',
			'page'
		);
	} finally {
		await page.context().close();
	}
});

test('teacher phone (#108): Classes lists the classes; on a class page Classes stays active, Dashboard not', async ({
	browser
}) => {
	const page = await newPage(browser, 375);
	try {
		await signIn(page, teacher);
		await expect(page).toHaveURL(/\/teacher$/);
		const classes = mainNav(page).getByRole('link', { name: 'Classes' });
		const dashboard = mainNav(page).getByRole('link', { name: 'Dashboard' });
		await classes.click();
		await expect(page).toHaveURL(/\/teacher\/classes$/);
		await expect(page.getByRole('heading', { level: 1, name: 'My Classes' })).toBeVisible();
		await expect(classes).toHaveAttribute('aria-current', 'page');
		await expect(dashboard).not.toHaveAttribute('aria-current');

		const card = page.getByTestId('class-cards').locator('li').filter({ hasText: className });
		await expect(card).toBeVisible();
		await card.getByRole('link').click();
		await expect(page).toHaveURL(new RegExp(`/teacher/classes/${classId}$`));
		await expect(classes).toHaveAttribute('aria-current', 'page');
		await expect(dashboard).not.toHaveAttribute('aria-current');
	} finally {
		await page.context().close();
	}
});

test('desktop (#108): a teacher at 1440px gets all seven side nav items, each reachable', async ({
	browser
}) => {
	const page = await newPage(browser, 1440);
	try {
		await signIn(page, teacher);
		await expect(sideNav(page)).toBeVisible();
		await expect(bottomNav(page)).toBeHidden();
		expect(await navNames(page)).toEqual([
			'Dashboard',
			'Classes',
			'Calendar',
			'Board',
			expect.stringMatching(/^Requests/),
			'Leaderboard',
			'Help'
		]);
		for (const [name, url] of [
			['Classes', /\/teacher\/classes$/],
			['Calendar', /\/calendar$/],
			[/^Board$/, /\/board$/],
			[/^Requests/, /\/requests$/],
			['Leaderboard', /\/leaderboard$/],
			['Dashboard', /\/teacher$/]
		] as const) {
			const link = mainNav(page).getByRole('link', { name });
			await link.click();
			await expect(page).toHaveURL(url);
			await expect(link).toHaveAttribute('aria-current', 'page');
		}
		await openHelp(page);
		await expect(helpSheet(page).getByRole('tab', { name: 'For teachers' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
	} finally {
		await page.context().close();
	}
});

test('admin phone: Dashboard, Classes, Requests (count), Calendar; More holds the rest', async ({
	browser
}) => {
	const page = await newPage(browser, 375);
	try {
		await signIn(page, admin);
		await expect(page).toHaveURL(/\/admin$/);
		expect(await navNames(page)).toEqual([
			'Dashboard',
			'Classes',
			expect.stringMatching(/^Requests/),
			'Calendar',
			'More'
		]);
		// The pending student is a pending request: the count shows.
		const requests = mainNav(page).getByRole('link', { name: /^Requests/ });
		await expect(requests).toHaveAttribute('data-count', /^[1-9]\d*$/);
		await expect(requests).toHaveAccessibleName(/^Requests\s*,\s*\d+ pending$/);
		// #123: the count pill at 12px, also under Tibetan (a "༡" at 10px reads as
		// a comma), with the Tibetan line (#114) so the glyph is not cut.
		// By test id and address: under Tibetan the nav's and link's names change.
		const pill = bottomNav(page).locator('a[href$="/requests"] [data-count-pill]');
		const pillStyle = () =>
			pill.evaluate((el) => {
				const style = getComputedStyle(el);
				return {
					size: parseFloat(style.fontSize),
					line: parseFloat(style.lineHeight),
					cut: el.scrollHeight > el.clientHeight + 1
				};
			});
		expect((await pillStyle()).size).toBeGreaterThanOrEqual(12);
		await useLocale(page, 'bo');
		const bo = await pillStyle();
		expect(bo.size).toBeGreaterThanOrEqual(12);
		expect(bo.line).toBeGreaterThanOrEqual(2 * bo.size - 0.5);
		expect(bo.cut).toBe(false);
		await useLocale(page, 'en');

		await mainNav(page).getByRole('button', { name: 'More' }).click();
		const sheet = page.getByRole('dialog', { name: 'More pages' });
		await expect(sheet).toBeVisible();
		const entries = sheet.locator('ul').locator(':is(a, button)');
		await expect(entries).toHaveText([
			'Teachers',
			'Parents',
			'Teams',
			'Leaderboard',
			'Board',
			'Help'
		]);

		await sheet.getByRole('link', { name: 'Teams' }).click();
		await expect(page).toHaveURL(/\/admin\/teams$/);
		await expect(sheet).toBeHidden();
		// More is the active tab on a page it holds.
		await expect(mainNav(page).getByRole('button', { name: 'More' })).toHaveAttribute(
			'aria-current',
			'page'
		);
	} finally {
		await page.context().close();
	}
});

test('tablet: a parent gets the bottom bar at 820px and at 1180px (below 80em)', async ({
	browser
}) => {
	const page = await newPage(browser, 820);
	try {
		await signIn(page, parent);
		await expect(page).toHaveURL(/\/parent$/);
		await expect(bottomNav(page)).toBeVisible();
		await expect(sideNav(page)).toBeHidden();
		expect(await navNames(page)).toEqual(['Dashboard', 'Homework', 'Calendar', 'Board', 'Help']);

		// The side nav takes over from 80em (1280px) -- see the story's
		// Implementation Notes on the 1180px row.
		await page.setViewportSize({ width: 1180, height: 820 });
		await expect(bottomNav(page)).toBeVisible();
		await expect(sideNav(page)).toBeHidden();
		await page.setViewportSize({ width: 1280, height: 820 });
		await expect(sideNav(page)).toBeVisible();
		await expect(bottomNav(page)).toBeHidden();
		expect(await navNames(page)).toEqual(['Dashboard', 'Homework', 'Calendar', 'Board', 'Help']);
	} finally {
		await page.context().close();
	}
});

test('desktop: an admin at 1440px gets the side nav with all ten items; collapse survives a reload', async ({
	browser
}) => {
	const page = await newPage(browser, 1440);
	try {
		await signIn(page, admin);
		await expect(sideNav(page)).toBeVisible();
		await expect(bottomNav(page)).toBeHidden();
		expect(await navNames(page)).toEqual([
			'Dashboard',
			'Classes',
			'Teachers',
			'Parents',
			'Teams',
			'Calendar',
			'Board',
			expect.stringMatching(/^Requests/),
			'Leaderboard',
			'Help'
		]);

		await expect(sideNav(page)).toHaveAttribute('data-expanded', 'true');
		await page.getByRole('button', { name: 'Collapse menu' }).click();
		await expect(sideNav(page)).toHaveAttribute('data-expanded', 'false');
		await page.reload();
		await expect(sideNav(page)).toHaveAttribute('data-expanded', 'false');
		// #123: collapsed, the Requests pill is 12px and stays inside the rail,
		// with no sideways scroll in the list.
		const rail = await sideNav(page).evaluate((nav) => {
			const pill = nav.querySelector<HTMLElement>('[data-count-pill]');
			const list = nav.querySelector('ul');
			return {
				size: pill ? parseFloat(getComputedStyle(pill).fontSize) : 0,
				inside: pill
					? pill.getBoundingClientRect().right <= nav.getBoundingClientRect().right
					: false,
				scrolls: list ? list.scrollWidth > list.clientWidth + 1 : true
			};
		});
		expect(rail).toEqual({ size: 12, inside: true, scrolls: false });
		// Collapsed, the entries keep their names (icons only on screen).
		await expect(mainNav(page).getByRole('link', { name: 'Teams' })).toBeVisible();

		await page.getByRole('button', { name: 'Expand menu' }).click();
		await expect(sideNav(page)).toHaveAttribute('data-expanded', 'true');
		await page.reload();
		await expect(sideNav(page)).toHaveAttribute('data-expanded', 'true');
	} finally {
		await page.context().close();
	}
});

// #108: the teacher's bar (four links and More) too. Board (spec-parent-message-board
// story 3) is a student tab, so the student's bar has six labels.
for (const [role, user, links, labelCount] of [
	['student', () => student, 6, 6],
	['teacher', () => teacher, 4, 5]
] as const) {
	for (const locale of ['en', 'de', 'bo']) {
		test(`long labels: a ${role} at 375px in ${locale} sees every bar and header label in full, on at most two lines`, async ({
			browser
		}) => {
			const page = await newPage(browser, 375);
			try {
				await signIn(page, user());
				await expect(page).toHaveURL(new RegExp(`/${role}$`));
				await useLocale(page, locale);
				await expect(bottomNav(page).getByRole('link')).toHaveCount(links);
				const labels = await page
					.locator('[data-testid="bottom-nav"] [data-nav-label]')
					.evaluateAll((spans) =>
						spans.map((span) => {
							const style = getComputedStyle(span);
							const lineHeight = parseFloat(style.lineHeight);
							const box = span.getBoundingClientRect();
							return {
								text: span.textContent,
								clipped:
									span.scrollWidth > span.clientWidth + 1 ||
									span.scrollHeight > span.clientHeight + 1,
								lines: Math.round(box.height / lineHeight),
								size: parseFloat(style.fontSize),
								left: box.left,
								right: box.right
							};
						})
					);
				expect(labels).toHaveLength(labelCount);
				for (const label of labels) {
					expect(label.clipped, `${label.text} clipped`).toBe(false);
					expect(label.lines, `${label.text} lines`).toBeLessThanOrEqual(2);
					// #123: at 11px the labels (and Tibetan in particular) were too
					// small to read on a phone; keep them at 12px or more.
					expect(label.size, `${label.text} size`).toBeGreaterThanOrEqual(12);
					expect(label.left).toBeGreaterThanOrEqual(0);
					expect(label.right).toBeLessThanOrEqual(375);
				}

				// CAP-6: the header fits -- logo, language and avatar, nothing cut.
				const header = page.getByTestId('app-header');
				expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
				const language = page.getByTestId('language-menu');
				expect(
					await language.evaluate((el) =>
						[...el.querySelectorAll('span')].every((s) => s.scrollWidth <= s.clientWidth + 1)
					)
				).toBe(true);
				const right = await page
					.getByTestId('account-menu')
					.evaluate((el) => el.getBoundingClientRect().right);
				expect(right).toBeLessThanOrEqual(375);
			} finally {
				await page.context().close();
			}
		});
	}
}

test('unapproved student: no nav items and no account link', async ({ browser }) => {
	const page = await newPage(browser, 375);
	try {
		await signIn(page, pendingStudent);
		await expect(page).toHaveURL(/\/student\/pending$/);
		await expect(mainNav(page)).toHaveCount(0);
		await expect(page.getByTestId('bottom-nav')).toHaveCount(0);
		await expect(page.getByTestId('side-nav')).toHaveCount(0);
		const menu = await openAccountMenu(page);
		await expect(menu.getByRole('menuitem', { name: 'My Account' })).toHaveCount(0);
		await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
		// Help stays reachable while they wait.
		await menu.getByRole('menuitem', { name: 'Help' }).click();
		await expect(helpSheet(page)).toBeVisible();
		await expect(helpSheet(page).getByRole('tab', { name: 'For students' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
	} finally {
		await page.context().close();
	}
});

test('account: My Account in the avatar menu opens /account', async ({ browser }) => {
	const page = await newPage(browser, 375);
	try {
		await signIn(page, teacher);
		const menu = await openAccountMenu(page);
		await menu.getByRole('menuitem', { name: 'My Account' }).click();
		await expect(page).toHaveURL(/\/account$/);
		await expect(menu).toBeHidden();
	} finally {
		await page.context().close();
	}
});

test('content gutter: 16px on a phone, 32px on a tablet (the shell gives it, no -mx on the page)', async ({
	browser
}) => {
	for (const [width, gutter] of [
		[375, 16],
		[820, 32]
	] as const) {
		const page = await newPage(browser, width);
		try {
			await signIn(page, teacher);
			await expect(page).toHaveURL(/\/teacher$/);
			const root = page.locator('main > [data-ui="new"]').first();
			await expect(root).toBeVisible();
			const box = (await root.boundingBox())!;
			// The layout width, not the viewport: a classic scrollbar takes room.
			const layout = await page.evaluate(() => document.documentElement.clientWidth);
			expect(box.x, `left gutter at ${width}px`).toBeCloseTo(gutter, 0);
			expect(layout - (box.x + box.width), `right gutter at ${width}px`).toBeCloseTo(gutter, 0);
		} finally {
			await page.context().close();
		}
	}
});

test('teacher with no classes (#108): the Classes page shows the empty state', async ({
	browser
}) => {
	const page = await newPage(browser, 375);
	try {
		// teacherParent teaches no class.
		await signIn(page, teacherParent);
		await expect(page).toHaveURL(/\/teacher$/);
		await mainNav(page).getByRole('link', { name: 'Classes' }).click();
		await expect(page).toHaveURL(/\/teacher\/classes$/);
		await expect(page.getByText("You haven't been assigned to any classes yet.")).toBeVisible();
		await expect(page.getByTestId('class-cards')).toHaveCount(0);
	} finally {
		await page.context().close();
	}
});

test('multi-role login: the avatar menu lists both roles; picking one posts /role', async ({
	browser
}) => {
	const page = await newPage(browser, 375);
	try {
		await signIn(page, teacherParent);
		await expect(page).toHaveURL(/\/teacher$/);
		const menu = await openAccountMenu(page);
		await expect(menu.getByText('Switch role')).toBeVisible();
		await expect(menu.getByRole('menuitemradio')).toHaveText(['Teacher', 'Parent']);
		await expect(menu.getByRole('menuitemradio', { name: 'Teacher' })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		const posted = page.waitForRequest(
			(request) => request.method() === 'POST' && new URL(request.url()).pathname === '/role'
		);
		await menu.getByRole('menuitemradio', { name: 'Parent' }).click();
		expect((await posted).postData()).toContain('role=parent');
		await expect(page).toHaveURL(/\/parent$/);
		expect(await navNames(page)).toEqual(['Dashboard', 'Homework', 'Calendar', 'Board', 'Help']);
	} finally {
		await page.context().close();
	}
});

test.describe('help', () => {
	async function expectHelpSheet(page: Page, firstTab: string) {
		const help = helpSheet(page);
		await expect(help).toBeVisible();
		await expect(help.getByRole('tab')).toHaveText([
			firstTab,
			...['For parents', 'For teachers', 'For students'].filter((t) => t !== firstTab),
			'Common questions'
		]);
		await expect(help.getByRole('tab', { name: firstTab })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await help.getByRole('tab', { name: 'Common questions' }).click();
		await expect(help.getByText('I did not get the confirmation email.')).toBeVisible();
		await help.getByRole('button', { name: 'Close help' }).click();
		await expect(help).toBeHidden();
	}

	test('teacher (375px): Help through More; replaying the tour closes it first', async ({
		browser
	}) => {
		const page = await newPage(browser, 375);
		try {
			await signIn(page, teacher);
			// #108: Help is in the More sheet, which closes as Help opens.
			await expect(mainNav(page).getByRole('button', { name: 'Help' })).toHaveCount(0);
			await mainNav(page).getByRole('button', { name: 'More' }).click();
			const more = page.getByRole('dialog', { name: 'More pages' });
			await more.getByRole('button', { name: 'Help' }).click();
			await expect(more).toBeHidden();
			await expectHelpSheet(page, 'For teachers');
			// Full screen on a phone.
			const help = await openHelp(page);
			const box = await help.boundingBox();
			expect(box).toMatchObject({ x: 0, y: 0, width: 375 });
			await help.getByRole('button', { name: 'Show me around this page' }).click();
			await expect(help).toBeHidden();
		} finally {
			await page.context().close();
		}
	});

	test('parent (820px): the Help tab, a dialog on a tablet', async ({ browser }) => {
		const page = await newPage(browser, 820);
		try {
			await signIn(page, parent);
			const help = await openHelp(page);
			const box = await help.boundingBox();
			expect(box!.x).toBeGreaterThan(0);
			expect(box!.width).toBeLessThan(820);
			await expectHelpSheet(page, 'For parents');
		} finally {
			await page.context().close();
		}
	});

	test('student (375px): Help is in the avatar menu, not the bar', async ({ browser }) => {
		const page = await newPage(browser, 375);
		try {
			await signIn(page, student);
			await expect(mainNav(page).getByRole('button', { name: 'Help' })).toHaveCount(0);
			const menu = await openAccountMenu(page);
			await menu.getByRole('menuitem', { name: 'Help' }).click();
			await expectHelpSheet(page, 'For students');
		} finally {
			await page.context().close();
		}
	});

	test('admin: the side nav at 1440px, the More sheet at 375px', async ({ browser }) => {
		const page = await newPage(browser, 1440);
		try {
			await signIn(page, admin);
			await openHelp(page);
			await expectHelpSheet(page, 'For parents');

			await page.setViewportSize({ width: 375, height: 800 });
			await mainNav(page).getByRole('button', { name: 'More' }).click();
			await page
				.getByRole('dialog', { name: 'More pages' })
				.getByRole('button', { name: 'Help' })
				.click();
			await expect(page.getByRole('dialog', { name: 'More pages' })).toBeHidden();
			await expectHelpSheet(page, 'For parents');
		} finally {
			await page.context().close();
		}
	});
});

test('sign out: releasePush() runs before the sign-out POST', async ({ browser }) => {
	const page = await newPage(browser, 375);
	try {
		// A browser holding a push subscription (no real push service here).
		await page.addInitScript(() => {
			const subscription = { endpoint: 'https://push.example.test/e2e-shell' };
			const registration = {
				pushManager: { getSubscription: async () => subscription }
			};
			Object.defineProperty(navigator.serviceWorker, 'getRegistration', {
				value: async () => registration
			});
		});
		const order: string[] = [];
		await page.route('**/api/push/subscription', async (route) => {
			order.push(`${route.request().method()} push`);
			await route.fulfill({ status: 204 });
		});
		page.on('request', (request) => {
			if (request.method() === 'POST' && new URL(request.url()).pathname === '/logout') {
				order.push('POST logout');
			}
		});

		await signIn(page, parent);
		const menu = await openAccountMenu(page);
		await menu.getByRole('menuitem', { name: 'Sign out' }).click();
		await expect(page).toHaveURL(/\/(login)?$/);
		expect(order).toEqual(['DELETE push', 'POST logout']);
	} finally {
		await page.context().close();
	}
});

test('every role at 375px: the end of the page scrolls fully into view above the bar', async ({
	browser
}) => {
	for (const user of [() => teacher, () => admin, () => parent, () => student]) {
		const page = await newPage(browser, 375);
		try {
			await signIn(page, user());
			await page.waitForLoadState('networkidle');
			// Scrolled to the end on every try: sections may still grow after
			// the network is quiet.
			await expect
				.poll(() =>
					page.evaluate(() => {
						window.scrollTo(0, document.documentElement.scrollHeight);
						const main = document.querySelector('main')!;
						const all = [...main.querySelectorAll('*')].filter(
							(el) => el.getClientRects().length > 0
						);
						const last = all[all.length - 1];
						const bar = document.querySelector('[data-testid="bottom-nav"]')!;
						return last.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
					})
				)
				.toBeLessThanOrEqual(0);
		} finally {
			await page.context().close();
		}
	}
});
