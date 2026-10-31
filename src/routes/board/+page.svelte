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
		MAX_BOARD_FILE_BYTES,
		MAX_FILES_PER_POST,
		boardFileLimitMessage,
		boardFileTooLargeMessage,
		maxBoardFileSizeText,
		maxBoardFilesText
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

	/**
	 * The school message board (spec-parent-message-board story 3): posts
	 * newest first for every reader, and a post form for admins, teachers and
	 * granted parents. Errors come from the root layout's form-error toast.
	 * Story 4: a post may carry up to 2 PDF files, listed under it.
	 * Story 5: the author edits a post's body in place (while a poster) and
	 * deletes it; an admin or a teacher deletes any post, after a question.
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

	// Story 4: the optional PDF files. The server checks them before it
	// inserts the post; too many or too large is refused here first, so a
	// large post is not sent for nothing.
	let localFileError = $state('');
	let serverFileError = $derived(
		form && 'fileError' in form && typeof form.fileError === 'string' ? form.fileError : ''
	);
	// A new answer from the server replaces the local message.
	$effect(() => {
		if (form) localFileError = '';
	});
	// Choosing other files hides the earlier message until the next answer.
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
					showToast(
						'warning',
						m.board_file_not_attached({
							names: notAttached.map((name) => `“${String(name)}”`).join(', ')
						})
					);
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
			.getAll('files')
			.filter((entry): entry is File => entry instanceof File && entry.size > 0);
		if (chosen.length > MAX_FILES_PER_POST) {
			localFileError = boardFileLimitMessage();
		} else if (chosen.some((file) => file.size > MAX_BOARD_FILE_BYTES)) {
			localFileError = boardFileTooLargeMessage();
		}
		if (localFileError) {
			document.getElementById('board-files')?.focus();
			return input.cancel();
		}
		return guarded(input);
	};

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
					<Label for="board-files">{m.board_file_label()}</Label>
					<Input
						id="board-files"
						type="file"
						name="files"
						accept="application/pdf,.pdf"
						multiple
						class="py-2.5"
						aria-describedby="board-files-hint{fileError ? ' board-files-error' : ''}"
						aria-invalid={fileError ? 'true' : undefined}
						onchange={filesPicked}
					/>
					<p id="board-files-hint" class="text-sm {ui.muted}">
						{m.board_file_hint({ size: maxBoardFileSizeText(), count: maxBoardFilesText() })}
					</p>
					{#if fileError}
						<p id="board-files-error" class={ui.error} role="alert" data-testid="file-error">
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
						{:else}
							{#if boardPost.content}
								<RichText content={boardPost.content} lang={boardPost.contentLanguage} />
							{/if}
						{/if}
						<BoardFiles files={boardPost.files} author={boardPost.authorName} />
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
											boardPost.files.length > 0
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
