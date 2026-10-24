import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

/** A message as literal text inside a RegExp. */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

	it('#126: no class yet: the empty state links to My classes to join one', () => {
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
					loadError: false
				}
			} as never
		});
		const empty = (body.match(/<div[^>]*data-testid="empty-state"[\s\S]*$/)?.[0] ?? '').replace(
			/<!--[\s\S]*?-->/g,
			''
		);
		expect(empty).toContain(m.student_no_classes());
		expect(empty).toMatch(
			new RegExp(`<a[^>]*href="/student/classes"[^>]*>\\s*${escape(m.nav_join())}\\s*</a>`)
		);
		// Not in the Done tab, and not after a failed load (unknown, not "no class").
		for (const data of [
			{ filter: 'done', loadError: false },
			{ filter: 'todo', loadError: true }
		]) {
			const other = render(Page, {
				props: {
					params: {},
					form: null,
					data: {
						counts: { todo: 0, done: 0 },
						groups: [],
						classes: [],
						page: 1,
						pageCount: 1,
						...data
					}
				} as never
			}).body;
			expect(other, JSON.stringify(data)).not.toContain('href="/student/classes"');
		}
	});
});
