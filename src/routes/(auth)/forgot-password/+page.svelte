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
	import { showToast } from '$lib/toast';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	// #118: the button shows the form is sending; a second tap or Enter is ignored until the answer.
	const pending = createPending();

	// #117: the action's error also stays in the form (the toast goes after
	// 5s): under Email, or above the button.
	let errorText = $derived(form && 'error' in form && form.error ? form.error : '');
	let errorAt = $derived(
		!errorText
			? null
			: errorText === m.forgot_error_required() || errorText === m.forgot_error_student()
				? 'email'
				: 'form'
	);

	$effect(() => {
		if (data.expired && !form) showToast('error', m.forgot_error_expired());
	});
</script>

<svelte:head>
	<title>{m.forgot_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.forgot_heading()} subtitle={m.forgot_description()}>
	<!-- #129: stays on the page, as on resend-confirmation (a toast would be
	     gone before the mail arrives); the one announcement. The live region is
	     always there, empty, so the text added into it is announced. -->
	<div role="status">
		{#if form?.success}
			<p class="mb-4 rounded-lg border border-border bg-muted p-3">{m.forgot_success()}</p>
		{/if}
	</div>
	<form method="POST" use:enhance={pending.submit('forgot')} class={auth.form}>
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
			aria-busy={pending.is('forgot') || undefined}
		>
			{#if pending.is('forgot')}
				<LoaderCircle class="size-5 animate-spin" aria-hidden="true" />
			{/if}
			{m.forgot_submit()}
		</Button>
	</form>

	{#snippet footer()}
		<a href={resolve('/login')} class={auth.link}>{m.forgot_back_to_login()}</a>
	{/snippet}
</AuthCard>
