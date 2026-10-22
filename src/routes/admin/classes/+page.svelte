<script lang="ts">
	import { onMount } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { enhance } from '$app/forms';
	import { formatInstant, num } from '$lib/format';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/toast';
	import { createConfirm } from '$lib/confirm.svelte';
	import { createPending } from '$lib/pending.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import CopyField from '$lib/components/CopyField.svelte';
	import ScheduleFields from '$lib/components/ScheduleFields.svelte';
	import LocalizedNameFields from '$lib/components/LocalizedNameFields.svelte';
	import BadgeSubjectSelect from '$lib/components/BadgeSubjectSelect.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { badgeSubjectLabel, isBadgeSubject } from '$lib/badge-subject';
	import { otherNames } from '$lib/localized-name';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * The admin's classes: create one (names, badge subject, schedule), and
	 * per class edit its names and subject inline (#76), open its students
	 * and syllabi, copy its code, and delete it while nobody is enrolled or
	 * pending.
	 * Mobile-first story 9: stacked cards below 80em and a full table from
	 * 80em (the Requests pattern); in a card each value carries its column's
	 * name. Delete asks in the new alert dialog. The name and subject fields
	 * are native, so a successful create clears them with the form reset (no
	 * remount); the schedule fields keep their remount (see below).
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	type ClassRow = (typeof data.classes)[number];

	const pending = createPending();
	const confirm = createConfirm();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	// #76: the class being edited (one row at a time).
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
			showToast('success', m.classes_saved({ name: form.renamed }));
		}
	});

	// A failed save keeps what was entered; otherwise the class's current
	// names and badge subject.
	function editValues(cls: ClassRow) {
		if (form && 'renameValues' in form && form.renameValues && form.renameId === cls.id) {
			return form.renameValues;
		}
		return {
			name: cls.name,
			nameBo: cls.name_bo,
			nameDe: cls.name_de,
			badgeSubject: cls.badge_subject
		};
	}

	// The subject error of a failed edit, for that class's row only.
	function editSubjectError(cls: ClassRow) {
		if (form && 'renameId' in form && form.renameId === cls.id && 'subjectError' in form) {
			return form.subjectError ?? null;
		}
		return null;
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

	// A failed create keeps the picked subject; a successful one clears it.
	let createdSubject = $derived(
		createResult && 'badgeSubject' in createResult && !createResult.success
			? createResult.badgeSubject
			: null
	);
	let createSubjectError = $derived(
		form && 'subjectError' in form && !('renameId' in form) ? (form.subjectError ?? null) : null
	);

	let scheduleErrors = $derived(
		form && 'scheduleErrors' in form && form.scheduleErrors ? form.scheduleErrors : {}
	);

	// One markup for both layouts: stacked cards below 80em, a table from 80em
	// (copied from /requests).
	const table = 'block w-full min-w-0 xl:table xl:border-collapse';
	const thead = 'hidden xl:table-header-group';
	const th =
		'border-b border-border px-3 py-2 text-left align-bottom text-sm font-medium text-muted-foreground';
	const tbody = 'flex min-w-0 flex-col gap-3 xl:table-row-group';
	const tr =
		'flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4 xl:table-row xl:rounded-none xl:border-0 xl:border-b xl:p-0';
	const td = 'block min-w-0 wrap-break-word xl:table-cell xl:px-3 xl:py-3 xl:align-middle';
	const tdActions = `${td} xl:w-px xl:text-right`;
	const actions = 'flex min-w-0 flex-wrap gap-2 xl:flex-nowrap xl:justify-end';
	/** A form or button holding one row action: full width in a card, its own width in the table. */
	const actionItem = 'min-w-0 flex-1 basis-32 xl:flex-none xl:basis-auto';
	const actionButton = `${ui.touch} w-full gap-2 xl:w-auto`;
	/** A value's column name, shown in a card only (the table has its header). */
	const cardLabel = `${ui.label} mb-1 xl:hidden`;
	const cellLink = `${ui.link} inline-flex min-h-11 min-w-11 items-center`;
	const formButton = `${ui.touch} gap-2`;
</script>

<svelte:head>
	<title>{m.classes_heading()} — Sherab Admin</title>
</svelte:head>

{#snippet spinner(key: string)}
	{#if pending.is(key)}
		<LoaderCircle class="animate-spin" aria-hidden="true" />
	{/if}
{/snippet}

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.classes_section_label()}</p>
			<h1 class={ui.heading}>{m.classes_heading()}</h1>
		</div>
		<Badge variant="secondary" class="min-h-7 px-3 text-sm" data-testid="page-counter">
			{num(data.classes.length)}
		</Badge>
	</header>

	<section class="{ui.card} flex flex-col gap-4" data-testid="class-create">
		<h2 class={ui.cardTitle}>{m.classes_create_heading()}</h2>
		<form
			method="POST"
			action="?/create"
			class="flex min-w-0 flex-col gap-4"
			use:enhance={pending.submit('create')}
			novalidate
		>
			<LocalizedNameFields label={m.classes_name_label()} values={createdNames} />
			<BadgeSubjectSelect
				id="new-class-subject"
				value={createdSubject}
				error={createSubjectError}
			/>
			<h3 class="text-lg leading-snug font-bold">{m.classes_schedule_heading()}</h3>
			<!-- Remounted on each result, as before story 9: the schedule's defaults
			     are not empty (Sunday, from today), so they come from the props
			     rather than from the form reset. -->
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
			<div>
				<Button
					type="submit"
					class="{formButton} w-full sm:w-auto"
					aria-busy={pending.is('create') || undefined}
					disabled={pending.busy}
				>
					{#if pending.is('create')}
						<LoaderCircle class="animate-spin" aria-hidden="true" />
					{:else}
						<Plus aria-hidden="true" />
					{/if}
					{m.classes_create_submit()}
				</Button>
			</div>
		</form>
	</section>

	<section class="{ui.card} flex flex-col gap-3" data-testid="class-list">
		<h2 class={ui.cardTitle}>{m.classes_all_heading()}</h2>
		{#if data.classes.length === 0}
			<p class={ui.muted}>{m.classes_empty()}</p>
		{:else}
			<!-- WebKit drops table semantics from a restyled table (cards below 80em): the roles keep them. -->
			<!-- svelte-ignore a11y_no_redundant_roles -->
			<table role="table" class={table}>
				<thead role="rowgroup" class={thead}>
					<tr role="row">
						<th role="columnheader" class={th}>{m.classes_col_name()}</th>
						<th role="columnheader" class={th}>{m.classes_col_subject()}</th>
						<th role="columnheader" class={th}>{m.classes_col_code()}</th>
						<th role="columnheader" class={th}>{m.classes_col_students()}</th>
						<th role="columnheader" class={th}>{m.classes_col_syllabi()}</th>
						<th role="columnheader" class={th}>{m.classes_col_created()}</th>
						<th role="columnheader" class={th}
							><span class="sr-only">{m.classes_col_actions()}</span></th
						>
					</tr>
				</thead>
				<tbody role="rowgroup" class={tbody}>
					{#each data.classes as cls (cls.id)}
						<tr role="row" class={tr} data-testid="class-row" data-class-id={cls.id}>
							<td role="cell" class="{td} font-semibold xl:font-normal">
								{cls.label}
								{#each otherNames(cls) as other (other.lang)}
									<span class="block text-base font-normal {ui.muted}" lang={other.lang}
										>{other.name}</span
									>
								{/each}
							</td>
							<td role="cell" class={td}>
								<p class={cardLabel}>{m.classes_col_subject()}</p>
								{#if isBadgeSubject(cls.badge_subject)}
									{badgeSubjectLabel(cls.badge_subject)}
								{:else}
									<Badge variant="warning">{m.badge_subject_not_set()}</Badge>
								{/if}
							</td>
							<td role="cell" class={td}>
								<p class={cardLabel} aria-hidden="true">{m.classes_col_code()}</p>
								<CopyField label={m.classes_col_code()} value={cls.code} hideLabel />
							</td>
							<td role="cell" class={td}>
								<p class={cardLabel}>{m.classes_col_students()}</p>
								<span class="flex min-w-0 flex-wrap items-center gap-2">
									<a
										href={resolve('/admin/classes/[id]/students', { id: cls.id })}
										class={cellLink}
									>
										{m.classes_students_summary({ approved: num(cls.approvedCount) })}
									</a>
									{#if cls.pendingCount > 0}
										<Badge variant="warning">
											{m.classes_pending_summary({ pending: num(cls.pendingCount) })}
										</Badge>
									{/if}
								</span>
							</td>
							<td role="cell" class={td}>
								<p class={cardLabel}>{m.classes_col_syllabi()}</p>
								<a href={resolve('/admin/classes/[id]/syllabus', { id: cls.id })} class={cellLink}>
									{cls.syllabusCount} · {m.classes_syllabi_open()}
								</a>
							</td>
							<td role="cell" class="{td} {ui.muted}">
								<p class={cardLabel}>{m.classes_col_created()}</p>
								<span>{formatInstant(cls.created_at)}</span>
							</td>
							<td role="cell" class={tdActions}>
								<div class={actions}>
									<div class={actionItem}>
										<Button
											variant="outline"
											class={actionButton}
											aria-expanded={editingId === cls.id}
											disabled={pending.busy}
											onclick={() => (editingId = editingId === cls.id ? null : cls.id)}
										>
											<Pencil aria-hidden="true" />
											{m.classes_edit()}
										</Button>
									</div>
									{#if cls.approvedCount === 0 && cls.pendingCount === 0}
										<form
											method="POST"
											action="?/delete"
											class={actionItem}
											use:enhance={pending.submit(`delete:${cls.id}`, {
												// Asked at submit time (`use:enhance` keeps the options it
												// mounted with): the name as renamed in place.
												confirm: () =>
													confirm.ask(
														m.classes_delete_confirm({ name: cls.label }),
														m.common_delete(),
														{
															destructive: true
														}
													)
											})}
										>
											<input type="hidden" name="classId" value={cls.id} />
											<input type="hidden" name="className" value={cls.label} />
											<Button
												type="submit"
												variant="destructive"
												class={actionButton}
												aria-busy={pending.is(`delete:${cls.id}`) || undefined}
												disabled={pending.busy}
											>
												{#if pending.is(`delete:${cls.id}`)}
													<LoaderCircle class="animate-spin" aria-hidden="true" />
												{:else}
													<Trash2 aria-hidden="true" />
												{/if}
												{m.common_delete()}
											</Button>
										</form>
									{/if}
								</div>
							</td>
						</tr>
						{#if editingId === cls.id}
							<tr
								role="row"
								class="{tr} -mt-1 border-primary xl:border-primary"
								data-testid="class-edit-row"
							>
								<td role="cell" colspan="7" class="{td} xl:py-4">
									<form
										method="POST"
										action="?/rename"
										class="flex min-w-0 flex-col gap-4"
										use:enhance={pending.submit(`rename:${cls.id}`)}
										novalidate
									>
										<input type="hidden" name="classId" value={cls.id} />
										<fieldset class="flex min-w-0 flex-col gap-4">
											<legend class="mb-3 font-bold wrap-break-word">
												{m.classes_edit_title({ name: cls.label })}
											</legend>
											<LocalizedNameFields
												label={m.classes_name_label()}
												idPrefix="edit-{cls.id}-"
												values={editValues(cls)}
											/>
											<BadgeSubjectSelect
												id="edit-{cls.id}-subject"
												value={editValues(cls).badgeSubject}
												error={editSubjectError(cls)}
											/>
										</fieldset>
										<div class="flex min-w-0 flex-wrap gap-2">
											<Button
												type="submit"
												class="{formButton} flex-1 sm:flex-none"
												aria-busy={pending.is(`rename:${cls.id}`) || undefined}
												disabled={pending.busy}
											>
												{@render spinner(`rename:${cls.id}`)}
												{m.classes_save()}
											</Button>
											<Button
												variant="outline"
												class="{formButton} flex-1 sm:flex-none"
												disabled={pending.busy}
												onclick={() => (editingId = null)}
											>
												{m.common_cancel()}
											</Button>
										</div>
									</form>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<ConfirmDialog {confirm} />
</div>
