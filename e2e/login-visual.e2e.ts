import { expect, test, type Page } from '@playwright/test';

/**
 * Screenshot baselines of the sign-in card (`[data-auth-card]`) at phone and
 * desktop width. Baselines are platform-specific (darwin).
 *
 * History: this was ix-visual.e2e.ts, the pixel proof (mobile-first story 1)
 * that the new CSS did not leak into the iX pages while they coexisted. Each
 * migrated page lost its shots to its own checks; the login card (story 6)
 * was re-baselined on the new UI and is all that is left. Story 10 removed
 * iX and renamed the file.
 */

test.describe.configure({ mode: 'serial' });
test.skip(
	process.platform !== 'darwin',
	'Baselines exist for darwin only; another platform would write unverified ones.'
);

const VIEWPORTS = [
	{ name: 'phone', width: 375, height: 812 },
	{ name: 'desktop', width: 1440, height: 900 }
] as const;

/** Wait until the page root is hydrated, the network is quiet and fonts are drawn. */
async function settle(page: Page) {
	await page.waitForSelector('main > [data-ui="new"][data-hydrated]');
	await page.waitForLoadState('networkidle');
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	// Layout settles after hydration (resize observers).
	await page.waitForTimeout(500);
}

/** Hides the new shell around the shot content (it is not part of the proof). */
async function normalize(page: Page, content: string) {
	await page.evaluate((content) => {
		// The new shell (story 2) is not part of the proof. A page taller than
		// the viewport is shot while scrolled, and its sticky header and bottom
		// bar would lie over the content: hidden, keeping their space. A shot
		// of a new-UI page (the login card, story 6) keeps that page.
		const newPage = document.querySelector(content)?.matches('[data-ui="new"]') ?? false;
		for (const chrome of document.querySelectorAll<HTMLElement>('[data-ui="new"]')) {
			if (newPage && chrome.closest(content)) continue;
			chrome.style.visibility = 'hidden';
		}
	}, content);
}

/**
 * Makes the viewport tall enough for the whole content element, so it is
 * shot without scrolling: iX scrolled the page inside its own content area
 * (which left everything below the first screen blank in the image), the new
 * shell scrolls the document. The width, which the layout depends on, stays.
 */
async function fitHeight(page: Page, content: string) {
	const box = await page.locator(content).boundingBox();
	const size = page.viewportSize();
	if (!box || !size) throw new Error(`no ${content} to shoot`);
	const height = Math.ceil(box.y + box.height + 200);
	if (height > size.height) await page.setViewportSize({ width: size.width, height });
}

async function shoot(page: Page, name: string, mask: string[] = [], content = '.page') {
	await settle(page);
	await normalize(page, content);
	await fitHeight(page, content);
	await settle(page);
	await expect(page.locator(content)).toHaveScreenshot(`${name}.png`, {
		animations: 'disabled',
		caret: 'hide',
		mask: mask.map((selector) => page.locator(selector)),
		maxDiffPixelRatio: 0.001
	});
}

for (const viewport of VIEWPORTS) {
	test.describe(`at ${viewport.width}px`, () => {
		test.use({ viewport: { width: viewport.width, height: viewport.height } });

		test(`login (${viewport.name})`, async ({ page }) => {
			await page.goto('/login');
			await shoot(page, `login-${viewport.name}`, [], '[data-auth-card]');
		});
	});
}
