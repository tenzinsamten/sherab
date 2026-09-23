/**
 * Turns a teacher's current class assignments and the admin's new selection
 * into the class_teachers rows to insert and delete. Duplicates and empty
 * IDs in the submitted selection are ignored.
 */
export function diffClassIds(current: readonly string[], selected: readonly string[]) {
	const currentSet = new Set(current);
	const selectedSet = new Set(selected.filter(Boolean));
	return {
		toAdd: [...selectedSet].filter((id) => !currentSet.has(id)),
		toRemove: [...currentSet].filter((id) => !selectedSet.has(id))
	};
}
