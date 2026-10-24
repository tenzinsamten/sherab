import { expect, test, type Browser, type Page, type Route } from '@playwright/test';
import { mainNav, service, signIn, type TestUser } from './fixtures';

/**
 * Mobile-first story 11: the shell's loading bar and the busy <main>, one
 * test per row of the story's I/O matrix that a browser can show. A slow
 * server load is made by holding the page's `__data.json` request; a slow
 * action by holding its POST. All at 375px (bottom nav).
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
let teacher: TestUser;

test.beforeAll(async () => {
	const email = `e2e-navprogress-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role: 'teacher' },
		user_metadata: { display_name: `Progress ${tag}` }
	});
	if (error || !data.user) throw new Error(`create user: ${error?.message}`);
	teacher = { id: data.user.id, email, password };
});

test.afterAll(async () => {
	if (teacher) await service.auth.admin.deleteUser(teacher.id);
});

const bar = (page: Page) => page.getByTestId('nav-progress');
const main = (page: Page) => page.locator('main');

async function phone(browser: Browser) {
	const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
	const page = await context.newPage();
	await signIn(page, teacher);
	await expect(page).toHaveURL(/\/teacher$/);
	await page.locator('main > [data-ui="new"]').first().waitFor();
	await page.waitForLoadState('networkidle');
	return page;
}

async function openAccount(page: Page) {
	await page.goto('/account');
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

/** Holds every matching request for `ms` before letting it through. */
async function slow(page: Page, url: string | RegExp, ms: number) {
	await page.route(url, async (route: Route) => {
		await new Promise((r) => setTimeout(r, ms));
		await route.continue().catch(() => undefined);
	});
}

async function expectIdle(page: Page) {
	await expect(bar(page)).toBeHidden();
	await expect(main(page)).not.toHaveAttribute('inert');
	await expect(main(page)).not.toHaveAttribute('aria-busy');
	await expect(main(page)).not.toHaveClass(/\bopacity-60\b/);
}

test('slow navigation: bar, faded and inert <main>, a tap in <main> does nothing; all gone on arrival', async ({
	browser
}) => {
	const page = await phone(browser);
	try {
		// My account's "Save name" button, ready to post, is in <main>.
		await openAccount(page);
		await page.locator('#displayName').fill(`Progress blocked ${tag}`);
		const save = (await page
			.locator('form[action="?/updateName"] button[type="submit"]')
			.boundingBox())!;
		const posts: string[] = [];
		page.on('request', (r) => {
			if (r.method() === 'POST') posts.push(r.url());
		});
		await slow(page, /\/calendar\/__data\.json/, 2500);
		await mainNav(page).getByRole('link', { name: 'Calendar' }).click();

		// Blocked from the first moment, before the 150 ms bar.
		await expect(main(page)).toHaveAttribute('inert', '');
		await expect(bar(page)).toBeHidden();

		await expect(bar(page)).toBeVisible();
		await expect(main(page)).toHaveAttribute('inert', '');
		await expect(main(page)).toHaveAttribute('aria-busy', 'true');
		await expect(main(page)).toHaveClass(/\bopacity-60\b/);
		await expect(main(page)).toHaveCSS('opacity', '0.6');
		await expect(page.locator('[aria-live="polite"]', { hasText: 'Loading…' })).toHaveCount(1);

		// <main> is inert: a tap on the button posts nothing.
		await page.mouse.click(save.x + save.width / 2, save.y + save.height / 2);
		await page.waitForTimeout(300);
		expect(posts).toEqual([]);
		await expect(page).toHaveURL(/\/account$/);

		await expect(page).toHaveURL(/\/calendar$/, { timeout: 10_000 });
		await expectIdle(page);
	} finally {
		await page.context().close();
	}
});

test('cancel: another bottom-nav tab still navigates during a slow navigation', async ({
	browser
}) => {
	const page = await phone(browser);
	try {
		await slow(page, /\/calendar\/__data\.json/, 5000);
		await mainNav(page).getByRole('link', { name: 'Calendar' }).click();
		await expect(bar(page)).toBeVisible();

		await mainNav(page).getByRole('link', { name: 'Classes' }).click();
		await expect(page).toHaveURL(/\/teacher\/classes$/);
		await expectIdle(page);
		// The abandoned calendar load never lands.
		await page.waitForTimeout(5500);
		await expect(page).toHaveURL(/\/teacher\/classes$/);
		await expectIdle(page);
	} finally {
		await page.context().close();
	}
});

