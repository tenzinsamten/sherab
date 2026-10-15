<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { ixFieldError, ixValue } from '$lib/ix-fields';
	import { BADGE_SUBJECTS, badgeSubjectLabel } from '$lib/badge-subject';

	/**
	 * A class's badge subject (badge detail CAP-1), posted as `badgeSubject`.
	 * Required in the admin's create and edit forms; `value` is the subject to
	 * show ('' or null for none picked yet), `error` the inline message.
	 */
	let {
		id,
		value = null,
		error = null
	}: { id: string; value?: string | null; error?: string | null } = $props();

	const errorId = $derived(`${id}-error`);
</script>

<div class="field">
	<!-- Remounted when the incoming value changes: <ix-select> takes its form
	     value only on load and on user picks, not on later `value` writes. -->
	{#key value ?? ''}
		<ix-select
			{id}
			name="badgeSubject"
			label={m.badge_subject_label()}
			required
			{@attach ixValue(value || null)}
			{@attach ixFieldError(error ? errorId : undefined)}
		>
			{#each BADGE_SUBJECTS as subject (subject)}
				<ix-select-item value={subject} label={badgeSubjectLabel(subject)}></ix-select-item>
			{/each}
		</ix-select>
	{/key}
	{#if error}
		<p id={errorId} class="field-error" role="alert">{error}</p>
	{/if}
</div>

<style>
	.field {
		margin-bottom: var(--space-3);
	}
	.field-error {
		margin: 0;
	}
</style>
