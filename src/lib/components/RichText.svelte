<script lang="ts">
	import type {
		ContentLanguage,
		RichTextBlock,
		RichTextDoc,
		RichTextInline,
		RichTextMark
	} from '$lib/rich-text';
	import { ui } from '$lib/ui/classes';

	/**
	 * Homework content (#72-#74), drawn element by element from the stored
	 * document: there is no `{@html}`, so only the elements below can appear.
	 * `lang` is the language it was written in, which selects the font
	 * whatever the interface language is (see `[lang]` in app.css and the
	 * Tibetan rule in tailwind.css). Its own `data-ui="new"` root
	 * (mobile-first story 4), so it also works on pages that are still iX;
	 * `rich-text` stays as the hook tests find it by.
	 */
	let { content, lang }: { content: RichTextDoc; lang: ContentLanguage } = $props();

	const heading = 'mt-4 mb-2 font-bold';
	const list = 'mb-2 pl-6';
</script>

<div data-ui="new" class="rich-text min-w-0 wrap-anywhere [&>:first-child]:mt-0" {lang}>
	{@render blocks(content.content)}
</div>

{#snippet blocks(nodes: RichTextBlock[])}
	{#each nodes as node, i (i)}
		{#if node.type === 'paragraph'}
			<p class="mb-2 whitespace-pre-wrap [li>&]:mb-1">{@render inline(node.content)}</p>
		{:else if node.type === 'heading'}
			<!-- The page title is the h1; the editor's two sizes come below it. -->
			{#if node.attrs.level === 2}
				<h2 class="{heading} text-xl">{@render inline(node.content)}</h2>
			{:else}
				<h3 class="{heading} text-lg">{@render inline(node.content)}</h3>
			{/if}
		{:else if node.type === 'bulletList'}
			<ul class="{list} list-disc">
				{#each node.content as item, j (j)}
					<li>{@render blocks(item.content)}</li>
				{/each}
			</ul>
		{:else}
			<ol class="{list} list-decimal">
				{#each node.content as item, j (j)}
					<li>{@render blocks(item.content)}</li>
				{/each}
			</ol>
		{/if}
	{/each}
{/snippet}

<!-- No whitespace may be added between the pieces of a line: the text is
     shown as typed (white-space: pre-wrap). An empty paragraph is a blank
     line the teacher left on purpose. -->
{#snippet inline(nodes: RichTextInline[] | undefined)}
	{#if !nodes || nodes.length === 0}<br
		/>{:else}{#each nodes as node, i (i)}{#if node.type === 'hardBreak'}<br
				/>{:else}{@render marked(node.text, node.marks ?? [])}{/if}{/each}{/if}
{/snippet}

<!-- eslint-disable svelte/no-navigation-without-resolve -- external teacher-supplied URL (http, https or mailto only: isSafeHref), not an internal route. -->
{#snippet marked(text: string, marks: RichTextMark[])}
	{@const mark = marks[0]}
	{@const rest = marks.slice(1)}
	{#if !mark}{text}{:else if mark.type === 'bold'}<strong class="font-bold"
			>{@render marked(text, rest)}</strong
		>{:else if mark.type === 'italic'}<em class="italic">{@render marked(text, rest)}</em
		>{:else if mark.type === 'underline'}<u class="underline">{@render marked(text, rest)}</u
		>{:else if mark.type === 'link'}<a
			href={mark.attrs.href}
			target="_blank"
			rel="noopener noreferrer"
			class={ui.link}>{@render marked(text, rest)}</a
		>{/if}
{/snippet}

<!-- eslint-enable svelte/no-navigation-without-resolve -->
