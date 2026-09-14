<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.signup_heading()} — Sherab</title>
</svelte:head>

<div class="card" style="max-width: 480px; margin: var(--space-8) auto;">
	<p class="section-label">{m.signup_section_label()}</p>
	<h1 style="font-size: var(--text-2xl); margin-top: 0;">{m.signup_heading()}</h1>
	<p style="color: var(--color-muted-foreground); font-size: var(--text-sm);">
		{m.signup_notice()}
	</p>

	{#if form?.error}
		<p class="banner-error" role="alert">{form.error}</p>
	{/if}

	<form method="POST" use:enhance>
		<div class="field">
			<label for="email">{m.signup_email_label()}</label>
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
			<label for="password">{m.signup_password_label()}</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="new-password"
				minlength="6"
				required
			/>
		</div>
		<button class="btn" type="submit">{m.signup_submit()}</button>
	</form>
</div>
