/**
 * Short-lived, read-once-ish flash cookie carrying the join wizard's
 * confirmation details (name, class) across the redirect from
 * `(auth)/join`'s `register` action to `/join/pending` -- avoids putting a
 * student's name in the URL/browser history while still letting the
 * receipt page show a specific confirmation rather than a generic one.
 */
export const JOIN_RECEIPT_COOKIE = 'join_pending_receipt';

export type JoinReceipt = {
	name: string;
	className: string;
	classCode: string;
	guardianEmail: string;
};
