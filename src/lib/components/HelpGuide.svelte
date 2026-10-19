<script lang="ts">
	import { num } from '$lib/format';
	import { HELP_IMAGE_SIZE, helpGuides, helpImageSrc, type HelpRole } from '$lib/help';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';

	/**
	 * One role's numbered guide (#87), on /help and in the shell's help sheet.
	 * Its own `data-ui="new"` root (mobile-first story 5).
	 */
	let { role }: { role: HelpRole } = $props();
</script>

<ol data-ui="new" class="flex min-w-0 flex-col gap-4" data-testid="help-guide">
	{#each helpGuides[role] as step, i (i)}
		<li class="flex items-start gap-3">
			<span
				class="inline-flex size-8 flex-none items-center justify-center rounded-full bg-primary font-bold text-primary-foreground"
				aria-hidden="true">{num(i + 1)}</span
			>
			<div class="min-w-0">
				<h3 class="mb-1 text-base leading-snug font-bold wrap-break-word">{step.title()}</h3>
				<p class="max-w-prose wrap-break-word">{step.body()}</p>
				{#if step.image}
					<!-- Phone-size pictures of the page the step talks about. -->
					<img
						class="mt-3 block h-auto w-full max-w-70 rounded-md border border-border"
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
