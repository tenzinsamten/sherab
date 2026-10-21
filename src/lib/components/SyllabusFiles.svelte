<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as m from '$lib/paraglide/messages.js';
	import Download from '@lucide/svelte/icons/download';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Upload from '@lucide/svelte/icons/upload';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { Confirm } from '$lib/confirm.svelte';
	import { ui } from '$lib/ui/classes';
	import type { createPending } from '$lib/pending.svelte';
	import {
		MAX_FILE_BYTES,
		MAX_FILES_PER_SECTION,
		fileTooLargeMessage,
		formatFileSize,
		maxFileSizeText,
		maxFilesText,
		type SyllabusFile
	} from '$lib/syllabus-files';

	/**
	 * The PDF files of one syllabus section (0039): each file's name (opens
	 * the PDF in a new tab), its size and a Download link (saves it under its
	 * original name). Both go through /files/syllabus/[fileId], which checks
	 * who is asking.
	 *
	 * With `pending` (the page's, on the teacher and admin syllabus pages) it
	 * also has Replace and Remove for each file and the upload field, posting
	 * to `?/uploadFile`, `?/replaceFile` and `?/deleteFile`. The upload field
	 * is hidden once the section has 5 files. `error` is the server's message
	 * about a chosen file: for the upload field (`fileId` null) or for the
	 * file that was to be replaced. `confirm` is the page's question dialog
	 * (SyllabusDetail's), which Remove asks first.
	 *
	 * Mobile-first story 4 moved the read-only half, story 8 the edit half:
	 * each in its own `data-ui="new"` root, so it also works on the admin
	 * syllabus page, which is still iX.
	 */
	let {
		files,
		sectionId,
		pending,
		confirm,
		error = null
	}: {
		files: SyllabusFile[];
		sectionId: string;
		pending?: ReturnType<typeof createPending>;
		confirm?: Confirm;
		error?: { fileId: string | null; message: string } | null;
	} = $props();

	// A file refused here, before it is sent (the server checks again).
	let localError = $state<{ fileId: string | null; message: string } | null>(null);
	// A new answer from the server replaces it, so it never hides a later message.
	$effect(() => {
		if (error) localError = null;
	});
	let shown = $derived(localError ?? error);
	let uploadError = $derived(shown && shown.fileId === null ? shown.message : '');
	let uploadErrorId = $derived(`section-file-error-${sectionId}`);

	/** `pending.submit`, after refusing a file over 1 MB without uploading it. */
	function submitFile(key: string, fileId: string | null): SubmitFunction {
		return (input) => {
			localError = null;
			const file = input.formData.get('file');
			if (file instanceof File && file.size > MAX_FILE_BYTES) {
				localError = { fileId, message: fileTooLargeMessage() };
				if (fileId !== null) input.formElement.reset();
				return input.cancel();
			}
			return pending?.submit(key)(input);
		};
	}

	/**
	 * Remove: `pending.submit` with the question, clearing a message left by
	 * an earlier file. The action is set up once, so the question reads the
	 * file's name when it is asked: a replaced file keeps its id, not its name.
	 */
	function submitRemove(current: () => SyllabusFile): SubmitFunction {
		const inner = pending?.submit(`remove:${current().id}`, {
			reset: false,
			// Without the page's dialog Remove never posts unasked.
			confirm: () =>
				confirm
					? confirm.ask(
							m.syllabus_file_delete_confirm({ name: current().name }),
							m.syllabus_file_delete(),
							{ destructive: true }
						)
					: Promise.resolve(false)
		});
		return (input) => {
			localError = null;
			return inner?.(input);
		};
	}

	/**
	 * Replace: opens the file picker. The input is emptied first, so choosing
	 * the same file again after a refusal still counts as a change.
	 */
	function pick(event: MouseEvent) {
		const input = (event.currentTarget as HTMLElement)
			.closest('form')
			?.querySelector<HTMLInputElement>('input[type="file"]');
		if (!input) return;
		input.value = '';
		input.click();
	}

	const fileButton = `${ui.touch} gap-2`;

	/** Replace: choosing a file posts it at once. */
	function chosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files?.length) input.form?.requestSubmit();
	}
</script>

