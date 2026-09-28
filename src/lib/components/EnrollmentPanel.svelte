<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages.js';
	import { confirmAction, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import { ixFieldError } from '$lib/ix-fields';

	/**
	 * Class members (#42): add an existing approved student from another
	 * class, or remove one. Posts to the page's `?/enroll` and `?/unenroll`
	 * actions (src/lib/server/enrollments.ts). Used on the teacher class page
	 * and /admin/classes/[id]/students.
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

	// Success toasts for this panel's own actions; errors are toasted app-wide.
	let lastForm: unknown;
	$effect(() => {
		const form = page.form as { success?: boolean; action?: string } | null;
		if (!form || form === lastForm || !form.success) return;
		lastForm = form;
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

	{#if students.length > 0}
		<ul class="member-list">
			{#each students as student (student.id)}
				<li>
					<span>{student.displayName}</span>
					<ix-button
						variant="danger-tertiary"
						icon="trashcan"
						loading={pending.is(`unenroll:${student.id}`) || undefined}
						disabled={pending.busy || undefined}
						onclick={() => remove(student)}
					>
						{m.unenroll_button()}
					</ix-button>
				</li>
			{/each}
		</ul>
	{/if}

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
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) 0;
	}

	.member-list li + li {
		border-top: 1px solid var(--theme-color-soft-bdr);
	}
</style>
