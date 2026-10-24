<script lang="ts">
	import { cn } from '$lib/utils';
	import { num } from '$lib/format';

	/**
	 * #60: the Requests count as a pill. Shown only: the nav entry reads out
	 * the count after its label (CountText).
	 */
	let { count, class: className = '' }: { count: number; class?: string } = $props();
</script>

<span
	aria-hidden="true"
	data-count-pill
	class={cn(
		'inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums',
		className
	)}
>
	{num(count)}
</span>
