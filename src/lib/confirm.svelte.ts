/**
 * Mobile-first story 5: a page's "Are you sure?" question as a promise, for
 * the alert dialog (ConfirmDialog.svelte). One question at a time per page:
 *
 *   const confirm = createConfirm();
 *   <form use:enhance={pending.submit('reject', { confirm: confirm.with(message, okay) })}>
 *   <ConfirmDialog {confirm} />
 *
 * `ask` resolves true on Confirm and false on Cancel, Escape or a new
 * question; `with` wraps it for `pending.submit`'s `confirm` option.
 */
export type ConfirmQuestion = {
	message: string;
	/** The Confirm button's label: the label of the button that was pressed. */
	okay: string;
	/** A press that erases something: the Confirm button is red. */
	destructive?: boolean;
};

export function createConfirm() {
	let question = $state<ConfirmQuestion | null>(null);
	let open = $state(false);
	let settle: ((ok: boolean) => void) | null = null;

	function finish(ok: boolean) {
		const done = settle;
		settle = null;
		done?.(ok);
	}

	return {
		/** The question on screen (kept while the dialog animates closed). */
		get question() {
			return question;
		},
		get open() {
			return open;
		},
		set open(value: boolean) {
			open = value;
			if (!value) finish(false);
		},
		ask(message: string, okay: string, options: { destructive?: boolean } = {}) {
			finish(false);
			question = { message, okay, destructive: options.destructive };
			open = true;
			return new Promise<boolean>((resolve) => {
				settle = resolve;
			});
		},
		with(message: string, okay: string, options: { destructive?: boolean } = {}) {
			return () => this.ask(message, okay, options);
		},
		/** Confirm: closes the dialog and answers yes (once). */
		confirm() {
			if (!open || !settle) return;
			open = false;
			finish(true);
		}
	};
}

export type Confirm = ReturnType<typeof createConfirm>;
