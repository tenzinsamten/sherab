<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { isoDay, num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { createConfirm } from '$lib/confirm.svelte';
	import { showToast } from '$lib/toast';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ContentLanguageSelect from '$lib/components/ContentLanguageSelect.svelte';
	import HomeworkFiles from '$lib/components/HomeworkFiles.svelte';
	import LinkRows from '$lib/components/LinkRows.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import RepeatIcon from '$lib/components/RepeatIcon.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { createPending } from '$lib/pending.svelte';
	import type { ContentLanguage } from '$lib/rich-text';
	import type { SkillArea } from '$lib/supabase/database.types';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * One homework and its copies, mobile-first story 7c: the copies are
	 * stacked cards below 80em and a table above, and every "Are you sure?"
	 * is the shared ConfirmDialog.
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	const pending = createPending();
	const confirm = createConfirm();
	let assignment = $derived(data.assignment);
	// The edit form's language (#74): starts as the saved one and, like the
	// other edit fields, keeps the teacher's pick when the page data reloads.
	let editLanguage = $state<ContentLanguage>(untrack(() => data.assignment.contentLanguage));
	// The edit fields' saved values as plain strings: a reload after another
	// action makes a new `assignment` but the same strings, so the fields keep
	// what the teacher typed; a save changes them, so the fields show it.
	let savedTitle = $derived(assignment.title);
	let savedOffset = $derived(String(assignment.dueOffsetDays ?? 0));

	// #110: the server's message about a chosen file, for the upload field
	// (fileId null) or the file that was to be replaced.
	let fileError = $derived(
		form && 'fileError' in form && typeof form.fileError === 'string'
			? { fileId: ('fileId' in form ? form.fileId : null) ?? null, message: form.fileError }
			: null
	);

	// #103b: the teacher's choice, when ending a series, to also archive the
	// homework students already have from it. Off unless ticked.
	let archiveCopiesOnEnd = $state(false);

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}

	// Single source of truth for "is this series currently inactive"
	// (review finding #8), reused by seriesStatusLabel() and the pause/end
	// buttons' visibility guard.
	function isSeriesInactive(a: typeof data.assignment): boolean {
		return Boolean(a.pausedAt) || Boolean(a.endsOn && a.endsOn <= data.today);
	}

	function seriesStatusLabel(a: typeof data.assignment): string | null {
		if (!a.isRecurring) return null;
		if (a.pausedAt) return m.homework_series_paused_label();
		if (a.endsOn && a.endsOn <= data.today) {
			return m.homework_series_ended_label({ date: isoDay(a.endsOn) });
		}
		return null;
	}

	// Only shows toasts: it must not write any state it reads (#30).
	$effect(() => {
		if (!form?.success) return;
		switch (form.action) {
			case 'markDone':
				showToast('success', m.homework_mark_done_success());
				break;
			case 'markReviewed':
				showToast('success', m.homework_mark_reviewed_success());
				break;
			case 'archiveInstance':
				showToast('success', m.homework_archived_success());
				break;
			case 'editAssignment':
				showToast('success', m.homework_edit_success());
				break;
			case 'fileUploaded':
				showToast('success', m.homework_file_uploaded());
				break;
			case 'fileReplaced':
				showToast('success', m.homework_file_replaced());
				break;
			case 'fileDeleted':
				showToast('success', m.homework_file_deleted());
				break;
			case 'pauseSeries':
				showToast('success', m.homework_series_paused_success());
				break;
			case 'endSeries':
				if (form.archiveFailed) {
					showToast('warning', m.homework_series_error_archive_copies_failed());
				} else {
					showToast(
						'success',
						form.archived
							? m.homework_series_ended_archived_success()
							: m.homework_series_ended_success()
					);
				}
				break;
		}
	});

	const field = 'mb-4 flex min-w-0 flex-col gap-1.5';
	const box = 'size-5 shrink-0 accent-primary';
	// A <details> summary (the reset keeps it a list item, with its marker):
	// the whole line is the ≥44px target.
	const summary =
		'min-h-11 cursor-pointer rounded-lg py-2.5 font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
	// The copies: a card each below 80em (WebKit needs the roles), a table above.
	const table = 'block w-full min-w-0 xl:table xl:border-collapse';
	const thead = 'hidden xl:table-header-group';
	const th =
		'border-b border-border px-3 py-2 text-left align-bottom text-sm font-medium text-muted-foreground';
	const tbody =
		'mb-3 flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4 xl:mb-0 xl:table-row-group xl:rounded-none xl:border-0 xl:border-b-2 xl:p-0';
	const tr = 'flex min-w-0 flex-wrap gap-x-6 gap-y-2 xl:table-row';
	const td = 'block min-w-0 wrap-break-word xl:table-cell xl:px-3 xl:py-3 xl:align-middle';
	/** A column's name, shown in front of the value on a card only. */
	const cellLabel = 'mr-1 text-sm text-muted-foreground xl:hidden';
	const actionButton = `${ui.touch} w-full sm:w-auto`;
