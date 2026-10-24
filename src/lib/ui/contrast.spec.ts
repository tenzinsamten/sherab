import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * #119: the destructive button's text on its red tint stays at WCAG AA
 * (4.5:1 for its 14px text), at rest (`bg-destructive/10`) and on hover
 * (`bg-destructive/20`), both over the white page. Read from the tokens, so a
 * changed red is checked too. (The plain red on its own tint is 4.30:1,
 * why the strong one exists.)
 */
const css = readFileSync(new URL('./tailwind.css', import.meta.url), 'utf8');
const button = readFileSync(
	new URL('../components/ui/button/button.svelte', import.meta.url),
	'utf8'
);

function token(name: string): string {
	const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`))?.[1];
	if (!value) throw new Error(`--${name} not found as a #rrggbb value`);
	return value;
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** `color` at `alpha` over white, as Tailwind's `bg-x/10` paints it on the page. */
const overWhite = (hex: string, alpha: number) =>
	rgb(hex).map((c) => Math.round(c * alpha + 255 * (1 - alpha)));
function luminance([r, g, b]: number[]) {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: number[], b: number[]) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

describe('destructive button contrast (#119)', () => {
	const destructive = token('destructive');
	const strong = token('destructive-strong');

	it('uses the strong red for its text', () => {
		const variant = button.match(/destructive:\s*'([^']*)'/)?.[1] ?? '';
		expect(variant).toContain('text-destructive-strong');
		// Not the plain red, in any state (hover:, focus-visible:, …).
		expect(variant.split(/\s+/).filter((c) => /(^|:)text-destructive$/.test(c))).toEqual([]);
	});

	it('reaches 4.5:1 on its tint and on the hover tint', () => {
		expect(contrast(rgb(strong), overWhite(destructive, 0.1))).toBeGreaterThanOrEqual(4.5);
		expect(contrast(rgb(strong), overWhite(destructive, 0.2))).toBeGreaterThanOrEqual(4.5);
	});
});

/** #122: field borders (`--input`, rgba over white) and visible focus outlines. */
describe('field borders and focus (#122)', () => {
	it('field borders reach 3:1 on white and on the muted shell', () => {
		const m = css.match(/--input:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\);/);
		if (!m) throw new Error('--input not found as rgba()');
		const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
		// On the white page and on the muted public shell (--muted #eff0f1).
		for (const page of [[255, 255, 255], rgb(token('muted'))]) {
			const border = [r, g, b].map((c, i) => Math.round(c * a + page[i] * (1 - a)));
			expect(contrast(border, page)).toBeGreaterThanOrEqual(3);
		}
	});

	it('controls focus with a solid outline, not the faint ring', () => {
		for (const path of [
			'../components/ui/button/button.svelte',
			'../components/ui/input/input.svelte',
			'../components/ui/native-select/native-select.svelte',
			'../components/ui/badge/badge.svelte',
			'../components/RichTextEditor.svelte'
		]) {
			const source = readFileSync(new URL(path, import.meta.url), 'utf8');
			expect(source, path).not.toMatch(/focus-(visible|within):ring-(3|\[3px\]|ring\/50)/);
			expect(source, path).toMatch(/focus-(visible|within):outline-solid/);
		}
	});
});

/**
 * #129: primary text on light-blue surfaces and white on the primary hover
 * reach 4.5:1 with the strong blue (the plain blue is below it on its tints).
 */
describe('primary-strong contrast (#129)', () => {
	const primary = token('primary');
	const strong = token('primary-strong');
	const white = [255, 255, 255];
	const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

	it('reaches 4.5:1 on the accent, on primary/10 and as the white hover background', () => {
		const m = css.match(/--accent:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\);/);
		if (!m) throw new Error('--accent not found as rgba()');
		const accent = [m[1], m[2], m[3]].map((c) =>
			Math.round(Number(c) * Number(m[4]) + 255 * (1 - Number(m[4])))
		);
		// More sheet's current item, the Help sheet's active tab and a pressed editor button (text on bg-accent).
		expect(contrast(rgb(strong), accent)).toBeGreaterThanOrEqual(4.5);
		// The info badge (text on bg-primary/10).
		expect(contrast(rgb(strong), overWhite(primary, 0.1))).toBeGreaterThanOrEqual(4.5);
		// The default button's hover and the default badge link's hover (white text on bg-primary-strong).
		expect(contrast(white, rgb(strong))).toBeGreaterThanOrEqual(4.5);
	});

	it('those places use the strong blue', () => {
		const sheetItem = read('../components/shell/BottomNav.svelte').match(
			/sheetItemClass =\s*'([^']*)'/
		)?.[1];
		expect(sheetItem).toContain('aria-[current=page]:text-primary-strong');
		expect(sheetItem).not.toMatch(/aria-\[current=page\]:text-primary(\s|$)/);

		const tool = read('../components/RichTextEditor.svelte').match(/const tool =\s*'([^']*)'/)?.[1];
		expect(tool).toContain('aria-pressed:text-primary-strong');
		expect(tool).not.toMatch(/aria-pressed:text-primary(\s|$)/);

		const helpTab = read('../components/shell/HelpSheet.svelte').match(
			/tabClass =\s*'([^']*)'/
		)?.[1];
		expect(helpTab).toContain('data-[state=active]:text-primary-strong');
		expect(helpTab).not.toMatch(/data-\[state=active\]:text-primary(\s|$)/);

		const badge = read('../components/ui/badge/badge.svelte');
		const info = badge.match(/info:\s*'([^']*)'/)?.[1];
		expect(info).toContain('text-primary-strong');
		expect(info).not.toMatch(/text-primary(\s|$)/);
		// The default badge as a link: white text on its hover.
		const badgeDefault = badge.match(/default:\s*'([^']*)'/)?.[1] ?? '';
		expect(badgeDefault).toContain('[a]:hover:bg-primary-strong');
		expect(badgeDefault).not.toContain('hover:bg-primary/');

		const variant = button.match(/default:\s*'([^']*)'/)?.[1] ?? '';
		expect(variant).toContain('hover:bg-primary-strong');
		expect(variant).not.toContain('hover:bg-primary/');
	});
});
