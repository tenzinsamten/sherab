<script module lang="ts">
	export type ChildPickerOption = { key: string; href: string; label: string; current: boolean };
</script>

<script lang="ts">
	/**
	 * A parent's child picker (#58, #59): pill links, one per option, the
	 * current one marked. Each `href` is already resolve()d by the caller.
	 * Its own `data-ui="new"` root (mobile-first story 3), so it also works
	 * on the calendar.
	 */
	let { label, options }: { label: string; options: ChildPickerOption[] } = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href is resolve()d by the caller. -->
<nav data-ui="new" class="mb-4 flex flex-wrap gap-2" aria-label={label}>
	{#each options as option (option.key)}
		<a
			href={option.href}
			class="inline-flex min-h-11 items-center rounded-full border border-border bg-background px-4 text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
			aria-current={option.current ? 'page' : undefined}>{option.label}</a
		>
	{/each}
</nav>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
