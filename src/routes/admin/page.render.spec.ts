import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

/**
 * Mobile-first story 9: the admin dashboard as the server renders it. Six
 * tiles, three of them links (classes, teachers, requests); a zero value is
 * muted, never hidden.
 */
function renderPage(overrides: Record<string, number> = {}) {
	return render(Page, {
		props: {
			params: {},
			data: {
				classesCount: 3,
				teachersCount: 0,
				pendingRequestsCount: 2,
				studentsCount: 0,
				homeworkAssignmentsCount: 5,
				homeworkCompletionPercent: 40,
				...overrides
			}
		} as never
	}).body.replace(/<!--[\s\S]*?-->/g, ''); // without Svelte's hydration markers
}

describe('admin dashboard (+page.svelte)', () => {
	it('shows six tiles, exactly three of them links to classes, teachers and requests', () => {
		const body = renderPage();
		expect(body).toContain('data-ui="new"');
		const tiles = body.match(/<ul[^>]*data-testid="dashboard-tiles"[\s\S]*?<\/ul>/)?.[0] ?? '';
		expect(tiles.match(/<li[\s>]/g)).toHaveLength(6);
		const hrefs = [...tiles.matchAll(/<a[^>]*href="([^"]+)"/g)].map((a) => a[1]);
		expect(hrefs).toEqual(['/admin/classes', '/admin/teachers', '/requests']);
	});

	it('mutes a tile value only when it is zero', () => {
		const body = renderPage();
		const values = [
			...body.matchAll(/<p class="([^"]*)" data-testid="tile-value">\s*([^<]*?)\s*</g)
		].map((v) => ({ muted: v[1].split(/\s+/).includes('text-muted-foreground'), text: v[2] }));
		expect(values).toHaveLength(6);
		// Classes 3, teachers 0, requests 2, students 0, homework 5, completion 40%.
		expect(values.map((v) => v.muted)).toEqual([false, true, false, true, false, false]);
		expect(values[1].text).toBe('0');
	});
});
