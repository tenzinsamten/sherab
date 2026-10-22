import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Mobile-first redesign, story 1: the new component system (Tailwind +
 * shadcn-svelte) on the dev-only /dev/ui preview. Inside `data-ui="new"` the
 * Sherab theme applies and neither src/app.css nor the browser defaults
 * style plain elements; Tibetan text uses Atisha.
 */

const PRIMARY = 'rgb(37, 99, 235)';
/** The theme's --foreground: what a plain link inherits inside the root. */
const FOREGROUND = 'rgba(0, 10, 20, 0.9)';

async function openPreview(page: Page) {
	await page.goto('/dev/ui');
	await page.waitForLoadState('networkidle');
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

function style(locator: Locator, property: string) {
	return locator.evaluate(
		(element, name) => getComputedStyle(element).getPropertyValue(name),
		property
	);
}

/** The fonts Chrome actually drew the element's text with. */
async function renderedFonts(page: Page, locator: Locator): Promise<string[]> {
	const testId = await locator.getAttribute('data-testid');
	const scope = await locator.evaluate((element) =>
		element.closest('[data-testid^="preview-"]')?.getAttribute('data-testid')
	);
	if (!testId || !scope) {
		throw new Error(
			`renderedFonts needs a data-testid inside a preview section (got ${testId}, ${scope})`
		);
	}
	const session = await page.context().newCDPSession(page);
	try {
		await session.send('DOM.enable');
		await session.send('CSS.enable');
		const { root } = await session.send('DOM.getDocument', { depth: -1 });
		const { nodeId } = await session.send('DOM.querySelector', {
			nodeId: root.nodeId,
			selector: `[data-testid="${scope}"] [data-testid="${testId}"]`
		});
		const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
		return fonts.map((font) => font.familyName);
	} finally {
		await session.detach();
	}
}

test.describe('/dev/ui', () => {
	test.beforeEach(async ({ page }) => {
		await openPreview(page);
	});

	test('the button carries the Sherab theme', async ({ page }) => {
		const button = page.getByTestId('preview-en').getByTestId('button-default');
		await expect(button).toBeVisible();
		expect(await style(button, 'background-color')).toBe(PRIMARY);
		expect(await style(button, 'color')).toBe('rgb(255, 255, 255)');
		expect(await style(button, 'border-top-left-radius')).toBe('4px');
		// The Lucide icon renders as an SVG inside it.
		await expect(button.getByTestId('lucide-icon')).toBeVisible();
		expect(await button.getByTestId('lucide-icon').evaluate((el) => el.tagName)).toBe('svg');
	});

	test('the card carries the Sherab theme', async ({ page }) => {
		const card = page.getByTestId('preview-en').getByTestId('card');
		expect(await style(card, 'background-color')).toBe('rgb(255, 255, 255)');
		expect(await style(card, 'border-top-left-radius')).toBe('4px');
	});

	test('a button outside the root is still styled by utilities', async ({ page }) => {
		const button = page.getByTestId('button-outside');
		expect(await style(button, 'background-color')).toBe(PRIMARY);
		expect(await style(button, 'border-top-left-radius')).toBe('4px');
	});

	test('plain heading, link and table get no app.css or browser-default styles', async ({
		page
	}) => {
		const root = page.getByTestId('preview-en');
		const rootFontSize = await style(root, 'font-size');
		expect(rootFontSize).toBe('16px');

		// Browsers size and bold headings by level; the reset inherits them.
		const heading = root.getByTestId('plain-heading');
		expect(await style(heading, 'font-size')).toBe(rootFontSize);
		expect(await style(heading, 'font-weight')).toBe('400');
		expect(await style(heading, 'margin-bottom')).toBe('0px');
		expect(await style(heading, 'font-family')).toBe(await style(root, 'font-family'));
		expect(await style(heading, 'letter-spacing')).toBe('normal');

		// Browsers colour and underline links; the reset inherits the colour.
		const link = root.getByTestId('plain-link');
		expect(await style(link, 'color')).toBe(FOREGROUND);
		expect(await style(link, 'text-decoration-line')).toBe('none');
		await link.hover();
		expect(await style(link, 'color')).toBe(FOREGROUND);

		// app.css: full width, collapsed, cell padding and bottom borders.
		const table = root.getByTestId('plain-table');
		expect(await style(table, 'width')).not.toBe(await style(table.locator('..'), 'width'));
		const cell = table.locator('td').first();
		expect(await style(cell, 'padding-left')).toBe('0px');
		expect(await style(cell, 'border-bottom-width')).toBe('0px');
	});

	test('Tibetan text uses Atisha and the label is not clipped', async ({ page }) => {
		const root = page.getByTestId('preview-bo');
		expect(await style(root, 'font-family')).toMatch(/^Atisha,/);
		expect(await renderedFonts(page, root.getByTestId('plain-heading'))).toContain('Atisha');

		const button = root.getByTestId('button-default');
		expect(await renderedFonts(page, button)).toContain('Atisha');
		const fits = await button.evaluate(
			(element) =>
				element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth
		);
		expect(fits).toBe(true);

		// Nested languages: Tibetan inside the English root, English inside the
		// Tibetan root.
		const boInEn = page.getByTestId('preview-en').getByTestId('nested-lang');
		expect(await style(boInEn, 'font-family')).toMatch(/^Atisha,/);
		expect(await style(boInEn, 'line-height')).toBe(
			`${2 * parseFloat(await style(boInEn, 'font-size'))}px`
		);
		const enInBo = root.getByTestId('nested-lang');
		expect(await style(enInBo, 'font-family')).toMatch(/^system-ui,/);
		expect(await style(enInBo, 'line-height')).toBe(
			`${1.5 * parseFloat(await style(enInBo, 'font-size'))}px`
		);

		// English inside the page stays on the system stack.
		const en = page.getByTestId('preview-en');
		expect(await style(en, 'font-family')).not.toContain('Atisha');
	});
});
