import { describe, expect, it } from 'vitest';
import {
	MAX_PENDING_JOIN_REQUESTS,
	classJoinDecisionErrorMessage,
	classJoinDismissErrorMessage,
	classJoinErrorMessage
} from './class-join';

/** B12a (#67): 0031's refusals -> messages. */
describe('class join error messages', () => {
	it('puts the shared cap into the limit message', () => {
		expect(MAX_PENDING_JOIN_REQUESTS).toBe(3);
		expect(classJoinErrorMessage({ code: '22023', hint: 'join_limit' })).toBe(
			'You have 3 requests waiting. Wait for a decision before sending another.'
		);
	});

	it('maps dismiss refusals', () => {
		expect(classJoinDismissErrorMessage({ code: '22023', hint: 'join_not_rejected' })).toBe(
			'Only a rejected request can be dismissed.'
		);
		expect(classJoinDismissErrorMessage({ code: '42501' })).toBe(
			'Could not dismiss the request. Please try again.'
		);
	});

	it.each([
		[{ code: '42501' }, "You can't decide this join request."],
		[{ code: '22023', hint: 'join_not_pending' }, 'This join request has already been decided.'],
		[{ code: '22023', hint: 'join_decision_invalid' }, 'Choose approve or reject.'],
		[
			{ code: '22023', hint: 'join_student_not_approved' },
			"This student's account is no longer approved."
		],
		[{ code: 'XX000' }, 'Could not save the decision. Please try again.']
	])('maps a decide refusal %o', (err, message) => {
		expect(classJoinDecisionErrorMessage(err)).toBe(message);
	});
});
