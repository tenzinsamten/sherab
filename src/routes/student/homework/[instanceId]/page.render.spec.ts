import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

// Rendered outside SvelteKit: the page reads only the URL (the ?from=done crumb).
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/student/homework/i1') }
}));

/**
 * Mobile-first story 4: archived homework still shows its status but has
 * no Mark done (the action would be refused).
 */
describe('student homework detail (+page.svelte)', () => {
	it('shows the status and no Mark done for archived homework', () => {
		const { body } = render(Page, {
			props: {
				params: { instanceId: 'i1' },
				form: null,
				data: {
					item: {
						instanceId: 'i1',
						classId: 'c1',
						title: 'Read page 4',
						contentLanguage: 'en',
						skillArea: 'language',
						dueDate: '2026-10-20',
						status: 'assigned',
						overdue: false,
						isRecurring: false,
						content: null,
						referenceLinks: []
					},
					className: 'Class A',
					archived: true,
					loadError: false
				}
			} as never
		});

		const status = body.match(/<p[^>]*data-testid="homework-status"[\s\S]*?<\/p>/)?.[0] ?? '';
		expect(status).toContain(m.student_homework_status_assigned());
		expect(body).not.toContain('action="?/markDone"');
		expect(body).not.toMatch(
			new RegExp(`<button[^>]*>[\\s\\S]*?${m.student_homework_mark_done()}`)
		);
	});
});
