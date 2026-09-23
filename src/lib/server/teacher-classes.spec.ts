import { describe, expect, it } from 'vitest';
import { diffClassIds } from './teacher-classes';

describe('diffClassIds', () => {
	it('adds newly selected classes and removes deselected ones', () => {
		expect(diffClassIds(['a', 'b'], ['b', 'c'])).toEqual({ toAdd: ['c'], toRemove: ['a'] });
	});

	it('changes nothing when the selection is unchanged', () => {
		expect(diffClassIds(['a', 'b'], ['b', 'a'])).toEqual({ toAdd: [], toRemove: [] });
	});

	it('removes every class when nothing is selected', () => {
		expect(diffClassIds(['a', 'b'], [])).toEqual({ toAdd: [], toRemove: ['a', 'b'] });
	});

	it('ignores duplicate and empty submitted ids', () => {
		expect(diffClassIds([], ['a', 'a', ''])).toEqual({ toAdd: ['a'], toRemove: [] });
	});
});
