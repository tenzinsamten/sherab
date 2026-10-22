import * as m from '$lib/paraglide/messages.js';
import { num } from '$lib/format';
import { formatFileSize, type PdfFile } from '$lib/pdf-files';

/**
 * PDF files attached to a syllabus section (0039_syllabus_section_files.sql):
 * the limits and what a page shows of a file. The server checks the limits
 * (src/lib/server/syllabus-files.ts); the upload form reads them to hide
 * itself at the limit and to refuse a too-large file before it is sent.
 * Shared with homework files: `$lib/pdf-files`.
 */

/** 1 MB, also the bucket's own limit. */
export const MAX_FILE_BYTES = 1_048_576;
export const MAX_FILES_PER_SECTION = 5;

export type SyllabusFile = PdfFile;
export { formatFileSize };

/** The limits as the messages name them: "1.0 MB" and "5", in the viewer's digits. */
export const maxFileSizeText = () => formatFileSize(MAX_FILE_BYTES);
export const maxFilesText = () => num(MAX_FILES_PER_SECTION);

export const fileTooLargeMessage = () =>
	m.syllabus_file_error_too_large({ size: maxFileSizeText() });
export const fileLimitMessage = () => m.syllabus_file_error_limit({ count: maxFilesText() });
