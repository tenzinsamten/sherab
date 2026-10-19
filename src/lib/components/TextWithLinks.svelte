<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';
	import { ui } from '$lib/ui/classes';

	/**
	 * The reference links under a homework's or syllabus's content (#27, #32),
	 * or `empty` when there are none and the caller has no content either. The
	 * content itself is rich text, drawn by RichText.svelte (#72, #75). Each
	 * opens in a new tab, marked with an external-link icon. Its own
	 * `data-ui="new"` root (mobile-first story 4), so it also works on pages
	 * that are still iX.
	 */
	let { links, empty = '' }: { links: HomeworkReferenceLink[]; empty?: string } = $props();
</script>

{#if links.length > 0 || empty}
	<div data-ui="new" class="min-w-0">
		{#if links.length > 0}
			<ul class="mb-2 flex flex-col">
				{#each links as link, i (i)}
					<li class="min-w-0">
						<!-- eslint-disable svelte/no-navigation-without-resolve -- external teacher-supplied URL, not an internal route (Boundaries: no URL validation, opens externally). -->
						<a
							href={link.url}
							target="_blank"
							rel="noopener noreferrer"
							class="{ui.link} inline-flex min-h-11 items-center gap-1.5 wrap-anywhere"
						>
							<span class="min-w-0">{link.label ?? link.url}</span>
							<ExternalLink class="size-4 shrink-0" aria-hidden="true" />
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</li>
				{/each}
			</ul>
		{:else}
			<p class={ui.muted}>{empty}</p>
		{/if}
	</div>
{/if}