test('slow page action: the bar shows, <main> is neither inert nor faded', async ({ browser }) => {
	const page = await phone(browser);
	try {
		await openAccount(page);
		await page.route(/\/account\?\/updateName/, async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			await new Promise((r) => setTimeout(r, 2000));
			await route.continue().catch(() => undefined);
		});

		await page.locator('#displayName').fill(`Progress renamed ${tag}`);
		const save = page.locator('form[action="?/updateName"] button[type="submit"]');
		await save.click();

		await expect(bar(page)).toBeVisible();
		await expect(main(page)).toHaveAttribute('aria-busy', 'true');
		await expect(main(page)).not.toHaveAttribute('inert');
		await expect(main(page)).not.toHaveClass(/\bopacity-60\b/);
		await expect(main(page)).toHaveCSS('opacity', '1');

		await expect(page.locator('[data-sonner-toast]')).toHaveText('Name updated.');
		await expectIdle(page);
		// #109: the disabled Save dropped focus while it ran; it is back on Save.
		await expect(save).toBeFocused();
	} finally {
		await page.context().close();
	}
});

const errorToast = (page: Page) => page.locator('[data-sonner-toast][data-type="error"]');
/** updateName's fail(400) for a blank name (messages/en.json account_name_error_required). */
const blankNameError = 'Enter a name of 1 to 80 characters.';

/** #109: My account with its Save name POST held for 1.5 s. */
async function slowSaveName(page: Page) {
	await openAccount(page);
	await page.route(/\/account\?\/updateName/, async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue().catch(() => undefined);
	});
	return page.locator('form[action="?/updateName"] button[type="submit"]');
}

test('#109: a failed page action also returns focus to the pressed button', async ({ browser }) => {
	const page = await phone(browser);
	try {
		const save = await slowSaveName(page);
		// Passes `required`, but the action trims it and answers fail(400).
		await page.locator('#displayName').fill('   ');
		await save.focus();
		await page.keyboard.press('Enter');
		await expect(save).toBeDisabled();
		await expect(errorToast(page)).toHaveText(blankNameError);
		await expect(page.getByTestId('field-error')).toBeVisible();
		await expectIdle(page);
		await expect(save).toBeFocused();
	} finally {
		await page.context().close();
	}
});

test('#109: Enter in a text field keeps focus in the field, on success and on fail()', async ({
	browser
}) => {
	const page = await phone(browser);
	try {
		const save = await slowSaveName(page);
		const name = page.locator('#displayName');

		await name.fill(`Progress entered ${tag}`);
		await name.press('Enter');
		await expect(save).toBeDisabled();
		await expect(page.locator('[data-sonner-toast]')).toHaveText('Name updated.');
		await expectIdle(page);
		await expect(save).toBeEnabled();
		await expect(name).toBeFocused();

		// Passes `required`, but the action trims it and answers fail(400).
		await name.fill('   ');
		await name.press('Enter');
		await expect(save).toBeDisabled();
		await expect(errorToast(page)).toHaveText(blankNameError);
		await expect(page.getByTestId('field-error')).toBeVisible();
		await expectIdle(page);
		await expect(save).toBeEnabled();
		await expect(name).toBeFocused();
	} finally {
		await page.context().close();
	}
});

test('#109: focus moved to a field during a slow save stays there', async ({ browser }) => {
	const page = await phone(browser);
	try {
		const save = await slowSaveName(page);
		const name = page.locator('#displayName');
		await name.fill(`Progress moved ${tag}`);
		await save.click();
		await expect(save).toBeDisabled();
		await name.focus();
		await expect(page.locator('[data-sonner-toast]')).toHaveText('Name updated.');
		await expectIdle(page);
		await expect(save).toBeEnabled();
		await expect(name).toBeFocused();
	} finally {
		await page.context().close();
	}
});

