<script lang="ts">
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';

	/**
	 * The reference links under a homework's or syllabus's content (#27, #32),
	 * or `empty` when there are none and the caller has no content either. The
	 * content itself is rich text, drawn by RichText.svelte (#72, #75).
	 */
	let { links, empty = '' }: { links: HomeworkReferenceLink[]; empty?: string } = $props();
</script>

{#if links.length > 0}
	<ul class="links">
		{#each links as link, i (i)}
			<li>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external teacher-supplied URL, not an internal route (Boundaries: no URL validation, opens externally). -->
				<a href={link.url} target="_blank" rel="noopener noreferrer">{link.label ?? link.url}</a>
			</li>
		{/each}
	</ul>
{/if}
{#if links.length === 0 && empty}
	<p class="muted" style="margin:0;">{empty}</p>
{/if}

<style>
	.links {
		margin: 0 0 var(--space-2);
		padding-left: var(--space-4);
	}
</style>
