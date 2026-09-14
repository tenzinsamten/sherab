<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.login_heading()} — Sherab</title>
</svelte:head>

<div class="card" style="max-width: 420px; margin: var(--space-8) auto;">
	<p class="section-label">{m.login_section_label()}</p>
	<h1 style="font-size: var(--text-2xl); margin-top: 0;">{m.login_heading()}</h1>

	{#if form?.error}
		<p class="banner-error" role="alert">{form.error}</p>
	{/if}

	<form method="POST" use:enhance>
		<div class="field">
			<label for="email">{m.login_email_label()}</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				required
				value={form?.email ?? ''}
			/>
		</div>
		<div class="field">
			<label for="password">{m.login_password_label()}</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
			/>
		</div>
		<button class="btn" type="submit">{m.login_submit()}</button>
	</form>
</div>
