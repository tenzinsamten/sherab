import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { todayInBerlin } from '$lib/berlin-date';
import { toHhMm } from '$lib/server/calendar';
import { leaveErrorMessage } from '$lib/server/leave';
import type { Actions, PageServerLoad } from './$types';

export type LeaveAnswer = 'coming' | 'on_leave' | 'sick';
export type LeaveClassification = 'planned' | 'short_notice';
export type SickDecision = 'approved' | 'rejected';

export type ChildSession = {
	id: string;
	day: string;
	className: string;
	/** `HH:MM`, null = no time set (the session then starts at 00:00). */
	startTime: string | null;
	durationMinutes: number | null;
	/** Coming / On leave can still be set: the session has not started (DB instant). */
	open: boolean;
	answer: LeaveAnswer | null;
	classification: LeaveClassification | null;
	/** Story 7-5: the decision on this session's Sick. Once set, the answers are locked. */
	decision: SickDecision | null;
	/**
	 * Story 7-5 (decision 2): Sick can be offered -- the session is dated
	 * yesterday or today (Berlin), so still inside the database's Sick window
	 * (until the end of the day after), and nothing has been decided.
	 */
	sickOpen: boolean;
};

/** How far ahead the leave page lists sessions. */
const LEAVE_WINDOW_DAYS = 12 * 7;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function plusDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/**
 * Stories 7-4, 7-5: one approved child's non-cancelled sessions from
 * yesterday (Berlin) through the next 12 weeks, each with its current leave
 * answer and the decision on a Sick answer. The child must be
 * one of the caller's approved children (linked_children(), the same rule as
 * is_parent_of); anything else is a 404. RLS (is_parent_in_class,
 * is_parent_of) is the real barrier for every read.
 */
export const load: PageServerLoad = async ({ params, parent, locals: { supabase } }) => {
	const { parentStatus } = await parent();
	if (parentStatus !== 'approved' || !UUID_PATTERN.test(params.id)) {
		throw error(404, 'Not found');
	}

	const { data: linked } = await supabase.rpc('linked_children');
	const child = (linked ?? []).find((c) => c.id === params.id && c.status === 'approved');
	if (!child) {
		throw error(404, 'Not found');
	}

	const { data: enrollments, error: enrollmentsError } = await supabase
		.from('class_enrollments')
		.select('class_id')
		.eq('student_id', child.id);
	const classIds = (enrollments ?? []).map((e) => e.class_id);

	let sessions: ChildSession[] = [];
	let loadError = Boolean(enrollmentsError);

	if (classIds.length > 0) {
		const today = todayInBerlin();
		const yesterday = plusDays(today, -1);
		const { data: rows, error: sessionsError } = await supabase
			.from('class_sessions_effective')
			.select('id, day, class_name, start_time, duration_minutes, starts_at')
			.in('class_id', classIds)
			.eq('cancelled', false)
			.gte('day', yesterday)
			.lte('day', plusDays(today, LEAVE_WINDOW_DAYS))
			.order('day')
			.order('start_time', { nullsFirst: true });
		if (sessionsError) loadError = true;

		const sessionIds = (rows ?? []).flatMap((r) => (r.id ? [r.id] : []));
		const current = new Map<
			string,
			{ answer: LeaveAnswer; classification: LeaveClassification | null }
		>();
		const decisions = new Map<string, SickDecision>();
		if (sessionIds.length > 0) {
			const [{ data: answers, error: answersError }, { data: decided, error: decidedError }] =
				await Promise.all([
					supabase
						.from('session_leave_history')
						.select('class_session_id, answer, classification')
						.eq('student_id', child.id)
						.in('class_session_id', sessionIds)
						.order('answered_at', { ascending: false })
						.order('id', { ascending: false }),
					supabase
						.from('sick_leave_decisions')
						.select('class_session_id, decision')
						.eq('student_id', child.id)
						.in('class_session_id', sessionIds)
				]);
			if (answersError || decidedError) loadError = true;
			for (const d of decided ?? []) decisions.set(d.class_session_id, d.decision);
			// Newest first: the first row per session is the current answer.
			for (const a of answers ?? []) {
				if (!current.has(a.class_session_id)) {
					current.set(a.class_session_id, {
						answer: a.answer,
						classification: a.classification
					});
				}
			}
		}

		const now = Date.now();
		sessions = (rows ?? []).flatMap((r) =>
			r.id && r.day
				? [
						{
							id: r.id,
							day: r.day,
							className: r.class_name ?? '',
							startTime: r.start_time ? toHhMm(r.start_time) : null,
							durationMinutes: r.duration_minutes,
							open: r.starts_at ? Date.parse(r.starts_at) > now : false,
							answer: current.get(r.id)?.answer ?? null,
							classification: current.get(r.id)?.classification ?? null,
							decision: decisions.get(r.id) ?? null,
							sickOpen: r.day >= yesterday && r.day <= today && !decisions.has(r.id)
						}
					]
				: []
		);
	}

	return { child: { id: child.id, name: child.name }, sessions, loadError };
};

async function readSessionId(request: Request) {
	const formData = await request.formData();
	return { formData, sessionId: String(formData.get('sessionId') ?? '') };
}

export const actions: Actions = {
	/** The classification an On leave saved now would get (preview_leave, never computed here). */
	preview: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/login');

		const { sessionId } = await readSessionId(request);
		if (!UUID_PATTERN.test(sessionId)) {
			return fail(400, { error: m.leave_error_failed(), sessionId });
		}

		const { data, error: rpcError } = await supabase.rpc('preview_leave', {
			p_class_session_id: sessionId,
			p_student_id: params.id
		});
		if (rpcError || (data !== 'planned' && data !== 'short_notice')) {
			return fail(rpcError?.code === '42501' ? 403 : 400, {
				error: leaveErrorMessage(rpcError),
				sessionId
			});
		}
		return { action: 'preview' as const, sessionId, preview: data };
	},

	/**
	 * Appends Coming, On leave or Sick. The database stamps actor, time and
	 * classification, and enforces every cutoff and a decided session's lock.
	 */
	setLeave: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/login');

		const { formData, sessionId } = await readSessionId(request);
		const answer = String(formData.get('answer') ?? '');
		if (
			!UUID_PATTERN.test(sessionId) ||
			(answer !== 'coming' && answer !== 'on_leave' && answer !== 'sick')
		) {
			return fail(400, { error: m.leave_error_invalid(), sessionId });
		}

		const { data, error: insertError } = await supabase
			.from('session_leave_history')
			.insert({ class_session_id: sessionId, student_id: params.id, answer })
			.select('answer, classification')
			.single();
		if (insertError || !data) {
			return fail(insertError?.code === '42501' ? 403 : 400, {
				error: leaveErrorMessage(insertError),
				sessionId
			});
		}
		return {
			action: 'setLeave' as const,
			success: true,
			sessionId,
			answer: data.answer,
			classification: data.classification
		};
	}
};
