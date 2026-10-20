<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';

	/**
	 * The student registration flow as a stepper (#63): class code → name →
	 * parent consent → waiting for approval. /join shows steps 1–3 as the
	 * student goes; /join/pending shows step 4. Finished steps before
	 * `current` are buttons when `onselect` is given (going back keeps the
	 * typed values); the current and later steps are not.
	 *
	 * Mobile-first story 6b: an ordered list in its own `data-ui="new"` root,
	 * one step per row so long labels (de, bo) wrap instead of being cut. The
	 * current step is `aria-current="step"`; a finished one shows a check
	 * mark and is read as "<label>, done" (one message per language), not
	 * only a colour.
	 */
	type Step = 1 | 2 | 3 | 4;
	let { current, onselect }: { current: Step; onselect?: (step: Step) => void } = $props();

	const labels = [m.join_step_code, m.join_step_name, m.join_step_consent, m.join_step_waiting];

	const row = 'flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1 text-start';
	const mark =
		'inline-flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums';
</script>

<div data-ui="new" data-testid="join-steps" class="mb-6 min-w-0">
	<p class="sr-only" aria-live="polite">
		{m.join_step_progress({ step: num(current), label: labels[current - 1]() })}
	</p>
	<ol class="flex min-w-0 flex-col gap-1">
		{#each labels as label, i (i)}
			{@const step = (i + 1) as Step}
			{@const done = step < current}
			<li
				class="min-w-0"
				aria-current={step === current ? 'step' : undefined}
				data-state={done ? 'done' : step === current ? 'current' : 'upcoming'}
			>
				{#snippet content()}
					<span
						class="{mark} {done
							? 'border-success bg-success text-primary-foreground'
							: step === current
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-input text-muted-foreground'}"
						aria-hidden="true"
					>
						{#if done}<Check class="size-4" strokeWidth={3} />{:else}{num(step)}{/if}
					</span>
					<span
						data-step-label
						class="min-w-0 wrap-break-word {step === current
							? 'font-bold'
							: done
								? ''
								: 'text-muted-foreground'}"
					>
						{#if done}
							<span aria-hidden="true">{label()}</span>
							<span class="sr-only" data-step-sr>{m.join_step_label_done({ label: label() })}</span>
						{:else}
							{label()}
						{/if}
					</span>
				{/snippet}
				{#if done && onselect}
					<!-- Named outright, so the name is the one message. -->
					<button
						type="button"
						aria-label={m.join_step_label_done({ label: label() })}
						class="{row} cursor-pointer hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						onclick={() => onselect(step)}
					>
						{@render content()}
					</button>
				{:else}
					<div class={row}>{@render content()}</div>
				{/if}
			</li>
		{/each}
	</ol>
</div>
