<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.join_pending_heading()} — Sherab</title>
</svelte:head>

<div class="split-screen">
	<div class="poster-panel poster-ink">
		<div>
			<p class="poster-eyebrow">{m.join_pending_section_label()}</p>
			<h1 class="poster-hero">{m.join_pending_heading()}</h1>
		</div>
		<p class="poster-footer">{m.join_pending_cannot_yet()}</p>
	</div>
	<div class="form-panel">
		<div class="form-panel-inner">
			<span
				class="tag"
				style="background: var(--color-secondary); color: var(--color-on-secondary);"
				>{m.join_pending_status_badge()}</span
			>
			<h2 style="font-size: var(--text-2xl); margin: var(--space-3) 0 0;">
				{m.join_pending_heading()}
			</h2>
			<p style="color: var(--color-muted-foreground);">{m.join_pending_explanation()}</p>

			{#if data.receipt}
				<div
					style="display:grid; grid-template-columns: auto minmax(0,1fr); gap: var(--space-2) var(--space-4); margin: var(--space-6) 0; padding: var(--space-4) 0; border-top: 2px solid var(--color-foreground); border-bottom: 1px solid var(--color-border);"
				>
					<span class="section-label" style="margin:0;">{m.join_pending_name_label()}</span>
					<span style="font-weight:600;">{data.receipt.name}</span>
					<span class="section-label" style="margin:0;">{m.join_pending_class_label()}</span>
					<span style="font-weight:600;">{data.receipt.className}</span>
				</div>
				<p>{m.join_pending_check_email({ email: data.receipt.guardianEmail })}</p>
			{/if}

			<a class="btn btn-outline" style="margin-top: var(--space-4);" href={resolve('/join')}
				>{m.join_pending_start_over()}</a
			>
		</div>
	</div>
</div>
