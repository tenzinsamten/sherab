<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { formatInstant, num } from '$lib/format';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import CopyField from '$lib/components/CopyField.svelte';
	import { confirmAction, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import ScheduleFields from '$lib/components/ScheduleFields.svelte';
	import LocalizedNameFields from '$lib/components/LocalizedNameFields.svelte';
	import { otherNames } from '$lib/localized-name';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	type ClassRow = (typeof data.classes)[number];

	const pending = createPending();

	// #76: the class whose names are being edited (one row at a time).
	let editingId = $state<string | null>(null);

	$effect(() => {
		if (form && 'class' in form && form.class) {
			showToast(
				'success',
				m.classes_created_success({ name: form.class.name, code: form.class.code })
			);
		}
		if (form && 'deleted' in form && form.deleted) {
			showToast('success', m.classes_deleted_success({ name: form.deleted }));
		}
		if (form && 'renamed' in form && form.renamed) {
			editingId = null;
			showToast('success', m.names_saved({ name: form.renamed }));
		}
	});

	// A failed save keeps what was typed; otherwise the class's current names.
	function editValues(cls: ClassRow) {
		if (form && 'renameValues' in form && form.renameValues && form.renameId === cls.id) {
			return form.renameValues;
		}
		return { name: cls.name, nameBo: cls.name_bo, nameDe: cls.name_de };
	}

	// A failed create keeps what was entered; otherwise the new-class default
	// schedule: Sunday, weekly, from today (Berlin), no end, time unset (Story 6-4).
	let schedule = $derived(
		form && 'schedule' in form && form.schedule
			? {
					weekdays: form.schedule.weekdays.map(Number),
					startTime: form.schedule.startTime,
					durationMinutes: form.schedule.durationMinutes,
					startsOn: form.schedule.startsOn,
					endsOn: form.schedule.endsOn,
					intervalWeeks: form.schedule.intervalWeeks
				}
			: {
					weekdays: [7],
					startTime: null,
					durationMinutes: null,
					startsOn: data.today,
					endsOn: null,
					intervalWeeks: 1
				}
	);
	// The last create result (every create result echoes the names): other
	// actions (a delete, a rename) leave it, so they don't clear a half-typed name.
	let lastCreate: ActionData = null;
	let createResult = $derived.by(() => {
		if (form && 'name' in form) lastCreate = form;
		return lastCreate;
	});
	let createdNames = $derived(
		createResult && 'name' in createResult && !createResult.success
			? { name: createResult.name, nameBo: createResult.nameBo, nameDe: createResult.nameDe }
			: { name: '', nameBo: '', nameDe: '' }
	);

	let scheduleErrors = $derived(
		form && 'scheduleErrors' in form && form.scheduleErrors ? form.scheduleErrors : {}
	);

	let deleteForm: HTMLFormElement | undefined = $state();
	let deleteTarget = $state({ id: '', name: '' });

	async function deleteClass(cls: ClassRow) {
		const ok = await confirmAction(
			m.common_confirm_title(),
			m.classes_delete_confirm({ name: cls.label }),
			m.common_delete(),
			m.common_cancel()
		);
		if (!ok) return;
		deleteTarget = { id: cls.id, name: cls.label };
		await tick(); // hidden inputs pick up deleteTarget before submitting
		deleteForm?.requestSubmit();
	}
</script>

<svelte:head>
	<title>{m.classes_heading()} — Sherab Admin</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.classes_section_label()}</p>
			<h1 class="page-heading">{m.classes_heading()}</h1>
		</div>
		<span class="page-counter">{num(data.classes.length)}</span>
	</header>

	<section class="card">
		<h2>{m.classes_create_heading()}</h2>
		<form method="POST" action="?/create" use:enhance={pending.submit('create')} novalidate>
			<!-- Remounted after a successful create only: <ix-input> doesn't take
			     part in form reset. A failed create keeps the names (echoed back). -->
			{#key createResult?.success ? createResult : null}
				<LocalizedNameFields label={m.classes_name_label()} values={createdNames} />
			{/key}
			<h3 class="schedule-heading">{m.classes_schedule_heading()}</h3>
			{#key form}
				<ScheduleFields
					idPrefix="new-class"
					weekdays={schedule.weekdays}
					startTime={schedule.startTime}
					durationMinutes={schedule.durationMinutes}
					startsOn={schedule.startsOn}
					endsOn={schedule.endsOn}
					intervalWeeks={schedule.intervalWeeks}
					errors={scheduleErrors}
				/>
			{/key}
			<ix-button
				type="submit"
				icon="add"
				loading={pending.is('create') || undefined}
				disabled={pending.busy || undefined}>{m.classes_create_submit()}</ix-button
			>
		</form>
	</section>

	<section class="card">
		<h2>{m.classes_all_heading()}</h2>
		{#if data.classes.length === 0}
			<p class="muted">{m.classes_empty()}</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>{m.classes_col_name()}</th>
							<th>{m.classes_col_code()}</th>
							<th>{m.classes_col_students()}</th>
							<th>{m.classes_col_syllabi()}</th>
							<th>{m.classes_col_created()}</th>
							<th><span class="sr-only">{m.classes_col_actions()}</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.classes as cls (cls.id)}
							<tr>
								<td>
									{cls.label}
									{#each otherNames(cls) as other (other.lang)}
										<span class="muted other-name" lang={other.lang}>{other.name}</span>
									{/each}
								</td>
								<td><CopyField label={m.classes_col_code()} value={cls.code} hideLabel /></td>
								<td>
									<span class="actions">
										<a href={resolve('/admin/classes/[id]/students', { id: cls.id })}>
											{m.classes_students_summary({ approved: num(cls.approvedCount) })}
										</a>
										{#if cls.pendingCount > 0}
											<ix-pill variant="warning">
												{m.classes_pending_summary({ pending: num(cls.pendingCount) })}
											</ix-pill>
										{/if}
									</span>
								</td>
								<td>
									<a href={resolve('/admin/classes/[id]/syllabus', { id: cls.id })}>
										{cls.syllabusCount} · {m.classes_syllabi_open()}
									</a>
								</td>
								<td class="muted">{formatInstant(cls.created_at)}</td>
								<td>
									<div class="actions" style="justify-content:flex-end;">
										<ix-button
											variant="tertiary"
											icon="pen"
											disabled={pending.busy || undefined}
											onclick={() => (editingId = editingId === cls.id ? null : cls.id)}
										>
											{m.names_edit()}
										</ix-button>
										{#if cls.approvedCount === 0 && cls.pendingCount === 0}
											<ix-button
												variant="danger-tertiary"
												icon="trashcan"
												loading={pending.is(`delete:${cls.id}`) || undefined}
												disabled={pending.busy || undefined}
												onclick={() => deleteClass(cls)}
											>
												{m.common_delete()}
											</ix-button>
										{/if}
									</div>
								</td>
							</tr>
							{#if editingId === cls.id}
								<tr>
									<td colspan="6">
										<form
											method="POST"
											action="?/rename"
											use:enhance={pending.submit(`rename:${cls.id}`)}
											novalidate
										>
											<input type="hidden" name="classId" value={cls.id} />
											<fieldset>
												<legend>{m.names_edit_title({ name: cls.label })}</legend>
												<LocalizedNameFields
													label={m.classes_name_label()}
													idPrefix="edit-{cls.id}-"
													values={editValues(cls)}
												/>
											</fieldset>
											<div class="actions">
												<ix-button
													type="submit"
													loading={pending.is(`rename:${cls.id}`) || undefined}
													disabled={pending.busy || undefined}>{m.names_save()}</ix-button
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
		bind:this={deleteForm}
		method="POST"
		action="?/delete"
		use:enhance={pending.submit(() => `delete:${deleteTarget.id}`)}
		hidden
	>
		<input type="hidden" name="classId" value={deleteTarget.id} />
		<input type="hidden" name="className" value={deleteTarget.name} />
	</form>
</div>

<style>
	.schedule-heading {
		margin: var(--space-2) 0 var(--space-2);
		font-size: var(--theme-font-size-l);
	}
	.other-name {
		display: block;
		font-size: var(--theme-font-size-default);
	}
</style>
