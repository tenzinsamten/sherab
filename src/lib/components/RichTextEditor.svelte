<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import Bold from '@lucide/svelte/icons/bold';
	import Italic from '@lucide/svelte/icons/italic';
	import Link from '@lucide/svelte/icons/link';
	import List from '@lucide/svelte/icons/list';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import Underline from '@lucide/svelte/icons/underline';
	import * as m from '$lib/paraglide/messages.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ui } from '$lib/ui/classes';
	import { isSafeHref, type ContentLanguage, type RichTextDoc } from '$lib/rich-text';

	/**
	 * Rich-text field for homework content (#72-#74): Tiptap (MIT packages
	 * only), loaded in the browser. The document is posted as JSON in a hidden
	 * `name` field, so the form stays a normal SvelteKit post; the server
	 * checks it with parseContent(). `initial` is read once: later page data
	 * must not replace what the teacher is typing.
	 *
	 * Mobile-first story 7c: its own `data-ui="new"` root, so it also works
	 * in the syllabus forms. `rte-input` and `rte-body` stay
	 * as the hooks tests find the editable area and its language by.
	 */
	let {
		id,
		name = 'content',
		label,
		lang,
		initial = null,
		required = false
	}: {
		id: string;
		name?: string;
		label: string;
		/** Language being written: selects the font while typing. */
		lang: ContentLanguage;
		initial?: RichTextDoc | null;
		required?: boolean;
	} = $props();

	// The editable area is Tiptap's own node, so it is styled from its class
	// list: the same look as RichText.svelte. No length limit: it grows.
	const body =
		'block min-h-48 p-3 outline-none whitespace-pre-wrap wrap-anywhere [&_p]:mb-2 [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-bold [&>:first-child]:mt-0 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li_p]:mb-1 [&_a]:text-primary [&_a]:underline';
	// ≥44px (CAP-3); the pressed state is filled.
	const tool =
		'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-transparent px-2 font-bold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-primary [&_svg]:size-5';
	const separator = 'mx-1 h-6 w-px bg-border';

	const start = untrack(() => initial);
	let host: HTMLDivElement;
	let editor = $state.raw<Editor | null>(null);
	let json = $state(start ? JSON.stringify(start) : '');
	// Bumped on every editor transaction: the toolbar's pressed states read it.
	let version = $state(0);

	let linkOpen = $state(false);
	let linkUrl = $state('');
	let linkInvalid = $state(false);
	let linkInput = $state<HTMLInputElement | null>(null);

	onMount(() => {
		let cancelled = false;
		let instance: Editor | null = null;
		(async () => {
			const [{ Editor }, { default: StarterKit }] = await Promise.all([
				import('@tiptap/core'),
				import('@tiptap/starter-kit')
			]);
			if (cancelled) return;
			instance = new Editor({
				element: host,
				extensions: [
					StarterKit.configure({
						// Only what the stored document allows (src/lib/rich-text.ts).
						blockquote: false,
						code: false,
						codeBlock: false,
						horizontalRule: false,
						strike: false,
						heading: { levels: [2, 3] },
						link: {
							openOnClick: false,
							defaultProtocol: 'https',
							isAllowedUri: (url) => isSafeHref(url)
						}
					})
				],
				content: start ?? undefined,
				editorProps: {
					attributes: {
						id,
						class: `rte-input ${body}`,
						role: 'textbox',
						'aria-multiline': 'true',
						'aria-labelledby': `${id}-label`,
						...(required ? { 'aria-required': 'true' } : {})
					}
				},
				onUpdate: ({ editor: current }) => {
					json = current.isEmpty ? '' : JSON.stringify(current.getJSON());
				},
				onTransaction: () => {
					version += 1;
				}
			});
			editor = instance;
		})();
		return () => {
			cancelled = true;
			instance?.destroy();
		};
	});

	function active(type: string, attrs?: Record<string, unknown>): boolean {
		void version;
		return editor?.isActive(type, attrs) ?? false;
	}

	// The toolbar must not take the focus (and with it the selection) away
	// from the text.
	function keepSelection(event: MouseEvent) {
		event.preventDefault();
	}

	function openLink() {
		if (!editor) return;
		linkUrl = (editor.getAttributes('link').href as string | undefined) ?? '';
		linkInvalid = false;
		linkOpen = true;
		queueMicrotask(() => linkInput?.focus());
	}

	function closeLink() {
		linkOpen = false;
		editor?.commands.focus();
	}

	function applyLink() {
		if (!editor) return;
		const typed = linkUrl.trim();
		// "example.org" is meant as a web address.
		const href = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`;
		if (!typed || !isSafeHref(href)) {
			linkInvalid = true;
			return;
		}
		const chain = editor.chain().focus();
		if (editor.state.selection.empty && !editor.isActive('link')) {
			// Nothing selected: the address itself becomes the linked text.
			chain
				.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
				.run();
		} else {
			chain.extendMarkRange('link').setLink({ href }).run();
		}
		linkOpen = false;
	}

	function removeLink() {
		editor?.chain().focus().extendMarkRange('link').unsetLink().run();
		linkOpen = false;
	}

	// Enter in the address field applies the link; it must not post the form.
	function linkKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			applyLink();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			closeLink();
		}
	}
</script>

<div data-ui="new" class="rte mb-4 flex min-w-0 flex-col gap-1.5">
	<span class="text-sm font-medium" id={`${id}-label`}>{label}{required ? '*' : ''}</span>
	<div
		class="min-w-0 rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
	>
		<div
			class="flex flex-wrap items-center gap-1 border-b border-border p-1"
			role="toolbar"
			aria-label={m.rte_toolbar_label()}
		>
			<button
				type="button"
				class={tool}
				aria-label={m.rte_bold()}
				title={m.rte_bold()}
				aria-pressed={active('bold')}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleBold().run()}
				><Bold aria-hidden="true" /></button
			>
			<button
				type="button"
				class={tool}
				aria-label={m.rte_italic()}
				title={m.rte_italic()}
				aria-pressed={active('italic')}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleItalic().run()}
				><Italic aria-hidden="true" /></button
			>
			<button
				type="button"
				class={tool}
				aria-label={m.rte_underline()}
				title={m.rte_underline()}
				aria-pressed={active('underline')}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleUnderline().run()}
				><Underline aria-hidden="true" /></button
			>
			<span class={separator} aria-hidden="true"></span>
			<button
				type="button"
				class={tool}
				aria-label={m.rte_heading()}
				title={m.rte_heading()}
				aria-pressed={active('heading', { level: 2 })}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H1</button
			>
			<button
				type="button"
				class={tool}
				aria-label={m.rte_subheading()}
				title={m.rte_subheading()}
				aria-pressed={active('heading', { level: 3 })}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>H2</button
			>
			<span class={separator} aria-hidden="true"></span>
			<button
				type="button"
				class={tool}
				aria-label={m.rte_bullet_list()}
				title={m.rte_bullet_list()}
				aria-pressed={active('bulletList')}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleBulletList().run()}
				><List aria-hidden="true" /></button
			>
			<button
				type="button"
				class={tool}
				aria-label={m.rte_numbered_list()}
				title={m.rte_numbered_list()}
				aria-pressed={active('orderedList')}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleOrderedList().run()}
				><ListOrdered aria-hidden="true" /></button
			>
			<span class={separator} aria-hidden="true"></span>
			<button
				type="button"
				class={tool}
				aria-label={m.rte_link()}
				title={m.rte_link()}
				aria-pressed={active('link')}
				aria-expanded={linkOpen}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => (linkOpen ? closeLink() : openLink())}><Link aria-hidden="true" /></button
			>
		</div>

		{#if linkOpen}
			<div class="flex flex-col gap-1.5 border-b border-border bg-muted p-2">
				<label class="text-sm font-medium" for={`${id}-link`}>{m.rte_link_url_label()}</label>
				<div class="flex flex-wrap items-center gap-2">
					<!-- No `name`: this field is not part of the posted form. -->
					<Input
						bind:ref={linkInput}
						bind:value={linkUrl}
						id={`${id}-link`}
						type="url"
						inputmode="url"
						placeholder="https://"
						class="min-w-48 flex-1 bg-background"
						aria-invalid={linkInvalid || undefined}
						aria-describedby={linkInvalid ? `${id}-link-error` : undefined}
						onkeydown={linkKeydown}
					/>
					<Button type="button" class={ui.touch} onclick={applyLink}>{m.rte_link_apply()}</Button>
					{#if active('link')}
						<Button type="button" variant="outline" class={ui.touch} onclick={removeLink}
							>{m.rte_link_remove()}</Button
						>
					{/if}
					<Button type="button" variant="outline" class={ui.touch} onclick={closeLink}
						>{m.rte_link_cancel()}</Button
					>
				</div>
				{#if linkInvalid}
					<p class={ui.error} id={`${id}-link-error`}>{m.rte_link_invalid()}</p>
				{/if}
			</div>
		{/if}

		<div class="rte-body" bind:this={host} {lang}></div>
	</div>
	<input type="hidden" {name} value={json} />
</div>
