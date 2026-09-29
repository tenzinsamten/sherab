<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import logo from '$lib/assets/sherab-logo-blue.svg';

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
			<img src={logo} alt={m.nav_logo_alt()} width="180" height="100" />
			<h1>{title}</h1>
			{#if subtitle}<p>{subtitle}</p>{/if}
		</header>
		{@render children()}
		{#if footer}
			<div class="auth-card-footer">{@render footer()}</div>
		{/if}
	</div>
</div>
