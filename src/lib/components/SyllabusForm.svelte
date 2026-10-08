<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { ixFieldError, ixValue } from '$lib/ix-fields';
	import type { createPending } from '$lib/pending.svelte';
	import type { ContentLanguage, RichTextDoc } from '$lib/rich-text';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';
	import ContentLanguageSelect from './ContentLanguageSelect.svelte';
	import LinkRows from './LinkRows.svelte';
	import RichTextEditor from './RichTextEditor.svelte';

	/**
	 * Edit form for one syllabus section (0038), posting `sectionId`, `title`,
	 * the editor's `content`, `contentLanguage` and LinkRows' link fields to
	 * `?/updateSection`. The title is required; the description is rich text
	 * in a chosen language, like homework content (#75), and stays optional.
	 * `titleError` is the server's message for a wrong title, shown under the
	 * field. `pending` is the page's, so every button waits for one answer.
	 */
	let {
		section,
		titleError,
		pending,
		oncancel
	}: {
		section: {
			id: string;
			title: string;
			content: RichTextDoc | null;
			contentLanguage: ContentLanguage;
			links: HomeworkReferenceLink[];
		};
		titleError?: string;
		pending: ReturnType<typeof createPending>;
		oncancel: () => void;
	} = $props();

	// Always the language the section was saved in (a new one is created in
	// the teacher's interface language), so saving never changes it unasked.
	let contentLanguage = $state<ContentLanguage>(untrack(() => section.contentLanguage));
	let saveKey = $derived(`save:${section.id}`);
	let errorId = $derived(`section-title-error-${section.id}`);
</script>

<!-- novalidate: the server checks the title and its message is linked to the
     field (ixFieldError). reset: false keeps what was typed if saving fails. -->
<form
	method="POST"
	action="?/updateSection"
	novalidate
	use:enhance={pending.submit(() => saveKey, { reset: false })}
>
	<input type="hidden" name="sectionId" value={section.id} />
	<div class="field">
		<ix-input
			id="section-title-{section.id}"
			name="title"
			label={m.syllabus_section_title_label()}
			max-length="200"
			required
			{@attach ixValue(section.title)}
			{@attach ixFieldError(titleError ? errorId : undefined)}
		></ix-input>
		{#if titleError}
			<p id={errorId} class="field-error" role="alert">{titleError}</p>
		{/if}
	</div>
	<ContentLanguageSelect
		id="section-language-{section.id}"
		label={m.syllabus_section_language_label()}
		bind:value={contentLanguage}
	/>
	<RichTextEditor
		id="section-content-{section.id}"
		label={m.syllabus_section_description_label()}
		lang={contentLanguage}
		initial={section.content}
	/>
	<LinkRows
		idPrefix="section-{section.id}"
		links={section.links}
		legend={m.syllabus_section_links_legend()}
	/>
	<div class="actions">
		<ix-button
			type="submit"
			loading={pending.is(saveKey) || undefined}
			disabled={pending.busy || undefined}>{m.syllabus_section_submit()}</ix-button
		>
		<ix-button variant="secondary" disabled={pending.busy || undefined} onclick={oncancel}>
			{m.common_cancel()}
		</ix-button>
	</div>
</form>
