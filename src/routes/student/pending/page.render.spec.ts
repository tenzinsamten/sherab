import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

/**
 * Mobile-first story 4, I/O matrix "Pending / rejected — load error": when
 * the profile could not be read, the status card claims no status.
 */
describe('student pending page (+page.svelte)', () => {
	it('claims no status when the load failed: error state, generic text only', () => {
		const { body } = render(Page, {
			props: { params: {}, data: { state: 'pending', name: '', loadError: true } } as never
		});

		const card = body.match(/<section[^>]*data-testid="student-status"[\s\S]*?<\/section>/)?.[0];
		expect(card).toBeDefined();
		expect(card).toMatch(/data-state="error"/);
		expect(card).toContain(m.load_error_generic());
		for (const text of [
			m.student_pending_heading(),
			m.student_pending_body(),
			m.student_rejected_heading(),
			m.student_rejected_body()
		]) {
			expect(body).not.toContain(text);
		}
		expect(body).not.toContain(m.student_pending_check_again());
		expect(body).not.toContain(m.join_pending_status_badge());
	});
});
