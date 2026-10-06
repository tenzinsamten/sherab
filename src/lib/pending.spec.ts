import { describe, expect, it, vi } from 'vitest';
import { createPending } from './pending.svelte';

type Input = Parameters<ReturnType<ReturnType<typeof createPending>['submit']>>[0];

const input = () =>
	({ cancel: vi.fn() }) as unknown as Input & { cancel: ReturnType<typeof vi.fn> };

describe('createPending().submit', () => {
	it('without confirm: marks the key busy until the answer is applied', async () => {
		const pending = createPending();
		const i = input();
		const after = await pending.submit('save')(i);
		expect(i.cancel).not.toHaveBeenCalled();
		expect(pending.is('save')).toBe(true);
		await (after as (o: unknown) => Promise<void>)({ update: async () => undefined });
		expect(pending.busy).toBe(false);
	});

	it('#91: does not post when the question is answered no', async () => {
		const pending = createPending();
		const i = input();
		const after = await pending.submit('reject', { confirm: async () => false })(i);
		expect(i.cancel).toHaveBeenCalledOnce();
		expect(after).toBeUndefined();
		expect(pending.busy).toBe(false);
	});

	it('#91: posts when the question is answered yes', async () => {
		const pending = createPending();
		const i = input();
		const after = await pending.submit('reject', { confirm: async () => true })(i);
		expect(i.cancel).not.toHaveBeenCalled();
		expect(pending.is('reject')).toBe(true);
		expect(after).toBeTypeOf('function');
	});

	it('#91: a second press while the question is open is dropped without asking again', async () => {
		const pending = createPending();
		let answer: (ok: boolean) => void = () => undefined;
		const confirm = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
		const submit = pending.submit('reject', { confirm });
		const first = input();
		const second = input();
		const running = submit(first);
		await submit(second);
		expect(second.cancel).toHaveBeenCalledOnce();
		expect(confirm).toHaveBeenCalledOnce();
		answer(true);
		await running;
		expect(first.cancel).not.toHaveBeenCalled();
	});

	it('#91: a failed question leaves the form usable', async () => {
		const pending = createPending();
		const submit = pending.submit('reject', {
			confirm: vi.fn().mockRejectedValueOnce(new Error('no dialog')).mockResolvedValue(true)
		});
		await expect(submit(input())).rejects.toThrow('no dialog');
		const again = input();
		await submit(again);
		expect(again.cancel).not.toHaveBeenCalled();
		expect(pending.is('reject')).toBe(true);
	});
});
