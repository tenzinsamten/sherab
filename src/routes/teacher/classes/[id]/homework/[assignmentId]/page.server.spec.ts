import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';

const { actions } = await import('./+page.server');

/**
 * #103, #103b: endSeries. It ends the series with Munich's date and, when
 * the teacher ticked it, archives every copy of the series that is not
 * archived yet -- only after the series is ended.
 */
type Result = { data?: unknown; error: unknown };
type Call = {
	table: string;
	values: Record<string, unknown>;
	filters: [string, ...unknown[]][];
};

function event(fields: Record<string, string>, answers: { end?: Result; archive?: Result } = {}) {
	const body = new FormData();
	body.set('assignmentId', 'series1');
	for (const [name, value] of Object.entries(fields)) body.set(name, value);

	const calls: Call[] = [];
	const supabase = {
		from: (table: string) => ({
			update: (values: Record<string, unknown>) => {
				const call: Call = { table, values, filters: [] };
				calls.push(call);
				const answer =
					table === 'homework_assignments'
						? (answers.end ?? { data: [{ id: 'series1' }], error: null })
						: (answers.archive ?? { data: [{ id: 'copy1' }], error: null });
				const chain: Record<string, unknown> = {};
				for (const name of ['eq', 'not', 'or', 'is', 'select']) {
					chain[name] = (...args: unknown[]) => {
						call.filters.push([name, ...args]);
						return chain;
					};
				}
				chain.then = (resolve: (value: Result) => unknown) => resolve(answer);
				return chain;
			}
		})
	};
	const e = {
		request: new Request('https://app.test/teacher/classes/c1/homework/series1?/endSeries', {
			method: 'POST',
			body
		}),
		params: { id: 'c1', assignmentId: 'series1' },
		locals: {
			supabase,
			safeGetSession: async () => ({ session: {}, user: { id: 'teacher1' } })
		}
	} as unknown as Parameters<typeof actions.endSeries>[0];
	return { e, calls };
}

describe('endSeries (#103, #103b)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// 00:30 on Tuesday 13 October 2026 in Munich: still the 12th in UTC.
		vi.setSystemTime(new Date('2026-10-12T22:30:00Z'));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('not ticked: ends the series with the date in Munich and archives nothing', async () => {
		const { e, calls } = event({});

		expect(await actions.endSeries(e)).toEqual({
			success: true,
			action: 'endSeries',
			archived: false,
			archiveFailed: false
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].table).toBe('homework_assignments');
		expect(calls[0].values).toEqual({ ends_on: '2026-10-13' });
		expect(calls[0].filters).toContainEqual(['eq', 'id', 'series1']);
		expect(calls[0].filters).toContainEqual(['eq', 'class_id', 'c1']);
		expect(calls[0].filters).toContainEqual(['not', 'recurrence_rule', 'is', null]);
		expect(calls[0].filters).toContainEqual(['or', 'ends_on.is.null,ends_on.gt.2026-10-13']);
	});

	it('ticked: ends the series, then archives its copies that are not archived yet', async () => {
		const { e, calls } = event({ archiveCopies: 'on' });

		expect(await actions.endSeries(e)).toEqual({
			success: true,
			action: 'endSeries',
			archived: true,
			archiveFailed: false
		});
		expect(calls.map((c) => c.table)).toEqual(['homework_assignments', 'homework_instances']);
		expect(calls[1].values).toEqual({
			archived_at: '2026-10-12T22:30:00.000Z',
			archived_by: 'teacher1'
		});
		// Only this series, only this class, and never a copy that is
		// already archived (its date and teacher stay as they are).
		expect(calls[1].filters).toEqual([
			['eq', 'assignment_id', 'series1'],
			['eq', 'class_id', 'c1'],
			['is', 'archived_at', null],
			['select', 'id']
		]);
	});

	it('only the value the page sends counts as ticked', async () => {
		for (const value of ['', 'off', 'false']) {
			const { e, calls } = event({ archiveCopies: value });
			expect(await actions.endSeries(e)).toMatchObject({ success: true, archived: false });
			expect(calls.map((c) => c.table)).toEqual(['homework_assignments']);
		}
	});

	it('ticked, but the series has no open copy: ended, and nothing is called archived', async () => {
		const { e } = event({ archiveCopies: 'on' }, { archive: { data: [], error: null } });

		expect(await actions.endSeries(e)).toEqual({
			success: true,
			action: 'endSeries',
			archived: false,
			archiveFailed: false
		});
	});

	it('no homework id: nothing is ended or archived', async () => {
		const { e, calls } = event({ assignmentId: '', archiveCopies: 'on' });

		expect(await actions.endSeries(e)).toMatchObject({ status: 400 });
		expect(calls).toEqual([]);
	});

	it('ticked, but the series could not be ended: nothing is archived', async () => {
		const { e, calls } = event({ archiveCopies: 'on' }, { end: { data: [], error: null } });

		const result = await actions.endSeries(e);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.homework_series_error_end_failed(), action: 'endSeries' }
		});
		expect(calls.map((c) => c.table)).toEqual(['homework_assignments']);
	});

	it('ended, but archiving failed: still a success, so the page reloads as ended, and it says the homework is still there', async () => {
		const { e, calls } = event(
			{ archiveCopies: 'on' },
			{ archive: { data: null, error: { message: 'permission denied' } } }
		);

		expect(await actions.endSeries(e)).toEqual({
			success: true,
			action: 'endSeries',
			archived: false,
			archiveFailed: true
		});
		expect(calls.map((c) => c.table)).toEqual(['homework_assignments', 'homework_instances']);
	});
});
