<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	// #89: a failed confirmation link, or a sign-in with an unconfirmed
	// email, offers a new link. The typed email goes along when there is one.
	let unconfirmed = $derived(Boolean(form && 'unconfirmed' in form && form.unconfirmed));
	let resendHref = $derived(
		resolve('/resend-confirmation') +
			(unconfirmed && form?.email?.includes('@') ? `?email=${encodeURIComponent(form.email)}` : '')
	);
</script>

<svelte:head>
	<title>{m.login_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.login_welcome_title()} subtitle={m.login_welcome_subtitle()}>
	{#if data.confirmLinkFailed && !form}
		<!-- In the card, not a toast: it stays readable and is gone after the
		     next sign-in attempt instead of stacking on its error (#89). -->
		<p class="field-error" role="alert">{m.login_error_confirm_link()}</p>
	{/if}
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
		{#if data.confirmLinkFailed || unconfirmed}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resendHref is resolve()d; only ?email= is added. -->
			<a href={resendHref}>{m.resend_heading()}</a>
		{/if}
		<a href={resolve('/forgot-password')}>{m.login_forgot_link()}</a>
		<a href={resolve('/register')}>{m.login_register_parent_link()}</a>
		<a href={resolve('/help')}>{m.help_link()}</a>
	{/snippet}
</AuthCard>
