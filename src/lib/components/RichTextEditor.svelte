<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import * as m from '$lib/paraglide/messages.js';
	import { isSafeHref, type ContentLanguage, type RichTextDoc } from '$lib/rich-text';

	/**
	 * Rich-text field for homework content (#72-#74): Tiptap (MIT packages
	 * only), loaded in the browser. The document is posted as JSON in a hidden
	 * `name` field, so the form stays a normal SvelteKit post; the server
	 * checks it with parseContent(). `initial` is read once: later page data
	 * must not replace what the teacher is typing.
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
						class: 'rte-input',
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

<div class="rte">
	<span class="rte-label" id={`${id}-label`}>{label}{required ? '*' : ''}</span>
	<div class="rte-box">
		<div class="rte-toolbar" role="toolbar" aria-label={m.rte_toolbar_label()}>
			<button
				type="button"
				class="rte-tool"
				aria-label={m.rte_bold()}
				title={m.rte_bold()}
				aria-pressed={active('bold')}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleBold().run()}
				><ix-icon name="text-bold" size="16" aria-hidden="true"></ix-icon></button
			>
			<button
				type="button"
				class="rte-tool"
				aria-label={m.rte_italic()}
				title={m.rte_italic()}
				aria-pressed={active('italic')}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleItalic().run()}
				><ix-icon name="text-italic" size="16" aria-hidden="true"></ix-icon></button
			>
			<button
				type="button"
				class="rte-tool"
				aria-label={m.rte_underline()}
				title={m.rte_underline()}
				aria-pressed={active('underline')}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleUnderline().run()}
				><ix-icon name="text-underline" size="16" aria-hidden="true"></ix-icon></button
			>
			<span class="rte-separator" aria-hidden="true"></span>
			<button
				type="button"
				class="rte-tool rte-tool-text"
				aria-label={m.rte_heading()}
				title={m.rte_heading()}
				aria-pressed={active('heading', { level: 2 })}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H1</button
			>
			<button
				type="button"
				class="rte-tool rte-tool-text"
				aria-label={m.rte_subheading()}
				title={m.rte_subheading()}
				aria-pressed={active('heading', { level: 3 })}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>H2</button
			>
			<span class="rte-separator" aria-hidden="true"></span>
			<button
				type="button"
				class="rte-tool"
				aria-label={m.rte_bullet_list()}
				title={m.rte_bullet_list()}
				aria-pressed={active('bulletList')}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleBulletList().run()}
				><ix-icon name="list" size="16" aria-hidden="true"></ix-icon></button
			>
			<button
				type="button"
				class="rte-tool"
				aria-label={m.rte_numbered_list()}
				title={m.rte_numbered_list()}
				aria-pressed={active('orderedList')}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => editor?.chain().focus().toggleOrderedList().run()}
				><ix-icon name="list-sorted" size="16" aria-hidden="true"></ix-icon></button
			>
			<span class="rte-separator" aria-hidden="true"></span>
			<button
				type="button"
				class="rte-tool"
				aria-label={m.rte_link()}
				title={m.rte_link()}
				aria-pressed={active('link')}
				aria-expanded={linkOpen}
				disabled={!editor}
				onmousedown={keepSelection}
				onclick={() => (linkOpen ? closeLink() : openLink())}
				><ix-icon name="link" size="16" aria-hidden="true"></ix-icon></button
			>
		</div>

		{#if linkOpen}
			<div class="rte-link">
				<label class="rte-link-label" for={`${id}-link`}>{m.rte_link_url_label()}</label>
				<div class="rte-link-row">
					<!-- No `name`: this field is not part of the posted form. -->
					<input
						bind:this={linkInput}
						bind:value={linkUrl}
						id={`${id}-link`}
						type="url"
						inputmode="url"
						placeholder="https://"
						aria-invalid={linkInvalid || undefined}
						aria-describedby={linkInvalid ? `${id}-link-error` : undefined}
						onkeydown={linkKeydown}
					/>
					<ix-button type="button" onclick={applyLink}>{m.rte_link_apply()}</ix-button>
					{#if active('link')}
						<ix-button type="button" variant="secondary" onclick={removeLink}
							>{m.rte_link_remove()}</ix-button
						>
					{/if}
					<ix-button type="button" variant="secondary" onclick={closeLink}
						>{m.rte_link_cancel()}</ix-button
					>
				</div>
				{#if linkInvalid}
					<p class="field-error" id={`${id}-link-error`}>{m.rte_link_invalid()}</p>
				{/if}
			</div>
		{/if}

		<div class="rte-body" bind:this={host} {lang}></div>
	</div>
	<input type="hidden" {name} value={json} />
</div>

<style>
	.rte {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}

	.rte-label {
		color: var(--theme-color-soft-text);
		font-size: var(--theme-font-size-default);
	}

	.rte-box {
		background-color: var(--theme-input--background);
		color: var(--theme-input--color);
		border: 1px solid var(--theme-input--border-color);
		border-radius: var(--theme-input--border-radius);
	}

	.rte-box:focus-within {
		outline: 1px solid var(--theme-color-focus-bdr);
		border-color: var(--theme-input--border-color--focus);
	}

	.rte-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1);
		border-bottom: 1px solid var(--theme-color-soft-bdr);
	}

	/* 2.25rem square: the same target size as the app's other small controls
	   (WCAG 2.2 target size). */
	.rte-tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.25rem;
		height: 2.25rem;
		padding: 0 var(--space-2);
		background: transparent;
		color: var(--theme-color-std-text);
		border: 1px solid transparent;
		border-radius: var(--theme-default-border-radius);
		font: inherit;
		cursor: pointer;
	}

	.rte-tool-text {
		font-size: var(--theme-font-size-default);
		font-weight: var(--theme-font-weight-bold);
	}

	.rte-tool:hover:not(:disabled) {
		background: var(--theme-color-ghost--hover);
	}

	.rte-tool:focus-visible {
		outline: 1px solid var(--theme-color-focus-bdr);
		outline-offset: 1px;
	}

	.rte-tool[aria-pressed='true'] {
		background: var(--theme-color-ghost-primary--active);
		border-color: var(--theme-color-primary);
		color: var(--theme-color-primary);
	}

	.rte-tool:disabled {
		color: var(--theme-color-weak-text);
		cursor: default;
	}

	.rte-separator {
		width: 1px;
		height: 1.5rem;
		margin: 0 var(--space-1);
		background: var(--theme-color-soft-bdr);
	}

	.rte-link {
		padding: var(--space-2);
		border-bottom: 1px solid var(--theme-color-soft-bdr);
		background: var(--theme-color-1);
	}

	.rte-link-label {
		display: block;
		margin-bottom: var(--space-1);
		color: var(--theme-color-soft-text);
		font-size: var(--theme-font-size-default);
	}

	.rte-link-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.rte-link-row input {
		flex: 1;
		min-width: 12rem;
		min-height: 2.5rem;
		padding: var(--space-1) var(--space-2);
		background-color: var(--theme-input--background);
		color: var(--theme-input--color);
		border: 1px solid var(--theme-input--border-color);
		border-radius: var(--theme-input--border-radius);
		font: inherit;
	}

	.rte-link-row input[aria-invalid='true'] {
		border-color: var(--theme-color-alarm);
	}

	.rte-link .field-error {
		margin: var(--space-1) 0 0;
	}

	/* The editable area is created by Tiptap, so it is styled globally from
	   this component's body. It has no length limit: it grows with the text. */
	.rte-body :global(.rte-input) {
		min-height: 12rem;
		padding: var(--space-3);
		outline: none;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.rte-body :global(.rte-input p) {
		margin: 0 0 var(--space-2);
	}

	.rte-body :global(.rte-input h2),
	.rte-body :global(.rte-input h3) {
		margin: var(--space-4) 0 var(--space-2);
		font-weight: var(--theme-font-weight-bold);
	}

	.rte-body :global(.rte-input h2) {
		font-size: var(--theme-font-size-xl);
	}

	.rte-body :global(.rte-input h3) {
		font-size: var(--theme-font-size-l);
	}

	.rte-body :global(.rte-input > :first-child) {
		margin-top: 0;
	}

	.rte-body :global(.rte-input ul),
	.rte-body :global(.rte-input ol) {
		margin: 0 0 var(--space-2);
		padding-left: var(--space-6);
	}

	.rte-body :global(.rte-input a) {
		color: var(--theme-color-primary);
		text-decoration: underline;
	}
</style>
