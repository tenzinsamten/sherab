<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import { CONTENT_LANGUAGES, isContentLanguage, type ContentLanguage } from '$lib/rich-text';

	/**
	 * The language a homework is written in (#74), posted as
	 * `contentLanguage`. It selects the font of the title and content for
	 * every viewer; `value` is bound so the form can show that font while the
	 * teacher types. Mobile-first story 7c: a native select in its own
	 * `data-ui="new"` root, so it also works in the syllabus forms.
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
</script>

<!-- #101: `data-tour` is what the new-homework tour points at. -->
<div data-ui="new" class="mb-4 flex min-w-0 flex-col gap-1.5" data-tour="homework-language">
	<Label for={id}>{label}</Label>
	<NativeSelect.Root
		{id}
		name="contentLanguage"
		class="w-full"
		required
		bind:value={
			() => value,
			(picked) => {
				if (isContentLanguage(picked)) value = picked;
			}
		}
	>
		{#each CONTENT_LANGUAGES as language (language)}
			<NativeSelect.Option value={language}>{languageLabel(language)}</NativeSelect.Option>
		{/each}
	</NativeSelect.Root>
</div>
