<script lang="ts">
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';

	/**
	 * Plain teacher-written text (line breaks kept, always escaped) followed by
	 * its reference links. Used for the class syllabus (#32).
	 */
	let {
		text,
		links,
		empty = ''
	}: { text: string | null; links: HomeworkReferenceLink[]; empty?: string } = $props();
</script>

{#if text}
	<p class="text">{text}</p>
{/if}
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
{#if !text && links.length === 0 && empty}
	<p class="muted" style="margin:0;">{empty}</p>
{/if}

<style>
	.text {
		margin: 0 0 var(--space-2);
		white-space: pre-line;
	}

	.links {
		margin: 0 0 var(--space-2);
		padding-left: var(--space-4);
	}
</style>
