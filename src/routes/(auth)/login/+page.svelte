<script lang="ts">
	import LogIn from '@lucide/svelte/icons/log-in';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard, { auth } from '$lib/components/AuthCard.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ui } from '$lib/ui/classes';
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
		<p class="mb-4 {ui.error}" role="alert">{m.login_error_confirm_link()}</p>
	{/if}
	<form method="POST" use:enhance class={auth.form}>
		<div class={auth.field}>
			<label for="email" class={auth.label}>{m.login_email_label()}</label>
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
		<div class={auth.field}>
			<label for="password" class={auth.label}>{m.login_password_label()}</label>
			<PasswordInput
				id="password"
				name="password"
				autocomplete="current-password"
				placeholder={m.login_password_placeholder()}
				required
			/>
		</div>
		<Button type="submit" class={auth.submit}>
			<LogIn class="size-5" aria-hidden="true" />
			{m.login_submit()}
		</Button>
	</form>

	{#snippet footer()}
		{#if data.confirmLinkFailed || unconfirmed}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resendHref is resolve()d; only ?email= is added. -->
			<a href={resendHref} class={auth.link}>{m.resend_heading()}</a>
		{/if}
		<a href={resolve('/forgot-password')} class={auth.link}>{m.login_forgot_link()}</a>
		<a href={resolve('/register')} class={auth.link}>{m.login_register_parent_link()}</a>
		<a href={resolve('/help')} class={auth.link}>{m.help_link()}</a>
	{/snippet}
</AuthCard>
