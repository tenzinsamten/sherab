import { describe, expect, it } from 'vitest';
import { createConfirm } from './confirm.svelte';

describe('createConfirm', () => {
	it('answers true on Confirm, once, and closes', async () => {
		const confirm = createConfirm();
		const answer = confirm.ask('Reject Pema?', 'Reject', { destructive: true });
		expect(confirm.open).toBe(true);
		expect(confirm.question).toEqual({
			message: 'Reject Pema?',
			okay: 'Reject',
			destructive: true
		});
		confirm.confirm();
		expect(confirm.open).toBe(false);
		await expect(answer).resolves.toBe(true);
		// A second tap (during the close) does nothing more, and closing answers nothing.
		confirm.confirm();
		confirm.open = false;
		await expect(answer).resolves.toBe(true);
	});

	it('answers false when the dialog closes (Cancel, Escape)', async () => {
		const confirm = createConfirm();
		const answer = confirm.ask('Approve?', 'Approve');
		confirm.open = false;
		await expect(answer).resolves.toBe(false);
		// Confirm after the close does not turn it into a yes.
		confirm.confirm();
		await expect(answer).resolves.toBe(false);
	});

	it('answers a question false when a new one is asked', async () => {
		const confirm = createConfirm();
		const first = confirm.ask('First?', 'Yes');
		const second = confirm.with('Second?', 'Yes')();
		await expect(first).resolves.toBe(false);
		expect(confirm.question?.message).toBe('Second?');
		confirm.confirm();
		await expect(second).resolves.toBe(true);
	});
});
