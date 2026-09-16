<script lang="ts">
	/**
	 * Recurring-assignment indicator icon (Story 3-2 Code Map: "a small inline
	 * SVG repeat indicator (Lucide, matching design-tokens.md's documented
	 * 'general SVG icon library... never emoji' guidance)"). First use of an
	 * icon library in this codebase -- a single shared component rather than
	 * inlining the SVG at each call site, since it is used in both the
	 * teacher and student homework views.
	 *
	 * Path data is Lucide's "repeat" icon (ISC licensed), reproduced inline
	 * rather than pulled in as a package dependency -- one icon does not
	 * justify a new runtime dependency for this project.
	 */
	let { size = 14 }: { size?: number } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	<path d="m17 2 4 4-4 4" />
	<path d="M3 11v-1a4 4 0 0 1 4-4h14" />
	<path d="m7 22-4-4 4-4" />
	<path d="M21 13v1a4 4 0 0 1-4 4H3" />
</svg>
