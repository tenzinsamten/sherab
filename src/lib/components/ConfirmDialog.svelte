<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import type { Confirm } from '$lib/confirm.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';

	/**
	 * The page's "Are you sure?" alert dialog (mobile-first story 5), driven
	 * by `createConfirm()` ($lib/confirm.svelte). It replaces iX's confirm
	 * modal: same title, the question, Cancel and the pressed button's label.
	 * On close, focus goes back to where it was (the pressed button).
	 */
	let { confirm, testid = 'confirm-dialog' }: { confirm: Confirm; testid?: string } = $props();
</script>

<AlertDialog.Root bind:open={() => confirm.open, (value) => (confirm.open = value)}>
	<AlertDialog.Content data-testid={testid}>
		<AlertDialog.Header>
			<AlertDialog.Title>{m.common_confirm_title()}</AlertDialog.Title>
			<AlertDialog.Description class="wrap-break-word">
				{confirm.question?.message ?? ''}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel class={ui.touch}>{m.common_cancel()}</AlertDialog.Cancel>
			<AlertDialog.Action
				variant={confirm.question?.destructive ? 'destructive' : 'default'}
				class={ui.touch}
				onclick={() => confirm.confirm()}
			>
				{confirm.question?.okay ?? ''}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
