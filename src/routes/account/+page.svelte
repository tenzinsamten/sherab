<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

	// Errors are shown by the root layout's form-error toast.
	$effect(() => {
		if (!form?.success) return;
		if (form.action === 'updateName') showToast('success', m.account_name_success());
		if (form.action === 'changePassword') showToast('success', m.account_password_success());
	});
</script>

<svelte:head>
	<title>{m.account_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.account_section_label()}</p>
			<h1 class="page-heading">{m.account_heading()}</h1>
		</div>
	</header>

	<section class="card">
		<h2>{m.account_name_heading()}</h2>
		<form
			method="POST"
			action="?/updateName"
			use:enhance={pending.submit('name')}
			class="form-narrow"
		>
			<div class="field">
				<label for="displayName">{m.account_name_label()}</label>
				<input
					id="displayName"
					name="displayName"
					type="text"
					autocomplete="name"
					maxlength="80"
					required
					value={data.displayName}
				/>
			</div>
			<div class="field">
				<label for="email">{m.account_email_label()}</label>
				<input id="email" type="email" value={data.email ?? ''} readonly />
			</div>
			<ix-button
				type="submit"
				loading={pending.is('name') || undefined}
				disabled={pending.busy || undefined}>{m.account_name_submit()}</ix-button
			>
		</form>
	</section>

	<section class="card">
		<h2>{m.account_password_heading()}</h2>
		<form
			method="POST"
			action="?/changePassword"
			use:enhance={pending.submit('password')}
			class="form-narrow"
		>
			<!-- Lets password managers match the change to the right account. -->
			<input type="hidden" name="username" autocomplete="username" value={data.email ?? ''} />
			<div class="field">
				<label for="currentPassword">{m.account_current_password_label()}</label>
				<input
					id="currentPassword"
					name="currentPassword"
					type="password"
					autocomplete="current-password"
					required
				/>
			</div>
			<div class="field">
				<label for="password">{m.reset_password_label()}</label>
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
				<label for="confirm">{m.reset_confirm_label()}</label>
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
				type="submit"
				loading={pending.is('password') || undefined}
				disabled={pending.busy || undefined}>{m.account_password_submit()}</ix-button
			>
		</form>
	</section>
</div>
