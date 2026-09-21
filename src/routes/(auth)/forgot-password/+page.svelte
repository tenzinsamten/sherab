<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import logoSeal from '$lib/assets/logo-seal-blue.png';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<svelte:head>
	<title>{m.forgot_heading()} — Sherab</title>
</svelte:head>

<div class="split-screen">
	<div class="poster-panel poster-ink">
		<div>
			<p class="poster-eyebrow">{m.login_section_label()}</p>
			<h1 class="poster-hero">{m.forgot_heading()}</h1>
		</div>
		<p class="poster-footer">{m.forgot_description()}</p>
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
			{:else if data.expired && !form?.success}
				<p class="banner-error" role="alert">{m.forgot_error_expired()}</p>
			{/if}
			{#if form?.success}
				<p class="banner-success" role="status">{m.forgot_success()}</p>
			{/if}

			<form method="POST" use:enhance>
				<div class="field">
					<label for="email">{m.forgot_email_label()}</label>
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
				<button class="btn" style="width:100%; justify-content:flex-start;" type="submit"
					>{m.forgot_submit()}</button
				>
			</form>
			<p style="margin-top: var(--space-4);">
				<a href="/login">{m.forgot_back_to_login()}</a>
			</p>
		</div>
	</div>
</div>
