<script lang="ts">
	import type {
		ContentLanguage,
		RichTextBlock,
		RichTextDoc,
		RichTextInline,
		RichTextMark
	} from '$lib/rich-text';

	/**
	 * Homework content (#72-#74), drawn element by element from the stored
	 * document: there is no `{@html}`, so only the elements below can appear.
	 * `lang` is the language it was written in, which selects the font
	 * whatever the interface language is (see `[lang]` in app.css).
	 */
	let { content, lang }: { content: RichTextDoc; lang: ContentLanguage } = $props();
</script>

<div class="rich-text" {lang}>
	{@render blocks(content.content)}
</div>

{#snippet blocks(nodes: RichTextBlock[])}
	{#each nodes as node, i (i)}
		{#if node.type === 'paragraph'}
			<p>{@render inline(node.content)}</p>
		{:else if node.type === 'heading'}
			<!-- The page title is the h1; the editor's two sizes come below it. -->
			{#if node.attrs.level === 2}
				<h2>{@render inline(node.content)}</h2>
			{:else}
				<h3>{@render inline(node.content)}</h3>
			{/if}
		{:else if node.type === 'bulletList'}
			<ul>
				{#each node.content as item, j (j)}
					<li>{@render blocks(item.content)}</li>
				{/each}
			</ul>
		{:else}
			<ol>
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
	{#if !mark}{text}{:else if mark.type === 'bold'}<strong>{@render marked(text, rest)}</strong
		>{:else if mark.type === 'italic'}<em>{@render marked(text, rest)}</em
		>{:else if mark.type === 'underline'}<u>{@render marked(text, rest)}</u
		>{:else if mark.type === 'link'}<a
			href={mark.attrs.href}
			target="_blank"
			rel="noopener noreferrer">{@render marked(text, rest)}</a
		>{/if}
{/snippet}

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	.rich-text {
		overflow-wrap: anywhere;
	}

	.rich-text p {
		margin: 0 0 var(--space-2);
		white-space: pre-wrap;
	}

	.rich-text h2,
	.rich-text h3 {
		margin: var(--space-4) 0 var(--space-2);
		font-weight: var(--theme-font-weight-bold);
	}

	.rich-text h2 {
		font-size: var(--theme-font-size-xl);
	}

	.rich-text h3 {
		font-size: var(--theme-font-size-l);
	}

	.rich-text > :first-child {
		margin-top: 0;
	}

	.rich-text ul,
	.rich-text ol {
		margin: 0 0 var(--space-2);
		padding-left: var(--space-6);
	}

	.rich-text li > p {
		margin-bottom: var(--space-1);
	}
</style>
