<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard, { auth } from '$lib/components/AuthCard.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
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
	<form method="POST" use:enhance class={auth.form}>
		<div class={auth.field}>
			<label for="email" class={auth.label}>{m.forgot_email_label()}</label>
			<Input
				id="email"
				name="email"
				type="text"
				autocomplete="username"
				placeholder={m.login_email_placeholder()}
				required
				value={form?.email ?? ''}
			/>
		</div>
		<Button type="submit" class={auth.submit}>{m.forgot_submit()}</Button>
	</form>

	{#snippet footer()}
		<a href={resolve('/login')} class={auth.link}>{m.forgot_back_to_login()}</a>
	{/snippet}
</AuthCard>
