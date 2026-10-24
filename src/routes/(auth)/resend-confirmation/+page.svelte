<script lang="ts">
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard, { auth } from '$lib/components/AuthCard.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { createPending } from '$lib/pending.svelte';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	// #118: the button shows the form is sending; a second tap or Enter is ignored until the answer.
	const pending = createPending();

	// #117: the action's error also stays in the form (the toast goes after
	// 5s): under Email, or above the button.
	let errorText = $derived(form && 'error' in form && form.error ? form.error : '');
	let errorAt = $derived(
		!errorText ? null : errorText === m.resend_error_required() ? 'email' : 'form'
	);
</script>

<svelte:head>
	<title>{m.resend_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.resend_heading()} subtitle={m.resend_description()}>
	<!-- Stays on the page (a toast would be gone before the mail arrives). The
	     live region is always there, empty, so the text added into it is
	     announced (#129). -->
	<div role="status">
		{#if form?.success}
			<p class="mb-4 rounded-lg border border-border bg-muted p-3">{m.resend_success()}</p>
		{/if}
	</div>
	<form method="POST" use:enhance={pending.submit('resend')} class={auth.form}>
		<div class={auth.field}>
			<label for="email" class={auth.label}>{m.forgot_email_label()}</label>
			<Input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				required
				value={form?.email ?? data.email}
				aria-invalid={errorAt === 'email' ? 'true' : undefined}
				aria-describedby={errorAt === 'email' ? 'email-error' : undefined}
			/>
			{#if errorAt === 'email'}
				<p id="email-error" class={ui.error}>{errorText}</p>
			{/if}
		</div>
		{#if errorAt === 'form'}
			<p id="form-error" class={ui.error}>{errorText}</p>
		{/if}
		<Button
			type="submit"
			class={auth.submit}
			disabled={pending.busy}
			aria-busy={pending.is('resend') || undefined}
		>
			{#if pending.is('resend')}
				<LoaderCircle class="size-5 animate-spin" aria-hidden="true" />
			{/if}
			{m.resend_submit()}
		</Button>
	</form>

	{#snippet footer()}
		<a href={resolve('/login')} class={auth.link}>{m.forgot_back_to_login()}</a>
	{/snippet}
</AuthCard>
