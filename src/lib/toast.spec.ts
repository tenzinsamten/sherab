import { beforeEach, describe, expect, it, vi } from 'vitest';

const sonner = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}));
vi.mock('svelte-sonner', () => ({ toast: sonner }));

import { showToast, type ToastType } from './toast';

describe('showToast (mobile-first story 10)', () => {
	beforeEach(() => vi.clearAllMocks());

	it.each<ToastType>(['success', 'error', 'info', 'warning'])(
		'%s calls the matching Sonner toast with the message',
		(type) => {
			showToast(type, `Saved ${type}`);
			expect(sonner[type]).toHaveBeenCalledExactlyOnceWith(`Saved ${type}`);
			for (const other of Object.keys(sonner) as ToastType[]) {
				if (other !== type) expect(sonner[other]).not.toHaveBeenCalled();
			}
		}
	);
});
