<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { confirmAction, showToast } from '$lib/ix';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	type Teacher = (typeof data.teachers)[number];

	// ix-checkbox has no form-reset support, so the create form is re-mounted
	// (fresh, unchecked) after each successful create.
	let createKey = $state(0);
	let editingId = $state<string | null>(null);

	$effect(() => {
		if (!form) return;
		if ('success' in form && form.success) createKey += 1;
		if ('updated' in form && form.updated) {
			editingId = null;
			showToast('success', m.teachers_classes_updated({ name: form.updated }));
		}
		if ('removed' in form && form.removed)
			showToast('success', m.teachers_removed_success({ name: form.removed }));
	});

	let actionForm: HTMLFormElement | undefined = $state();
	let actionTarget = $state({ action: '', teacherId: '' });

	function teacherName(t: Teacher) {
		return t.display_name ?? t.email;
	}

	async function runConfirmed(action: 'resetPassword' | 'remove', teacher: Teacher) {
		const message =
			action === 'remove'
				? m.teachers_remove_confirm({ name: teacherName(teacher) })
				: m.teachers_reset_confirm({ name: teacherName(teacher) });
		const okay = action === 'remove' ? m.teachers_remove() : m.teachers_reset_password();
		if (!(await confirmAction(m.common_confirm_title(), message, okay, m.common_cancel()))) return;
		actionTarget = { action: `?/${action}`, teacherId: teacher.id };
		await tick();
		actionForm?.requestSubmit();
	}

	let credential = $derived(
		form && 'tempPassword' in form && form.tempPassword
			? 'reset' in form && form.reset
				? m.teachers_reset_success({ email: form.email ?? '', password: form.tempPassword })
				: m.teachers_created_success({ email: form.email ?? '', password: form.tempPassword })
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
		<span class="page-counter">{data.teachers.length}</span>
	</header>

	{#if credential}
		<!-- One-time credential: stays until dismissed, unlike a toast. -->
		<ix-message-bar type="success" persistent style="display:block; margin-bottom: var(--space-4);">
			<strong>{m.teachers_credential_heading()}:</strong>
			<span class="credential">{credential}</span>
		</ix-message-bar>
	{/if}

	<section class="card">
		<h2>{m.teachers_create_heading()}</h2>
		{#if data.classes.length === 0}
			<p class="muted">{m.teachers_need_class_first()}</p>
		{:else}
			{#key createKey}
				<form method="POST" action="?/create" use:enhance class="form-narrow">
					<div class="field">
						<label for="email">{m.teachers_email_label()}</label>
						<input
							id="email"
							name="email"
							type="email"
							required
							value={form && 'email' in form && !('success' in form) && !('reset' in form)
								? (form.email ?? '')
								: ''}
						/>
					</div>
					<div class="field">
						<label for="displayName">{m.teachers_display_name_label()}</label>
						<input
							id="displayName"
							name="displayName"
							type="text"
							value={form && 'displayName' in form && !('success' in form)
								? (form.displayName ?? '')
								: ''}
						/>
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
					<ix-button type="submit" icon="add">{m.teachers_create_submit()}</ix-button>
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
								<td>{teacher.display_name ?? '—'}</td>
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
											onclick={() => (editingId = editingId === teacher.id ? null : teacher.id)}
										>
											{m.teachers_edit_classes()}
										</ix-button>
										<ix-button
											variant="tertiary"
											icon="key"
											onclick={() => runConfirmed('resetPassword', teacher)}
										>
											{m.teachers_reset_password()}
										</ix-button>
										<ix-button
											variant="danger-tertiary"
											icon="trashcan"
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
										<form method="POST" action="?/updateClasses" use:enhance>
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
												<ix-button type="submit">{m.teachers_save_classes()}</ix-button>
												<ix-button variant="secondary" onclick={() => (editingId = null)}>
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

	<form bind:this={actionForm} method="POST" action={actionTarget.action} use:enhance hidden>
		<input type="hidden" name="teacherId" value={actionTarget.teacherId} />
	</form>
</div>
