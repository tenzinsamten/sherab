<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { cn } from '$lib/utils.js';

	/**
	 * Sherab: an empty or failed section (replaces iX's `ix-empty-state`): an
	 * icon, a heading line and an optional line below it. #126: `children`
	 * is the next step (a link or a value to copy), under the text.
	 */
	let {
		header,
		subHeader,
		icon: Icon,
		class: className,
		children
	}: {
		header: string;
		subHeader?: string;
		/** A Lucide icon component. */
		icon?: Component<{ class?: string; 'aria-hidden'?: boolean }>;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<Empty.Root class={cn('gap-3 p-4 md:p-6', className)} data-testid="empty-state">
	<Empty.Header class="max-w-prose">
		{#if Icon}
			<Empty.Media variant="icon" class="size-11 rounded-full text-muted-foreground">
				<Icon class="size-5" aria-hidden={true} />
			</Empty.Media>
		{/if}
		<Empty.Title class="text-base font-semibold">{header}</Empty.Title>
		{#if subHeader}
			<Empty.Description class="text-base text-muted-foreground">{subHeader}</Empty.Description>
		{/if}
	</Empty.Header>
	{#if children}
		<Empty.Content>{@render children()}</Empty.Content>
	{/if}
</Empty.Root>
