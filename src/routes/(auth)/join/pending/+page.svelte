<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.join_pending_heading()} — Sherab</title>
</svelte:head>

<div class="card" style="max-width: 480px; margin: var(--space-6) auto;">
	<p class="section-label">{m.join_pending_section_label()}</p>
	<h1 style="font-size: var(--text-2xl); margin-top: 0;">{m.join_pending_heading()}</h1>

	<span
		style="display:inline-block; background: var(--color-secondary); color: var(--color-on-secondary); font-weight:700; text-transform:uppercase; letter-spacing:0.04em; font-size: var(--text-sm); padding: var(--space-1) var(--space-3); margin-bottom: var(--space-4);"
	>
		{m.join_pending_status_badge()}
	</span>

	{#if data.receipt}
		<p style="font-weight:700;">
			{m.join_pending_summary({ name: data.receipt.name, className: data.receipt.className })}
		</p>
	{/if}

	<p>{m.join_pending_explanation()}</p>
	<p style="color: var(--color-muted-foreground);">{m.join_pending_cannot_yet()}</p>

	<a class="btn btn-outline" href={resolve('/join')}>{m.join_pending_start_over()}</a>
</div>
