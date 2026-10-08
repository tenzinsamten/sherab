<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick, untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { confirmAction, confirmWith, showToast } from '$lib/ix';
	import { ixFieldError } from '$lib/ix-fields';
	import { createPending } from '$lib/pending.svelte';
	import { formatSchoolYear } from '$lib/school-year';
	import type { ContentLanguage, RichTextDoc } from '$lib/rich-text';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';
	import RichText from './RichText.svelte';
	import SyllabusForm from './SyllabusForm.svelte';
	import TextWithLinks from './TextWithLinks.svelte';

	/**
	 * One syllabus (#37) as its sections (0038): each with Edit, move up /
	 * down and Delete, then the "Add a section" form and "Delete syllabus".
	 * Posts to `?/addSection`, `?/updateSection`, `?/moveSection`,
	 * `?/deleteSection` and `?/delete`. `result` is the page's latest action
	 * result (`form`): it opens a section that was just added or failed to
	 * save, closes one that was saved, and carries a wrong title's message.
	 */
	type Section = {
		id: string;
		title: string;
		content: RichTextDoc | null;
		contentLanguage: ContentLanguage;
		links: HomeworkReferenceLink[];
	};
	type Result = {
		action?: 'sectionAdded' | 'sectionSaved' | 'sectionMoved' | 'sectionDeleted';
		sectionId?: string | null;
		titleError?: string;
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
	// Bumped after each add: <ix-input> takes no part in a form reset.
	let addKey = $state(0);

	const pending = createPending();
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
			if (r.action === 'sectionAdded') {
				addKey += 1;
				showToast('success', m.syllabus_section_added());
			}
			if (r.action === 'sectionSaved' && r.sectionId) {
				setEditing(r.sectionId, false);
				showToast('success', m.syllabus_section_saved());
			}
			if (r.action === 'sectionDeleted') {
				if (r.sectionId) setEditing(r.sectionId, false);
				showToast('success', m.syllabus_section_deleted());
			}
		});
	});

	let addTitleError = $derived(result?.titleError && !result.sectionId ? result.titleError : '');

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

{#if syllabus.sections.length === 0}
	<section class="card">
		<p class="muted" style="margin:0;">{m.syllabus_section_none()}</p>
	</section>
{/if}

{#each syllabus.sections as section, i (section.id)}
	<section class="card" data-section-id={section.id}>
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
			<div class="section-head">
				<h2 class="section-title" lang={section.contentLanguage}>{section.title}</h2>
				<div class="section-moves">
					{#each ['up', 'down'] as const as direction (direction)}
						<form
							method="POST"
							action="?/moveSection"
							use:enhance={pending.submit(`${direction}:${section.id}`, { reset: false })}
						>
							<input type="hidden" name="sectionId" value={section.id} />
							<input type="hidden" name="direction" value={direction} />
							<ix-icon-button
								type="submit"
								icon={direction === 'up' ? 'arrow-up' : 'arrow-down'}
								variant="tertiary"
								aria-label={direction === 'up'
									? m.syllabus_section_move_up({ title: section.title })
									: m.syllabus_section_move_down({ title: section.title })}
								loading={pending.is(`${direction}:${section.id}`) || undefined}
								disabled={(direction === 'up' ? i === 0 : i === syllabus.sections.length - 1) ||
									pending.busy ||
									undefined}
							></ix-icon-button>
						</form>
					{/each}
				</div>
			</div>
			{#if section.content}
				<RichText content={section.content} lang={section.contentLanguage} />
			{/if}
			<TextWithLinks
				links={section.links}
				empty={section.content ? '' : m.syllabus_section_empty()}
			/>
			<div class="actions" style="margin-top: var(--space-4);">
				<ix-button
					icon="pen"
					disabled={pending.busy || undefined}
					onclick={() => setEditing(section.id, true)}>{m.syllabus_section_edit()}</ix-button
				>
				<form
					method="POST"
					action="?/deleteSection"
					use:enhance={pending.submit(`delete:${section.id}`, {
						reset: false,
						confirm: confirmWith(
							m.syllabus_section_delete_confirm({ title: section.title }),
							m.common_delete()
						)
					})}
				>
					<input type="hidden" name="sectionId" value={section.id} />
					<ix-button
						type="submit"
						variant="danger-secondary"
						icon="trashcan"
						loading={pending.is(`delete:${section.id}`) || undefined}
						disabled={pending.busy || undefined}>{m.syllabus_section_delete()}</ix-button
					>
				</form>
			</div>
		{/if}
	</section>
{/each}

<section class="card">
	<h2>{m.syllabus_section_add_heading()}</h2>
	<!-- novalidate: the server checks the title; its message is linked to the field. -->
	<form
		method="POST"
		action="?/addSection"
		novalidate
		use:enhance={pending.submit('add', { reset: false })}
		class="actions add-form"
	>
		<div class="field add-title">
			{#key addKey}
				<ix-input
					id="section-title-new"
					name="title"
					label={m.syllabus_section_title_label()}
					max-length="200"
					required
					{@attach ixFieldError(addTitleError ? 'section-title-new-error' : undefined)}
				></ix-input>
			{/key}
			{#if addTitleError}
				<p id="section-title-new-error" class="field-error" role="alert">{addTitleError}</p>
			{/if}
		</div>
		<ix-button
			type="submit"
			icon="add"
			loading={pending.is('add') || undefined}
			disabled={pending.busy || undefined}>{m.syllabus_section_add_submit()}</ix-button
		>
	</form>
</section>

<section class="card">
	<div class="actions">
		<ix-button
			variant="danger-secondary"
			icon="trashcan"
			loading={pending.is('delete') || undefined}
			disabled={pending.busy || undefined}
			onclick={deleteSyllabus}>{m.syllabus_delete()}</ix-button
		>
	</div>
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

<style>
	.section-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
	}

	/* A long title wraps beside the move buttons instead of pushing them out. */
	.section-title {
		margin-top: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.section-moves {
		display: flex;
		flex: none;
		gap: var(--space-1);
	}

	.add-form {
		align-items: flex-start;
	}

	.add-title {
		flex: 1 1 16rem;
		margin: 0;
	}

	/* Level with the input, which sits under its label. */
	.add-form > ix-button {
		margin-top: 1.5rem;
	}
</style>
