import { afterEach, describe, expect, it, vi } from 'vitest';
import { runningActions } from './busy.svelte';
import { createPending, restoreFocus } from './pending.svelte';

type Input = Parameters<ReturnType<ReturnType<typeof createPending>['submit']>>[0];

// The ActionResult an answer carries; the focus return (#109) reads its type.
const ok = { type: 'success', status: 200 } as const;

const input = () =>
	({ cancel: vi.fn() }) as unknown as Input & { cancel: ReturnType<typeof vi.fn> };

describe('createPending().submit', () => {
	it('without confirm: marks the key busy until the answer is applied', async () => {
		const pending = createPending();
		const i = input();
		const after = await pending.submit('save')(i);
		expect(i.cancel).not.toHaveBeenCalled();
		expect(pending.is('save')).toBe(true);
		await (after as (o: unknown) => Promise<void>)({ update: async () => undefined, result: ok });
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
	type After = (o: { update: () => Promise<void>; result: unknown }) => Promise<void>;

	it('counts a posted submit until update() settles', async () => {
		const before = runningActions();
		const after = (await createPending().submit('save')(input())) as After;
		expect(runningActions()).toBe(before + 1);
		await after({ update: async () => undefined, result: ok });
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
		await after({ update: async () => undefined, result: ok });
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
				result: ok,
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
		await one({ update: async () => undefined, result: ok });
		expect(runningActions()).toBe(before + 1);
		await two({ update: async () => undefined, result: ok });
		expect(runningActions()).toBe(before);
	});
});

// #109: the disabled buttons drop focus to <body> during an action (and
// applyAction does on success); it goes back afterwards. The server project
// runs in node, so `document` and the elements are stubs.
describe('restoreFocus (#109)', () => {
	const body = { tagName: 'BODY' };
	let doc: { body: unknown; activeElement: unknown };
	type Fake = HTMLElement & { focus: ReturnType<typeof vi.fn> };
	/** Like the browser, a focused element becomes `activeElement`, unless it can't take focus. */
	const element = (
		over: { isConnected?: boolean; disabled?: boolean; takesFocus?: boolean } = {}
	): Fake => {
		const { takesFocus = true, ...rest } = over;
		const el = { isConnected: true, disabled: false, ...rest } as unknown as Fake;
		el.focus = vi.fn(() => {
			if (takesFocus) doc.activeElement = el;
		});
		return el;
	};
	const stubDocument = (activeElement: unknown) => {
		doc = { body, activeElement };
		vi.stubGlobal('document', doc);
	};
	type After = (o: { update: () => Promise<void>; result: unknown }) => Promise<void>;
	const submitWith = async (submitter: HTMLElement) =>
		(await createPending().submit('save')({
			...input(),
			submitter
		} as unknown as Input)) as After;
	// update() stands in for applyAction's reset_focus: focus ends on <body>.
	const resetsFocus = async () => {
		doc.activeElement = body;
	};

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('focuses the pressed button when focus fell to <body>', async () => {
		stubDocument(body);
		const save = element();
		await restoreFocus(save);
		expect(save.focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(doc.activeElement).toBe(save);
	});

	it('focuses the pressed button when nothing has focus', async () => {
		stubDocument(null);
		const save = element();
		await restoreFocus(save);
		expect(save.focus).toHaveBeenCalledOnce();
	});

	it('leaves focus that moved elsewhere (a field, a dialog, a new page)', async () => {
		stubDocument({ tagName: 'INPUT' });
		const save = element();
		await restoreFocus(save);
		expect(save.focus).not.toHaveBeenCalled();
	});

	it('does not focus a button that left the page', async () => {
		stubDocument(body);
		const remove = element({ isConnected: false });
		await restoreFocus(remove);
		expect(remove.focus).not.toHaveBeenCalled();
	});

	it('does not focus a button that is still disabled', async () => {
		stubDocument(body);
		const save = element({ disabled: true });
		await restoreFocus(save);
		expect(save.focus).not.toHaveBeenCalled();
	});

	it('does nothing without a submitter', async () => {
		stubDocument(body);
		await expect(restoreFocus(null)).resolves.toBeUndefined();
	});

	it('does nothing without a document (server)', async () => {
		const save = element();
		await restoreFocus(save);
		expect(save.focus).not.toHaveBeenCalled();
	});

	it('prefers the earlier focused element, falls back to the button', async () => {
		stubDocument(body);
		const field = element();
		const save = element();
		await restoreFocus(field, save);
		expect(doc.activeElement).toBe(field);
		expect(save.focus).not.toHaveBeenCalled();

		doc.activeElement = body;
		const gone = element({ isConnected: false });
		await restoreFocus(gone, save);
		expect(gone.focus).not.toHaveBeenCalled();
		expect(doc.activeElement).toBe(save);

		doc.activeElement = body;
		await restoreFocus(body as unknown as Element, save);
		expect(save.focus).toHaveBeenCalledTimes(2);
	});

	it('a candidate that cannot take focus (hidden, inert) passes to the next', async () => {
		stubDocument(body);
		const collapsed = element({ takesFocus: false });
		const save = element();
		await restoreFocus(collapsed, save);
		expect(collapsed.focus).toHaveBeenCalledOnce();
		expect(doc.activeElement).toBe(save);
	});

	it('a field focused before a success that dropped focus gets it back', async () => {
		const field = element();
		const save = element();
		stubDocument(field);
		await (
			await submitWith(save)
		)({ result: ok, update: resetsFocus });
		expect(doc.activeElement).toBe(field);
		expect(save.focus).not.toHaveBeenCalled();
	});

	it('<body> before (the clicked button was disabled): the button gets it', async () => {
		const save = element();
		stubDocument(body);
		await (
			await submitWith(save)
		)({ result: ok, update: resetsFocus });
		expect(doc.activeElement).toBe(save);
	});

	it('a field that left the page: the button gets it', async () => {
		const save = element();
		const gone = element({ isConnected: false });
		stubDocument(gone);
		await (
			await submitWith(save)
		)({ result: ok, update: resetsFocus });
		expect(gone.focus).not.toHaveBeenCalled();
		expect(doc.activeElement).toBe(save);
	});

	it('a fail() answer also returns focus', async () => {
		const save = element();
		stubDocument(body);
		await (
			await submitWith(save)
		)({
			result: { type: 'failure', status: 400, data: {} },
			update: async () => undefined
		});
		expect(doc.activeElement).toBe(save);
	});

	it('a redirect or an error page moves no focus (they set their own)', async () => {
		for (const result of [
			{ type: 'redirect', status: 303, location: '/elsewhere' },
			{ type: 'error', error: new Error('boom') }
		]) {
			const field = element();
			const save = element();
			stubDocument(field);
			await (
				await submitWith(save)
			)({ result, update: resetsFocus });
			expect(field.focus).not.toHaveBeenCalled();
			expect(save.focus).not.toHaveBeenCalled();
			expect(doc.activeElement).toBe(body);
		}
	});

	it('a throwing update() still returns focus', async () => {
		const save = element();
		stubDocument(body);
		await expect(
			(await submitWith(save))({
				result: ok,
				update: async () => {
					throw new Error('network');
				}
			})
		).rejects.toThrow('network');
		expect(doc.activeElement).toBe(save);
	});

	it('a cancelled second submit moves no focus', async () => {
		const first = element();
		const second = element();
		stubDocument(body);
		const pending = createPending();
		const after = (await pending.submit('save')({
			...input(),
			submitter: first
		} as unknown as Input)) as After;
		const i = { ...input(), submitter: second } as unknown as Input & {
			cancel: ReturnType<typeof vi.fn>;
		};
		expect(await pending.submit('other')(i)).toBeUndefined();
		expect(i.cancel).toHaveBeenCalledOnce();
		expect(second.focus).not.toHaveBeenCalled();
		expect(first.focus).not.toHaveBeenCalled();
		await after({ result: ok, update: async () => undefined });
		expect(second.focus).not.toHaveBeenCalled();
		expect(doc.activeElement).toBe(first);
	});

	it('a declined question moves no focus', async () => {
		stubDocument(body);
		const save = element();
		const i = { ...input(), submitter: save } as unknown as Input;
		await createPending().submit('reject', { confirm: async () => false })(i);
		expect(save.focus).not.toHaveBeenCalled();
	});
});
