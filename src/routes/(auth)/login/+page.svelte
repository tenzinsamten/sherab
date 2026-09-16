<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.login_heading()} — Sherab</title>
</svelte:head>

<div class="split-screen">
	<div class="poster-panel poster-ink">
		<div>
			<p class="poster-eyebrow">{m.login_section_label()}</p>
			<h1 class="poster-hero">{m.login_heading()}</h1>
		</div>
	</div>
	<div class="form-panel">
		<div class="form-panel-inner">
			{#if form?.error}
				<p class="banner-error" role="alert">{form.error}</p>
			{/if}

			<form method="POST" use:enhance>
				<div class="field">
					<label for="email">{m.login_email_label()}</label>
					<input
						id="email"
						name="email"
						type="text"
						autocomplete="username"
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
				<button class="btn" style="width:100%; justify-content:flex-start;" type="submit"
					>{m.login_submit()}</button
				>
			</form>
		</div>
	</div>
</div>
