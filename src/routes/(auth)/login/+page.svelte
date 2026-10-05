<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import { showToast } from '$lib/ix';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	$effect(() => {
		if (data.confirmLinkFailed && !form) showToast('error', m.login_error_confirm_link());
	});
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
			<PasswordInput
				id="password"
				name="password"
				autocomplete="current-password"
				placeholder={m.login_password_placeholder()}
				required
			/>
		</div>
		<ix-button class="block" type="submit" icon="log-in">{m.login_submit()}</ix-button>
	</form>

	{#snippet footer()}
		<a href={resolve('/forgot-password')}>{m.login_forgot_link()}</a>
		<a href={resolve('/register')}>{m.login_register_parent_link()}</a>
	{/snippet}
</AuthCard>
