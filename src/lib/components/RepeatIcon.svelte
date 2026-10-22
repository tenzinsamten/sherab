<script lang="ts">
	import Repeat from '@lucide/svelte/icons/repeat';

	/**
	 * Recurring-assignment indicator icon (Story 3-2): Lucide's "repeat",
	 * shared by the teacher and student homework views. Since the
	 * mobile-first redesign (story 4) it is the `@lucide/svelte` icon, no
	 * longer a copied path; a bare inline icon, so it needs no
	 * `data-ui="new"` root and sits inside a pill.
	 */
	let { size = 14 }: { size?: number } = $props();
</script>

<Repeat
	{size}
	strokeWidth={2.5}
	class="inline-block shrink-0 align-[-0.125em]"
	aria-hidden="true"
	focusable="false"
/>
