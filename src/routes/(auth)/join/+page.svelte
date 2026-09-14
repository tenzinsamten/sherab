<script lang="ts">
	import { enhance } from '$app/forms';
	import { createSupabaseBrowserClient } from '$lib/supabase/client';
	import * as m from '$lib/paraglide/messages.js';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let step = $state<1 | 2 | 3>(1);

	let classCode = $state('');
	let classCodeError = $state('');
	let checkingCode = $state(false);
	let resolvedClass = $state<{ id: string; name: string } | null>(null);

	let registrationName = $state('');
	let guardianConsent = $state(false);
	let submitting = $state(false);

	const supabase = createSupabaseBrowserClient();

	async function checkClassCode() {
		const code = classCode.trim();
		if (!code) {
			classCodeError = m.join_error_code_required();
			return;
		}

		checkingCode = true;
		classCodeError = '';
		const { data, error } = await supabase.rpc('validate_class_code', { p_code: code });
		checkingCode = false;

		if (error || !data || data.length === 0) {
			classCodeError = m.join_error_invalid_code();
			resolvedClass = null;
			return;
		}

		resolvedClass = data[0];
		step = 2;
	}

	function goToConsentStep() {
		if (!registrationName.trim()) return;
		step = 3;
	}

	function goBack() {
		if (step > 1) step = (step - 1) as 1 | 2;
	}
</script>

<svelte:head>
	<title>{m.join_heading()} — Sherab</title>
</svelte:head>

<div class="card" style="max-width: 480px; margin: var(--space-6) auto;">
	<p class="section-label">{m.join_section_label()}</p>
	<h1 style="font-size: var(--text-2xl); margin-top: 0;">{m.join_heading()}</h1>

	{#if form?.error}
		<p class="banner-error" role="alert">{form.error}</p>
	{/if}

	<ol
		style="list-style: none; padding: 0; margin: 0 0 var(--space-4) 0; display:flex; gap: var(--space-3);"
		aria-hidden="true"
	>
		<li style="opacity:{step === 1 ? 1 : 0.5}; font-weight:700;">01</li>
		<li style="opacity:{step === 2 ? 1 : 0.5}; font-weight:700;">02</li>
		<li style="opacity:{step === 3 ? 1 : 0.5}; font-weight:700;">03</li>
	</ol>

	{#if step === 1}
		<div class="field">
			<label for="classCode">{m.join_code_label()}</label>
			<input
				id="classCode"
				type="text"
				required
				autocomplete="off"
				aria-invalid={classCodeError ? 'true' : undefined}
				bind:value={classCode}
				oninput={() => {
					classCode = classCode.toUpperCase();
					classCodeError = '';
				}}
			/>
			{#if classCodeError}
				<p class="field-error">{classCodeError}</p>
			{/if}
		</div>
		<button class="btn" type="button" disabled={checkingCode} onclick={checkClassCode}>
			{checkingCode ? m.join_checking() : m.join_continue()}
		</button>
	{:else if step === 2 && resolvedClass}
		<p style="color: var(--color-muted-foreground);">
			{m.join_class_confirmed({ name: resolvedClass.name, code: classCode })}
		</p>
		<div class="field">
			<label for="registrationName">{m.join_name_label()}</label>
			<input
				id="registrationName"
				type="text"
				required
				autocomplete="name"
				bind:value={registrationName}
			/>
		</div>
		<p style="color: var(--color-muted-foreground); font-size: var(--text-sm);">
			{m.join_name_note()}
		</p>
		<div style="display:flex; gap: var(--space-2);">
			<button class="btn btn-outline" type="button" onclick={goBack}>{m.join_back()}</button>
			<button
				class="btn"
				type="button"
				disabled={!registrationName.trim()}
				onclick={goToConsentStep}
			>
				{m.join_continue()}
			</button>
		</div>
	{:else if step === 3 && resolvedClass}
		<form
			method="POST"
			action="?/register"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<input type="hidden" name="classId" value={resolvedClass.id} />
			<input type="hidden" name="className" value={resolvedClass.name} />
			<input type="hidden" name="classCode" value={classCode} />
			<input type="hidden" name="registrationName" value={registrationName} />

			<p style="color: var(--color-muted-foreground);">{m.join_consent_notice()}</p>
			<label style="display:flex; align-items:flex-start; gap: var(--space-2);">
				<input type="checkbox" name="guardianConsent" required bind:checked={guardianConsent} />
				<span>{m.join_consent_checkbox_label()}</span>
			</label>

			<div style="display:flex; gap: var(--space-2); margin-top: var(--space-4);">
				<button class="btn btn-outline" type="button" onclick={goBack}>{m.join_back()}</button>
				<button class="btn" type="submit" disabled={!guardianConsent || submitting}>
					{m.join_submit()}
				</button>
			</div>
		</form>
	{/if}
</div>
