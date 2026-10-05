<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages.js';
	import { confirmAction, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import { ixFieldError } from '$lib/ix-fields';
	import CredentialFields from './CredentialFields.svelte';

	/**
	 * Class members (#42): add an existing approved student from another
	 * class, or remove one. Posts to the page's `?/enroll` and `?/unenroll`
	 * actions (src/lib/server/enrollments.ts). Used on the teacher class page
	 * and /admin/classes/[id]/students.
	 * #88: "Reset PIN" per student posts to `?/resetPin`
	 * (src/lib/server/student-pin.ts); the new PIN shows once, above the list.
	 */
	let {
		className,
		students,
		enrollable
	}: {
		className: string;
		students: { id: string; displayName: string }[];
		enrollable: { id: string; displayName: string; username: string | null; classNames: string }[];
	} = $props();

	const pending = createPending();

	// Changes on each successful enrol, remounting the add form (see {#key}).
	let enrollKey = $state<unknown>(null);
	let studentMissing = $state(false);

	// <ix-select required> doesn't block a submit by itself: stop an empty
	// one here and show the select's invalid state instead of posting.
	const enrollSubmit = pending.submit('enroll');
	const submitEnroll: SubmitFunction = (input) => {
		if (!input.formData.get('studentId')) {
			input.cancel();
			studentMissing = true;
			return;
		}
		return enrollSubmit(input);
	};

	async function focusSelect() {
		await tick();
		const select = document.getElementById('enroll-student') as
			(HTMLElement & { componentOnReady?: () => Promise<unknown> }) | null;
		if (!select) return;
		// iX makes the host focusable only once it has loaded.
		await customElements.whenDefined('ix-select');
		await select.componentOnReady?.();
		select.focus();
	}

	let removeForm: HTMLFormElement | undefined = $state();
	let removeId = $state('');

	let pinForm: HTMLFormElement | undefined = $state();
	let pinId = $state('');
	let credentialBar: HTMLElement | undefined = $state();

	// #88: the one-time sign-in details of the last PIN reset. They live only
	// in this action result: the next action or a reload drops them.
	let credential = $derived.by(() => {
		const form = page.form as {
			success?: boolean;
			action?: string;
			studentName?: string;
			username?: string;
			pin?: string;
		} | null;
		if (!form?.success || form.action !== 'pinReset' || !form.username || !form.pin) return null;
		return {
			message: m.pin_reset_success({ name: form.studentName ?? form.username }),
			fields: [
				{ label: m.credential_username(), value: form.username },
				{ label: m.credential_pin(), value: form.pin }
			]
		};
	});

	/** The new PIN appears above the list, which may be off screen: scroll to it. */
	async function showCredential() {
		await tick();
		const bar = credentialBar as
			(HTMLElement & { componentOnReady?: () => Promise<unknown> }) | undefined;
		if (!bar) return;
		// The bar has no height until iX has loaded it.
		await customElements.whenDefined('ix-message-bar');
		await bar.componentOnReady?.();
		bar.scrollIntoView({ block: 'nearest' });
	}

	// Success toasts for this panel's own actions; errors are toasted app-wide.
	let lastForm: unknown;
	$effect(() => {
		const form = page.form as { success?: boolean; action?: string } | null;
		if (!form || form === lastForm || !form.success) return;
		lastForm = form;
		if (form.action === 'pinReset') showCredential();
		if (form.action === 'enrolled') {
			showToast('success', m.enroll_success());
			enrollKey = form;
			// The remount drops focus to <body>: put it on the new select.
			focusSelect();
		}
		if (form.action === 'unenrolled') showToast('success', m.unenroll_success());
	});

	async function remove(student: { id: string; displayName: string }) {
		const ok = await confirmAction(
			m.common_confirm_title(),
			m.unenroll_confirm({ name: student.displayName, className }),
			m.unenroll_button(),
			m.common_cancel()
		);
		if (!ok) return;
		removeId = student.id;
		await tick();
		removeForm?.requestSubmit();
	}

	async function resetPin(student: { id: string; displayName: string }) {
		const ok = await confirmAction(
			m.common_confirm_title(),
			m.pin_reset_confirm({ name: student.displayName }),
			m.pin_reset_button(),
			m.common_cancel()
		);
		if (!ok) return;
		pinId = student.id;
		await tick();
		pinForm?.requestSubmit();
	}

	function optionLabel(s: (typeof enrollable)[number]) {
		const who = s.username ? `${s.displayName} (${s.username})` : s.displayName;
		return s.classNames ? `${who} — ${s.classNames}` : who;
	}
</script>

<section class="card">
	<h2>{m.enroll_heading()}</h2>
	<p class="muted">{m.enroll_intro()}</p>

	{#if enrollable.length === 0}
		<p class="muted">{m.enroll_none_available()}</p>
	{:else}
		<!-- Remounted after each enrol: iX fields don't take part in form reset. -->
		{#key enrollKey}
			<form method="POST" action="?/enroll" use:enhance={submitEnroll} class="actions enroll-form">
				<div class="field">
					<ix-select
						id="enroll-student"
						name="studentId"
						label={m.enroll_student_label()}
						i18n-placeholder={m.enroll_student_placeholder()}
						required
						onvalueChange={() => (studentMissing = false)}
						{@attach ixFieldError(studentMissing ? 'enroll-student-error' : undefined)}
					>
						{#each enrollable as s (s.id)}
							<ix-select-item value={s.id} label={optionLabel(s)}></ix-select-item>
						{/each}
					</ix-select>
					{#if studentMissing}
						<p id="enroll-student-error" class="field-error" role="alert">
							{m.enroll_error_pick()}
						</p>
					{/if}
				</div>
				<ix-button
					type="submit"
					icon="add"
					loading={pending.is('enroll') || undefined}
					disabled={pending.busy || undefined}
				>
					{m.enroll_button()}
				</ix-button>
			</form>
		{/key}
	{/if}

	{#if credential}
		<!-- One-time credential (#88): stays until dismissed, unlike a toast. -->
		<ix-message-bar bind:this={credentialBar} type="success" persistent class="pin-credential">
			<span>{credential.message}</span>
			<CredentialFields fields={credential.fields} />
		</ix-message-bar>
	{/if}

	{#if students.length > 0}
		<ul class="member-list">
			{#each students as student (student.id)}
				<li>
					<span>{student.displayName}</span>
					<div class="member-actions">
						<ix-button
							variant="tertiary"
							icon="key"
							loading={pending.is(`resetPin:${student.id}`) || undefined}
							disabled={pending.busy || undefined}
							onclick={() => resetPin(student)}
						>
							{m.pin_reset_button()}
						</ix-button>
						<ix-button
							variant="danger-tertiary"
							icon="trashcan"
							loading={pending.is(`unenroll:${student.id}`) || undefined}
							disabled={pending.busy || undefined}
							onclick={() => remove(student)}
						>
							{m.unenroll_button()}
						</ix-button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<form
		bind:this={pinForm}
		method="POST"
		action="?/resetPin"
		use:enhance={pending.submit(() => `resetPin:${pinId}`)}
		hidden
	>
		<input type="hidden" name="studentId" value={pinId} />
	</form>

	<form
		bind:this={removeForm}
		method="POST"
		action="?/unenroll"
		use:enhance={pending.submit(() => `unenroll:${removeId}`)}
		hidden
	>
		<input type="hidden" name="studentId" value={removeId} />
	</form>
</section>

<style>
	.enroll-form {
		align-items: flex-end;
		flex-wrap: wrap;
	}

	.enroll-form .field {
		flex: 1 1 18rem;
		margin: 0;
	}

	.member-list {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
	}

	.member-list li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-1) var(--space-3);
		padding: var(--space-2) 0;
	}

	/* Wraps below the name on a phone, the buttons kept to the right. */
	.member-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-1) var(--space-2);
		margin-inline-start: auto;
	}

	.pin-credential {
		display: block;
		margin-top: var(--space-4);
	}

	/* Inside the card on a phone the label, value and copy button don't fit
	   on one line: let them wrap instead of running out of the bar. */
	.pin-credential :global(.copy-field) {
		flex-wrap: wrap;
	}

	.pin-credential :global(.credential) {
		overflow-wrap: anywhere;
	}

	.member-list li + li {
		border-top: 1px solid var(--theme-color-soft-bdr);
	}
</style>
