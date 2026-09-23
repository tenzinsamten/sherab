<script lang="ts">
	import { enhance } from '$app/forms';
	import { createSupabaseBrowserClient } from '$lib/supabase/client';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import { showToast } from '$lib/ix';

	let step = $state<1 | 2 | 3>(1);

	let classCode = $state('');
	let classCodeInvalid = $state(false);
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
			classCodeInvalid = true;
			showToast('error', m.join_error_code_required());
			return;
		}

		checkingCode = true;
		classCodeInvalid = false;
		const { data, error } = await supabase.rpc('validate_class_code', { p_code: code });
		checkingCode = false;

		if (error || !data || data.length === 0) {
			classCodeInvalid = true;
			showToast('error', m.join_error_invalid_code());
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

	const steps = [m.join_code_label(), m.join_name_label(), m.join_consent_checkbox_label()];
</script>

<svelte:head>
	<title>{m.join_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.join_heading()}>
	<p class="sr-only" aria-live="polite">{m.join_step_progress({ step: `${step}` })}</p>
	<ol class="join-steps" aria-hidden="true">
		{#each steps as label, i (i)}
			<li class:active={step === i + 1} class:done={step > i + 1}>{i + 1}. {label}</li>
		{/each}
	</ol>

	{#if step === 1}
		<form
			onsubmit={(event) => {
				event.preventDefault();
				checkClassCode();
			}}
		>
			<div class="field">
				<label for="classCode">{m.join_code_question()}</label>
				<input
					id="classCode"
					type="text"
					required
					autocomplete="off"
					placeholder={m.join_code_placeholder()}
					aria-invalid={classCodeInvalid ? 'true' : undefined}
					bind:value={classCode}
					oninput={() => {
						classCode = classCode.toUpperCase();
						classCodeInvalid = false;
					}}
				/>
			</div>
			<ix-button
				class="block"
				type="submit"
				loading={checkingCode || undefined}
				disabled={checkingCode || undefined}
			>
				{checkingCode ? m.join_checking() : m.join_continue()}
			</ix-button>
		</form>
	{:else if step === 2 && resolvedClass}
		<p>
			<ix-pill variant="success"
				>{m.join_class_confirmed({ name: resolvedClass.name, code: classCode })}</ix-pill
			>
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
		<p class="muted">{m.join_name_note()}</p>
		<div class="actions">
			<ix-button disabled={!registrationName.trim() || undefined} onclick={goToConsentStep}
				>{m.join_continue()}</ix-button
			>
			<ix-button variant="secondary" onclick={goBack}>{m.join_back()}</ix-button>
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
			<p class="muted">{m.join_guardian_email_note()}</p>

			<p class="muted">{m.join_consent_notice()}</p>
			<div class="check-list" style="margin-bottom: var(--space-4);">
				<ix-checkbox
					name="guardianConsent"
					required
					label={m.join_consent_checkbox_label()}
					checked={guardianConsent || undefined}
					oncheckedChange={(event: CustomEvent<boolean>) => (guardianConsent = event.detail)}
				></ix-checkbox>
			</div>

			<div class="actions">
				<ix-button
					type="submit"
					loading={submitting || undefined}
					disabled={!guardianConsent || !guardianEmail.trim() || submitting || undefined}
				>
					{m.join_submit()}
				</ix-button>
				<ix-button variant="secondary" onclick={goBack}>{m.join_back()}</ix-button>
			</div>
		</form>
	{/if}
</AuthCard>
