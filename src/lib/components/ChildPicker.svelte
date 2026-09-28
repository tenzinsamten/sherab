<script module lang="ts">
	export type ChildPickerOption = { key: string; href: string; label: string; current: boolean };
</script>

<script lang="ts">
	/**
	 * A parent's child picker (#58, #59): pill links, one per option, the
	 * current one marked. Each `href` is already resolve()d by the caller.
	 */
	let { label, options }: { label: string; options: ChildPickerOption[] } = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href is resolve()d by the caller. -->
<nav class="child-picker" aria-label={label}>
	{#each options as option (option.key)}
		<a href={option.href} class="child-pick" aria-current={option.current ? 'page' : undefined}
			>{option.label}</a
		>
	{/each}
</nav>

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	.child-picker {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0 0 var(--space-4);
	}
	.child-pick {
		display: inline-flex;
		align-items: center;
		min-height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--theme-color-soft-bdr);
		border-radius: 999px;
		color: var(--theme-color-std-text);
		text-decoration: none;
	}
	.child-pick:hover {
		background: var(--theme-color-ghost-primary--hover);
	}
	.child-pick[aria-current='page'] {
		background: var(--theme-color-primary);
		border-color: var(--theme-color-primary);
		color: var(--theme-color-primary--contrast);
	}
	/* #70: iX colours visited links primary with a high-specificity rule
	   (a[href]:not(.disabled):not(:disabled):visited), which turned the
	   selected pill's text blue on blue. Out-rank it for every link state. */
	a.child-pick.child-pick[href]:is(:link, :visited, :hover, :active) {
		color: var(--theme-color-std-text);
	}
	a.child-pick.child-pick[href][aria-current='page']:is(:link, :visited, :hover, :active) {
		color: #ffffff;
	}
	.child-pick:focus-visible {
		outline: 2px solid var(--theme-color-focus-bdr);
		outline-offset: 1px;
	}
</style>
