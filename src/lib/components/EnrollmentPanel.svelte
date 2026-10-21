<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import { createConfirm } from '$lib/confirm.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import { createPending } from '$lib/pending.svelte';
	import { ui } from '$lib/ui/classes';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import CredentialFields from './CredentialFields.svelte';

	/**
	 * Class members (#42): add an existing approved student from another
	 * class, or remove one. Posts to the page's `?/enroll` and `?/unenroll`
	 * actions (src/lib/server/enrollments.ts). Used on the teacher class page
	 * and /admin/classes/[id]/students.
	 * #88: "Reset PIN" per student posts to `?/resetPin`
	 * (src/lib/server/student-pin.ts); the new PIN shows once, above the list.
	 * Mobile-first story 8: its own `data-ui="new"` root (the admin page is
	 * still iX), a native select, the new question dialog and an outcome box
	 * for the PIN.
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
	const confirm = createConfirm();

	// The picked student. Emptied after an enrol: the enrolled student's
	// option is gone, and a bound select whose value has no option shows blank.
	let studentId = $state('');
	let studentMissing = $state(false);

	// The form is novalidate: stop an empty submit here and show the message
	// under the select instead of posting.
	const enrollSubmit = pending.submit('enroll');
	const submitEnroll: SubmitFunction = (input) => {
		if (!input.formData.get('studentId')) {
			input.cancel();
			studentMissing = true;
			return;
		}
		return enrollSubmit(input);
	};

	let heading: HTMLElement | undefined = $state();

	/** The select, or the heading when the last enrollable student was just added (the form is gone). */
	async function focusSelect() {
		await tick();
		(document.getElementById('enroll-student') ?? heading)?.focus();
	}

	let removeForm: HTMLFormElement | undefined = $state();
	let removeId = $state('');

	let pinForm: HTMLFormElement | undefined = $state();
	let pinId = $state('');
	let outcomeBox: HTMLElement | undefined = $state();

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
		outcomeBox?.scrollIntoView({ block: 'nearest' });
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
			studentId = '';
			// The pressed button was disabled while posting: put focus on the select.
			focusSelect();
		}
		if (form.action === 'unenrolled') showToast('success', m.unenroll_success());
	});

	async function remove(student: { id: string; displayName: string }) {
		if (pending.busy) return;
		const ok = await confirm.ask(
			m.unenroll_confirm({ name: student.displayName, className }),
			m.unenroll_button(),
			{ destructive: true }
		);
		if (!ok) return;
		removeId = student.id;
		await tick();
		removeForm?.requestSubmit();
	}

	async function resetPin(student: { id: string; displayName: string }) {
		if (pending.busy) return;
		const ok = await confirm.ask(
			m.pin_reset_confirm({ name: student.displayName }),
			m.pin_reset_button()
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

	const memberButton = `${ui.touch} min-w-0 flex-1 gap-2 sm:flex-none`;
</script>

<div data-ui="new" class="min-w-0">
	<section class="{ui.card} flex flex-col gap-3">
		<div>
			<h2 bind:this={heading} tabindex="-1" class="{ui.cardTitle} outline-none">
				{m.enroll_heading()}
			</h2>
			<p class={ui.muted}>{m.enroll_intro()}</p>
		</div>

		{#if enrollable.length === 0}
			<p class={ui.muted}>{m.enroll_none_available()}</p>
		{:else}
			<form
				method="POST"
				action="?/enroll"
				novalidate
				use:enhance={submitEnroll}
				class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start"
			>
				<div class="flex min-w-0 flex-col gap-1.5 sm:flex-1">
					<Label for="enroll-student">{m.enroll_student_label()}</Label>
					<NativeSelect.Root
						id="enroll-student"
						name="studentId"
						class="w-full"
						required
						bind:value={studentId}
						aria-invalid={studentMissing ? 'true' : undefined}
						aria-describedby={studentMissing ? 'enroll-student-error' : undefined}
						onchange={() => (studentMissing = false)}
					>
						<NativeSelect.Option value="">{m.enroll_student_placeholder()}</NativeSelect.Option>
						{#each enrollable as s (s.id)}
							<NativeSelect.Option value={s.id}>{optionLabel(s)}</NativeSelect.Option>
						{/each}
					</NativeSelect.Root>
					{#if studentMissing}
						<p id="enroll-student-error" class={ui.error} role="alert">
							{m.enroll_error_pick()}
						</p>
					{/if}
				</div>
				<!-- Level with the select, which sits under its label. -->
				<Button
					type="submit"
					class="{ui.touch} w-full gap-2 sm:mt-6.5 sm:w-auto"
					aria-busy={pending.is('enroll') || undefined}
					disabled={pending.busy}
				>
					{#if pending.is('enroll')}
						<LoaderCircle class="animate-spin" aria-hidden="true" />
					{:else}
						<Plus aria-hidden="true" />
					{/if}
					{m.enroll_button()}
				</Button>
			</form>
		{/if}

		{#if credential}
			<!-- One-time credential (#88): stays until the next action or a reload, unlike a toast. -->
			<div
				bind:this={outcomeBox}
				role="status"
				data-testid="pin-credential"
				class="flex min-w-0 flex-col gap-2 rounded-lg border border-success bg-success/10 p-4"
			>
				<p class="wrap-break-word">{credential.message}</p>
				<CredentialFields fields={credential.fields} />
			</div>
		{/if}

		{#if students.length > 0}
			<ul class={ui.rows} data-testid="member-list">
				{#each students as student (student.id)}
					<li class="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2">
						<span class="min-w-0 wrap-break-word">{student.displayName}</span>
						<!-- Wraps below the name on a phone. -->
						<div class="flex min-w-0 flex-wrap gap-2 max-sm:w-full sm:ms-auto">
							<Button
								variant="outline"
								class={memberButton}
								aria-busy={pending.is(`resetPin:${student.id}`) || undefined}
								disabled={pending.busy}
								onclick={() => resetPin(student)}
							>
								{#if pending.is(`resetPin:${student.id}`)}
									<LoaderCircle class="animate-spin" aria-hidden="true" />
								{:else}
									<KeyRound aria-hidden="true" />
								{/if}
								{m.pin_reset_button()}
							</Button>
							<Button
								variant="destructive"
								class={memberButton}
								aria-busy={pending.is(`unenroll:${student.id}`) || undefined}
								disabled={pending.busy}
								onclick={() => remove(student)}
							>
								{#if pending.is(`unenroll:${student.id}`)}
									<LoaderCircle class="animate-spin" aria-hidden="true" />
								{:else}
									<Trash2 aria-hidden="true" />
								{/if}
								{m.unenroll_button()}
							</Button>
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
</div>

<ConfirmDialog {confirm} />
