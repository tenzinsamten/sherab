<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.signup_heading()} — Sherab</title>
</svelte:head>

<div class="split-screen">
	<div class="poster-panel poster-amber">
		<div>
			<p class="poster-eyebrow">{m.signup_section_label()}</p>
			<h1 class="poster-hero">{m.signup_heading()}</h1>
		</div>
		<p class="poster-footer">{m.signup_notice()}</p>
	</div>
	<div class="form-panel">
		<div class="form-panel-inner">
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
				<button class="btn" style="width:100%; justify-content:flex-start;" type="submit"
					>{m.signup_submit()}</button
				>
			</form>
		</div>
	</div>
</div>
