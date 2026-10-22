<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import * as m from '$lib/paraglide/messages.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { ui } from '$lib/ui/classes';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';

	/**
	 * Editable list of reference links: homework (#27) and class syllabus (#32). Each row submits a
	 * `linkUrl` and a `linkLabel` field, read in order by parseReferenceLinks()
	 * in $lib/server/homework-details.ts. A row with an empty URL is ignored.
	 * Mobile-first story 7c: native fields in their own `data-ui="new"` root,
	 * so they also work in the syllabus forms. `mb-4` spaces it
	 * like the fields around it there.
	 */
	let {
		idPrefix,
		links = [],
		max = 10,
		legend = m.homework_links_legend()
	}: {
		idPrefix: string;
		links?: HomeworkReferenceLink[];
		max?: number;
		legend?: string;
	} = $props();

	type Row = { key: number; url: string; label: string };
	let nextKey = 0;
	const toRow = (link: HomeworkReferenceLink): Row => ({
		key: nextKey++,
		url: link.url,
		label: link.label ?? ''
	});

	// Start from the saved links, or one blank row. Only the initial value is
	// taken from props; after that the rows are edited locally.
	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>(links.length > 0 ? links.map(toRow) : [toRow({ url: '', label: null })]);

	function addRow() {
		if (rows.length < max) rows.push(toRow({ url: '', label: null }));
	}

	function removeRow(key: number) {
		rows = rows.filter((r) => r.key !== key);
		if (rows.length === 0) addRow();
	}

	const field = 'flex min-w-0 flex-col gap-1.5';
</script>

<fieldset data-ui="new" class="mb-4 flex min-w-0 flex-col gap-3">
	<legend class="mb-2 text-sm font-medium">{legend}</legend>
	{#each rows as row, i (row.key)}
		<!-- Phone: the URL on its own line, then label and remove; wider: one line. -->
		<div
			class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-x-2 gap-y-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
		>
			<div class="{field} col-span-2 md:col-span-1">
				<Label for="{idPrefix}-url-{row.key}">{m.homework_link_url_label()} {i + 1}</Label>
				<Input
					id="{idPrefix}-url-{row.key}"
					name="linkUrl"
					type="text"
					inputmode="url"
					maxlength={2000}
					value={row.url}
					oninput={(event) => (row.url = event.currentTarget.value)}
				/>
			</div>
			<div class={field}>
				<Label for="{idPrefix}-label-{row.key}">{m.homework_link_label_label()}</Label>
				<Input
					id="{idPrefix}-label-{row.key}"
					name="linkLabel"
					maxlength={100}
					value={row.label}
					oninput={(event) => (row.label = event.currentTarget.value)}
				/>
			</div>
			<Button
				type="button"
				variant="ghost"
				class="size-11"
				aria-label="{m.homework_link_remove()} {i + 1}"
				onclick={() => removeRow(row.key)}><Trash2 aria-hidden="true" /></Button
			>
		</div>
	{/each}
	{#if rows.length < max}
		<Button type="button" variant="outline" class="{ui.touch} w-full md:w-fit" onclick={addRow}
			><Plus aria-hidden="true" />{m.homework_link_add()}</Button
		>
	{/if}
</fieldset>
