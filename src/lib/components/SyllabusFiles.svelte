<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as m from '$lib/paraglide/messages.js';
	import { confirmWith } from '$lib/ix';
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
	 * file that was to be replaced.
	 */
	let {
		files,
		sectionId,
		pending,
		error = null
	}: {
		files: SyllabusFile[];
		sectionId: string;
		pending?: ReturnType<typeof createPending>;
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

	/** Remove: `pending.submit` with the question, clearing a message left by an earlier file. */
	function submitRemove(file: SyllabusFile): SubmitFunction {
		const inner = pending?.submit(`remove:${file.id}`, {
			reset: false,
			confirm: confirmWith(
				m.syllabus_file_delete_confirm({ name: file.name }),
				m.syllabus_file_delete()
			)
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

	/** Replace: choosing a file posts it at once. */
	function chosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files?.length) input.form?.requestSubmit();
	}
</script>

{#if pending || files.length > 0}
	<div class="files">
		{#if pending}
			<h3 class="files-heading">{m.syllabus_file_heading()}</h3>
		{/if}
		{#if files.length > 0}
			<ul class="file-list" aria-label={m.syllabus_file_heading()}>
				{#each files as file (file.id)}
					<li class="file" data-file-id={file.id}>
						<span class="file-main">
							<a
								class="file-name"
								href={resolve('/files/syllabus/[fileId]', { fileId: file.id })}
								target="_blank"
								rel="noopener noreferrer">{file.name}</a
							>
							<span class="muted file-size">{formatFileSize(file.size)}</span>
						</span>
						<span class="actions file-actions">
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() plus the endpoint's own ?download. -->
							<a
								class="file-download"
								href="{resolve('/files/syllabus/[fileId]', { fileId: file.id })}?download"
								download={file.name}
								data-sveltekit-reload
								aria-label={m.syllabus_file_download_label({ name: file.name })}
								>{m.syllabus_file_download()}</a
							>
							{#if pending}
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
									<ix-button
										variant="tertiary"
										aria-label={m.syllabus_file_replace_label({ name: file.name })}
										loading={pending.is(`replace:${file.id}`) || undefined}
										disabled={pending.busy || undefined}
										onclick={pick}>{m.syllabus_file_replace()}</ix-button
									>
								</form>
								<form method="POST" action="?/deleteFile" use:enhance={submitRemove(file)}>
									<input type="hidden" name="sectionId" value={sectionId} />
									<input type="hidden" name="fileId" value={file.id} />
									<ix-button
										type="submit"
										variant="tertiary"
										aria-label={m.syllabus_file_delete_label({ name: file.name })}
										loading={pending.is(`remove:${file.id}`) || undefined}
										disabled={pending.busy || undefined}>{m.syllabus_file_delete()}</ix-button
									>
								</form>
							{/if}
						</span>
						{#if shown && shown.fileId === file.id}
							<p class="field-error file-error" role="alert">{shown.message}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if pending}
			{#if files.length < MAX_FILES_PER_SECTION}
				<form
					method="POST"
					action="?/uploadFile"
					enctype="multipart/form-data"
					class="upload"
					use:enhance={submitFile(`upload:${sectionId}`, null)}
				>
					<input type="hidden" name="sectionId" value={sectionId} />
					<div class="field upload-field">
						<label for="section-file-{sectionId}">{m.syllabus_file_upload_label()}</label>
						<input
							id="section-file-{sectionId}"
							type="file"
							name="file"
							accept="application/pdf,.pdf"
							aria-describedby="section-file-hint-{sectionId}{uploadError
								? ` ${uploadErrorId}`
								: ''}"
							aria-invalid={uploadError ? 'true' : undefined}
						/>
						<p id="section-file-hint-{sectionId}" class="muted upload-hint">
							{m.syllabus_file_upload_hint({ size: maxFileSizeText(), count: maxFilesText() })}
						</p>
						{#if uploadError}
							<p id={uploadErrorId} class="field-error" role="alert">{uploadError}</p>
						{/if}
					</div>
					<ix-button
						type="submit"
						variant="secondary"
						loading={pending.is(`upload:${sectionId}`) || undefined}
						disabled={pending.busy || undefined}>{m.syllabus_file_upload_submit()}</ix-button
					>
				</form>
			{:else}
				<p class="muted upload-hint">{m.syllabus_file_limit_reached({ count: maxFilesText() })}</p>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.files {
		margin-top: var(--space-3);
	}

	.files-heading {
		margin: 0 0 var(--space-2);
		font-size: var(--theme-font-size-l);
	}

	.file-list {
		list-style: none;
		margin: 0 0 var(--space-2);
		padding: 0;
	}

	/* Name and size first; the buttons wrap under them on a narrow screen. */
	.file {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-1) var(--space-3);
		padding: var(--space-1) 0;
	}

	.file + .file {
		border-top: 1px solid var(--theme-color-soft-bdr);
	}

	.file-main {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
		min-width: 0;
	}

	/* A long name without spaces breaks instead of widening the page. */
	.file-name {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.file-size {
		white-space: nowrap;
	}

	.file-error {
		flex-basis: 100%;
		margin: 0;
	}

	.upload {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}

	.upload-field {
		flex: 1 1 14rem;
		min-width: 0;
		margin: 0;
	}

	.upload-field input[type='file'] {
		width: 100%;
		max-width: 100%;
		min-width: 0;
	}

	.upload-hint {
		margin: 0;
		font-size: var(--theme-font-size-s);
	}

	/* Level with the input, which sits under its label. */
	.upload > ix-button {
		margin-top: 1.5rem;
	}
</style>
