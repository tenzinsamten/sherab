<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let submitting = $state(false);
	let receiptEmail = $derived(form && 'success' in form && form.success ? form.email : null);
	let values = $derived(form && !('success' in form) ? form : null);
</script>

<svelte:head>
	<title>{m.register_heading()} — Sherab</title>
</svelte:head>

{#if receiptEmail}
	<AuthCard title={m.register_receipt_heading()}>
		<p>{m.register_receipt_body({ email: receiptEmail })}</p>
		<p class="muted">{m.register_receipt_no_mail()}</p>

		{#snippet footer()}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()d; only ?email= is added. -->
			<a href="{resolve('/resend-confirmation')}?email={encodeURIComponent(receiptEmail)}"
				>{m.resend_heading()}</a
			>
			<a href={resolve('/login')}>{m.forgot_back_to_login()}</a>
		{/snippet}
	</AuthCard>
{:else}
	<AuthCard title={m.register_heading()} subtitle={m.register_subtitle()}>
		<form
			method="POST"
			action="?/register"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update({ reset: false });
					submitting = false;
				};
			}}
		>
			<!-- Email and password below stay native <input>: <ix-input> forces
			     autocomplete="off", which would break password managers (#66, B7b). -->
			<div class="field">
				<ix-input
					id="displayName"
					name="displayName"
					label={m.register_name_label()}
					max-length="80"
					required
					value={values?.displayName ?? ''}
				></ix-input>
			</div>
			<div class="field">
				<label for="email">{m.register_email_label()}</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					value={values?.email ?? ''}
				/>
			</div>
			<div class="field">
				<label for="password">{m.register_password_label()}</label>
				<PasswordInput
					id="password"
					name="password"
					autocomplete="new-password"
					minlength={6}
					required
				/>
			</div>
			<div class="field">
				<label for="confirm">{m.register_confirm_label()}</label>
				<PasswordInput
					id="confirm"
					name="confirm"
					autocomplete="new-password"
					minlength={6}
					required
				/>
			</div>
			<ix-button
				class="block"
				type="submit"
				loading={submitting || undefined}
				disabled={submitting || undefined}>{m.register_submit()}</ix-button
			>
		</form>

		{#snippet footer()}
			<a href={resolve('/login')}>{m.register_have_account()}</a>
		{/snippet}
	</AuthCard>
{/if}
