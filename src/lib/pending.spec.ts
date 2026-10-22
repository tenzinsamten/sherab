import { describe, expect, it, vi } from 'vitest';
import { runningActions } from './busy.svelte';
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

// Story 11: the app-wide count behind the layout's loading bar. Measured
// from a baseline, because earlier tests leave answered-yes submits open.
describe('createPending().submit: running actions (story 11)', () => {
	type After = (o: { update: () => Promise<void> }) => Promise<void>;

	it('counts a posted submit until update() settles', async () => {
		const before = runningActions();
		const after = (await createPending().submit('save')(input())) as After;
		expect(runningActions()).toBe(before + 1);
		await after({ update: async () => undefined });
		expect(runningActions()).toBe(before);
	});

	it('a cancelled second submit is not counted', async () => {
		const before = runningActions();
		const pending = createPending();
		const after = (await pending.submit('save')(input())) as After;
		const second = input();
		await pending.submit('other')(second);
		expect(second.cancel).toHaveBeenCalledOnce();
		expect(runningActions()).toBe(before + 1);
		await after({ update: async () => undefined });
		expect(runningActions()).toBe(before);
	});

	it('a declined question is not counted', async () => {
		const before = runningActions();
		await createPending().submit('reject', { confirm: async () => false })(input());
		expect(runningActions()).toBe(before);
	});

	it('a throwing update() still ends the count', async () => {
		const before = runningActions();
		const after = (await createPending().submit('save')(input())) as After;
		await expect(
			after({
				update: async () => {
					throw new Error('network');
				}
			})
		).rejects.toThrow('network');
		expect(runningActions()).toBe(before);
	});

	it('two components running at once keep the count up until both end', async () => {
		const before = runningActions();
		const one = (await createPending().submit('a')(input())) as After;
		const two = (await createPending().submit('b')(input())) as After;
		expect(runningActions()).toBe(before + 2);
		await one({ update: async () => undefined });
		expect(runningActions()).toBe(before + 1);
		await two({ update: async () => undefined });
		expect(runningActions()).toBe(before);
	});
});
