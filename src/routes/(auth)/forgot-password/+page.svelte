<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import { showToast } from '$lib/ix';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	$effect(() => {
		if (data.expired && !form) showToast('error', m.forgot_error_expired());
	});
	$effect(() => {
		if (form?.success) showToast('success', m.forgot_success());
	});
</script>

<svelte:head>
	<title>{m.forgot_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.forgot_heading()} subtitle={m.forgot_description()}>
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
		<ix-button class="block" type="submit">{m.forgot_submit()}</ix-button>
	</form>

	{#snippet footer()}
		<a href={resolve('/login')}>{m.forgot_back_to_login()}</a>
	{/snippet}
</AuthCard>
