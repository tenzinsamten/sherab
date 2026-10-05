<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import type { PageData } from './$types';

	/**
	 * #89: an emailed link stops here, and the button does the confirming. No
	 * script submits the form: only a person pressing it may spend the link.
	 * The form posts back to this address, which still carries the token.
	 */
	let { data }: { data: PageData } = $props();

	let recovery = $derived(data.kind === 'recovery');
	let title = $derived(recovery ? m.confirm_recovery_heading() : m.confirm_heading());
</script>

<svelte:head>
	<title>{title} — Sherab</title>
</svelte:head>

<AuthCard {title} subtitle={recovery ? m.confirm_recovery_body() : m.confirm_body()}>
	<form method="POST">
		<ix-button class="block" type="submit">
			{recovery ? m.confirm_recovery_submit() : m.confirm_submit()}
		</ix-button>
	</form>
</AuthCard>
