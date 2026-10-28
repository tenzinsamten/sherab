import { describe, expect, it } from 'vitest';
import { removeParentLinkErrorMessage } from './parent-links';

/** spec-second-parent story 4: 0057's refusals -> the admin's messages. */
describe('remove parent link error messages', () => {
	it.each([
		[{ code: '42501', hint: 'own_child' }, "You can't remove a parent link of your own child."],
		[{ code: '22023', hint: 'link_removed' }, 'This parent link is already removed.'],
		[
			{ code: '22023', hint: 'last_parent_link' },
			"This is the child's only parent link, so it can't be removed."
		],
		// The keep-one trigger's backstop: the same hint, another code.
		[
			{ code: '23514', hint: 'last_parent_link' },
			"This is the child's only parent link, so it can't be removed."
		],
		[{ code: '42501' }, "You can't remove this parent link."],
		[{ code: 'XX000' }, 'Could not remove the parent link. Please try again.'],
		[null, 'Could not remove the parent link. Please try again.']
	])('maps a refusal %o', (err, message) => {
		expect(removeParentLinkErrorMessage(err)).toBe(message);
	});
});
