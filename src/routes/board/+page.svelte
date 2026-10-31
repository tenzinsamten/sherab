<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Info from '@lucide/svelte/icons/info';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import MessagesSquare from '@lucide/svelte/icons/messages-square';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { formatInstant } from '$lib/format';
	import BoardFiles from '$lib/components/BoardFiles.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ContentLanguageSelect from '$lib/components/ContentLanguageSelect.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		BOARD_IMAGE_ACCEPT,
		boardImageLimitMessage,
		boardImageProblem,
		maxBoardImageSizeText
	} from '$lib/board-files';
	import { MAX_BOARD_TITLE_LENGTH } from '$lib/board-author';
	import { createConfirm } from '$lib/confirm.svelte';
	import { createPending } from '$lib/pending.svelte';
	import { createUnsavedGuard } from '$lib/unsaved.svelte';
	import { DEFAULT_CONTENT_LANGUAGE, type ContentLanguage } from '$lib/rich-text';
	import { showToast } from '$lib/toast';
	import { ui } from '$lib/ui/classes';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageProps } from './$types';
	import type { BoardReactions } from './+page.server';

	/**
	 * The school message board (spec-parent-message-board story 3): posts
	 * newest first for every reader, and a post form for admins, teachers and
	 * granted parents. Errors come from the root layout's form-error toast.
	 * Story 8: a post may carry one image, shown under a 3-line preview of
	 * its body that "…see more" expands in place (posts from before story 8
	 * may still list PDF files).
	 * Story 5: the author edits a post's body in place (while a poster) and
	 * deletes it; an admin or a teacher deletes any post, after a question.
	 * Story 9: every reader gives a post 👍 or 👎 (pressing it again takes it
	 * back); both counts show to everyone, never who reacted.
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	let contentLanguage = $state<ContentLanguage>(DEFAULT_CONTENT_LANGUAGE);
	// Bumped after a successful post: the editor and the language select
	// mount again empty (the editor's hidden field is not cleared by a form reset).
	let formKey = $state(0);

	const pending = createPending();
	// #121: asks before leaving the form once something was typed.
	const confirm = createConfirm();
	const unsaved = createUnsavedGuard(confirm);

	// Story 8: the optional image. The server checks it before it inserts
	// the post; a too-large or wrong file is refused here first, so a large
	// post is not sent for nothing.
	let localFileError = $state('');
	let serverFileError = $derived(
		form && 'fileError' in form && typeof form.fileError === 'string' ? form.fileError : ''
	);
	// A new answer from the server replaces the local message.
	$effect(() => {
		if (form) localFileError = '';
	});
	// Choosing another file hides the earlier message until the next answer.
	let filesChanged = $state(false);
	$effect(() => {
		if (form) filesChanged = false;
	});
	let fileError = $derived(localFileError || (filesChanged ? '' : serverFileError));

	function filesPicked() {
		localFileError = '';
		filesChanged = true;
	}

	const submitPost: SubmitFunction = async (input) => {
		const after = await pending.submit('post')(input);
		return async (opts) => {
			if (after) await after(opts);
			else await opts.update();
			if (opts.result.type === 'success') {
				const notAttached = opts.result.data?.notAttached;
				if (Array.isArray(notAttached) && notAttached.length > 0) {
					showToast('warning', m.board_image_not_attached());
				} else {
					showToast('success', m.board_post_success());
				}
				contentLanguage = DEFAULT_CONTENT_LANGUAGE;
				formKey += 1;
				await tick();
			}
		};
	};
	const guarded = unsaved.submit(submitPost);
	const post: SubmitFunction = (input) => {
		localFileError = '';
		const chosen = input.formData
			.getAll('image')
			.filter((entry): entry is File => entry instanceof File && entry.size > 0);
		if (chosen.length > 1) {
			localFileError = boardImageLimitMessage();
		} else if (chosen[0]) {
			localFileError = boardImageProblem(chosen[0]) ?? '';
		}
		if (localFileError) {
			document.getElementById('board-image')?.focus();
			return input.cancel();
		}
		return guarded(input);
	};

	// Story 8: the posts whose full body shows; not kept across loads.
	let expanded = $state<Record<string, boolean>>({});

	function toggleExpanded(id: string) {
		expanded[id] = !expanded[id];
	}

	/** A click on a collapsed preview expands it, except on a link inside it. */
	function previewClicked(event: MouseEvent, id: string) {
		if (expanded[id]) return;
		// Selecting text in the preview is not a click to expand it.
		if (window.getSelection()?.toString()) return;
		if (event.target instanceof Element && event.target.closest('a')) return;
		expanded[id] = true;
	}

	// Story 5: one post is edited at a time, in its card.
	let editingId = $state<string | null>(null);
	let editLanguage = $state<ContentLanguage>(DEFAULT_CONTENT_LANGUAGE);

	function startEdit(id: string, language: ContentLanguage) {
		editLanguage = language;
		editingId = id;
	}

	/** Shows the success toast (and runs `done`) once the answer is applied. */
	function withSuccess(submit: SubmitFunction, message: () => string, done?: () => void) {
		const wrapped: SubmitFunction = async (input) => {
			const after = await submit(input);
			return async (opts) => {
				if (after) await after(opts);
				else await opts.update();
				if (opts.result.type === 'success') {
					showToast('success', message());
					done?.();
				}
			};
		};
		return wrapped;
	}

	function submitEdit(id: string): SubmitFunction {
		return unsaved.submit(
			withSuccess(pending.submit(`edit:${id}`), m.board_edit_success, () => {
				if (editingId === id) editingId = null;
			})
		);
	}

	function submitDelete(id: string, author: string, hasFiles: boolean): SubmitFunction {
		return withSuccess(
			pending.submit(`delete:${id}`, {
				confirm: () =>
					confirm.ask(
						hasFiles
							? m.board_delete_confirm({ author })
							: m.board_delete_confirm_no_files({ author }),
						m.board_delete_button(),
						{
							destructive: true
						}
					)
			}),
			m.board_delete_success,
			() => {
				if (editingId === id) editingId = null;
			}
		);
	}

	/** "Edited": the last change came over a minute after the post. */
	function wasEdited(createdAt: string, updatedAt: string): boolean {
		const created = Date.parse(createdAt);
		const updated = Date.parse(updatedAt);
		return !Number.isNaN(created) && !Number.isNaN(updated) && updated - created > 60_000;
	}

	/** Story 9: the two reactions, in their order on the card. */
	const REACTIONS = [
		{
			value: 'up',
			mine: 1,
			emoji: '👍',
			count: (r: BoardReactions) => r.up,
			label: m.board_react_up_label
		},
		{
			value: 'down',
			mine: -1,
			emoji: '👎',
			count: (r: BoardReactions) => r.down,
			label: m.board_react_down_label
		}
	] as const;

	/** Story 9: 👍 or 👎; no toast, the reloaded counts are the answer. */
	function submitReaction(id: string): SubmitFunction {
		return pending.submit(`react:${id}`, { reset: false });
	}

	function olderHref(before: string): string {
		return `${resolve('/board')}?before=${encodeURIComponent(before)}`;
	}
