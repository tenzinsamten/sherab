<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import { BADGE_SUBJECTS, badgeSubjectLabel } from '$lib/badge-subject';
	import { ui } from '$lib/ui/classes';

	/**
	 * A class's badge subject (badge detail CAP-1), posted as `badgeSubject`.
	 * Required in the admin's create and edit forms; `value` is the subject to
	 * show ('' or null for none picked yet), `error` the inline message.
	 *
	 * Mobile-first story 9: a native select in its own `data-ui="new"` root.
	 * The empty first option is "Not set"; the select takes part in form
	 * reset, so a successful create clears it without a remount.
	 */
	let {
		id,
		value = null,
		error = null
	}: { id: string; value?: string | null; error?: string | null } = $props();

	const errorId = $derived(`${id}-error`);
	const selected = $derived(value || '');
</script>

<div data-ui="new" class="flex min-w-0 flex-col gap-1.5">
	<Label for={id} class="text-sm font-medium wrap-break-word">{m.badge_subject_label()}</Label>
	<NativeSelect.Root
		{id}
		name="badgeSubject"
		class="w-full md:max-w-xs"
		required
		value={selected}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? errorId : undefined}
	>
		<NativeSelect.Option value="" selected={selected === ''}>
			{m.badge_subject_not_set()}
		</NativeSelect.Option>
		{#each BADGE_SUBJECTS as subject (subject)}
			<NativeSelect.Option value={subject} selected={selected === subject}>
				{badgeSubjectLabel(subject)}
			</NativeSelect.Option>
		{/each}
	</NativeSelect.Root>
	{#if error}
		<p id={errorId} class={ui.error} role="alert">{error}</p>
	{/if}
</div>
