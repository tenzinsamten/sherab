import * as m from '$lib/paraglide/messages.js';
import { num } from '$lib/format';
import { getLocale } from '$lib/paraglide/runtime';

/**
 * PDF files attached to a syllabus section (0039_syllabus_section_files.sql):
 * the limits and what a page shows of a file. The server checks the limits
 * (src/lib/server/syllabus-files.ts); the upload form reads them to hide
 * itself at the limit and to refuse a too-large file before it is sent.
 */

/** 1 MB, also the bucket's own limit. */
export const MAX_FILE_BYTES = 1_048_576;
export const MAX_FILES_PER_SECTION = 5;

export type SyllabusFile = {
	id: string;
	/** The original file name: shown, and used when the file is downloaded. */
	name: string;
	/** Size in bytes. */
	size: number;
};

/**
 * A file size as "340 KB" below 1,048,576 bytes and "1.0 MB" from there, in
 * the viewer's digits and decimal separator ("1,0 MB" in German).
 */
export function formatFileSize(bytes: number, locale: string = getLocale()): string {
	if (bytes >= MAX_FILE_BYTES) {
		const size = (bytes / MAX_FILE_BYTES).toFixed(1);
		return m.syllabus_file_size_mb({
			size: num(locale === 'de' ? size.replace('.', ',') : size, locale)
		});
	}
	return m.syllabus_file_size_kb({ size: num(Math.max(1, Math.round(bytes / 1024)), locale) });
}

/** The limits as the messages name them: "1.0 MB" and "5", in the viewer's digits. */
export const maxFileSizeText = () => formatFileSize(MAX_FILE_BYTES);
export const maxFilesText = () => num(MAX_FILES_PER_SECTION);

export const fileTooLargeMessage = () =>
	m.syllabus_file_error_too_large({ size: maxFileSizeText() });
export const fileLimitMessage = () => m.syllabus_file_error_limit({ count: maxFilesText() });
