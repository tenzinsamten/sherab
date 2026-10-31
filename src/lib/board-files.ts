import * as m from '$lib/paraglide/messages.js';
import { formatFileSize, type PdfFile } from '$lib/pdf-files';

/**
 * The image on a board post (spec-parent-message-board story 8,
 * 0064_board_images.sql): at most 1 per post, JPEG, PNG or WebP, up to
 * 5 MB. The server checks them (src/lib/server/board-files.ts); the post
 * form reads them to refuse a too-large or wrong file before it is sent.
 *
 * Posts from before story 8 may still carry PDF files (`BoardFile`), shown
 * as download links.
 */

/** 5 MB (5,242,880 bytes), also the bucket's own limit. */
export const MAX_BOARD_IMAGE_BYTES = 5_242_880;
export const MAX_IMAGES_PER_POST = 1;

/** The types the bucket and the server accept, as the file input asks for them. */
export const BOARD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const BOARD_IMAGE_ACCEPT = BOARD_IMAGE_TYPES.join(',');

/** A post's image: shown and opened through /files/board/[id], which signs a fresh link. */
export type BoardImage = { id: string; name: string };

/** A legacy PDF file on a post from before story 8. */
export type BoardFile = PdfFile;

export const maxBoardImageSizeText = () => formatFileSize(MAX_BOARD_IMAGE_BYTES);

export const boardImageTooLargeMessage = () =>
	m.board_image_error_too_large({ size: maxBoardImageSizeText() });
export const boardImageTypeMessage = () => m.board_image_error_type();
export const boardImageLimitMessage = () => m.board_image_error_limit();
/** The whole post is over its cap: names the limits. */
export const boardImagePostTooLargeMessage = () =>
	m.board_image_error_post_too_large({ size: maxBoardImageSizeText() });

/**
 * The client's check of a chosen file, type before size; the server checks
 * the bytes again. An empty type (some pickers send none) is left to the server.
 */
export function boardImageProblem(file: File): string | null {
	if (file.type && !(BOARD_IMAGE_TYPES as readonly string[]).includes(file.type)) {
		return boardImageTypeMessage();
	}
	if (file.size > MAX_BOARD_IMAGE_BYTES) return boardImageTooLargeMessage();
	return null;
}
