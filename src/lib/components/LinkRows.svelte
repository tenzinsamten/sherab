<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';

	/**
	 * Editable list of reference links: homework (#27) and class syllabus (#32). Each row submits a
	 * `linkUrl` and a `linkLabel` field, read in order by parseReferenceLinks()
	 * in $lib/server/homework-details.ts. A row with an empty URL is ignored.
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
</script>

<fieldset class="check-list" style="margin-bottom: var(--space-4);">
	<legend>{legend}</legend>
	{#each rows as row, i (row.key)}
		<div class="link-row">
			<div class="field" style="margin:0;">
				<label for="{idPrefix}-url-{row.key}">{m.homework_link_url_label()} {i + 1}</label>
				<input
					id="{idPrefix}-url-{row.key}"
					name="linkUrl"
					type="text"
					inputmode="url"
					maxlength="2000"
					bind:value={row.url}
				/>
			</div>
			<div class="field" style="margin:0;">
				<label for="{idPrefix}-label-{row.key}">{m.homework_link_label_label()}</label>
				<input
					id="{idPrefix}-label-{row.key}"
					name="linkLabel"
					type="text"
					maxlength="100"
					bind:value={row.label}
				/>
			</div>
			<ix-icon-button
				icon="trashcan"
				variant="tertiary"
				aria-label="{m.homework_link_remove()} {i + 1}"
				onclick={() => removeRow(row.key)}
			></ix-icon-button>
		</div>
	{/each}
	{#if rows.length < max}
		<ix-button variant="secondary" icon="add" onclick={addRow}>{m.homework_link_add()}</ix-button>
	{/if}
</fieldset>

<style>
	.link-row {
		display: grid;
		grid-template-columns: 2fr 1fr auto;
		gap: var(--space-2);
		align-items: end;
		margin-bottom: var(--space-3);
	}

	@media (max-width: 40em) {
		.link-row {
			grid-template-columns: 1fr auto;
		}
		.link-row > :nth-child(2) {
			grid-column: 1;
		}
	}
</style>
