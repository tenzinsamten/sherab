<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import * as m from '$lib/paraglide/messages.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { createPending } from '$lib/pending.svelte';
	import type { ContentLanguage, RichTextDoc } from '$lib/rich-text';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';
	import { ui } from '$lib/ui/classes';
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
	 * Mobile-first story 8: native fields in its own `data-ui="new"` root.
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
     field. reset: false keeps what was typed if saving fails. -->
<form
	data-ui="new"
	class="flex min-w-0 flex-col"
	method="POST"
	action="?/updateSection"
	novalidate
	use:enhance={pending.submit(() => saveKey, { reset: false })}
>
	<input type="hidden" name="sectionId" value={section.id} />
	<div class="mb-4 flex min-w-0 flex-col gap-1.5">
		<Label for="section-title-{section.id}">{m.syllabus_section_title_label()}</Label>
		<Input
			id="section-title-{section.id}"
			name="title"
			lang={contentLanguage}
			maxlength={200}
			required
			value={section.title}
			aria-invalid={titleError ? 'true' : undefined}
			aria-describedby={titleError ? errorId : undefined}
		/>
		{#if titleError}
			<p id={errorId} class={ui.error} role="alert">{titleError}</p>
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
	<div class="flex min-w-0 flex-col gap-2 sm:flex-row">
		<Button
			type="submit"
			class="{ui.touch} w-full gap-2 sm:w-auto"
			aria-busy={pending.is(saveKey) || undefined}
			disabled={pending.busy}
		>
			{#if pending.is(saveKey)}
				<LoaderCircle class="animate-spin" aria-hidden="true" />
			{/if}
			{m.syllabus_section_submit()}
		</Button>
		<Button
			variant="outline"
			class="{ui.touch} w-full sm:w-auto"
			disabled={pending.busy}
			onclick={oncancel}
		>
			{m.common_cancel()}
		</Button>
	</div>
</form>
