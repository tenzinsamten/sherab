import * as m from '$lib/paraglide/messages.js';
import type { PgError } from './class-join';

/**
 * spec-second-parent story 3 (AD-16): the invite functions (0056) name their
 * refusal in the error hint; 42501 without a known hint = not allowed (or
 * not found, which looks the same). None of these messages depends on
 * whether the invited email has an account.
 */

/** A create_parent_invite refusal -> the inviting parent's message. */
export function inviteParentErrorMessage(err: PgError): string {
	switch (err?.hint) {
		case 'not_your_child':
			return m.invite_error_not_your_child();
		case 'child_has_two_parents':
			return m.invite_error_two_parents();
		case 'own_or_linked_email':
			return m.invite_error_own_email();
		case 'invite_pending':
			return m.invite_error_pending();
	}
	if (err?.code === '42501') return m.invite_error_not_allowed();
	return m.invite_error_failed();
}

/** A cancel_parent_invite refusal -> the parent's message. */
export function cancelInviteErrorMessage(err: PgError): string {
	if (err?.hint === 'invite_not_live') return m.invite_cancel_error_not_live();
	if (err?.code === '42501') return m.invite_error_not_allowed();
	return m.invite_cancel_error_failed();
}

/** An accept_parent_invite refusal -> the invitee's message. */
export function acceptInviteErrorMessage(err: PgError): string {
	switch (err?.hint) {
		case 'invite_not_live':
			return m.parent_invites_error_not_live();
		case 'child_has_two_parents':
			return m.parent_invites_error_two_parents();
		case 'removed_parent':
			return m.parent_invites_error_removed();
		case 'duplicate_child_name':
			return m.parent_invites_error_duplicate_name();
	}
	if (err?.code === '42501') return m.parent_invites_error_not_allowed();
	return m.parent_invites_error_failed();
}

/** One invite on the invitee's /parent page (list_my_parent_invites). */
export type MyParentInvite = {
	id: string;
	childName: string;
	/** null: the inviter's name is not known. */
	invitedBy: string | null;
	expiresAt: string;
};

/** The child page's invite card: a form, the pending invite, or nothing (two parents). */
export type InviteCard =
	{ kind: 'form' } | { kind: 'pending'; id: string; email: string; expiresAt: string } | null;
