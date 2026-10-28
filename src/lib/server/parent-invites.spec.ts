import { describe, expect, it } from 'vitest';
import {
	acceptInviteErrorMessage,
	cancelInviteErrorMessage,
	inviteParentErrorMessage
} from './parent-invites';

/** spec-second-parent story 3: 0056's refusals -> messages. */
describe('parent invite error messages', () => {
	it.each([
		[
			{ code: '42501', hint: 'not_your_child' },
			'You can invite a parent only for your own approved child.'
		],
		[{ code: '22023', hint: 'child_has_two_parents' }, 'This child already has two parents.'],
		[
			{ code: '22023', hint: 'own_or_linked_email' },
			'This email is yours or belongs to a parent who is already linked.'
		],
		[{ code: '22023', hint: 'invite_pending' }, 'An invite is already pending for this child.'],
		[{ code: '42501' }, "You can't change invites for this child."],
		[{ code: 'XX000' }, 'Could not create the invite. Please try again.'],
		[null, 'Could not create the invite. Please try again.']
	])('maps a create refusal %o', (err, message) => {
		expect(inviteParentErrorMessage(err)).toBe(message);
	});

	it.each([
		[{ code: '22023', hint: 'invite_not_live' }, 'This invite is no longer pending.'],
		[{ code: '42501' }, "You can't change invites for this child."],
		[{ code: 'XX000' }, 'Could not cancel the invite. Please try again.']
	])('maps a cancel refusal %o', (err, message) => {
		expect(cancelInviteErrorMessage(err)).toBe(message);
	});

	it.each([
		[{ code: '22023', hint: 'invite_not_live' }, 'This invite can no longer be accepted.'],
		[{ code: '22023', hint: 'child_has_two_parents' }, 'This child already has two parents.'],
		[
			{ code: '22023', hint: 'removed_parent' },
			"The admin removed your link to this child, so this invite can't be accepted."
		],
		[{ code: '22023', hint: 'duplicate_child_name' }, 'You already have a child with this name.'],
		[{ code: '42501' }, "You can't accept this invite."],
		[{ code: 'XX000' }, 'Could not accept the invite. Please try again.']
	])('maps an accept refusal %o', (err, message) => {
		expect(acceptInviteErrorMessage(err)).toBe(message);
	});
});
