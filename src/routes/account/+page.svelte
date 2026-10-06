<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import { disablePush, enablePush, pushState, type PushState } from '$lib/push-client';
	import { ixValue } from '$lib/ix-fields';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

	// Errors are shown by the root layout's form-error toast.
	$effect(() => {
		if (!form?.success) return;
		if (form.action === 'updateName') showToast('success', m.account_name_success());
		if (form.action === 'changePassword') showToast('success', m.account_password_success());
		if (form.action === 'requestParentAccess') showToast('success', m.account_parent_requested());
	});

	// #92: homework notifications. The switch belongs to this browser (its
	// permission and subscription), so its state is read here, not loaded.
	let push = $state<PushState | null>(null);
	let pushBusy = $state(false);

	onMount(async () => {
		if (data.pushKey) push = await pushState();
	});

	async function togglePush() {
		if (!data.pushKey || pushBusy) return;
		pushBusy = true;
		try {
			if (push === 'on') {
				push = await disablePush();
				showToast('success', m.account_push_disabled());
			} else {
				// 'denied' or still 'off' (the question was dismissed) say so below.
				push = await enablePush(data.pushKey);
				if (push === 'on') showToast('success', m.account_push_enabled());
			}
		} catch {
			showToast('error', m.account_push_error());
			push = await pushState().catch(() => push);
		} finally {
			pushBusy = false;
		}
	}
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
				<ix-input
					id="displayName"
					name="displayName"
					label={m.account_name_label()}
					max-length="80"
					required
					{@attach ixValue(data.displayName)}
				></ix-input>
			</div>
			<!-- Display only (no name). -->
			{#if data.role === 'student'}
				<div class="field">
					<ix-input
						id="username"
						label={m.account_username_label()}
						value={data.username ?? ''}
						readonly
					></ix-input>
					<p class="muted field-note">{m.account_pin_note()}</p>
				</div>
			{:else}
				<div class="field">
					<ix-input id="email" label={m.account_email_label()} value={data.email ?? ''} readonly
					></ix-input>
				</div>
			{/if}
			<ix-button
				type="submit"
				loading={pending.is('name') || undefined}
				disabled={pending.busy || undefined}>{m.account_name_submit()}</ix-button
			>
		</form>
	</section>

	{#if data.role !== 'student'}
		<section class="card">
			<h2>{m.account_password_heading()}</h2>
			<form
				method="POST"
				action="?/changePassword"
				use:enhance={pending.submit('password')}
				class="form-narrow"
			>
				<!-- Password fields stay native <input>: <ix-input> forces autocomplete="off",
				     which would break password managers (#66, B7b). -->
				<!-- Lets password managers match the change to the right account. -->
				<input type="hidden" name="username" autocomplete="username" value={data.email ?? ''} />
				<div class="field">
					<label for="currentPassword">{m.account_current_password_label()}</label>
					<PasswordInput
						id="currentPassword"
						name="currentPassword"
						autocomplete="current-password"
						required
					/>
				</div>
				<div class="field">
					<label for="password">{m.reset_password_label()}</label>
					<PasswordInput
						id="password"
						name="password"
						autocomplete="new-password"
						minlength={6}
						required
					/>
				</div>
				<div class="field">
					<label for="confirm">{m.reset_confirm_label()}</label>
					<PasswordInput
						id="confirm"
						name="confirm"
						autocomplete="new-password"
						minlength={6}
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
	{/if}
	<!-- #92: students and approved parents, once the feature is set up. -->
	{#if data.pushKey}
		<section class="card" aria-labelledby="push-heading">
			<h2 id="push-heading">{m.account_push_heading()}</h2>
			<p class="muted">
				{data.role === 'student' ? m.account_push_intro_student() : m.account_push_intro_parent()}
			</p>
			{#if push === 'needs-install'}
				<p>{m.account_push_needs_install()}</p>
			{:else if push === 'unsupported'}
				<p>{m.account_push_unsupported()}</p>
			{:else if push === 'denied'}
				<p>{m.account_push_denied()}</p>
			{:else if push}
				{#if push === 'on'}
					<p><ix-pill variant="success">{m.account_push_status_on()}</ix-pill></p>
				{/if}
				<ix-button
					type="button"
					data-push-toggle={push}
					variant={push === 'on' ? 'secondary' : undefined}
					loading={pushBusy || undefined}
					disabled={pushBusy || pending.busy || undefined}
					onclick={() => void togglePush()}
					>{push === 'on' ? m.account_push_disable() : m.account_push_enable()}</ix-button
				>
				<p class="muted field-note">{m.account_push_device_note()}</p>
			{/if}
		</section>
	{/if}
	<!-- B14a (#68): staff only. Parent shows in the role switcher once approved. -->
	{#if 'parentStatus' in data}
		<section class="card" aria-labelledby="parent-access-heading">
			<h2 id="parent-access-heading">{m.account_parent_heading()}</h2>
			{#if data.parentStatus === 'approved'}
				<p>{m.account_parent_approved({ email: data.email ?? '' })}</p>
			{:else if data.parentStatus === 'pending'}
				<p><ix-pill variant="warning">{m.account_parent_pending()}</ix-pill></p>
			{:else if data.parentStatus === 'rejected'}
				<p class="muted">{m.account_parent_rejected()}</p>
			{:else}
				<p class="muted">{m.account_parent_intro()}</p>
				<form method="POST" action="?/requestParentAccess" use:enhance={pending.submit('parent')}>
					<ix-button
						type="submit"
						variant="secondary"
						loading={pending.is('parent') || undefined}
						disabled={pending.busy || undefined}>{m.account_parent_request()}</ix-button
					>
				</form>
			{/if}
		</section>
	{/if}
</div>

<style>
	.field-note {
		margin: var(--space-1) 0 0;
	}
</style>
