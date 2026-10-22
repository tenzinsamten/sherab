import * as m from '$lib/paraglide/messages.js';
import { num } from '$lib/format';
import { getLocale } from '$lib/paraglide/runtime';

/**
 * What a page shows of a stored PDF file, for syllabus section files (#95,
 * `syllabus-files.ts`) and homework files (#110, `homework-files.ts`) alike.
 */

/** 1 MB as the app counts it: 1,048,576 bytes. */
export const BYTES_PER_MB = 1_048_576;

export type PdfFile = {
	id: string;
	/** The original file name: shown, and used when the file is downloaded. */
	name: string;
	/** Size in bytes. */
	size: number;
};

/**
 * A file size as "340 KB" and, from what would round to 1024 KB (1,048,064
 * bytes), as "1.0 MB", in the viewer's digits and decimal separator ("1,0 MB"
 * in German). Never "1024 KB".
 */
export function formatFileSize(bytes: number, locale: string = getLocale()): string {
	const kb = Math.max(1, Math.round(bytes / 1024));
	if (kb >= 1024) {
		const size = (bytes / BYTES_PER_MB).toFixed(1);
		return m.syllabus_file_size_mb({
			size: num(locale === 'de' ? size.replace('.', ',') : size, locale)
		});
	}
	return m.syllabus_file_size_kb({ size: num(kb, locale) });
}
