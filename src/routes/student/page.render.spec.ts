import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

/** A message as literal text inside a RegExp. */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Mobile-first story 4, I/O matrix "Dashboard — load error": a failed load
 * shows "—" in every tile, never a misleading number.
 */
describe('student dashboard (+page.svelte)', () => {
	it('shows "—" in every tile and no number when the load failed', () => {
		const { body } = render(Page, {
			props: {
				params: {},
				form: null,
				data: {
					tiles: { todo: 4, overdue: 2, doneThisWeek: 3 },
					team: null,
					teamId: null,
					streak: null,
					badges: [],
					badgeProgress: [],
					progressLoadError: false,
					nextDue: [],
					classes: [],
					loadError: true
				}
			} as never
		});

		const tiles = body.match(/<ul[^>]*data-testid="dashboard-tiles"[\s\S]*?<\/ul>/)?.[0] ?? '';
		expect(tiles).not.toBe('');
		const values = [...tiles.matchAll(/<li[\s\S]*?<\/li>/g)].map((li) =>
			li[0]
				.replace(/<!--[\s\S]*?-->/g, '')
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
		);
		expect(values).toEqual(
			[
				m.student_tile_todo(),
				m.student_tile_overdue(),
				m.student_tile_done_week(),
				m.student_tile_team()
			].map((label) => `${label} —`)
		);
		// No number anywhere in the tiles' text (the fixture's counts are 4, 2, 3).
		expect(values.join(' ')).not.toMatch(/\d/);
	});

	it('#126: without a class, a Join a class link to My classes; not after a failed load', () => {
		const base = {
			tiles: { todo: 0, overdue: 0, doneThisWeek: 0 },
			team: null,
			teamId: null,
			streak: null,
			badges: [],
			badgeProgress: [],
			progressLoadError: false,
			nextDue: [],
			classes: [],
			loadError: false
		};
		const page = (loadError: boolean) =>
			render(Page, {
				props: { params: {}, form: null, data: { ...base, loadError } } as never
			}).body;
		const join = new RegExp(
			`<a[^>]*href="/student/classes"[^>]*>\\s*${escape(m.nav_join())}\\s*</a>`
		);
		const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '');
		expect(text(page(false))).toMatch(join);
		expect(text(page(true))).not.toMatch(join);
	});
});
