<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import CredentialFields from '$lib/components/CredentialFields.svelte';
	import JoinSteps from '$lib/components/JoinSteps.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// #100: the username and PIN made at registration, while the receipt
	// cookie lives. Without it the page keeps its generic text.
	let credentials = $derived(
		data.receipt?.username && data.receipt.pin
			? [
					{ label: m.credential_username(), value: data.receipt.username },
					{ label: m.credential_pin(), value: data.receipt.pin }
				]
			: null
	);
</script>

<svelte:head>
	<title>{m.join_pending_heading()} — Sherab</title>
</svelte:head>

<!-- Without credentials on screen the text does not promise a sign-in. -->
<AuthCard
	title={m.join_pending_heading()}
	subtitle={credentials
		? m.join_pending_explanation()
		: m.join_pending_explanation_no_credentials()}
>
	<JoinSteps current={4} />
	<div class="flex min-w-0 flex-col gap-4">
		<p class="text-center">
			<Badge variant="warning" class="px-3 py-1 text-sm">{m.join_pending_status_badge()}</Badge>
		</p>

		{#if data.receipt}
			<table class="w-full border-collapse">
				<tbody class={ui.rows}>
					<tr>
						<th scope="row" class="w-1/3 py-2 pe-3 text-start align-top font-normal {ui.muted}"
							>{m.join_pending_name_label()}</th
						>
						<td class="py-2 wrap-anywhere">{data.receipt.name}</td>
					</tr>
					<tr>
						<th scope="row" class="w-1/3 py-2 pe-3 text-start align-top font-normal {ui.muted}"
							>{m.join_pending_class_label()}</th
						>
						<td class="py-2 wrap-anywhere">{data.receipt.className}</td>
					</tr>
				</tbody>
			</table>
			{#if credentials}
				<div class="flex min-w-0 flex-col gap-2" data-testid="join-credentials">
					<CredentialFields fields={credentials} />
					<p><strong>{m.join_pending_credentials_once()}</strong></p>
				</div>
			{/if}
			<p>{m.join_pending_teacher_approves()}</p>
		{/if}

		<p class={ui.muted}>{m.join_pending_cannot_yet()}</p>
	</div>

	{#snippet footer()}
		<div class="flex w-full flex-col gap-2">
			<Button href={resolve('/join')} variant="secondary" class="{ui.touch} w-full"
				>{m.join_pending_start_over()}</Button
			>
			<Button href={resolve('/login')} class="{ui.touch} w-full">{m.join_pending_sign_in()}</Button>
		</div>
	{/snippet}
</AuthCard>
