import * as m from '$lib/paraglide/messages.js';
import { num } from '$lib/format';
import { formatFileSize, type PdfFile } from '$lib/pdf-files';

/**
 * PDF files attached to a homework (#110, 0053_homework_files.sql): the
 * limits and the messages that name them. The server checks the limits
 * (src/lib/server/homework-files.ts); the forms read them to hide the upload
 * field at the limit and to refuse a too-large file before it is sent.
 */

/** 5 MB (5,242,880 bytes), also the bucket's own limit. */
export const MAX_HOMEWORK_FILE_BYTES = 5_242_880;
export const MAX_FILES_PER_HOMEWORK = 2;

export type HomeworkFile = PdfFile;

/** The limits as the messages name them: "5.0 MB" and "2", in the viewer's digits. */
export const maxHomeworkFileSizeText = () => formatFileSize(MAX_HOMEWORK_FILE_BYTES);
export const maxHomeworkFilesText = () => num(MAX_FILES_PER_HOMEWORK);

export const homeworkFileTooLargeMessage = () =>
	m.homework_file_error_too_large({ size: maxHomeworkFileSizeText() });
export const homeworkFileLimitMessage = () =>
	m.homework_file_error_limit({ count: maxHomeworkFilesText() });
