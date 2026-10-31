import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { createPending } from '$lib/pending.svelte';
import MarkDoneForm from './MarkDoneForm.svelte';

const INSTANCE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CHILD = '11111111-2222-4333-8444-555555555555';

/** spec-parent-managed-homework story 4: the optional hidden childId field. */
describe('MarkDoneForm', () => {
	it('without childId (a student page) posts only the instanceId', () => {
		const { body } = render(MarkDoneForm, {
			props: { instanceId: INSTANCE, title: 'Read', pending: createPending() }
		});
		expect(body).toContain('action="?/markDone"');
		expect(body).toMatch(new RegExp(`<input type="hidden" name="instanceId" value="${INSTANCE}"`));
		expect(body).not.toContain('name="childId"');
	});

	it('with childId (/parent/homework) also posts the child', () => {
		const { body } = render(MarkDoneForm, {
			props: { instanceId: INSTANCE, childId: CHILD, title: 'Read', pending: createPending() }
		});
		expect(body).toMatch(new RegExp(`<input type="hidden" name="childId" value="${CHILD}"`));
	});
});
