import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { CLASS_MESSAGES, rowOr404 } from './class-access';

function statusOf(fn: () => unknown): number | null {
	try {
		fn();
		return null;
	} catch (e) {
		return isHttpError(e) ? e.status : -1;
	}
}

describe('rowOr404', () => {
	it('returns the row when there is one', () => {
		const row = { id: 'c1', name: 'Yaks' };
		expect(rowOr404({ data: row, error: null }, CLASS_MESSAGES)).toBe(row);
	});

	it('is a 404 when there is no row (missing, or hidden by RLS)', () => {
		expect(statusOf(() => rowOr404({ data: null, error: null }, CLASS_MESSAGES))).toBe(404);
	});

	it('is a 500, not a 404, when the query itself fails', () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(
			statusOf(() =>
				rowOr404(
					{ data: null, error: { message: 'column classes.syllabus does not exist' } },
					CLASS_MESSAGES
				)
			)
		).toBe(500);
		expect(log).toHaveBeenCalled();
		log.mockRestore();
	});
});
