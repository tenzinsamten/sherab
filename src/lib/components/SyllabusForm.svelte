<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { createPending } from '$lib/pending.svelte';
	import { readContentLanguage, type ContentLanguage, type RichTextDoc } from '$lib/rich-text';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';
	import ContentLanguageSelect from './ContentLanguageSelect.svelte';
	import LinkRows from './LinkRows.svelte';
	import RichTextEditor from './RichTextEditor.svelte';

	/**
	 * Edit form for one class syllabus (#37), posting `syllabusId`, the
	 * editor's `content`, `contentLanguage` and LinkRows' link fields to
	 * `?/update`. The text is rich text in a chosen language, like homework
	 * content (#75), and stays optional. `oncancel` shows a Cancel button.
	 */
	let {
		syllabusId,
		syllabus,
		language,
		links,
		oncancel
	}: {
		syllabusId: string;
		syllabus: RichTextDoc | null;
		language: ContentLanguage;
		links: HomeworkReferenceLink[];
		oncancel?: () => void;
	} = $props();

	const pending = createPending();
	// A syllabus with no text yet starts in the teacher's interface language;
	// one with text keeps the language it was saved in.
	let contentLanguage = $state<ContentLanguage>(
		untrack(() => (syllabus ? language : readContentLanguage(getLocale())))
	);
</script>

<form method="POST" action="?/update" use:enhance={pending.submit('syllabus')}>
	<input type="hidden" name="syllabusId" value={syllabusId} />
	<ContentLanguageSelect
		id="syllabus-language-{syllabusId}"
		label={m.syllabus_language_label()}
		bind:value={contentLanguage}
	/>
	<RichTextEditor
		id="syllabus-{syllabusId}"
		label={m.syllabus_label()}
		lang={contentLanguage}
		initial={syllabus}
	/>
	<LinkRows idPrefix="syllabus-{syllabusId}" {links} legend={m.syllabus_links_legend()} />
	<div class="actions">
		<ix-button
			type="submit"
			loading={pending.is('syllabus') || undefined}
			disabled={pending.busy || undefined}>{m.syllabus_submit()}</ix-button
		>
		{#if oncancel}
			<ix-button variant="secondary" disabled={pending.busy || undefined} onclick={oncancel}>
				{m.common_cancel()}
			</ix-button>
		{/if}
	</div>
</form>
