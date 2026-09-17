<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import logoSeal from '$lib/assets/logo-seal-blue.png';
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
		<p class="poster-footer">
			<strong style="display:block; font-size: var(--text-lg); margin-bottom: var(--space-1);"
				>{m.login_welcome_title()}</strong
			>
			{m.login_welcome_subtitle()}
		</p>
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
					<label for="email">{m.login_email_label()}</label>
					<input
						id="email"
						name="email"
						type="text"
						autocomplete="username"
						placeholder={m.login_email_placeholder()}
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
						placeholder={m.login_password_placeholder()}
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
