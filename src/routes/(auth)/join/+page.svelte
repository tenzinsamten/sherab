<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { createSupabaseBrowserClient } from '$lib/supabase/client';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import JoinSteps from '$lib/components/JoinSteps.svelte';
	import { showToast } from '$lib/ix';
	import { ixFieldError } from '$lib/ix-fields';

	let step = $state<1 | 2 | 3>(1);

	let classCode = $state('');
	// The code's error, shown under the field as well as in the toast.
	let classCodeError = $state<string | null>(null);
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
			showToast('error', classCodeError);
			return;
		}

		checkingCode = true;
		classCodeError = null;
		const { data, error } = await supabase.rpc('validate_class_code', { p_code: code });
		checkingCode = false;

		if (error || !data || data.length === 0) {
			classCodeError = m.join_error_invalid_code();
			showToast('error', classCodeError);
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

	// A finished step picked in the workflow steps: go back to it (the typed
	// values are kept in state) and move focus to that step's field, since
	// the steps are rebuilt and the picked one is gone.
	const stepField: Record<1 | 2, string> = { 1: 'classCode', 2: 'registrationName' };
	async function goToStep(target: 1 | 2 | 3 | 4) {
		if (target >= step) return;
		step = target as 1 | 2;
		await tick();
		const field = document.getElementById(stepField[step]) as
			| (HTMLElement & {
					componentOnReady?: () => Promise<unknown>;
					getNativeInputElement?: () => Promise<HTMLElement>;
			  })
			| null;
		if (!field) return;
		await customElements.whenDefined(field.localName);
		await field.componentOnReady?.();
		// The host doesn't pass focus on: focus iX's own input.
		const input = await field.getNativeInputElement?.().catch(() => null);
		(input ?? field).focus();
	}
</script>

<svelte:head>
	<title>{m.join_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.join_heading()}>
	<!-- Not while the code is checked or the form is sent: going back would
	     unmount the form mid-request. -->
	<JoinSteps current={step} onselect={checkingCode || submitting ? undefined : goToStep} />

	{#if step === 1}
		<!-- novalidate: checkClassCode checks the code, and iX's own validation
		     would replace the error's aria-describedby (see $lib/ix-fields). -->
		<form
			novalidate
			onsubmit={(event) => {
				event.preventDefault();
				checkClassCode();
			}}
		>
			<div class="field">
				<ix-input
					id="classCode"
					label={m.join_code_question()}
					required
					placeholder={m.join_code_placeholder()}
					value={classCode}
					onvalueChange={(event: CustomEvent<string>) => {
						classCode = event.detail.toUpperCase();
						classCodeError = null;
					}}
					{@attach ixFieldError(classCodeError ? 'classCode-error' : undefined)}
				></ix-input>
				{#if classCodeError}
					<p id="classCode-error" class="field-error" role="alert">{classCodeError}</p>
				{/if}
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
			<ix-input
				id="registrationName"
				label={m.join_name_label()}
				required
				value={registrationName}
				onvalueChange={(event: CustomEvent<string>) => (registrationName = event.detail)}
			></ix-input>
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
				<ix-input
					id="guardianEmail"
					name="guardianEmail"
					type="email"
					label={m.join_guardian_email_label()}
					required
					value={guardianEmail}
					onvalueChange={(event: CustomEvent<string>) => (guardianEmail = event.detail)}
				></ix-input>
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
