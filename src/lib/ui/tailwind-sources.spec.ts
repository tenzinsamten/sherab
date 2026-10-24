import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #129: Tailwind's utilities are imported with `source(none)`, so a component
 * not named by an `@source` in tailwind.css gets none of its classes. Every
 * src/lib/components .svelte file that sets classes must be covered, by its own
 * entry or by a listed directory.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'tailwind.css'), 'utf8');
const components = resolve(here, '../components');

const sources = [...css.matchAll(/^@source '([^']+)';/gm)]
	.map((match) => match[1])
	.filter((path) => !path.includes('*'))
	.map((path) => resolve(here, path));

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return svelteFiles(path);
		return entry.name.endsWith('.svelte') ? [path] : [];
	});
}

const covered = (file: string) =>
	sources.some((source) => file === source || file.startsWith(source + sep));

describe('tailwind @source list (#129)', () => {
	it('covers every component that sets classes', () => {
		const styled = svelteFiles(components).filter((file) =>
			/\bclass(Name)?\s*[=:]|data-ui="new"/.test(readFileSync(file, 'utf8'))
		);
		expect(styled.length).toBeGreaterThan(0);
		const missing = styled.filter((file) => !covered(file)).map((f) => relative(components, f));
		expect(missing).toEqual([]);
	});
});
