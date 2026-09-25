<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { createPending } from '$lib/pending.svelte';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';
	import LinkRows from './LinkRows.svelte';

	/**
	 * Edit form for one class syllabus (#37), posting `syllabusId`, `syllabus`
	 * and LinkRows' link fields to `?/update`. `oncancel` shows a Cancel button.
	 */
	let {
		syllabusId,
		syllabus,
		links,
		oncancel
	}: {
		syllabusId: string;
		syllabus: string | null;
		links: HomeworkReferenceLink[];
		oncancel?: () => void;
	} = $props();

	const pending = createPending();
</script>

<form method="POST" action="?/update" use:enhance={pending.submit('syllabus')}>
	<input type="hidden" name="syllabusId" value={syllabusId} />
	<div class="field">
		<label for="syllabus-{syllabusId}">{m.syllabus_label()}</label>
		<textarea
			id="syllabus-{syllabusId}"
			name="syllabus"
			rows="10"
			maxlength="5000"
			value={syllabus ?? ''}></textarea>
	</div>
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
