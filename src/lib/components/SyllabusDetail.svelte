<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick, untrack } from 'svelte';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/toast';
	import { createConfirm } from '$lib/confirm.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { createPending } from '$lib/pending.svelte';
	import { ui } from '$lib/ui/classes';
	import { formatSchoolYear } from '$lib/school-year';
	import type { ContentLanguage, RichTextDoc } from '$lib/rich-text';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import RichText from './RichText.svelte';
	import type { SyllabusFile } from '$lib/syllabus-files';
	import SyllabusFiles from './SyllabusFiles.svelte';
	import SyllabusForm from './SyllabusForm.svelte';
	import TextWithLinks from './TextWithLinks.svelte';

	/**
	 * One syllabus (#37) as its sections (0038): each with Edit, move up /
	 * down and Delete and its PDF files (0039, SyllabusFiles), then the "Add a
	 * section" form and "Delete syllabus". Posts to `?/addSection`,
	 * `?/updateSection`, `?/moveSection`, `?/deleteSection` and `?/delete`,
	 * and through SyllabusFiles to `?/uploadFile`, `?/replaceFile` and
	 * `?/deleteFile`. `result` is the page's latest action
	 * result (`form`): it opens a section that was just added or failed to
	 * save, closes one that was saved, and carries a wrong title's message.
	 * Mobile-first story 8: its own `data-ui="new"` root, so it also works on
	 * the admin syllabus page. It owns the page's one
	 * question dialog (`createConfirm` asks one question at a time) and
	 * passes it to SyllabusFiles.
	 */
	type Section = {
		id: string;
		title: string;
		content: RichTextDoc | null;
		contentLanguage: ContentLanguage;
		links: HomeworkReferenceLink[];
		files: SyllabusFile[];
	};
	type Result = {
		action?:
			| 'sectionAdded'
			| 'sectionSaved'
			| 'sectionMoved'
			| 'sectionDeleted'
			| 'fileUploaded'
			| 'fileReplaced'
			| 'fileDeleted';
		sectionId?: string | null;
		titleError?: string;
		/** A refused file: its message, its section and the file it was to replace (null: an upload). */
		fileError?: string;
		fileSectionId?: string;
		fileId?: string | null;
		error?: string;
	} | null;

	let {
		syllabus,
		result
	}: {
		syllabus: { id: string; schoolYear: number; sections: Section[] };
		result: Result;
	} = $props();

	/** The section a result asks to show as its form: just added, or not saved. */
	function opened(r: Result): string | null {
		if (!r?.sectionId) return null;
		return r.action === 'sectionAdded' || r.action === undefined ? r.sectionId : null;
	}

	// From the result at render time too, so a post without JavaScript comes
	// back with the form open.
	let editingIds = $state<string[]>(
		untrack(() => {
			const id = opened(result);
			return id ? [id] : [];
		})
	);
	// The failed result whose form was cancelled: its title error is not shown
	// again when that section is reopened.
	let cancelledResult = $state.raw<Result>(null);

	const pending = createPending();
	const confirm = createConfirm();
	let deleteForm: HTMLFormElement | undefined = $state();

	function setEditing(id: string, on: boolean) {
		editingIds = on
			? editingIds.includes(id)
				? editingIds
				: [...editingIds, id]
			: editingIds.filter((other) => other !== id);
	}

	// Reads only `result`, so changing the state here can't re-trigger it.
	$effect(() => {
		const r = result;
		if (!r) return;
		untrack(() => {
			const id = opened(r);
			if (id) setEditing(id, true);
			if (r.action === 'sectionAdded') showToast('success', m.syllabus_section_added());
			if (r.action === 'sectionSaved' && r.sectionId) {
				setEditing(r.sectionId, false);
				showToast('success', m.syllabus_section_saved());
			}
			if (r.action === 'sectionDeleted') {
				if (r.sectionId) setEditing(r.sectionId, false);
				showToast('success', m.syllabus_section_deleted());
			}
			if (r.action === 'fileUploaded') showToast('success', m.syllabus_file_uploaded());
			if (r.action === 'fileReplaced') showToast('success', m.syllabus_file_replaced());
			if (r.action === 'fileDeleted') showToast('success', m.syllabus_file_deleted());
		});
	});

	let addTitleError = $derived(result?.titleError && !result.sectionId ? result.titleError : '');

	const actionButton = `${ui.touch} w-full gap-2 sm:w-auto`;

	async function deleteSyllabus() {
		if (pending.busy) return;
		const ok = await confirm.ask(
			m.syllabus_delete_confirm({ year: formatSchoolYear(syllabus.schoolYear) }),
			m.common_delete(),
			{ destructive: true }
		);
		if (!ok) return;
		await tick();
		deleteForm?.requestSubmit();
	}
</script>

