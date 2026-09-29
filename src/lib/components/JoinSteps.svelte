<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';

	/**
	 * The student registration flow as iX workflow steps (#63): class code →
	 * name → parent consent → waiting for approval. /join shows steps 1–3 as
	 * the student goes; /join/pending shows step 4. Finished steps before
	 * `current` are clickable when `onselect` is given (going back keeps the
	 * typed values); the current and later steps are not.
	 */
	type Step = 1 | 2 | 3 | 4;
	let { current, onselect }: { current: Step; onselect?: (step: Step) => void } = $props();

	const labels = [m.join_step_code, m.join_step_name, m.join_step_consent, m.join_step_waiting];

	function onStepSelected(event: CustomEvent<number>) {
		const target = event.detail + 1;
		// iX would move the selection itself: only finished steps may be picked.
		if (!onselect || target >= current) {
			event.preventDefault();
			return;
		}
		onselect(target as Step);
	}
</script>

<p class="sr-only" aria-live="polite">
	{m.join_step_progress({ step: `${current}`, label: labels[current - 1]() })}
</p>
<!-- Keyed: <ix-workflow-steps> reads selected-index only when it loads.
     Vertical: each horizontal step is a fixed 12rem with a one-line,
     ellipsised label, so four of them overflow the card. -->
{#key current}
	<ix-workflow-steps
		class="join-steps"
		vertical
		selected-index={current - 1}
		clickable={onselect ? true : undefined}
		onstepSelected={onStepSelected}
	>
		{#each labels as label, i (i)}
			<ix-workflow-step
				status={i + 1 < current ? 'success' : 'open'}
				disabled={onselect && i + 1 > current ? true : undefined}>{label()}</ix-workflow-step
			>
		{/each}
	</ix-workflow-steps>
{/key}

<style>
	.join-steps {
		display: block;
		margin-bottom: var(--space-5);
	}
</style>
