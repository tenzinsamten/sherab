<script lang="ts">
	import { onMount } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { todayInBerlin } from '$lib/berlin-date';
	import { formatDay } from '$lib/format';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ContentLanguageSelect from '$lib/components/ContentLanguageSelect.svelte';
	import LinkRows from '$lib/components/LinkRows.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import { createConfirm } from '$lib/confirm.svelte';
	import { createPending } from '$lib/pending.svelte';
	import { createUnsavedGuard } from '$lib/unsaved.svelte';
	import { readContentLanguage, type ContentLanguage } from '$lib/rich-text';
	import type { SkillArea } from '$lib/supabase/database.types';
	import { ui } from '$lib/ui/classes';
	import {
		MAX_FILES_PER_HOMEWORK,
		MAX_HOMEWORK_FILE_BYTES,
		homeworkFileLimitMessage,
		homeworkFileTooLargeMessage,
		maxHomeworkFileSizeText,
		maxHomeworkFilesText
	} from '$lib/homework-files';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageProps } from './$types';

	/**
	 * New homework for a class, mobile-first story 7c: native fields, radio
	 * rows and student checkboxes, each ≥44px.
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	const skillAreas: SkillArea[] = ['language', 'song', 'dance'];
	// Language the homework is written in (#74): starts as the teacher's
	// interface language and sets the font of the title and content fields.
	let contentLanguage = $state<ContentLanguage>(readContentLanguage(getLocale()));
	let targetMode = $state<'all' | 'subset'>('all');
	let assignmentMode = $state<'once' | 'weekly'>('once');
	// Success redirects to the list, which shows the toast; errors come from
	// the root layout's form-error toast.
	const pending = createPending();
	// #121: asks before leaving the form once something was typed.
	const confirm = createConfirm();
	const unsaved = createUnsavedGuard(confirm);

	// #110: the optional PDF files. The server checks them before it creates
	// anything (a refused file returns the form as typed; the files are
	// chosen again). Too many or too large is refused here first, so a large
	// post is not sent for nothing.
	let localFileError = $state('');
	let serverFileError = $derived(
		form && 'fileError' in form && typeof form.fileError === 'string' ? form.fileError : ''
	);
	// A new answer from the server replaces the local message.
	$effect(() => {
		if (form) localFileError = '';
	});
	let fileError = $derived(localFileError || serverFileError);

	const create = unsaved.submit(pending.submit('create'));
	const submitCreate: SubmitFunction = (input) => {
		localFileError = '';
		const chosen = input.formData
			.getAll('files')
			.filter((entry): entry is File => entry instanceof File && entry.size > 0);
		if (chosen.length > MAX_FILES_PER_HOMEWORK) {
			localFileError = homeworkFileLimitMessage();
		} else if (chosen.some((file) => file.size > MAX_HOMEWORK_FILE_BYTES)) {
			localFileError = homeworkFileTooLargeMessage();
		}
		if (localFileError) {
			document.getElementById('files')?.focus();
			return input.cancel();
		}
		return create(input);
	};

	// The mode decides which fields show.
	function pickMode(mode: 'once' | 'weekly') {
		assignmentMode = mode;
		// The start-date field is recreated empty when the mode changes.
		startDate = '';
	}

	// #96: when students see a weekly homework depends on its start date --
	// at once for today or earlier (Munich), else from that date. Shown under
	// the field as its description.
	let startDate = $state('');
	let startDateNote = $derived(
		!/^\d{4}-\d{2}-\d{2}$/.test(startDate)
			? m.homework_start_date_note()
			: startDate > todayInBerlin()
				? m.homework_start_date_note_from({ date: formatDay(startDate) })
				: m.homework_start_date_note_now()
	);

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}

	const field = 'mb-4 flex min-w-0 flex-col gap-1.5';
	const legend = 'mb-1.5 text-sm font-medium';
	// A radio or checkbox row: the whole row is the ≥44px target.
	const choice =
		'flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2 has-checked:border-primary has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-ring';
	const box = 'size-5 shrink-0 accent-primary';
</script>

<svelte:head>
	<title>{m.homework_create_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

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
				{ label: m.breadcrumb_new_homework() }
			]}
		/>
	</div>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.homework_section_label()}</p>
			<h1 class={ui.heading}>{m.homework_create_heading()}</h1>
			<p class="{ui.subtitle} wrap-break-word">{data.class.name}</p>
		</div>
	</header>

	<section class={ui.card}>
		<form
			method="POST"
			action="?/createAssignment"
			enctype="multipart/form-data"
			use:enhance={submitCreate}
			use:unsaved.track
		>
			<div class={field}>
				<Label for="title">{m.homework_title_label()}</Label>
				<Input id="title" name="title" lang={contentLanguage} required />
			</div>
			<div class={field}>
				<Label for="skillArea">{m.homework_skill_area_label()}</Label>
				<NativeSelect.Root id="skillArea" name="skillArea" class="w-full" required>
					{#each skillAreas as area (area)}
						<NativeSelect.Option value={area}>{skillLabel(area)}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>
			<ContentLanguageSelect id="contentLanguage" bind:value={contentLanguage} />
			<RichTextEditor
				id="content"
				label={m.homework_content_label()}
				lang={contentLanguage}
				required
			/>
			<LinkRows idPrefix="create" />

			<div class={field}>
				<Label for="files">{m.homework_file_create_label()}</Label>
				<Input
					id="files"
					type="file"
					name="files"
					accept="application/pdf,.pdf"
					multiple
					class="py-2.5"
					aria-describedby="files-hint{fileError ? ' files-error' : ''}"
					aria-invalid={fileError ? 'true' : undefined}
				/>
				<p id="files-hint" class="text-sm {ui.muted}">
					{m.homework_file_create_hint({
						size: maxHomeworkFileSizeText(),
						count: maxHomeworkFilesText()
					})}
				</p>
				{#if fileError}
					<p id="files-error" class={ui.error} role="alert" data-testid="file-error">
						{fileError}
					</p>
				{/if}
			</div>

			<fieldset id="mode" class={field} data-tour="homework-schedule">
				<legend class={legend}>{m.homework_mode_legend()}</legend>
				<div class="flex flex-col gap-2 sm:flex-row">
					{#each [{ value: 'once', label: m.homework_mode_once() }, { value: 'weekly', label: m.homework_mode_weekly() }] as const as option (option.value)}
						<label class="{choice} flex-1">
							<input
								type="radio"
								name="mode"
								value={option.value}
								checked={assignmentMode === option.value}
								onchange={() => pickMode(option.value)}
								class={box}
							/>
							<span>{option.label}</span>
						</label>
					{/each}
				</div>
			</fieldset>

			{#if assignmentMode === 'once'}
				<div class={field} data-tour="homework-due">
					<Label for="dueDate">{m.homework_due_date_label()}</Label>
					<Input id="dueDate" name="dueDate" type="date" required />
				</div>

				<fieldset id="targetMode" class={field} data-tour="homework-target">
					<legend class={legend}>{m.homework_target_legend()}</legend>
					<div class="flex flex-col gap-2 sm:flex-row">
						{#each [{ value: 'all', label: m.homework_target_all() }, { value: 'subset', label: m.homework_target_subset() }] as const as option (option.value)}
							<label class="{choice} flex-1">
								<input
									type="radio"
									name="targetMode"
									value={option.value}
									checked={targetMode === option.value}
									onchange={() => (targetMode = option.value)}
									class={box}
								/>
								<span>{option.label}</span>
							</label>
						{/each}
					</div>
				</fieldset>
				{#if targetMode === 'subset'}
					<fieldset class={field}>
						<legend class="sr-only">{m.homework_target_subset()}</legend>
						<div class="grid gap-2 sm:grid-cols-2">
							{#each data.students as student (student.id)}
								<label class={choice}>
									<input type="checkbox" name="studentIds" value={student.id} class={box} />
									<span class="wrap-break-word">{student.displayName}</span>
								</label>
							{/each}
						</div>
					</fieldset>
				{/if}
			{:else}
				<div class={field}>
					<Label for="startDate">{m.homework_start_date_label()}</Label>
					<Input
						id="startDate"
						name="startDate"
						type="date"
						required
						aria-describedby="startDate-note"
						value={startDate}
						oninput={(event) => (startDate = event.currentTarget.value)}
					/>
					<p id="startDate-note" class="text-sm {ui.muted}" aria-live="polite">{startDateNote}</p>
				</div>
				<div class={field}>
					<Label for="dueOffsetDays">{m.homework_due_offset_label()}</Label>
					<Input
						id="dueOffsetDays"
						name="dueOffsetDays"
						type="number"
						inputmode="numeric"
						min="0"
						max="365"
						step="1"
						required
						value="7"
					/>
				</div>
				<p class="mb-4 {ui.muted}">{m.homework_recurring_note()}</p>
			{/if}

			<Button
				type="submit"
				class="{ui.touch} w-full gap-2 sm:w-auto"
				aria-busy={pending.is('create') || undefined}
				disabled={pending.busy}
			>
				{#if pending.is('create')}
					<LoaderCircle class="animate-spin" aria-hidden="true" />
				{/if}
				{m.homework_create_submit()}
			</Button>
		</form>
	</section>
</div>

<ConfirmDialog {confirm} />
