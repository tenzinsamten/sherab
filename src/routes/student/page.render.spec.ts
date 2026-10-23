import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

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
});