test('load error: the error page shows and the busy state clears', async ({ browser }) => {
	const page = await phone(browser);
	try {
		// Only the navigation's own load fails; SvelteKit's refetch for the
		// root error page goes through, so the error page renders in-app.
		let failed = false;
		await page.route(/\/calendar\/__data\.json/, async (route) => {
			if (failed) return route.continue();
			failed = true;
			await new Promise((r) => setTimeout(r, 1000));
			await route.fulfill({ status: 500, body: 'boom' });
		});
		// Survives only if no full document reload happens.
		await page.evaluate(() => ((window as unknown as { noReload: boolean }).noReload = true));
		await mainNav(page).getByRole('link', { name: 'Calendar' }).click();
		await expect(bar(page)).toBeVisible();
		await expect(main(page)).toHaveAttribute('inert', '');

		await expect(page).toHaveURL(/\/calendar$/, { timeout: 10_000 });
		// #115: the translated error page, with the status below its heading.
		await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
		await expect(page.getByText('Error 500')).toBeVisible();
		expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(
			true
		);
		await expectIdle(page);
	} finally {
		await page.context().close();
	}
});

test('reduced motion: a static bar with the same timing, no fade transition', async ({
	browser
}) => {
	const context = await browser.newContext({
		viewport: { width: 375, height: 812 },
		reducedMotion: 'reduce'
	});
	const page = await context.newPage();
	try {
		await signIn(page, teacher);
		await expect(page).toHaveURL(/\/teacher$/);
		await page.locator('main > [data-ui="new"]').first().waitFor();
		await page.waitForLoadState('networkidle');

		await slow(page, /\/calendar\/__data\.json/, 2500);
		await mainNav(page).getByRole('link', { name: 'Calendar' }).click();
		await expect(bar(page)).toBeVisible();
		const fill = page.getByTestId('nav-progress-fill');
		await expect(fill).toHaveCSS('animation-name', 'none');
		const widths = await fill.evaluate((el) => [
			el.getBoundingClientRect().width,
			(el.parentElement as HTMLElement).getBoundingClientRect().width
		]);
		expect(widths[0]).toBe(widths[1]);
		await expect(main(page)).toHaveCSS('opacity', '0.6');
		await expect(main(page)).toHaveCSS('transition-property', 'none');

		await expect(page).toHaveURL(/\/calendar$/, { timeout: 10_000 });
		await expectIdle(page);
	} finally {
		await context.close();
	}
});

test('fast navigation: the bar never shows', async ({ browser }) => {
	const page = await phone(browser);
	try {
		// Warm the dev server and keep the classes page's data, so the timed
		// navigation's load is answered at once. (#108: the Classes tab, since
		// Leaderboard moved into More.)
		let cached: { body: Buffer; headers: Record<string, string> } | undefined;
		await page.route(/\/teacher\/classes\/__data\.json/, async (route) => {
			if (cached) return route.fulfill({ body: cached.body, headers: cached.headers });
			const response = await route.fetch();
			cached = { body: await response.body(), headers: response.headers() };
			await route.fulfill({ response, body: cached.body });
		});
		await mainNav(page).getByRole('link', { name: 'Classes' }).click();
		await expect(page).toHaveURL(/\/teacher\/classes$/);
		await mainNav(page).getByRole('link', { name: 'Dashboard' }).click();
		await expect(page).toHaveURL(/\/teacher$/);
		await page.waitForLoadState('networkidle');

		await page.evaluate(() => {
			const w = window as unknown as { barSeen: boolean };
			w.barSeen = false;
			new MutationObserver(() => {
				if (document.querySelector('[data-testid="nav-progress"]')) w.barSeen = true;
			}).observe(document.body, { childList: true, subtree: true });
		});
		await mainNav(page).getByRole('link', { name: 'Classes' }).click();
		await expect(page).toHaveURL(/\/teacher\/classes$/);
		await page.waitForTimeout(400);
		expect(await page.evaluate(() => (window as unknown as { barSeen: boolean }).barSeen)).toBe(
			false
		);
		await expectIdle(page);
	} finally {
		await page.context().close();
	}
});
