import { JOIN_RECEIPT_COOKIE, type JoinReceipt } from '$lib/server/join-receipt';
import type { PageServerLoad } from './$types';

/**
 * Reads the flash-style receipt cookie set by the join wizard's `register`
 * action. Deliberately does NOT redirect away when it's missing (a direct
 * visit, an expired cookie, or a refresh past its short TTL) -- the page
 * still renders a true, if less specific, "pending" status rather than
 * bouncing the visitor elsewhere (see +page.svelte's generic fallback).
 */
export const load: PageServerLoad = async ({ cookies }) => {
	const raw = cookies.get(JOIN_RECEIPT_COOKIE);
	if (!raw) {
		return { receipt: null };
	}

	try {
		return { receipt: JSON.parse(raw) as JoinReceipt };
	} catch {
		return { receipt: null };
	}
};
