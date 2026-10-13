/**
 * Short-lived, read-once-ish flash cookie carrying the join wizard's
 * confirmation details (name, class) across the redirect from
 * `(auth)/join`'s `register` action to `/join/pending` -- avoids putting a
 * student's name in the URL/browser history while still letting the
 * receipt page show a specific confirmation rather than a generic one.
 *
 * #100: it also carries the new student's username and PIN, which the page
 * shows once. The cookie is httpOnly, same-site, lives 10 minutes and is
 * sent only to `/join/pending`; the PIN is stored nowhere else readable.
 */
export const JOIN_RECEIPT_COOKIE = 'join_pending_receipt';

export type JoinReceipt = {
	name: string;
	className: string;
	classCode: string;
	username?: string;
	pin?: string;
};
