<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { ixValue } from '$lib/ix-fields';

	/**
	 * The name of a class or team in each language (#76), posted as `name`
	 * (English), `nameBo` (Tibetan) and `nameDe` (German). English and Tibetan
	 * are required; a missing German name shows the English one.
	 * `idPrefix` keeps the ids unique when several forms are on the page.
	 */
	let {
		label,
		idPrefix = '',
		values
	}: {
		label: string;
		idPrefix?: string;
		values?: { name?: string | null; nameBo?: string | null; nameDe?: string | null };
	} = $props();
</script>

<div class="name-fields">
	<div class="field">
		<ix-input
			id="{idPrefix}name"
			name="name"
			label={m.localized_name_label({ label, language: m.content_language_en() })}
			required
			{@attach ixValue(values?.name ?? '')}
		></ix-input>
	</div>
	<div class="field">
		<ix-input
			id="{idPrefix}name-bo"
			name="nameBo"
			lang="bo"
			label={m.localized_name_label({ label, language: m.content_language_bo() })}
			required
			{@attach ixValue(values?.nameBo ?? '')}
		></ix-input>
	</div>
	<div class="field">
		<ix-input
			id="{idPrefix}name-de"
			name="nameDe"
			label={m.localized_name_label({ label, language: m.content_language_de() })}
			{@attach ixValue(values?.nameDe ?? '')}
		></ix-input>
	</div>
</div>

<style>
	.name-fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0 var(--space-4);
	}
</style>
