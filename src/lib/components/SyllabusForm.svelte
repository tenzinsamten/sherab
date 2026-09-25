<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { createPending } from '$lib/pending.svelte';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';
	import LinkRows from './LinkRows.svelte';

	/**
	 * Edit form for a class syllabus (#32), posting `syllabus` plus LinkRows'
	 * link fields to `action`. `classId` is sent as a hidden field for pages
	 * that list several classes (/admin/classes); the teacher class page takes
	 * it from the route instead.
	 */
	let {
		action,
		idPrefix,
		syllabus,
		links,
		classId
	}: {
		action: string;
		idPrefix: string;
		syllabus: string | null;
		links: HomeworkReferenceLink[];
		classId?: string;
	} = $props();

	const pending = createPending();
</script>

<form method="POST" {action} use:enhance={pending.submit('syllabus')}>
	{#if classId}
		<input type="hidden" name="classId" value={classId} />
	{/if}
	<div class="field">
		<label for="{idPrefix}-syllabus">{m.syllabus_label()}</label>
		<textarea
			id="{idPrefix}-syllabus"
			name="syllabus"
			rows="6"
			maxlength="5000"
			value={syllabus ?? ''}></textarea>
	</div>
	<LinkRows {idPrefix} {links} legend={m.syllabus_links_legend()} />
	<ix-button
		type="submit"
		loading={pending.is('syllabus') || undefined}
		disabled={pending.busy || undefined}>{m.syllabus_submit()}</ix-button
	>
</form>