</script>

<svelte:head>
	<title>{m.board_heading()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.board_section_label()}</p>
			<h1 class={ui.heading}>{m.board_heading()}</h1>
			<p class={ui.subtitle}>{m.board_subtitle()}</p>
		</div>
	</header>

	{#if data.canPost}
		<section class={ui.card} aria-labelledby="board-form-heading" data-testid="board-form">
			<h2 id="board-form-heading" class={ui.cardTitle}>{m.board_form_heading()}</h2>
			<form
				method="POST"
				action="?/post"
				enctype="multipart/form-data"
				use:enhance={post}
				use:unsaved.track
			>
				{#key formKey}
					<!-- Story 7: a required title, the post's heading. -->
					<div class="mb-4 flex min-w-0 flex-col gap-1.5">
						<Label for="board-title">{m.board_title_label()}</Label>
						<Input
							id="board-title"
							name="title"
							type="text"
							maxlength={MAX_BOARD_TITLE_LENGTH}
							required
							autocomplete="off"
						/>
					</div>
					<ContentLanguageSelect id="contentLanguage" bind:value={contentLanguage} />
					<RichTextEditor
						id="content"
						name="content"
						label={m.board_content_label()}
						lang={contentLanguage}
						required
					/>
				{/key}
				<div class="mb-4 flex min-w-0 flex-col gap-1.5">
					<Label for="board-image">{m.board_image_label()}</Label>
					<Input
						id="board-image"
						type="file"
						name="image"
						accept={BOARD_IMAGE_ACCEPT}
						class="py-2.5"
						aria-describedby="board-image-hint{fileError ? ' board-image-error' : ''}"
						aria-invalid={fileError ? 'true' : undefined}
						onchange={filesPicked}
					/>
					<p id="board-image-hint" class="text-sm {ui.muted}">
						{m.board_image_hint({ size: maxBoardImageSizeText() })}
					</p>
					{#if fileError}
						<p id="board-image-error" class={ui.error} role="alert" data-testid="file-error">
							{fileError}
						</p>
					{/if}
				</div>
				<Button
					type="submit"
					class="{ui.touch} w-full gap-2 sm:w-auto"
					aria-busy={pending.is('post') || undefined}
					disabled={pending.busy}
				>
					{#if pending.is('post')}
						<LoaderCircle class="animate-spin" aria-hidden="true" />
					{/if}
					{m.board_post_submit()}
				</Button>
			</form>
		</section>
	{/if}

	{#if data.loadError}
		<div class={ui.card} role="alert" data-testid="board-load-error">
			<EmptyState header={m.board_load_error()} icon={Info} />
		</div>
	{:else if data.posts.length === 0}
		<section class={ui.card}>
			<EmptyState header={m.board_empty()} icon={MessagesSquare} />
		</section>
	{:else}
		<ol
			class="flex min-w-0 flex-col gap-3"
			aria-label={m.board_list_label()}
			data-testid="board-posts"
		>
			{#each data.posts as boardPost (boardPost.id)}
				{@const canEdit = boardPost.mine && data.canPost}
				{@const canDelete = boardPost.mine || data.canModerate}
				<li class={ui.card} data-testid="board-post">
					<article class="min-w-0">
						{#if boardPost.title}
							<!-- Story 7: posts from before titles show no heading. -->
							<h2
								class="mb-1 text-lg leading-snug font-bold wrap-anywhere"
								data-testid="board-post-title"
							>
								{boardPost.title}
							</h2>
						{/if}
						<header class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
							<p class="font-bold wrap-anywhere" data-testid="board-post-author">
								{boardPost.authorName}
							</p>
							<p class="text-sm {ui.muted}">
								<time datetime={boardPost.createdAt}>
									{formatInstant(boardPost.createdAt, true)}
								</time>
								{#if boardPost.updatedAt && wasEdited(boardPost.createdAt, boardPost.updatedAt)}
									<span aria-hidden="true">·</span>
									<span data-testid="board-post-edited">{m.board_edit_marker()}</span>
								{/if}
							</p>
						</header>
						{#if editingId === boardPost.id && canEdit}
							<form
								method="POST"
								action="?/edit"
								use:enhance={submitEdit(boardPost.id)}
								use:unsaved.track
								data-testid="board-edit-form"
							>
								<input type="hidden" name="postId" value={boardPost.id} />
								<div class="mb-4 flex min-w-0 flex-col gap-1.5">
									<Label for="edit-title-{boardPost.id}">{m.board_title_label()}</Label>
									<Input
										id="edit-title-{boardPost.id}"
										name="title"
										type="text"
										value={boardPost.title ?? ''}
										maxlength={MAX_BOARD_TITLE_LENGTH}
										required
										autocomplete="off"
										data-testid="board-edit-title"
									/>
								</div>
								<ContentLanguageSelect
									id="edit-language-{boardPost.id}"
									bind:value={editLanguage}
								/>
								<RichTextEditor
									id="edit-content-{boardPost.id}"
									name="content"
									label={m.board_content_label()}
									lang={editLanguage}
									initial={boardPost.content}
									required
								/>
								<div class="flex flex-wrap gap-2">
									<Button
										type="submit"
										class="{ui.touch} gap-2"
										aria-label={m.board_edit_save_label({ author: boardPost.authorName })}
										aria-busy={pending.is(`edit:${boardPost.id}`) || undefined}
										disabled={pending.busy}
										data-testid="board-edit-save"
									>
										{#if pending.is(`edit:${boardPost.id}`)}
											<LoaderCircle class="animate-spin" aria-hidden="true" />
										{/if}
										{m.board_edit_save()}
									</Button>
									<Button
										type="button"
										variant="outline"
										class={ui.touch}
										aria-label={m.board_edit_cancel_label({ author: boardPost.authorName })}
										disabled={pending.busy}
										onclick={() => (editingId = null)}
										data-testid="board-edit-cancel"
									>
										{m.board_edit_cancel()}
									</Button>
								</div>
							</form>
						{:else if boardPost.content}
							{@const open = !boardPost.long || expanded[boardPost.id] === true}
							<!-- Story 8: a long body is clamped to 3 lines until "…see more";
							     a click on the preview expands it too (the button is the
							     keyboard's way). -->
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<div
								id="board-post-body-{boardPost.id}"
								class={open ? undefined : 'line-clamp-3 cursor-pointer'}
								onclick={boardPost.long
									? (event) => previewClicked(event, boardPost.id)
									: undefined}
								data-testid="board-post-body"
								data-expanded={boardPost.long ? String(open) : undefined}
							>
								<RichText content={boardPost.content} lang={boardPost.contentLanguage} />
							</div>
							{#if boardPost.long}
								<button
									type="button"
									class="{ui.link} inline-flex min-h-11 items-center"
									aria-expanded={open}
									aria-controls="board-post-body-{boardPost.id}"
									onclick={() => toggleExpanded(boardPost.id)}
									data-testid="board-post-more"
								>
									{open ? m.board_preview_less() : m.board_preview_more()}
								</button>
							{/if}
						{/if}
						{#if boardPost.image}
							{@const imageHref = resolve('/files/board/[fileId]', {
								fileId: boardPost.image.id
							})}
							<!-- Story 8: the post's image, through the endpoint that signs a fresh
							     link on each request; opens full size in a new tab. -->
							<a
								href={imageHref}
								target="_blank"
								rel="noopener"
								class="mt-3 block min-w-0"
								aria-label={m.board_image_open_label()}
								data-testid="board-post-image-link"
							>
								<img
									src={imageHref}
									alt={boardPost.title ?? m.board_image_alt_fallback()}
									loading="lazy"
									class="max-h-96 w-full rounded-md object-cover"
									data-testid="board-post-image"
								/>
							</a>
						{/if}
						<!-- Legacy PDF files from before story 8. -->
						<BoardFiles files={boardPost.files} author={boardPost.authorName} />
						<!-- Story 9: 👍 and 👎 with their counts, for every reader. Each button
						     keeps its name; its visible count is read as its description. -->
						<form
							method="POST"
							action="?/react"
							use:enhance={submitReaction(boardPost.id)}
							class="mt-3"
							data-testid="board-post-reactions"
						>
							<input type="hidden" name="postId" value={boardPost.id} />
							<div
								role="group"
								aria-label={m.board_react_group_label({ author: boardPost.authorName })}
								class="flex flex-wrap gap-2"
							>
								{#each REACTIONS as reaction (reaction.value)}
									{@const pressed = boardPost.reactions.mine === reaction.mine}
									{@const countId = `board-react-${reaction.value}-count-${boardPost.id}`}
									<Button
										type="submit"
										name="value"
										value={reaction.value}
										variant={pressed ? 'default' : 'outline'}
										class="{ui.touch} gap-1.5 px-3 tabular-nums"
										aria-pressed={pressed}
										aria-label={reaction.label()}
										aria-describedby={countId}
										aria-busy={pending.is(`react:${boardPost.id}`) || undefined}
										disabled={pending.busy || data.reactionsError}
										data-testid="board-react-{reaction.value}"
									>
										<span aria-hidden="true">{reaction.emoji}</span>
										<span id={countId} data-testid="board-react-{reaction.value}-count"
											>{reaction.count(boardPost.reactions)}</span
										>
									</Button>
								{/each}
							</div>
						</form>
						{#if (canEdit && editingId !== boardPost.id) || canDelete}
							<div class="mt-3 flex flex-wrap gap-2" data-testid="board-post-actions">
								{#if canEdit && editingId !== boardPost.id}
									<Button
										type="button"
										variant="outline"
										class="{ui.touch} gap-2"
										aria-label={m.board_edit_label({ author: boardPost.authorName })}
										disabled={pending.busy || editingId !== null}
										onclick={() => startEdit(boardPost.id, boardPost.contentLanguage)}
										data-testid="board-post-edit"
									>
										<Pencil aria-hidden="true" />
										{m.board_edit_button()}
									</Button>
								{/if}
								{#if canDelete}
									<form
										method="POST"
										action="?/delete"
										use:enhance={submitDelete(
											boardPost.id,
											boardPost.authorName,
											boardPost.image !== null || boardPost.files.length > 0
										)}
									>
										<input type="hidden" name="postId" value={boardPost.id} />
										<Button
											type="submit"
											variant="outline"
											class="{ui.touch} gap-2"
											aria-label={m.board_delete_label({ author: boardPost.authorName })}
											aria-busy={pending.is(`delete:${boardPost.id}`) || undefined}
											disabled={pending.busy}
											data-testid="board-post-delete"
										>
											{#if pending.is(`delete:${boardPost.id}`)}
												<LoaderCircle class="animate-spin" aria-hidden="true" />
											{:else}
												<Trash2 aria-hidden="true" />
											{/if}
											{m.board_delete_button()}
										</Button>
									</form>
								{/if}
							</div>
						{/if}
					</article>
				</li>
			{/each}
		</ol>
		{#if data.olderBefore}
			<p>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- olderHref() builds on resolve(). -->
				<a
					href={olderHref(data.olderBefore)}
					class="{ui.link} inline-flex min-h-11 items-center"
					data-testid="board-older">{m.board_older_posts()}</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</p>
		{/if}
	{/if}

	{#if data.paged}
		<!-- An older page: the way back to the newest posts (and to a new post). -->
		<p>
			<a
				href={resolve('/board')}
				class="{ui.link} inline-flex min-h-11 items-center"
				data-testid="board-newest">{m.board_newest_posts()}</a
			>
		</p>
	{/if}
</div>

<ConfirmDialog {confirm} />
