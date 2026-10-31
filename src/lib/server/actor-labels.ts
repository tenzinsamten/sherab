import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';

type Client = SupabaseClient<Database>;

/** Who set a leave answer or deletion request, as seen by the viewer. */
export type ActorLabel = { self: true } | { self: false; name: string };

/**
 * spec-second-parent story 2 (AD-12): a label per distinct actor id. The
 * viewer is "you"; anyone else is named by actor_display_name(), once per
 * id, all at once. A null name, a failed call or a null id gets no label.
 */
export async function actorLabels(
	supabase: Client,
	studentId: string,
	actorIds: (string | null)[],
	viewerId: string | null
): Promise<Map<string, ActorLabel>> {
	const labels = new Map<string, ActorLabel>();
	const others = new Set<string>();
	for (const id of actorIds) {
		if (!id) continue;
		if (id === viewerId) labels.set(id, { self: true });
		else others.add(id);
	}
	const named = await Promise.all(
		[...others].map(async (id) => [id, await actorName(supabase, studentId, id)] as const)
	);
	for (const [id, name] of named) {
		if (name) labels.set(id, { self: false, name });
	}
	return labels;
}

/**
 * spec-parent-managed-homework story 5 (CAP-4): "Marked done by ..." labels
 * for a child's done items. The child is named from `child.name` without a
 * lookup (none when the name is blank); the viewer is "you"; every other
 * distinct id (another parent or a teacher) is looked up once by
 * actorLabels(). Only another parent comes back named: a teacher, an unknown
 * name or a failed lookup gets no label.
 */
export async function doneByLabels(
	supabase: Client,
	child: { id: string; name: string },
	doneByIds: (string | null | undefined)[],
	viewerId: string | null
): Promise<Map<string, ActorLabel>> {
	const ids = doneByIds.filter((id): id is string => Boolean(id));
	const labels = await actorLabels(
		supabase,
		child.id,
		ids.filter((id) => id !== child.id),
		viewerId
	);
	const childName = child.name.trim();
	if (ids.includes(child.id) && child.id !== viewerId && childName) {
		labels.set(child.id, { self: false, name: childName });
	}
	return labels;
}

/** The key actorNames() uses for one (student, actor) pair. */
export function actorKey(studentId: string, actorId: string): string {
	return `${studentId}:${actorId}`;
}

/**
 * spec-second-parent CAP-6 (AD-12, AD-13): the setter's name for each
 * distinct (student, actor) pair, resolved once per pair through
 * actor_display_name(). Look names up with actorKey(). Null ids, null names
 * and failed calls are left out, so the caller shows no label.
 */
export async function actorNames(
	supabase: Client,
	pairs: { studentId: string; actorId: string | null }[]
): Promise<Map<string, string>> {
	const distinct = new Map<string, { studentId: string; actorId: string }>();
	for (const { studentId, actorId } of pairs) {
		if (!actorId) continue;
		distinct.set(actorKey(studentId, actorId), { studentId, actorId });
	}
	const named = await Promise.all(
		[...distinct].map(
			async ([key, { studentId, actorId }]) =>
				[key, await actorName(supabase, studentId, actorId)] as const
		)
	);
	const names = new Map<string, string>();
	for (const [key, name] of named) {
		if (name) names.set(key, name);
	}
	return names;
}

async function actorName(
	supabase: Client,
	studentId: string,
	actorId: string
): Promise<string | null> {
	const { data, error } = await supabase.rpc('actor_display_name', {
		p_student_id: studentId,
		p_actor_id: actorId
	});
	if (error) {
		console.error('actor_display_name failed', error.message);
		return null;
	}
	return data ?? null;
}
