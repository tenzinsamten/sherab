<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	/**
	 * The name of a class or team in each language (#76), posted as `name`
	 * (English), `nameBo` (Tibetan) and `nameDe` (German). English and Tibetan
	 * are required; a missing German name shows the English one.
	 * `idPrefix` keeps the ids unique when several forms are on the page.
	 *
	 * Mobile-first story 9: native fields in their own `data-ui="new"` root.
	 * They take part in form reset, so a successful create clears them
	 * without a remount.
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

	const fields = $derived([
		{
			id: `${idPrefix}name`,
			name: 'name',
			lang: undefined,
			language: m.content_language_en(),
			required: true,
			value: values?.name ?? ''
		},
		{
			id: `${idPrefix}name-bo`,
			name: 'nameBo',
			lang: 'bo',
			language: m.content_language_bo(),
			required: true,
			value: values?.nameBo ?? ''
		},
		{
			id: `${idPrefix}name-de`,
			name: 'nameDe',
			lang: undefined,
			language: m.content_language_de(),
			required: false,
			value: values?.nameDe ?? ''
		}
	]);
</script>

<div
	data-ui="new"
	class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] md:gap-x-4"
>
	{#each fields as field (field.id)}
		<div class="flex min-w-0 flex-col gap-1.5">
			<Label for={field.id} class="text-sm font-medium wrap-break-word">
				{m.localized_name_label({ label, language: field.language })}
			</Label>
			<Input
				id={field.id}
				name={field.name}
				lang={field.lang}
				required={field.required}
				autocomplete="off"
				value={field.value}
			/>
		</div>
	{/each}
</div>
