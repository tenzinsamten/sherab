<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard, { auth } from '$lib/components/AuthCard.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<svelte:head>
	<title>{m.resend_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.resend_heading()} subtitle={m.resend_description()}>
	{#if form?.success}
		<!-- Stays on the page (a toast would be gone before the mail arrives). -->
		<p role="status" class="mb-4 rounded-lg border border-border bg-muted p-3">
			{m.resend_success()}
		</p>
	{/if}
	<form method="POST" use:enhance class={auth.form}>
		<div class={auth.field}>
			<label for="email" class={auth.label}>{m.forgot_email_label()}</label>
			<Input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				required
				value={form?.email ?? data.email}
			/>
		</div>
		<Button type="submit" class={auth.submit}>{m.resend_submit()}</Button>
	</form>

	{#snippet footer()}
		<a href={resolve('/login')} class={auth.link}>{m.forgot_back_to_login()}</a>
	{/snippet}
</AuthCard>