<div data-ui="new" class="flex min-w-0 flex-col gap-4 md:gap-6">
	{#if syllabus.sections.length === 0}
		<section class={ui.card}>
			<p class={ui.muted}>{m.syllabus_section_none()}</p>
		</section>
	{/if}

	{#each syllabus.sections as section, i (section.id)}
		<section class={ui.card} data-section-id={section.id}>
			{#if editingIds.includes(section.id)}
				<SyllabusForm
					{section}
					titleError={result?.titleError &&
					result.sectionId === section.id &&
					result !== cancelledResult
						? result.titleError
						: undefined}
					{pending}
					oncancel={() => {
						cancelledResult = result;
						setEditing(section.id, false);
					}}
				/>
			{:else}
				<!-- A long title wraps beside the move buttons instead of pushing them out. -->
				<div class="mb-3 flex min-w-0 items-start justify-between gap-2">
					<h2
						class="min-w-0 pt-2 text-lg leading-snug font-bold wrap-anywhere"
						lang={section.contentLanguage}
						data-testid="section-title"
					>
						{section.title}
					</h2>
					<div class="flex flex-none gap-1">
						{#each ['up', 'down'] as const as direction (direction)}
							<form
								method="POST"
								action="?/moveSection"
								use:enhance={pending.submit(`${direction}:${section.id}`, { reset: false })}
							>
								<input type="hidden" name="sectionId" value={section.id} />
								<input type="hidden" name="direction" value={direction} />
								<Button
									type="submit"
									variant="ghost"
									class="size-11"
									aria-label={direction === 'up'
										? m.syllabus_section_move_up({ title: section.title })
										: m.syllabus_section_move_down({ title: section.title })}
									aria-busy={pending.is(`${direction}:${section.id}`) || undefined}
									disabled={(direction === 'up' ? i === 0 : i === syllabus.sections.length - 1) ||
										pending.busy}
								>
									{#if pending.is(`${direction}:${section.id}`)}
										<LoaderCircle class="size-5 animate-spin" aria-hidden="true" />
									{:else if direction === 'up'}
										<ArrowUp class="size-5" aria-hidden="true" />
									{:else}
										<ArrowDown class="size-5" aria-hidden="true" />
									{/if}
								</Button>
							</form>
						{/each}
					</div>
				</div>
				{#if section.content}
					<RichText content={section.content} lang={section.contentLanguage} />
				{/if}
				<TextWithLinks
					links={section.links}
					empty={section.content || section.files.length > 0 ? '' : m.syllabus_section_empty()}
				/>
				<SyllabusFiles
					files={section.files}
					sectionId={section.id}
					{pending}
					{confirm}
					error={result?.fileError && result.fileSectionId === section.id
						? { fileId: result.fileId ?? null, message: result.fileError }
						: null}
				/>
				<div class="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row">
					<Button
						variant="outline"
						class={actionButton}
						disabled={pending.busy}
						data-testid="section-edit"
						onclick={() => setEditing(section.id, true)}
					>
						<Pencil aria-hidden="true" />
						{m.syllabus_section_edit()}
					</Button>
					<form
						method="POST"
						action="?/deleteSection"
						use:enhance={pending.submit(`delete:${section.id}`, {
							reset: false,
							// Read when asked: the action is set up once, the title may have been edited since.
							confirm: () =>
								confirm.ask(
									m.syllabus_section_delete_confirm({ title: section.title }),
									m.common_delete(),
									{ destructive: true }
								)
						})}
					>
						<input type="hidden" name="sectionId" value={section.id} />
						<Button
							type="submit"
							variant="destructive"
							class={actionButton}
							aria-busy={pending.is(`delete:${section.id}`) || undefined}
							disabled={pending.busy}
						>
							{#if pending.is(`delete:${section.id}`)}
								<LoaderCircle class="animate-spin" aria-hidden="true" />
							{:else}
								<Trash2 aria-hidden="true" />
							{/if}
							{m.syllabus_section_delete()}
						</Button>
					</form>
				</div>
			{/if}
		</section>
	{/each}

	<section class={ui.card}>
		<h2 class={ui.cardTitle}>{m.syllabus_section_add_heading()}</h2>
		<!-- novalidate: the server checks the title; its message is linked to the
		     field. A successful add resets the form, so the field is empty again. -->
		<form
			method="POST"
			action="?/addSection"
			novalidate
			use:enhance={pending.submit('add')}
			class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start"
		>
			<div class="flex min-w-0 flex-col gap-1.5 sm:flex-1">
				<Label for="section-title-new">{m.syllabus_section_title_label()}</Label>
				<Input
					id="section-title-new"
					name="title"
					maxlength={200}
					required
					aria-invalid={addTitleError ? 'true' : undefined}
					aria-describedby={addTitleError ? 'section-title-new-error' : undefined}
				/>
				{#if addTitleError}
					<p id="section-title-new-error" class={ui.error} role="alert">{addTitleError}</p>
				{/if}
			</div>
			<!-- Level with the input, which sits under its label. -->
			<Button
				type="submit"
				class="{actionButton} sm:mt-6.5"
				aria-busy={pending.is('add') || undefined}
				disabled={pending.busy}
			>
				{#if pending.is('add')}
					<LoaderCircle class="animate-spin" aria-hidden="true" />
				{:else}
					<Plus aria-hidden="true" />
				{/if}
				{m.syllabus_section_add_submit()}
			</Button>
		</form>
	</section>

	<section class={ui.card}>
		<Button
			variant="destructive"
			class={actionButton}
			aria-busy={pending.is('delete') || undefined}
			disabled={pending.busy}
			onclick={deleteSyllabus}
		>
			{#if pending.is('delete')}
				<LoaderCircle class="animate-spin" aria-hidden="true" />
			{:else}
				<Trash2 aria-hidden="true" />
			{/if}
			{m.syllabus_delete()}
		</Button>
	</section>

	<form
		bind:this={deleteForm}
		method="POST"
		action="?/delete"
		use:enhance={pending.submit('delete')}
		hidden
	>
		<input type="hidden" name="syllabusId" value={syllabus.id} />
	</form>
</div>

<ConfirmDialog {confirm} />
