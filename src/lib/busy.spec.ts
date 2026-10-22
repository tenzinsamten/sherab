import { describe, expect, it } from 'vitest';
import { actionEnded, actionStarted, runningActions } from './busy.svelte';

describe('running actions counter', () => {
	it('counts started actions until each one ends', () => {
		expect(runningActions()).toBe(0);
		actionStarted();
		actionStarted();
		expect(runningActions()).toBe(2);
		actionEnded();
		expect(runningActions()).toBe(1);
		actionEnded();
		expect(runningActions()).toBe(0);
	});

	it('never goes below 0', () => {
		actionEnded();
		actionEnded();
		expect(runningActions()).toBe(0);
		actionStarted();
		expect(runningActions()).toBe(1);
		actionEnded();
		expect(runningActions()).toBe(0);
	});
});
