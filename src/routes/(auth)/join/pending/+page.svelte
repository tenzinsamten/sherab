<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.join_pending_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.join_pending_heading()} subtitle={m.join_pending_explanation()}>
	<p style="text-align:center; margin: 0 0 var(--space-4);">
		<ix-pill variant="warning">{m.join_pending_status_badge()}</ix-pill>
	</p>

	{#if data.receipt}
		<table>
			<tbody>
				<tr>
					<th scope="row" class="muted">{m.join_pending_name_label()}</th>
					<td>{data.receipt.name}</td>
				</tr>
				<tr>
					<th scope="row" class="muted">{m.join_pending_class_label()}</th>
					<td>{data.receipt.className}</td>
				</tr>
			</tbody>
		</table>
		<p>{m.join_pending_check_email({ email: data.receipt.guardianEmail })}</p>
	{/if}

	<p class="muted">{m.join_pending_cannot_yet()}</p>

	{#snippet footer()}
		<ix-button variant="secondary" href={resolve('/join')}>{m.join_pending_start_over()}</ix-button>
	{/snippet}
</AuthCard>
