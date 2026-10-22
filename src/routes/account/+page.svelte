<script lang="ts">
	import { onMount } from 'svelte';
	import Bell from '@lucide/svelte/icons/bell';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { enhance } from '$app/forms';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/toast';
	import { createPending } from '$lib/pending.svelte';
	import { disablePush, enablePush, pushState, type PushState } from '$lib/push-client';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * My account: name, password, homework notifications and parent access.
	 * Mobile-first story 5: native fields with visible labels; a field's
	 * error also shows under it (the toast stays).
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

	let hydrated = $state(false);

	// Errors are shown by the root layout's form-error toast.
	$effect(() => {
		if (!form?.success) return;
		if (form.action === 'updateName') showToast('success', m.account_name_success());
		if (form.action === 'changePassword') showToast('success', m.account_password_success());
		if (form.action === 'requestParentAccess') showToast('success', m.account_parent_requested());
	});

	// The field an action's error belongs to, so it shows under that field too.
	let errorText = $derived(form && 'error' in form && form.error ? form.error : '');
	let fieldError = $derived.by((): Record<string, string> => {
		if (!errorText) return {};
		if (errorText === m.account_name_error_required()) return { displayName: errorText };
		if (errorText === m.account_password_error_current()) return { currentPassword: errorText };
		if (errorText === m.reset_error_length() || errorText === m.account_password_error_same())
			return { password: errorText };
		if (errorText === m.reset_error_mismatch()) return { confirm: errorText };
		return {};
	});
	const describedBy = (id: string) => (fieldError[id] ? `${id}-error` : undefined);

	// #92: homework notifications. The switch belongs to this browser (its
	// permission and subscription), so its state is read here, not loaded.
	let push = $state<PushState | null>(null);
	let pushBusy = $state(false);

	onMount(async () => {
		hydrated = true;
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

	const formClass = 'flex max-w-lg min-w-0 flex-col gap-4';
	const fieldClass = 'flex min-w-0 flex-col gap-1.5';
	const labelClass = 'text-sm font-medium';
	const submitClass = `${ui.touch} w-full sm:w-auto sm:self-start`;
</script>

<svelte:head>
	<title>{m.account_heading()} — Sherab</title>
</svelte:head>

{#snippet spinner(on: boolean)}
	{#if on}
		<LoaderCircle class="animate-spin" aria-hidden="true" />
	{/if}
{/snippet}

{#snippet error(id: string)}
	{#if fieldError[id]}
		<p id="{id}-error" class={ui.error} data-testid="field-error">{fieldError[id]}</p>
	{/if}
{/snippet}

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.account_section_label()}</p>
			<h1 class={ui.heading}>{m.account_heading()}</h1>
		</div>
	</header>

	<div class="grid min-w-0 grid-cols-1 gap-4 md:gap-6 xl:grid-cols-2">
		<section class={ui.card} aria-labelledby="name-heading">
			<h2 id="name-heading" class={ui.cardTitle}>{m.account_name_heading()}</h2>
			<form
				method="POST"
				action="?/updateName"
				use:enhance={pending.submit('name', { reset: false })}
				class={formClass}
			>
				<div class={fieldClass}>
					<label for="displayName" class={labelClass}>{m.account_name_label()}</label>
					<Input
						id="displayName"
						name="displayName"
						maxlength={80}
						required
						value={data.displayName}
						aria-invalid={fieldError.displayName ? 'true' : undefined}
						aria-describedby={describedBy('displayName')}
					/>
					{@render error('displayName')}
				</div>
				<!-- Display only (no name). -->
				{#if data.role === 'student'}
					<div class={fieldClass}>
						<label for="username" class={labelClass}>{m.account_username_label()}</label>
						<Input
							id="username"
							value={data.username ?? ''}
							readonly
							class="bg-muted"
							aria-describedby="username-note"
						/>
						<p id="username-note" class="text-sm {ui.muted}">{m.account_pin_note()}</p>
					</div>
				{:else}
					<div class={fieldClass}>
						<label for="email" class={labelClass}>{m.account_email_label()}</label>
						<Input id="email" value={data.email ?? ''} readonly class="bg-muted" />
					</div>
				{/if}
				<Button
					type="submit"
					class={submitClass}
					disabled={pending.busy}
					aria-busy={pending.is('name') || undefined}
				>
					{@render spinner(pending.is('name'))}
					{m.account_name_submit()}
				</Button>
			</form>
		</section>

		{#if data.role !== 'student'}
			<section class={ui.card} aria-labelledby="password-heading">
				<h2 id="password-heading" class={ui.cardTitle}>{m.account_password_heading()}</h2>
				<form
					method="POST"
					action="?/changePassword"
					use:enhance={pending.submit('password')}
					class={formClass}
				>
					<!-- Password fields stay native <input>s, so password managers fill
					     them (#66, B7b). -->
					<!-- Lets password managers match the change to the right account. -->
					<input type="hidden" name="username" autocomplete="username" value={data.email ?? ''} />
					<div class={fieldClass}>
						<label for="currentPassword" class={labelClass}
							>{m.account_current_password_label()}</label
						>
						<PasswordInput
							id="currentPassword"
							name="currentPassword"
							autocomplete="current-password"
							required
							aria-invalid={fieldError.currentPassword ? 'true' : undefined}
							aria-describedby={describedBy('currentPassword')}
						/>
						{@render error('currentPassword')}
					</div>
					<div class={fieldClass}>
						<label for="password" class={labelClass}>{m.reset_password_label()}</label>
						<PasswordInput
							id="password"
							name="password"
							autocomplete="new-password"
							minlength={6}
							required
							aria-invalid={fieldError.password ? 'true' : undefined}
							aria-describedby={describedBy('password')}
						/>
						{@render error('password')}
					</div>
					<div class={fieldClass}>
						<label for="confirm" class={labelClass}>{m.reset_confirm_label()}</label>
						<PasswordInput
							id="confirm"
							name="confirm"
							autocomplete="new-password"
							minlength={6}
							required
							aria-invalid={fieldError.confirm ? 'true' : undefined}
							aria-describedby={describedBy('confirm')}
						/>
						{@render error('confirm')}
					</div>
					<Button
						type="submit"
						class={submitClass}
						disabled={pending.busy}
						aria-busy={pending.is('password') || undefined}
					>
						{@render spinner(pending.is('password'))}
						{m.account_password_submit()}
					</Button>
				</form>
			</section>
		{/if}
		<!-- #92: students and approved parents, once the feature is set up. -->
		{#if data.pushKey}
			<section class="{ui.card} flex flex-col gap-3" aria-labelledby="push-heading">
				<h2 id="push-heading" class="text-lg leading-snug font-bold">
					{m.account_push_heading()}
				</h2>
				<p class={ui.muted}>
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
						<p><Badge variant="success">{m.account_push_status_on()}</Badge></p>
					{/if}
					<Button
						type="button"
						data-push-toggle={push}
						variant={push === 'on' ? 'outline' : 'default'}
						class={submitClass}
						disabled={pushBusy || pending.busy}
						aria-busy={pushBusy || undefined}
						onclick={() => void togglePush()}
					>
						{#if pushBusy}
							<LoaderCircle class="animate-spin" aria-hidden="true" />
						{:else if push === 'on'}
							<BellOff aria-hidden="true" />
						{:else}
							<Bell aria-hidden="true" />
						{/if}
						{push === 'on' ? m.account_push_disable() : m.account_push_enable()}
					</Button>
					<p class="text-sm {ui.muted}">{m.account_push_device_note()}</p>
				{/if}
			</section>
		{/if}
		<!-- B14a (#68): staff only. Parent shows in the role switcher once approved. -->
		{#if 'parentStatus' in data}
			<section class="{ui.card} flex flex-col gap-3" aria-labelledby="parent-access-heading">
				<h2 id="parent-access-heading" class="text-lg leading-snug font-bold">
					{m.account_parent_heading()}
				</h2>
				{#if data.parentStatus === 'approved'}
					<p class="wrap-anywhere">{m.account_parent_approved({ email: data.email ?? '' })}</p>
				{:else if data.parentStatus === 'pending'}
					<p><Badge variant="warning">{m.account_parent_pending()}</Badge></p>
				{:else if data.parentStatus === 'rejected'}
					<p class={ui.muted}>{m.account_parent_rejected()}</p>
				{:else}
					<p class={ui.muted}>{m.account_parent_intro()}</p>
					<form method="POST" action="?/requestParentAccess" use:enhance={pending.submit('parent')}>
						<Button
							type="submit"
							variant="outline"
							class={submitClass}
							disabled={pending.busy}
							aria-busy={pending.is('parent') || undefined}
						>
							{@render spinner(pending.is('parent'))}
							{m.account_parent_request()}
						</Button>
					</form>
				{/if}
			</section>
		{/if}
	</div>
</div>
