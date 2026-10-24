<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard, { auth } from '$lib/components/AuthCard.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ui } from '$lib/ui/classes';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	// #117: the action's error also stays in the form (the toast goes after
	// 5s): under its field, or above the button.
	let errorText = $derived(form?.error ?? '');
	let errorAt = $derived.by((): string | null => {
		if (!errorText) return null;
		if (errorText === m.reset_error_length()) return 'password';
		if (errorText === m.reset_error_mismatch()) return 'confirm';
		return 'form';
	});
	const invalid = (id: string) => (errorAt === id ? 'true' : undefined);
	const describedBy = (id: string) => (errorAt === id ? `${id}-error` : undefined);
</script>

<svelte:head>
	<title>{m.reset_heading()} — Sherab</title>
</svelte:head>

{#snippet error(at: string)}
	{#if errorAt === at}
		<p id="{at}-error" class={ui.error}>{errorText}</p>
	{/if}
{/snippet}

<AuthCard title={m.reset_heading()}>
	<form method="POST" use:enhance class={auth.form}>
		<div class={auth.field}>
			<label for="password" class={auth.label}>{m.reset_password_label()}</label>
			<PasswordInput
				id="password"
				name="password"
				autocomplete="new-password"
				minlength={6}
				required
				aria-invalid={invalid('password')}
				aria-describedby={describedBy('password')}
			/>
			{@render error('password')}
		</div>
		<div class={auth.field}>
			<label for="confirm" class={auth.label}>{m.reset_confirm_label()}</label>
			<PasswordInput
				id="confirm"
				name="confirm"
				autocomplete="new-password"
				minlength={6}
				required
				aria-invalid={invalid('confirm')}
				aria-describedby={describedBy('confirm')}
			/>
			{@render error('confirm')}
		</div>
		{@render error('form')}
		<Button type="submit" class={auth.submit}>{m.reset_submit()}</Button>
	</form>
</AuthCard>
