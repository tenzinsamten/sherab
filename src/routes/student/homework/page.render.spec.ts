import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

/**
 * Mobile-first story 4, I/O matrix "Homework list — load error": a failed
 * load is not "no classes"; the list shows the load-failed empty state.
 */
describe('student homework list (+page.svelte)', () => {
	it('shows the load-failed empty state when the load failed', () => {
		const { body } = render(Page, {
			props: {
				params: {},
				form: null,
				data: {
					filter: 'todo',
					counts: { todo: 0, done: 0 },
					groups: [],
					classes: [],
					page: 1,
					pageCount: 1,
					loadError: true
				}
			} as never
		});

		const empty = body.match(/<div[^>]*data-testid="empty-state"[\s\S]*$/)?.[0] ?? '';
		expect(empty).toContain(m.student_homework_load_failed());
		expect(body).not.toContain(m.student_no_classes());
		expect(body).not.toContain('data-testid="class-group"');
	});
});