</script>

<svelte:head>
	<title>{assignment.title} — {m.homework_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

{#snippet spinner(key: string)}
	{#if pending.is(key)}
		<LoaderCircle class="animate-spin" aria-hidden="true" />
	{/if}
{/snippet}

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
		<PageBreadcrumb
			items={[
				{ label: m.nav_dashboard(), href: resolve('/teacher') },
				{ label: data.class.name, href: resolve('/teacher/classes/[id]', { id: data.class.id }) },
				{
					label: m.homework_heading(),
					href: resolve('/teacher/classes/[id]/homework', { id: data.class.id })
				},
				{ label: assignment.title }
			]}
		/>
	</div>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.homework_section_label()} · {skillLabel(assignment.skillArea)}</p>
			<h1 class="{ui.heading} flex flex-wrap items-center gap-2">
				<span lang={assignment.contentLanguage}>{assignment.title}</span>
				{#if assignment.isRecurring}
					<Badge variant="outline"><RepeatIcon /> {m.homework_recurring_badge_label()}</Badge>
				{/if}
			</h1>
			<p class="{ui.subtitle} wrap-break-word">{data.class.name}</p>
		</div>
	</header>

	<section class="{ui.card} flex flex-col gap-3">
		{#if assignment.content}
			<RichText content={assignment.content} lang={assignment.contentLanguage} />
		{/if}

		{#if assignment.referenceLinks.length > 0}
			<ul class="list-disc pl-6">
				{#each assignment.referenceLinks as link, i (i)}
					<li class="wrap-anywhere">
						<!-- eslint-disable svelte/no-navigation-without-resolve -- external teacher-supplied URL, not an internal route (Boundaries: no URL validation, opens externally). -->
						<a href={link.url} target="_blank" rel="noopener noreferrer" class={ui.link}>
							{link.label ?? link.url}
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</li>
				{/each}
			</ul>
		{/if}

		<!-- #110: the homework's PDF files, managed here (not in the edit form). -->
		<HomeworkFiles files={data.files} {pending} {confirm} error={fileError} />

		{#if seriesStatusLabel(assignment)}
			<p class="font-bold">{seriesStatusLabel(assignment)}</p>
		{/if}

		<details>
			<summary class={summary}>{m.homework_edit_heading()}</summary>
			<!-- reset: false: a reset would put back the values the page was
			     first drawn with. Each field takes its value from the page data
			     only when the saved value changes, so a reload after another
			     action keeps unsaved edits and a save shows the saved values. -->
			<form
				method="POST"
				action="?/editAssignment"
				use:enhance={pending.submit('edit', { reset: false })}
				class="mt-3"
			>
				<input type="hidden" name="assignmentId" value={assignment.id} />
				<div class={field}>
					<Label for={`edit-title-${assignment.id}`}>{m.homework_title_label()}</Label>
					<Input
						id={`edit-title-${assignment.id}`}
						name="title"
						lang={editLanguage}
						required
						value={savedTitle}
					/>
				</div>
				<ContentLanguageSelect id={`edit-language-${assignment.id}`} bind:value={editLanguage} />
				<RichTextEditor
					id={`edit-content-${assignment.id}`}
					label={m.homework_content_label()}
					lang={editLanguage}
					initial={assignment.content}
					required
				/>
				<LinkRows idPrefix={`edit-${assignment.id}`} links={assignment.referenceLinks} />
				{#if assignment.isRecurring}
					<div class={field}>
						<Label for={`edit-offset-${assignment.id}`}>{m.homework_due_offset_label()}</Label>
						<Input
							id={`edit-offset-${assignment.id}`}
							name="dueOffsetDays"
							type="number"
							inputmode="numeric"
							min="0"
							max="365"
							step="1"
							required
							value={savedOffset}
						/>
					</div>
				{/if}
				<Button
					variant="outline"
					type="submit"
					class="{actionButton} gap-2"
					aria-busy={pending.is('edit') || undefined}
					disabled={pending.busy}
				>
					{@render spinner('edit')}
					{m.homework_edit_submit()}
				</Button>
			</form>

			{#if assignment.isRecurring && !isSeriesInactive(assignment)}
				<div class="mt-4 flex flex-col gap-2 sm:flex-row">
					<form
						method="POST"
						action="?/pauseSeries"
						use:enhance={pending.submit('pause', {
							confirm: confirm.with(
								m.homework_series_pause_confirm(),
								m.homework_series_pause_action()
							)
						})}
					>
						<input type="hidden" name="assignmentId" value={assignment.id} />
						<Button
							variant="outline"
							type="submit"
							class="{actionButton} gap-2"
							aria-busy={pending.is('pause') || undefined}
							disabled={pending.busy}
						>
							{@render spinner('pause')}
							{m.homework_series_pause_action()}
						</Button>
					</form>
					<form
						method="POST"
						action="?/endSeries"
						use:enhance={pending.submit('end', {
							// #103b: the question says what the tick will do.
							confirm: () =>
								confirm.ask(
									archiveCopiesOnEnd
										? m.homework_series_end_archive_confirm()
										: m.homework_series_end_confirm(),
									m.homework_series_end_action(),
									{ destructive: true }
								)
						})}
					>
						<input type="hidden" name="assignmentId" value={assignment.id} />
						{#if archiveCopiesOnEnd}
							<input type="hidden" name="archiveCopies" value="on" />
						{/if}
						<Button
							variant="destructive"
							type="submit"
							class="{actionButton} gap-2"
							aria-busy={pending.is('end') || undefined}
							disabled={pending.busy}
						>
							{@render spinner('end')}
							{m.homework_series_end_action()}
						</Button>
					</form>
				</div>
				<label class="mt-2 flex min-h-11 cursor-pointer items-center gap-3">
					<input
						type="checkbox"
						class={box}
						bind:checked={archiveCopiesOnEnd}
						disabled={pending.busy}
					/>
					<span>{m.homework_series_end_archive_label()}</span>
				</label>
			{/if}
		</details>

		{#if assignment.instances.length === 0}
			<p class={ui.muted}>{m.homework_instances_empty()}</p>
		{:else}
			<!-- WebKit drops table semantics from a restyled table (cards below 80em): the roles keep them. -->
			<!-- svelte-ignore a11y_no_redundant_roles -->
			<table role="table" class={table}>
				<thead role="rowgroup" class={thead}>
					<tr role="row">
						<th role="columnheader" class={th}>{m.homework_col_due()}</th>
						<th role="columnheader" class={th}>{m.homework_col_done()}</th>
						<th role="columnheader" class={th}>{m.homework_col_reviewed()}</th>
						<th role="columnheader" class={th}>{m.homework_col_status()}</th>
					</tr>
				</thead>
				{#each assignment.instances as instance (instance.id)}
					<!-- One group per copy: its numbers, then its students. -->
					<tbody role="rowgroup" class={tbody} data-testid="homework-instance">
						<tr role="row" class={tr}>
							<td role="cell" class="{td} font-bold xl:font-normal">
								<span class={cellLabel}>{m.homework_col_due()}</span>{isoDay(instance.dueDate)}
							</td>
							<td role="cell" class={td}>
								<span class={cellLabel}>{m.homework_col_done()}</span>{num(instance.doneCount)} / {num(
									instance.students.length
								)}
							</td>
							<td role="cell" class={td}>
								<span class={cellLabel}>{m.homework_col_reviewed()}</span>{num(
									instance.reviewedCount
								)} / {num(instance.students.length)}
							</td>
							<td role="cell" class="{td} empty:hidden">
								{#if instance.archivedAt}
									<Badge variant="secondary">{m.homework_archived_label()}</Badge>
								{:else if instance.students.some((s) => s.overdue)}
									<Badge variant="alarm">{m.homework_overdue_label()}</Badge>
								{/if}
							</td>
						</tr>
						<tr role="row" class="block xl:table-row">
							<td role="cell" colspan="4" class="block min-w-0 xl:table-cell xl:px-3 xl:pb-3">
								<details>
									<summary class={summary}>{m.homework_student_status_heading()}</summary>
									{#if instance.students.length === 0 && assignment.wholeClass}
										<p class="mt-2 {ui.muted}">{m.homework_no_students_yet()}</p>
									{/if}
									<ul class={ui.rows}>
										{#each instance.students as student (student.studentId)}
											<li
												class="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2"
												data-testid="homework-student"
											>
												<span class="min-w-0 wrap-break-word">
													<strong>{student.displayName}</strong>
													—
													{#if student.reviewedAt}
														{m.homework_status_reviewed()}
													{:else if student.doneAt}
														{m.homework_status_done()}
													{:else}
														{m.homework_status_assigned()}
													{/if}
													{#if student.overdue}
														<Badge variant="alarm">{m.homework_overdue_label()}</Badge>
													{/if}
												</span>
												{#if !instance.archivedAt}
													{#if !student.doneAt}
														{@const key = `done:${instance.id}:${student.studentId}`}
														<form
															method="POST"
															action="?/markDone"
															class="w-full sm:w-auto"
															use:enhance={pending.submit(key, {
																confirm: confirm.with(
																	m.homework_mark_done_confirm({ name: student.displayName }),
																	m.homework_mark_done()
																)
															})}
														>
															<input type="hidden" name="instanceId" value={instance.id} />
															<input type="hidden" name="studentId" value={student.studentId} />
															<Button
																variant="outline"
																type="submit"
																class="{actionButton} gap-2"
																aria-busy={pending.is(key) || undefined}
																disabled={pending.busy}
																aria-label={m.homework_mark_done_for({ name: student.displayName })}
															>
																{@render spinner(key)}
																{m.homework_mark_done()}
															</Button>
														</form>
													{/if}
													{#if student.doneAt && !student.reviewedAt}
														{@const key = `reviewed:${instance.id}:${student.studentId}`}
														<form
															method="POST"
															action="?/markReviewed"
															class="w-full sm:w-auto"
															use:enhance={pending.submit(key, {
																confirm: confirm.with(
																	m.homework_mark_reviewed_confirm({ name: student.displayName }),
																	m.homework_mark_reviewed()
																)
															})}
														>
															<input type="hidden" name="instanceId" value={instance.id} />
															<input type="hidden" name="studentId" value={student.studentId} />
															<Button
																variant="outline"
																type="submit"
																class="{actionButton} gap-2"
																aria-busy={pending.is(key) || undefined}
																disabled={pending.busy}
																aria-label={m.homework_mark_reviewed_for({
																	name: student.displayName
																})}
															>
																{@render spinner(key)}
																{m.homework_mark_reviewed()}
															</Button>
														</form>
													{/if}
												{/if}
											</li>
										{/each}
									</ul>
									{#if !instance.archivedAt}
										<form
											method="POST"
											action="?/archiveInstance"
											class="mt-3"
											use:enhance={pending.submit(`archive:${instance.id}`, {
												confirm: confirm.with(
													m.homework_archive_confirm({ date: isoDay(instance.dueDate) }),
													m.homework_archive_action(),
													{ destructive: true }
												)
											})}
										>
											<input type="hidden" name="instanceId" value={instance.id} />
											<Button
												variant="destructive"
												type="submit"
												class="{actionButton} gap-2"
												aria-busy={pending.is(`archive:${instance.id}`) || undefined}
												disabled={pending.busy}
											>
												{@render spinner(`archive:${instance.id}`)}
												{m.homework_archive_action()}
											</Button>
										</form>
									{/if}
								</details>
							</td>
						</tr>
					</tbody>
				{/each}
			</table>
		{/if}
	</section>
</div>

<ConfirmDialog {confirm} />
