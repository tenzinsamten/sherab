<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.login_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.login_welcome_title()} subtitle={m.login_welcome_subtitle()}>
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
		<ix-button class="block" type="submit" icon="log-in">{m.login_submit()}</ix-button>
	</form>

	{#snippet footer()}
		<a href={resolve('/forgot-password')}>{m.login_forgot_link()}</a>
	{/snippet}
</AuthCard>
