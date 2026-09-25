import * as m from '$lib/paraglide/messages.js';
import { showToast } from '$lib/ix';

/**
 * Copies text and confirms with a toast (#41). The Clipboard API needs a
 * secure context and permission, so when it's missing or refused the value
 * on screen (if given) is selected instead, ready for a manual copy.
 */
export async function copyText(text: string, selectOnFailure?: HTMLElement) {
	try {
		if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
		await navigator.clipboard.writeText(text);
		showToast('success', m.copy_done());
	} catch {
		if (selectOnFailure) {
			const range = document.createRange();
			range.selectNodeContents(selectOnFailure);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
		}
		showToast('error', m.copy_failed());
	}
}
