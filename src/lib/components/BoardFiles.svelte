<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import Download from '@lucide/svelte/icons/download';
	import { ui } from '$lib/ui/classes';
	import type { BoardFile } from '$lib/board-files';
	import { formatFileSize } from '$lib/pdf-files';

	/**
	 * The PDF files of one board post (spec-parent-message-board story 4),
	 * read-only: each file's name (opens the PDF in a new tab), its size and a
	 * Download link (saves it under its original name). Both go through
	 * /files/board/[fileId], which checks who is asking. The same markup as
	 * HomeworkFiles without `pending`. `author` names the list for screen
	 * readers, so each post's list has its own name.
	 */
	let { files, author }: { files: BoardFile[]; author: string } = $props();
</script>

{#if files.length > 0}
	<div class="mt-3 min-w-0">
		<ul
			class="divide-y divide-border"
			aria-label={m.board_file_list_label({ author })}
			data-testid="board-files"
		>
			{#each files as file (file.id)}
				<li
					class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1"
					data-file-id={file.id}
				>
					<span class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
						<a
							class="{ui.link} inline-flex min-h-11 min-w-0 items-center wrap-anywhere"
							href={resolve('/files/board/[fileId]', { fileId: file.id })}
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
						href="{resolve('/files/board/[fileId]', { fileId: file.id })}?download"
						download={file.name}
						data-sveltekit-reload
						aria-label={m.homework_file_download_label({ name: file.name })}
						data-testid="file-download"
					>
						<Download class="size-4 shrink-0" aria-hidden="true" />
						{m.homework_file_download()}
					</a>
				</li>
			{/each}
		</ul>
	</div>
{/if}
