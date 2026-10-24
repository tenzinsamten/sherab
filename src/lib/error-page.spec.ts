import { describe, expect, it } from 'vitest';
import { errorKind } from './error-page';

describe('errorKind', () => {
	it('tells a missing page from a refused one', () => {
		expect(errorKind(404)).toBe('not-found');
		expect(errorKind(403)).toBe('forbidden');
		expect(errorKind(401)).toBe('forbidden');
	});

	it('shows the general message for everything else', () => {
		expect(errorKind(400)).toBe('generic');
		expect(errorKind(500)).toBe('generic');
		expect(errorKind(503)).toBe('generic');
	});
});
