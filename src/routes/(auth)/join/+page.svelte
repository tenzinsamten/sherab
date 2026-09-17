<script lang="ts">
	import { enhance } from '$app/forms';
	import { createSupabaseBrowserClient } from '$lib/supabase/client';
	import * as m from '$lib/paraglide/messages.js';
	import logoSeal from '$lib/assets/logo-seal-blue.png';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let step = $state<1 | 2 | 3>(1);

	let classCode = $state('');
	let classCodeError = $state('');
	let checkingCode = $state(false);
	let resolvedClass = $state<{ id: string; name: string } | null>(null);

	let registrationName = $state('');
	let guardianEmail = $state('');
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

<div class="split-screen">
	<div class="poster-panel poster-blue">
		<div>
			<p class="poster-eyebrow">{m.join_section_label()}</p>
			<h1 class="poster-hero">{m.join_heading()}</h1>
		</div>
		<p class="sr-only" aria-live="polite">{m.join_step_progress({ step: `${step}` })}</p>
		<ol
			style="list-style: none; padding: 0; margin: 0; display:flex; flex-direction:column;"
			class="poster-steps"
			aria-hidden="true"
		>
			<li class="poster-step" class:active={step === 1}>
				<span class="poster-step-num">01</span>
				<span>{m.join_code_label()}</span>
			</li>
			<li class="poster-step" class:active={step === 2}>
				<span class="poster-step-num">02</span>
				<span>{m.join_name_label()}</span>
			</li>
			<li class="poster-step" class:active={step === 3}>
				<span class="poster-step-num">03</span>
				<span>{m.join_consent_checkbox_label()}</span>
			</li>
		</ol>
	</div>
	<div class="form-panel">
		<div class="form-panel-inner">
			<img
				src={logoSeal}
				alt={m.nav_seal_aria_label()}
				width="144"
				height="144"
				style="display:block; margin: -80px auto var(--space-4);"
			/>

			{#if form?.error}
				<p class="banner-error" role="alert">{form.error}</p>
			{/if}

			{#if step === 1}
				<h2 style="font-size: var(--text-2xl); margin: 0 0 var(--space-4);">
					{m.join_code_question()}
				</h2>
				<div class="field">
					<label for="classCode">{m.join_code_label()}</label>
					<input
						id="classCode"
						type="text"
						required
						autocomplete="off"
						placeholder={m.join_code_placeholder()}
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
				<button
					class="btn"
					style="width:100%; justify-content:flex-start;"
					type="button"
					disabled={checkingCode}
					onclick={checkClassCode}
				>
					{checkingCode ? m.join_checking() : m.join_continue()}
				</button>
			{:else if step === 2 && resolvedClass}
				<p style="color: var(--color-primary); font-weight:700;">
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
				<div style="display:flex; gap: var(--space-2); margin-top: var(--space-4);">
					<button
						class="btn"
						style="flex:1; justify-content:flex-start;"
						type="button"
						disabled={!registrationName.trim()}
						onclick={goToConsentStep}
					>
						{m.join_continue()}
					</button>
					<button class="btn btn-outline" type="button" onclick={goBack}>{m.join_back()}</button>
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

					<div class="field">
						<label for="guardianEmail">{m.join_guardian_email_label()}</label>
						<input
							id="guardianEmail"
							name="guardianEmail"
							type="email"
							required
							autocomplete="email"
							bind:value={guardianEmail}
						/>
					</div>
					<p style="color: var(--color-muted-foreground); font-size: var(--text-sm);">
						{m.join_guardian_email_note()}
					</p>

					<p id="joinConsentNotice" style="color: var(--color-muted-foreground);">
						{m.join_consent_notice()}
					</p>
					<label class="check-row" class:checked={guardianConsent}>
						<input
							type="checkbox"
							name="guardianConsent"
							required
							aria-describedby="joinConsentNotice"
							bind:checked={guardianConsent}
						/>
						<span class="check-glyph" aria-hidden="true">{guardianConsent ? '✓' : ''}</span>
						<span>{m.join_consent_checkbox_label()}</span>
					</label>

					<div style="display:flex; gap: var(--space-2); margin-top: var(--space-4);">
						<button
							class="btn"
							style="flex:1; justify-content:flex-start;"
							type="submit"
							disabled={!guardianConsent || !guardianEmail.trim() || submitting}
						>
							{m.join_submit()}
						</button>
						<button class="btn btn-outline" type="button" onclick={goBack}>{m.join_back()}</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
</div>
