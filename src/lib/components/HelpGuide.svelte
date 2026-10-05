<script lang="ts">
	import { num } from '$lib/format';
	import { HELP_IMAGE_SIZE, helpGuides, helpImageSrc, type HelpRole } from '$lib/help';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';

	/** One role's numbered guide (#87), on /help and in the menu's help overlay. */
	let { role }: { role: HelpRole } = $props();
</script>

<ol class="steps">
	{#each helpGuides[role] as step, i (i)}
		<li>
			<span class="step-number" aria-hidden="true">{num(i + 1)}</span>
			<div>
				<h3>{step.title()}</h3>
				<p>{step.body()}</p>
				{#if step.image}
					<img
						class="screenshot"
						src={helpImageSrc(step.image, getLocale())}
						alt={m.help_screenshot_alt({ title: step.title() })}
						width={HELP_IMAGE_SIZE.width}
						height={HELP_IMAGE_SIZE.height}
						loading="lazy"
					/>
				{/if}
			</div>
		</li>
	{/each}
</ol>

<style>
	.steps {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.steps > li {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
	}

	.steps > li > div {
		min-width: 0;
	}

	.step-number {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: var(--theme-color-primary);
		color: var(--theme-color-primary--contrast);
		font-weight: var(--theme-font-weight-bold);
	}

	.steps h3 {
		margin: 0 0 var(--space-1);
		font-size: var(--theme-font-size-l);
	}

	.steps p {
		margin: 0;
		max-width: 70ch;
	}

	/* Phone-size pictures of the page the step talks about. */
	.screenshot {
		display: block;
		width: 100%;
		max-width: 17.5rem;
		height: auto;
		margin-top: var(--space-3);
		border: 1px solid var(--theme-color-soft-bdr, rgba(0, 0, 0, 0.1));
		border-radius: var(--theme-default-border-radius);
	}
</style>
