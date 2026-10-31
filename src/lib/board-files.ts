import * as m from '$lib/paraglide/messages.js';
import {
	MAX_FILES_PER_HOMEWORK,
	MAX_HOMEWORK_FILE_BYTES,
	homeworkFileTooLargeMessage,
	maxHomeworkFileSizeText
} from '$lib/homework-files';
import { num } from '$lib/format';
import type { PdfFile } from '$lib/pdf-files';

/**
 * PDF files on a board post (spec-parent-message-board story 4, CAP-2,
 * 0061_message_board.sql): the homework rules -- PDF only, 5 MB each, at
 * most 2 per post. The server checks them (src/lib/server/board-files.ts);
 * the post form reads them to refuse too many or too large files before
 * they are sent.
 */

export const MAX_BOARD_FILE_BYTES = MAX_HOMEWORK_FILE_BYTES;
export const MAX_FILES_PER_POST = MAX_FILES_PER_HOMEWORK;

export type BoardFile = PdfFile;

export const maxBoardFileSizeText = maxHomeworkFileSizeText;
export const maxBoardFilesText = () => num(MAX_FILES_PER_POST);

export const boardFileTooLargeMessage = homeworkFileTooLargeMessage;
/** The whole post is over its cap: names both limits. */
export const boardFilePostTooLargeMessage = () =>
	m.board_file_error_post_too_large({
		count: maxBoardFilesText(),
		size: maxBoardFileSizeText()
	});
export const boardFileLimitMessage = () => m.board_file_error_limit({ count: maxBoardFilesText() });