{#if !pending}
	<!-- Read-only (the student's class page). -->
	{#if files.length > 0}
		<div data-ui="new" class="mt-3 min-w-0">
			<ul class="divide-y divide-border" aria-label={m.syllabus_file_heading()}>
				{#each files as file (file.id)}
					<li
						class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1"
						data-file-id={file.id}
					>
						<span class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
							<a
								class="{ui.link} inline-flex min-h-11 min-w-0 items-center wrap-anywhere"
								href={resolve('/files/syllabus/[fileId]', { fileId: file.id })}
								target="_blank"
								rel="noopener noreferrer"
								data-testid="file-name">{file.name}</a
							>
							<span class="text-sm whitespace-nowrap text-muted-foreground" data-testid="file-size"
								>{formatFileSize(file.size)}</span
							>
						</span>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() plus the endpoint's own ?download. -->
						<a
							class="{ui.link} inline-flex min-h-11 items-center gap-1.5"
							href="{resolve('/files/syllabus/[fileId]', { fileId: file.id })}?download"
							download={file.name}
							data-sveltekit-reload
							aria-label={m.syllabus_file_download_label({ name: file.name })}
						>
							<Download class="size-4 shrink-0" aria-hidden="true" />
							{m.syllabus_file_download()}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
{:else}
	<!-- With `pending` (teacher and admin): Replace, Remove and the upload field. -->
	<div data-ui="new" class="mt-3 flex min-w-0 flex-col gap-2">
		<h3 class="text-base font-bold">{m.syllabus_file_heading()}</h3>
		{#if files.length > 0}
			<ul class={ui.rows} aria-label={m.syllabus_file_heading()}>
				{#each files as file (file.id)}
					<!-- Name and size first; the buttons wrap under them on a narrow screen. -->
					<li
						class="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1"
						data-file-id={file.id}
					>
						<span class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
							<!-- A long name without spaces breaks instead of widening the page. -->
							<a
								class="{ui.link} inline-flex min-h-11 min-w-0 items-center wrap-anywhere"
								href={resolve('/files/syllabus/[fileId]', { fileId: file.id })}
								target="_blank"
								rel="noopener noreferrer"
								data-testid="file-name">{file.name}</a
							>
							<span class="text-sm whitespace-nowrap text-muted-foreground" data-testid="file-size"
								>{formatFileSize(file.size)}</span
							>
						</span>
						<span class="flex min-w-0 flex-wrap items-center gap-2">
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() plus the endpoint's own ?download. -->
							<a
								class="{ui.link} inline-flex min-h-11 items-center gap-1.5 px-1"
								href="{resolve('/files/syllabus/[fileId]', { fileId: file.id })}?download"
								download={file.name}
								data-sveltekit-reload
								aria-label={m.syllabus_file_download_label({ name: file.name })}
							>
								<Download class="size-4 shrink-0" aria-hidden="true" />
								{m.syllabus_file_download()}
							</a>
							<form
								method="POST"
								action="?/replaceFile"
								enctype="multipart/form-data"
								use:enhance={submitFile(`replace:${file.id}`, file.id)}
							>
								<input type="hidden" name="sectionId" value={sectionId} />
								<input type="hidden" name="fileId" value={file.id} />
								<input
									type="file"
									name="file"
									accept="application/pdf,.pdf"
									hidden
									tabindex="-1"
									aria-hidden="true"
									onchange={chosen}
								/>
								<Button
									variant="ghost"
									class={fileButton}
									aria-label={m.syllabus_file_replace_label({ name: file.name })}
									aria-busy={pending.is(`replace:${file.id}`) || undefined}
									disabled={pending.busy}
									onclick={pick}
								>
									{#if pending.is(`replace:${file.id}`)}
										<LoaderCircle class="animate-spin" aria-hidden="true" />
									{:else}
										<Upload aria-hidden="true" />
									{/if}
									{m.syllabus_file_replace()}
								</Button>
							</form>
							<form method="POST" action="?/deleteFile" use:enhance={submitRemove(() => file)}>
								<input type="hidden" name="sectionId" value={sectionId} />
								<input type="hidden" name="fileId" value={file.id} />
								<Button
									type="submit"
									variant="ghost"
									class="{fileButton} text-destructive hover:bg-destructive/10"
									aria-label={m.syllabus_file_delete_label({ name: file.name })}
									aria-busy={pending.is(`remove:${file.id}`) || undefined}
									disabled={pending.busy}
								>
									{#if pending.is(`remove:${file.id}`)}
										<LoaderCircle class="animate-spin" aria-hidden="true" />
									{:else}
										<Trash2 aria-hidden="true" />
									{/if}
									{m.syllabus_file_delete()}
								</Button>
							</form>
						</span>
						{#if shown && shown.fileId === file.id}
							<p class="{ui.error} basis-full" role="alert" data-testid="file-error">
								{shown.message}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if files.length < MAX_FILES_PER_SECTION}
			<form
				method="POST"
				action="?/uploadFile"
				enctype="multipart/form-data"
				class="mt-1 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start"
				use:enhance={submitFile(`upload:${sectionId}`, null)}
			>
				<input type="hidden" name="sectionId" value={sectionId} />
				<div class="flex min-w-0 flex-col gap-1.5 sm:flex-1">
					<Label for="section-file-{sectionId}">{m.syllabus_file_upload_label()}</Label>
					<Input
						id="section-file-{sectionId}"
						type="file"
						name="file"
						accept="application/pdf,.pdf"
						class="py-2.5"
						aria-describedby="section-file-hint-{sectionId}{uploadError ? ` ${uploadErrorId}` : ''}"
						aria-invalid={uploadError ? 'true' : undefined}
					/>
					<p id="section-file-hint-{sectionId}" class="text-sm {ui.muted}">
						{m.syllabus_file_upload_hint({ size: maxFileSizeText(), count: maxFilesText() })}
					</p>
					{#if uploadError}
						<p id={uploadErrorId} class={ui.error} role="alert">{uploadError}</p>
					{/if}
				</div>
				<!-- Level with the input, which sits under its label. -->
				<Button
					type="submit"
					variant="outline"
					class="{fileButton} w-full sm:mt-6.5 sm:w-auto"
					aria-busy={pending.is(`upload:${sectionId}`) || undefined}
					disabled={pending.busy}
				>
					{#if pending.is(`upload:${sectionId}`)}
						<LoaderCircle class="animate-spin" aria-hidden="true" />
					{:else}
						<Upload aria-hidden="true" />
					{/if}
					{m.syllabus_file_upload_submit()}
				</Button>
			</form>
		{:else}
			<p class="text-sm {ui.muted}">{m.syllabus_file_limit_reached({ count: maxFilesText() })}</p>
		{/if}
	</div>
{/if}
