<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import logoSeal from '$lib/assets/logo-seal-blue.png';

	let {
		title,
		subtitle,
		children,
		footer
	}: { title: string; subtitle?: string; children: Snippet; footer?: Snippet } = $props();
</script>

<div class="auth-page">
	<div class="auth-card">
		<header class="auth-card-header">
			<img src={logoSeal} alt={m.nav_seal_aria_label()} width="72" height="72" />
			<h1>{title}</h1>
			{#if subtitle}<p>{subtitle}</p>{/if}
		</header>
		{@render children()}
		{#if footer}
			<div class="auth-card-footer">{@render footer()}</div>
		{/if}
	</div>
</div>
