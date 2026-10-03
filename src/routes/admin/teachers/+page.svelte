<script lang="ts">
	import { num } from '$lib/format';
	import { tick, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { confirmAction, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import CredentialFields from '$lib/components/CredentialFields.svelte';
	import { ixValue } from '$lib/ix-fields';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	type Teacher = (typeof data.teachers)[number];

	const pending = createPending();

	// ix-checkbox has no form-reset support, so the create form is re-mounted
	// (fresh, unchecked) after each successful create.
	let createKey = $state(0);
	let editingId = $state<string | null>(null);

	// B14b (#68): the email belongs to an approved parent-only login. Nothing
	// changed yet; on OK the same form (its values kept) is resubmitted with
	// promote=1, which makes that login a teacher too.
	let createForm: HTMLFormElement | undefined = $state();
	let promote = $state(false);

	async function confirmPromotion() {
		const okay = await confirmAction(
			m.common_confirm_title(),
			m.teachers_promote_confirm(),
			m.teachers_promote_submit(),
			m.common_cancel()
		);
		if (!okay) return;
		promote = true;
		await tick();
		createForm?.requestSubmit();
		promote = false;
	}

	$effect(() => {
		const result = form;
		if (!result) return;
		// Only `form` is a dependency: `createKey += 1` reads createKey too,
		// which would otherwise re-run this effect in a loop.
		untrack(() => {
			if ('promotable' in result && result.promotable) void confirmPromotion();
			if ('promoted' in result && result.promoted)
				showToast('success', m.teachers_promoted_success({ email: result.email ?? '' }));
			if ('success' in result && result.success) createKey += 1;
			if ('updated' in result && result.updated) {
				editingId = null;
				showToast('success', m.teachers_classes_updated({ name: result.updated }));
			}
			if ('removed' in result && result.removed)
				showToast(
					'success',
					'keptParent' in result && result.keptParent
						? m.teachers_removed_kept_parent({ name: result.removed })
						: m.teachers_removed_success({ name: result.removed })
				);
		});
	});

	let actionForm: HTMLFormElement | undefined = $state();
	let actionTarget = $state({ action: '', teacherId: '' });
	// Pending key for a row's reset/remove, shared by the hidden form and its button.
	const rowKey = (action: string, teacherId: string) => `${action}:${teacherId}`;

	function teacherName(t: Teacher) {
		return t.display_name ?? t.email;
	}

	async function runConfirmed(action: 'resetPassword' | 'remove', teacher: Teacher) {
		// B14b (#68): a teacher who is also a parent keeps the parent account.
		const message =
			action === 'remove'
				? teacher.alsoParent
					? m.teachers_remove_confirm_parent({ name: teacherName(teacher) })
					: m.teachers_remove_confirm({ name: teacherName(teacher) })
				: m.teachers_reset_confirm({ name: teacherName(teacher) });
		const okay = action === 'remove' ? m.teachers_remove() : m.teachers_reset_password();
		if (!(await confirmAction(m.common_confirm_title(), message, okay, m.common_cancel()))) return;
		actionTarget = { action, teacherId: teacher.id };
		await tick();
		actionForm?.requestSubmit();
	}

	let credential = $derived(
		form && 'tempPassword' in form && form.tempPassword
			? {
					message:
						'reset' in form && form.reset
							? m.teachers_reset_success({ email: form.email ?? '' })
							: m.teachers_created_success({ email: form.email ?? '' }),
					fields: [
						{ label: m.credential_email(), value: form.email ?? '' },
						{ label: m.teachers_credential_heading(), value: form.tempPassword }
					]
				}
			: null
	);
</script>

<svelte:head>
	<title>{m.teachers_heading()} — Sherab Admin</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.teachers_section_label()}</p>
			<h1 class="page-heading">{m.teachers_heading()}</h1>
		</div>
		<span class="page-counter">{num(data.teachers.length)}</span>
	</header>

	{#if credential}
		<!-- One-time credential: stays until dismissed, unlike a toast. -->
		<ix-message-bar type="success" persistent style="display:block; margin-bottom: var(--space-4);">
			<span>{credential.message}</span>
			<CredentialFields fields={credential.fields} />
		</ix-message-bar>
	{/if}

	<section class="card">
		<h2>{m.teachers_create_heading()}</h2>
		{#if data.classes.length === 0}
			<p class="muted">{m.teachers_need_class_first()}</p>
		{:else}
			{#key createKey}
				<form
					bind:this={createForm}
					method="POST"
					action="?/create"
					use:enhance={pending.submit('create')}
					class="form-narrow"
				>
					{#if promote}
						<input type="hidden" name="promote" value="1" />
					{/if}
					<!-- The new teacher's email, not a sign-in field: an iX field (#66). -->
					<div class="field">
						<ix-input
							id="email"
							name="email"
							type="email"
							label={m.teachers_email_label()}
							required
							{@attach ixValue(
								form && 'email' in form && !('success' in form) && !('reset' in form)
									? (form.email ?? '')
									: ''
							)}
						></ix-input>
					</div>
					<div class="field">
						<ix-input
							id="displayName"
							name="displayName"
							label={m.teachers_display_name_label()}
							{@attach ixValue(
								form && 'displayName' in form && !('success' in form)
									? (form.displayName ?? '')
									: ''
							)}
						></ix-input>
					</div>
					<fieldset>
						<legend>{m.teachers_assign_legend()}</legend>
						<div class="check-list">
							{#each data.classes as cls (cls.id)}
								<ix-checkbox
									name="classIds"
									value={cls.id}
									label={`${cls.name} (${cls.code})`}
									checked={Boolean(
										form &&
										'classIds' in form &&
										!('success' in form) &&
										form.classIds?.includes(cls.id)
									) || undefined}
								></ix-checkbox>
							{/each}
						</div>
					</fieldset>
					<ix-button
						type="submit"
						icon="add"
						loading={pending.is('create') || undefined}
						disabled={pending.busy || undefined}>{m.teachers_create_submit()}</ix-button
					>
				</form>
			{/key}
		{/if}
	</section>

	<section class="card">
		<h2>{m.teachers_all_heading()}</h2>
		{#if data.teachers.length === 0}
			<p class="muted">{m.teachers_empty()}</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>{m.teachers_col_name()}</th>
							<th>{m.teachers_col_email()}</th>
							<th>{m.teachers_col_classes()}</th>
							<th><span class="sr-only">{m.teachers_col_actions()}</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.teachers as teacher (teacher.id)}
							<tr>
								<td>
									{teacher.display_name ?? '—'}
									{#if teacher.alsoParent}
										<ix-pill variant="neutral" outline>{m.teachers_also_parent()}</ix-pill>
									{/if}
								</td>
								<td class="muted" style="overflow-wrap:anywhere;">{teacher.email}</td>
								<td>
									{#if teacher.classes.length === 0}
										<span class="muted">{m.teachers_none()}</span>
									{:else}
										{teacher.classes.map((c) => `${c.name} (${c.code})`).join(', ')}
									{/if}
								</td>
								<td>
									<div class="actions" style="justify-content:flex-end;">
										<ix-button
											variant="tertiary"
											icon="pen"
											disabled={pending.busy || undefined}
											onclick={() => (editingId = editingId === teacher.id ? null : teacher.id)}
										>
											{m.teachers_edit_classes()}
										</ix-button>
										<ix-button
											variant="tertiary"
											icon="key"
											loading={pending.is(rowKey('resetPassword', teacher.id)) || undefined}
											disabled={pending.busy || undefined}
											onclick={() => runConfirmed('resetPassword', teacher)}
										>
											{m.teachers_reset_password()}
										</ix-button>
										<ix-button
											variant="danger-tertiary"
											icon="trashcan"
											loading={pending.is(rowKey('remove', teacher.id)) || undefined}
											disabled={pending.busy || undefined}
											onclick={() => runConfirmed('remove', teacher)}
										>
											{m.teachers_remove()}
										</ix-button>
									</div>
								</td>
							</tr>
							{#if editingId === teacher.id}
								<tr>
									<td colspan="4">
										<form
											method="POST"
											action="?/updateClasses"
											use:enhance={pending.submit(rowKey('updateClasses', teacher.id))}
										>
											<input type="hidden" name="teacherId" value={teacher.id} />
											<fieldset>
												<legend
													>{m.teachers_edit_classes_title({ name: teacherName(teacher) })}</legend
												>
												<div class="check-list">
													{#each data.classes as cls (cls.id)}
														<ix-checkbox
															name="classIds"
															value={cls.id}
															label={`${cls.name} (${cls.code})`}
															checked={teacher.classes.some((c) => c.id === cls.id) || undefined}
														></ix-checkbox>
													{/each}
												</div>
											</fieldset>
											<div class="actions">
												<ix-button
													type="submit"
													loading={pending.is(rowKey('updateClasses', teacher.id)) || undefined}
													disabled={pending.busy || undefined}
													>{m.teachers_save_classes()}</ix-button
												>
												<ix-button
													variant="secondary"
													disabled={pending.busy || undefined}
													onclick={() => (editingId = null)}
												>
													{m.common_cancel()}
												</ix-button>
											</div>
										</form>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<form
		bind:this={actionForm}
		method="POST"
		action={`?/${actionTarget.action}`}
		use:enhance={pending.submit(() => rowKey(actionTarget.action, actionTarget.teacherId))}
		hidden
	>
		<input type="hidden" name="teacherId" value={actionTarget.teacherId} />
	</form>
</div>
