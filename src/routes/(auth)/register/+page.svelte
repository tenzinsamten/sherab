<script lang="ts">
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard, { auth } from '$lib/components/AuthCard.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ui } from '$lib/ui/classes';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let submitting = $state(false);
	let receiptEmail = $derived(form && 'success' in form && form.success ? form.email : null);
	let values = $derived(form && !('success' in form) ? form : null);

	// #117: a failed submit's error also stays in the form (the toast goes
	// after 5s): under its field, or above the button.
	let errorText = $derived(values?.error ?? '');
	let errorAt = $derived.by((): string | null => {
		if (!errorText) return null;
		if (errorText === m.register_error_exists()) return 'email';
		if (errorText === m.reset_error_length()) return 'password';
		if (errorText === m.reset_error_mismatch()) return 'confirm';
		return 'form';
	});
	const invalid = (id: string) => (errorAt === id ? 'true' : undefined);
	const describedBy = (id: string) => (errorAt === id ? `${id}-error` : undefined);
</script>

<svelte:head>
	<title>{m.register_heading()} — Sherab</title>
</svelte:head>

{#snippet error(at: string)}
	{#if errorAt === at}
		<p id="{at}-error" class={ui.error}>{errorText}</p>
	{/if}
{/snippet}

{#if receiptEmail}
	<AuthCard title={m.register_receipt_heading()}>
		<div class="flex flex-col gap-3">
			<p>{m.register_receipt_body({ email: receiptEmail })}</p>
			<p class={ui.muted}>{m.register_receipt_no_mail()}</p>
		</div>

		{#snippet footer()}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()d; only ?email= is added. -->
			<a
				href="{resolve('/resend-confirmation')}?email={encodeURIComponent(receiptEmail)}"
				class={auth.link}>{m.resend_heading()}</a
			>
			<a href={resolve('/login')} class={auth.link}>{m.forgot_back_to_login()}</a>
		{/snippet}
	</AuthCard>
{:else}
	<AuthCard title={m.register_heading()} subtitle={m.register_subtitle()}>
		<form
			method="POST"
			action="?/register"
			class={auth.form}
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update({ reset: false });
					submitting = false;
				};
			}}
		>
			<!-- Native fields (mobile-first story 6), so password managers fill
			     email and passwords and offer a strong one (#66, B7b). -->
			<div class={auth.field}>
				<label for="displayName" class={auth.label}>{m.register_name_label()}</label>
				<Input
					id="displayName"
					name="displayName"
					maxlength={80}
					required
					value={values?.displayName ?? ''}
				/>
			</div>
			<div class={auth.field}>
				<label for="email" class={auth.label}>{m.register_email_label()}</label>
				<Input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					value={values?.email ?? ''}
					aria-invalid={invalid('email')}
					aria-describedby={describedBy('email')}
				/>
				{@render error('email')}
			</div>
			<div class={auth.field}>
				<label for="password" class={auth.label}>{m.register_password_label()}</label>
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
				<label for="confirm" class={auth.label}>{m.register_confirm_label()}</label>
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
			<Button
				type="submit"
				class={auth.submit}
				disabled={submitting}
				aria-busy={submitting || undefined}
			>
				{#if submitting}
					<LoaderCircle class="size-5 animate-spin" aria-hidden="true" />
				{/if}
				{m.register_submit()}
			</Button>
		</form>

		{#snippet footer()}
			<a href={resolve('/login')} class={auth.link}>{m.register_have_account()}</a>
		{/snippet}
	</AuthCard>
{/if}
