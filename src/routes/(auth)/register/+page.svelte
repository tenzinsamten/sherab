<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
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

		{#snippet footer()}
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
			<div class="field">
				<label for="displayName">{m.register_name_label()}</label>
				<input
					id="displayName"
					name="displayName"
					type="text"
					autocomplete="name"
					maxlength="80"
					required
					value={values?.displayName ?? ''}
				/>
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
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					minlength="6"
					required
				/>
			</div>
			<div class="field">
				<label for="confirm">{m.register_confirm_label()}</label>
				<input
					id="confirm"
					name="confirm"
					type="password"
					autocomplete="new-password"
					minlength="6"
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
