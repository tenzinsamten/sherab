<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Info from '@lucide/svelte/icons/info';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import MessagesSquare from '@lucide/svelte/icons/messages-square';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { formatInstant } from '$lib/format';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ContentLanguageSelect from '$lib/components/ContentLanguageSelect.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { createConfirm } from '$lib/confirm.svelte';
	import { createPending } from '$lib/pending.svelte';
	import { createUnsavedGuard } from '$lib/unsaved.svelte';
	import { DEFAULT_CONTENT_LANGUAGE, type ContentLanguage } from '$lib/rich-text';
	import { showToast } from '$lib/toast';
	import { ui } from '$lib/ui/classes';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	/**
	 * The school message board (spec-parent-message-board story 3): posts
	 * newest first for every reader, and a post form for admins, teachers and
	 * granted parents. Errors come from the root layout's form-error toast.
	 */
	let { data }: PageProps = $props();

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

	const submitPost: SubmitFunction = async (input) => {
		const after = await pending.submit('post')(input);
		return async (opts) => {
			if (after) await after(opts);
			else await opts.update();
			if (opts.result.type === 'success') {
				showToast('success', m.board_post_success());
				contentLanguage = DEFAULT_CONTENT_LANGUAGE;
				formKey += 1;
				await tick();
			}
		};
	};
	const post = unsaved.submit(submitPost);

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
			<form method="POST" action="?/post" use:enhance={post} use:unsaved.track>
				{#key formKey}
					<ContentLanguageSelect id="contentLanguage" bind:value={contentLanguage} />
					<RichTextEditor
						id="content"
						name="content"
						label={m.board_content_label()}
						lang={contentLanguage}
						required
					/>
				{/key}
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
				<li class={ui.card} data-testid="board-post">
					<article class="min-w-0">
						<header class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
							<p class="font-bold wrap-anywhere" data-testid="board-post-author">
								{boardPost.authorName}
							</p>
							<time datetime={boardPost.createdAt} class="text-sm {ui.muted}">
								{formatInstant(boardPost.createdAt, true)}
							</time>
						</header>
						{#if boardPost.content}
							<RichText content={boardPost.content} lang={boardPost.contentLanguage} />
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
