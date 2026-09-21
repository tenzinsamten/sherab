<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import logoSeal from '$lib/assets/logo-seal-blue.png';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.reset_heading()} — Sherab</title>
</svelte:head>

<div class="split-screen">
	<div class="poster-panel poster-ink">
		<div>
			<p class="poster-eyebrow">{m.login_section_label()}</p>
			<h1 class="poster-hero">{m.reset_heading()}</h1>
		</div>
	</div>
	<div class="form-panel">
		<div class="form-panel-inner">
			<img
				src={logoSeal}
				alt={m.nav_seal_aria_label()}
				width="144"
				height="144"
				style="display:block; margin: -80px auto var(--space-4);"
			/>

			{#if form?.error}
				<p class="banner-error" role="alert">{form.error}</p>
			{/if}

			<form method="POST" use:enhance>
				<div class="field">
					<label for="password">{m.reset_password_label()}</label>
					<input
						id="password"
						name="password"
						type="password"
						autocomplete="new-password"
						minlength="6"
						required
					/>
				</div>
				<div class="field">
					<label for="confirm">{m.reset_confirm_label()}</label>
					<input
						id="confirm"
						name="confirm"
						type="password"
						autocomplete="new-password"
						minlength="6"
						required
					/>
				</div>
				<button class="btn" style="width:100%; justify-content:flex-start;" type="submit"
					>{m.reset_submit()}</button
				>
			</form>
		</div>
	</div>
</div>
