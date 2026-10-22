<script lang="ts">
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { createSupabaseBrowserClient } from '$lib/supabase/client';
	import * as m from '$lib/paraglide/messages.js';
	import { localizeName } from '$lib/localized-name';
	import AuthCard, { auth } from '$lib/components/AuthCard.svelte';
	import JoinSteps from '$lib/components/JoinSteps.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { showToast } from '$lib/toast';
	import { ui } from '$lib/ui/classes';

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

		resolvedClass = localizeName(data[0]);
		step = 2;
	}

	function goToConsentStep() {
		if (!registrationName.trim()) return;
		step = 3;
	}

	function goBack() {
		if (step > 1) step = (step - 1) as 1 | 2;
	}

	// A finished step picked in the stepper: go back to it (the typed values
	// are kept in state) and move focus to that step's field, since the
	// picked step button is gone once it is the current step.
	const stepField: Record<1 | 2, string> = { 1: 'classCode', 2: 'registrationName' };
	async function goToStep(target: 1 | 2 | 3 | 4) {
		if (target >= step) return;
		step = target as 1 | 2;
		await tick();
		document.getElementById(stepField[step])?.focus();
	}

	// Upper-cased as typed, but not mid-composition (Android keyboards,
	// IMEs): rewriting the value then can drop or double characters, so the
	// composed text is upper-cased once it ends.
	function onClassCodeInput(event: Event & { currentTarget: HTMLInputElement }) {
		if (event instanceof InputEvent && event.isComposing) return;
		upperCaseClassCode(event.currentTarget);
	}

	function upperCaseClassCode(input: HTMLInputElement) {
		const upper = input.value.toUpperCase();
		if (input.value !== upper) {
			// Shown upper-cased as typed, the caret where it was.
			const { selectionStart, selectionEnd } = input;
			input.value = upper;
			input.setSelectionRange(selectionStart, selectionEnd);
		}
		classCode = upper;
		classCodeError = null;
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
		<!-- novalidate: checkClassCode checks the code and shows its error
		     under the field. The visible fields have no name: step 3's hidden
		     fields carry the values. -->
		<form
			novalidate
			class={auth.form}
			onsubmit={(event) => {
				event.preventDefault();
				checkClassCode();
			}}
		>
			<div class={auth.field}>
				<label for="classCode" class={auth.label}>{m.join_code_question()}</label>
				<Input
					id="classCode"
					required
					autocapitalize="characters"
					placeholder={m.join_code_placeholder()}
					value={classCode}
					autocomplete="off"
					spellcheck="false"
					oninput={onClassCodeInput}
					oncompositionend={(event) => upperCaseClassCode(event.currentTarget)}
					aria-invalid={classCodeError ? true : undefined}
					aria-describedby={classCodeError ? 'classCode-error' : undefined}
				/>
				{#if classCodeError}
					<p id="classCode-error" class={ui.error} role="alert">{classCodeError}</p>
				{/if}
			</div>
			<Button
				type="submit"
				class={auth.submit}
				disabled={checkingCode}
				aria-busy={checkingCode || undefined}
			>
				{#if checkingCode}
					<LoaderCircle class="size-5 animate-spin" aria-hidden="true" />
				{/if}
				{checkingCode ? m.join_checking() : m.join_continue()}
			</Button>
		</form>
	{:else if step === 2 && resolvedClass}
		<div class={auth.form}>
			<p>
				<Badge variant="success" class="px-3 py-1 text-sm"
					>{m.join_class_confirmed({ name: resolvedClass.name, code: classCode })}</Badge
				>
			</p>
			<div class={auth.field}>
				<label for="registrationName" class={auth.label}>{m.join_name_label()}</label>
				<Input id="registrationName" required autocomplete="off" bind:value={registrationName} />
				<p class="text-sm {ui.muted}">{m.join_name_note()}</p>
			</div>
			<div class="flex flex-col gap-2">
				<Button class={auth.submit} disabled={!registrationName.trim()} onclick={goToConsentStep}
					>{m.join_continue()}</Button
				>
				<Button variant="secondary" class="{ui.touch} w-full" onclick={goBack}
					>{m.join_back()}</Button
				>
			</div>
		</div>
	{:else if step === 3 && resolvedClass}
		<!-- novalidate: the server checks the email and consent, as before (no
		     browser validation bubbles). -->
		<form
			method="POST"
			action="?/register"
			novalidate
			class={auth.form}
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

			<div class={auth.field}>
				<label for="guardianEmail" class={auth.label}>{m.join_guardian_email_label()}</label>
				<Input
					id="guardianEmail"
					name="guardianEmail"
					type="email"
					required
					autocomplete="off"
					bind:value={guardianEmail}
				/>
				<p class="text-sm {ui.muted}">{m.join_guardian_email_note()}</p>
			</div>

			<p class="text-sm {ui.muted}">{m.join_consent_notice()}</p>
			<label
				for="guardianConsent"
				class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2 has-checked:border-primary has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-ring"
			>
				<input
					id="guardianConsent"
					type="checkbox"
					name="guardianConsent"
					required
					bind:checked={guardianConsent}
					class="size-5 shrink-0 accent-primary"
				/>
				<span class="min-w-0 wrap-break-word">{m.join_consent_checkbox_label()}</span>
			</label>

			<div class="flex flex-col gap-2">
				<Button
					type="submit"
					class={auth.submit}
					disabled={!guardianConsent || !guardianEmail.trim() || submitting}
					aria-busy={submitting || undefined}
				>
					{#if submitting}
						<LoaderCircle class="size-5 animate-spin" aria-hidden="true" />
					{/if}
					{m.join_submit()}
				</Button>
				<Button variant="secondary" class="{ui.touch} w-full" onclick={goBack}
					>{m.join_back()}</Button
				>
			</div>
		</form>
	{/if}
</AuthCard>
