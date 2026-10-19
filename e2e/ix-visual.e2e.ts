import { expect, test, type Page } from '@playwright/test';
import { service, signIn, type TestUser } from './fixtures';

/**
 * Mobile-first redesign, story 1: screenshot baselines of the iX pages,
 * taken on the code before Tailwind and shadcn-svelte were added. Every
 * later foundation change must leave these pixel-identical (the new CSS
 * must not leak into iX pages).
 *
 * Story 2 (new app shell): each image is the page content only -- the
 * `.page` element (`.auth-page` signed out) -- not the viewport, so the
 * shell around it (header, navigation) is not part of the proof and can be
 * replaced. Text that depends on the database or the run (counters, lists)
 * is masked. Baselines are platform-specific (darwin).
 */

test.describe.configure({ mode: 'serial' });
test.skip(
	process.platform !== 'darwin',
	'Baselines exist for darwin only; another platform would write unverified ones.'
);

const tag = crypto.randomUUID().slice(0, 8);
const userIds: string[] = [];

let teacher: TestUser;
let parent: TestUser;
let admin: TestUser;

async function createUser(role: 'teacher' | 'parent' | 'admin'): Promise<TestUser> {
	const email = `e2e-ixvis-${role}-${tag}@example.test`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role },
		user_metadata: { display_name: `Visual ${role}` }
	});
	if (error || !data.user) throw new Error(`create ${role}: ${error?.message}`);
	userIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

test.beforeAll(async () => {
	teacher = await createUser('teacher');
	parent = await createUser('parent');
	admin = await createUser('admin');
	const { error } = await service
		.from('parents')
		.update({ status: 'approved' })
		.eq('id', parent.id);
	if (error) throw new Error(`approve parent: ${error.message}`);
});

test.afterAll(async () => {
	const problems: string[] = [];
	for (const id of userIds) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
	}
	if (problems.length) throw new Error(problems.join('; '));
});

const VIEWPORTS = [
	{ name: 'phone', width: 375, height: 812 },
	{ name: 'desktop', width: 1440, height: 900 }
] as const;

/** Wait until iX has upgraded, the network is quiet and fonts are drawn. */
async function settle(page: Page) {
	await page.waitForFunction(() => customElements.get('ix-button') !== undefined);
	await page.waitForLoadState('networkidle');
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	// iX lays out its header and menu after upgrade (resize observers).
	await page.waitForTimeout(500);
}

/**
 * Puts what other test files leave behind in the shared database into a fixed
 * state, so the image does not depend on which tests ran before: masking
 * alone is not enough, since a mask takes the size of what it covers.
 */
async function normalize(page: Page) {
	await page.evaluate(() => {
		// The new shell (story 2) is not part of the proof. A page taller than
		// the viewport is shot while scrolled, and its sticky header and bottom
		// bar would lie over the content: hidden, keeping their space.
		for (const chrome of document.querySelectorAll<HTMLElement>('[data-ui="new"]')) {
			chrome.style.visibility = 'hidden';
		}
		// The admin class counter: one digit.
		for (const counter of document.querySelectorAll('.page-counter')) counter.textContent = '0';
		// The admin list of all classes: empty, at a fixed height (it stays masked).
		const list =
			location.pathname === '/admin/classes'
				? document.querySelector<HTMLElement>('.page > section.card:last-of-type')
				: null;
		if (list) {
			list.replaceChildren();
			list.style.height = '8rem';
		}
	});
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
	await normalize(page);
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
			await shoot(page, `login-${viewport.name}`, [], '.auth-page');
		});

		test(`teacher dashboard (${viewport.name})`, async ({ page }) => {
			await signIn(page, teacher);
			await page.goto('/teacher');
			await shoot(page, `teacher-dashboard-${viewport.name}`);
		});

		test(`parent dashboard (${viewport.name})`, async ({ page }) => {
			await signIn(page, parent);
			await page.goto('/parent');
			await shoot(page, `parent-dashboard-${viewport.name}`);
		});

		test(`admin classes (${viewport.name})`, async ({ page }) => {
			await signIn(page, admin);
			await page.goto('/admin/classes');
			// The class count and the list of all classes depend on what else is
			// in the database, the schedule's start date on today's date; the
			// rest of the create form and the page frame do not.
			await shoot(page, `admin-classes-${viewport.name}`, [
				'.page-counter',
				'ix-date-input',
				'.page > section.card:last-of-type'
			]);
		});
	});
}
