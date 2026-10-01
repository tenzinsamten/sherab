<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { ixValue } from '$lib/ix-fields';
	import { CONTENT_LANGUAGES, isContentLanguage, type ContentLanguage } from '$lib/rich-text';

	/**
	 * The language a homework is written in (#74), posted as
	 * `contentLanguage`. It selects the font of the title and content for
	 * every viewer; `value` is bound so the form can show that font while the
	 * teacher types.
	 */
	let {
		id,
		label = m.homework_content_language_label(),
		value = $bindable()
	}: { id: string; label?: string; value: ContentLanguage } = $props();

	function languageLabel(language: ContentLanguage): string {
		if (language === 'bo') return m.content_language_bo();
		if (language === 'de') return m.content_language_de();
		return m.content_language_en();
	}

	// <ix-select> emits valueChange but doesn't change the bound state itself.
	function pick(event: CustomEvent<string | string[]>) {
		const picked = Array.isArray(event.detail) ? event.detail[0] : event.detail;
		if (isContentLanguage(picked)) value = picked;
	}
</script>

<div class="field">
	<ix-select
		{id}
		name="contentLanguage"
		{label}
		required
		onvalueChange={pick}
		{@attach ixValue(value)}
	>
		{#each CONTENT_LANGUAGES as language (language)}
			<ix-select-item value={language} label={languageLabel(language)}></ix-select-item>
		{/each}
	</ix-select>
</div>
