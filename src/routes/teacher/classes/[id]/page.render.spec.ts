import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

// EnrollmentPanel (still iX) reads the latest form result.
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/teacher/classes/c1'), form: null }
}));

/**
 * Mobile-first story 7: the class page as the server renders it (before
 * any script runs): the newest session picked, its marks ticked, the leave
 * badge inside the student's row, and EnrollmentPanel after the new root.
 */
const students = [
	{ id: 's1', displayName: 'Ada' },
	{ id: 's2', displayName: 'Bo' }
];

function data(overrides: Record<string, unknown> = {}) {
	return {
		class: { id: 'c1', name: 'Class One', code: 'ABC123' },
		students,
		enrollable: [],
		skillHistory: [],
		attendance: [],
		currentMarks: { 'new:s1': true, 'new:s2': false, 'old:s2': true },
		markedSessionIds: ['new'],
		attendanceError: false,
		markableSessions: [
			{ id: 'new', day: '2026-10-19', startTime: '10:00:00' },
			{ id: 'old', day: '2026-10-12', startTime: null }
		],
		leaveAnswers: { 'new:s2': 'on_leave' },
		upcomingLeave: [],
		currentSkills: {},
		homeworkCounts: { open: 1, total: 2 },
		syllabusCounts: { total: 0, hasCurrent: false },
		currentYear: 2026,
		loadError: false,
		...overrides
	};
}

function renderPage(overrides: Record<string, unknown> = {}) {
	return render(Page, {
		props: { params: { id: 'c1' }, data: data(overrides), form: null } as never
	}).body;
}

const row = (body: string, id: string) =>
	body.match(new RegExp(`<label[^>]*data-student-id="${id}"[\\s\\S]*?</label>`))?.[0] ?? '';

describe('teacher class page (+page.svelte)', () => {
	it('picks the newest session and ticks its present marks', () => {
		const body = renderPage();
		expect(body).toMatch(/<option[^>]*value="new"[^>]*selected/);
		expect(body).toContain(m.roster_attendance_session_marked({ session: '2026-10-19 · 10:00' }));
		expect(row(body, 's1')).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
		expect(row(body, 's2')).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
		expect(body).toMatch(/name="loaded_s1" value="present"/);
		expect(body).toMatch(/name="loaded_s2" value="absent"/);
	});

	it('shows the leave answer as a badge inside the student row', () => {
		const body = renderPage();
		expect(row(body, 's2')).toContain(m.leave_answer_on_leave());
		expect(row(body, 's1')).not.toContain('data-testid="leave-badge"');
	});

	it('renders the page in its new-UI root, and EnrollmentPanel after it', () => {
		const body = renderPage();
		const root = body.indexOf('data-ui="new"');
		const panel = body.indexOf('<section class="card"');
		expect(root).toBeGreaterThanOrEqual(0);
		// The page's own markup comes first and has no iX in it; the panel's iX card follows.
		expect(body.indexOf('data-tour="class-skills"')).toBeGreaterThan(root);
		expect(panel).toBeGreaterThan(body.indexOf('data-tour="class-skills"'));
		expect(body.slice(root, panel)).not.toMatch(/<ix-/);
	});

	it('without a markable session: the hint, and no save target for the tour', () => {
		const body = renderPage({ markableSessions: [], markedSessionIds: [], currentMarks: {} });
		expect(body).toContain(m.roster_attendance_no_sessions());
		expect(body).not.toContain('data-tour="class-attendance-save"');
		expect(body).not.toContain('id="sessionId"');
	});
});
