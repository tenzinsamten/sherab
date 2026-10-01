<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { confirmAction, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import { formatSchoolYear } from '$lib/school-year';
	import type { ContentLanguage, RichTextDoc } from '$lib/rich-text';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';
	import RichText from './RichText.svelte';
	import SyllabusForm from './SyllabusForm.svelte';
	import TextWithLinks from './TextWithLinks.svelte';

	/**
	 * One syllabus (#37): view with Edit / Delete, or the edit form. Opens in
	 * edit mode when `startInEdit` (just added, `?edit=1`) or when it's empty.
	 */
	let {
		syllabus,
		startInEdit,
		saved
	}: {
		syllabus: {
			id: string;
			schoolYear: number;
			content: RichTextDoc | null;
			contentLanguage: ContentLanguage;
			links: HomeworkReferenceLink[];
		};
		startInEdit: boolean;
		/** True right after a successful save (the page's `form.action`). */
		saved: boolean;
	} = $props();

	// svelte-ignore state_referenced_locally
	let editing = $state(startInEdit || (!syllabus.content && syllabus.links.length === 0));

	const pending = createPending();
	let deleteForm: HTMLFormElement | undefined = $state();

	// Reads only `saved`, so setting `editing` here can't re-trigger it.
	$effect(() => {
		if (!saved) return;
		showToast('success', m.syllabus_saved());
		editing = false;
	});

	async function deleteSyllabus() {
		const ok = await confirmAction(
			m.common_confirm_title(),
			m.syllabus_delete_confirm({ year: formatSchoolYear(syllabus.schoolYear) }),
			m.common_delete(),
			m.common_cancel()
		);
		if (!ok) return;
		await tick();
		deleteForm?.requestSubmit();
	}
</script>

<section class="card">
	{#if editing}
		<SyllabusForm
			syllabusId={syllabus.id}
			syllabus={syllabus.content}
			language={syllabus.contentLanguage}
			links={syllabus.links}
			oncancel={() => (editing = false)}
		/>
	{:else}
		{#if syllabus.content}
			<RichText content={syllabus.content} lang={syllabus.contentLanguage} />
		{/if}
		<TextWithLinks links={syllabus.links} empty={syllabus.content ? '' : m.syllabus_empty()} />
		<div class="actions" style="margin-top: var(--space-4);">
			<ix-button icon="pen" onclick={() => (editing = true)}>{m.syllabus_edit()}</ix-button>
			<ix-button
				variant="danger-secondary"
				icon="trashcan"
				loading={pending.is('delete') || undefined}
				disabled={pending.busy || undefined}
				onclick={deleteSyllabus}>{m.syllabus_delete()}</ix-button
			>
		</div>
	{/if}
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
