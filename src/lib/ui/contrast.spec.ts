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
