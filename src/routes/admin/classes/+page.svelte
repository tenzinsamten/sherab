<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { confirmAction, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import ScheduleFields from '$lib/components/ScheduleFields.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

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
	});

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
	let scheduleErrors = $derived(
		form && 'scheduleErrors' in form && form.scheduleErrors ? form.scheduleErrors : {}
	);

	let deleteForm: HTMLFormElement | undefined = $state();
	let deleteTarget = $state({ id: '', name: '' });

	async function deleteClass(cls: { id: string; name: string }) {
		const ok = await confirmAction(
			m.common_confirm_title(),
			m.classes_delete_confirm({ name: cls.name }),
			m.common_delete(),
			m.common_cancel()
		);
		if (!ok) return;
		deleteTarget = { id: cls.id, name: cls.name };
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
		<span class="page-counter">{data.classes.length}</span>
	</header>

	<section class="card">
		<h2>{m.classes_create_heading()}</h2>
		<form method="POST" action="?/create" use:enhance={pending.submit('create')} novalidate>
			<div class="field" style="max-width:32rem;">
				<label for="name">{m.classes_name_label()}</label>
				<input
					id="name"
					name="name"
					type="text"
					required
					value={form?.success ? '' : (form && 'name' in form && form.name) || ''}
				/>
			</div>
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
								<td>{cls.name}</td>
								<td><code>{cls.code}</code></td>
								<td>
									<span class="actions">
										<a href={resolve('/admin/classes/[id]/students', { id: cls.id })}>
											{m.classes_students_summary({ approved: cls.approvedCount })}
										</a>
										{#if cls.pendingCount > 0}
											<ix-pill variant="warning">
												{m.classes_pending_summary({ pending: cls.pendingCount })}
											</ix-pill>
										{/if}
									</span>
								</td>
								<td>
									<a href={resolve('/admin/classes/[id]/syllabus', { id: cls.id })}>
										{cls.syllabusCount} · {m.classes_syllabi_open()}
									</a>
								</td>
								<td class="muted">{new Date(cls.created_at).toLocaleDateString()}</td>
								<td style="text-align:right;">
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
								</td>
							</tr>
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
</style>
