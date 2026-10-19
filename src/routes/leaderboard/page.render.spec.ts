import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

/** Mobile-first story 5, I/O matrix "Leaderboard — empty". */
describe('leaderboard (+page.svelte)', () => {
	it('shows the empty state when there are no teams', () => {
		const { body } = render(Page, {
			props: { params: {}, data: { teams: [], loadError: false } } as never
		});
		expect(body).toContain('data-testid="empty-state"');
		expect(body).toContain(m.leaderboard_empty());
		expect(body).not.toContain('data-testid="leaderboard"');
	});

	it('marks only the first rank as the top one', () => {
		const team = (id: string, name: string, streak: number) => ({
			teamId: id,
			teamName: name,
			totalStreak: streak,
			canOpen: false
		});
		const { body } = render(Page, {
			props: {
				params: {},
				data: { teams: [team('a', 'Alpha', 5), team('b', 'Beta', 2)], loadError: false }
			} as never
		});
		const rows = [...body.matchAll(/<li[^>]*data-testid="leaderboard-row"[^>]*>/g)].map(
			(r) => r[0]
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toContain('data-top');
		expect(rows[1]).not.toContain('data-top');
	});
});
