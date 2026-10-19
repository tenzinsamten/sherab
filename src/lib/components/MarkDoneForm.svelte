<script lang="ts">
	import { tick } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Check from '@lucide/svelte/icons/check';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { enhance } from '$app/forms';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as m from '$lib/paraglide/messages.js';
	import type { createPending } from '$lib/pending.svelte';
	import { ui } from '$lib/ui/classes';

	/**
	 * A homework's Mark done (#43, #91), posting to the page's `?/markDone`.
	 * Mobile-first story 4: the question is a new alert dialog (it was iX's
	 * confirm modal). The button is the form's submit button, so without
	 * JavaScript it posts directly; with it, the click asks first and
	 * Confirm submits the form. `pending` is the caller's (one per
	 * StudentHomeworkRows list, or the detail page's), so one press at a
	 * time within it. Once saved the form is gone (the homework shows Done),
	 * so focus moves to `focusAfter()` if it was left nowhere; after a failed
	 * save the form is still there and focus goes back to its button.
	 */
	let {
		instanceId,
		title,
		pending,
		variant = 'default',
		class: className = '',
		focusAfter
	}: {
		instanceId: string;
		/** The homework's title, for the question. */
		title: string;
		pending: ReturnType<typeof createPending>;
		variant?: 'default' | 'outline';
		class?: string;
		focusAfter?: () => HTMLElement | null | undefined;
	} = $props();

	let key = $derived(`done:${instanceId}`);
	let asking = $state(false);
	let form: HTMLFormElement | undefined = $state();
	let button: HTMLButtonElement | null = $state(null);
	// Set by Confirm: the dialog's close must not focus the (now busy) button.
	let confirmed = false;

	function ask(event: MouseEvent) {
		event.preventDefault();
		if (!pending.busy) asking = true;
	}

	async function confirm() {
		// A second tap during the close animation posts nothing more.
		if (!asking || pending.busy) return;
		confirmed = true;
		asking = false;
		await tick();
		form?.requestSubmit();
	}

	function closeFocus(event: Event) {
		if (!confirmed) return;
		confirmed = false;
		event.preventDefault();
	}

	const submit: SubmitFunction = async (input) => {
		const after = await pending.submit(key)(input);
		if (!after) return;
		return async (result) => {
			await after(result);
			await tick();
			const active = document.activeElement;
			if (active && active !== document.body && active.isConnected) return;
			// Not saved (an error): the form is still there, so its button.
			if (form?.isConnected && button) button.focus();
			else focusAfter?.()?.focus();
		};
	};
</script>

<form bind:this={form} method="POST" action="?/markDone" use:enhance={submit} class="min-w-0">
	<input type="hidden" name="instanceId" value={instanceId} />
	<Button
		bind:ref={button}
		type="submit"
		{variant}
		class="{ui.touch} {className}"
		disabled={pending.busy}
		aria-busy={pending.is(key) || undefined}
		aria-haspopup="dialog"
		onclick={ask}
	>
		{#if pending.is(key)}
			<LoaderCircle class="animate-spin" aria-hidden="true" />
		{:else}
			<Check aria-hidden="true" />
		{/if}
		{m.student_homework_mark_done()}
	</Button>
</form>

<AlertDialog.Root bind:open={asking}>
	<AlertDialog.Content data-testid="mark-done-confirm" onCloseAutoFocus={closeFocus}>
		<AlertDialog.Header>
			<AlertDialog.Title>{m.common_confirm_title()}</AlertDialog.Title>
			<AlertDialog.Description class="wrap-break-word">
				{m.student_homework_mark_done_confirm({ title })}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel class={ui.touch}>{m.common_cancel()}</AlertDialog.Cancel>
			<AlertDialog.Action class={ui.touch} disabled={pending.busy} onclick={() => void confirm()}>
				{m.student_homework_mark_done()}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
