import { describe, expect, it, vi } from 'vitest';
import {
	CLASS_CODE_CONSTRAINT,
	CLASS_CODE_LENGTH,
	generateClassCode,
	insertClassWithUniqueCode,
	UNIQUE_VIOLATION_CODE
} from './class-code';

describe('generateClassCode', () => {
	it('generates a code of the expected length', () => {
		expect(generateClassCode()).toHaveLength(CLASS_CODE_LENGTH);
		expect(generateClassCode(8)).toHaveLength(8);
	});

	it('only uses human-typeable, non-ambiguous characters', () => {
		// No 0/O or 1/I: a code read off a whiteboard or spoken aloud must not
		// be ambiguous between them.
		for (let i = 0; i < 200; i++) {
			expect(generateClassCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
		}
	});

	it('is not the same on every call (statistically distinct)', () => {
		const codes = new Set(Array.from({ length: 500 }, () => generateClassCode()));
		// 32^6 possible codes -- 500 draws colliding even once would be
		// astronomically unlikely if generation were working correctly.
		expect(codes.size).toBe(500);
	});
});

const codeCollision = {
	code: UNIQUE_VIOLATION_CODE,
	message: `duplicate key value violates unique constraint "${CLASS_CODE_CONSTRAINT}"`
};
const nameCollision = {
	code: UNIQUE_VIOLATION_CODE,
	message: 'duplicate key value violates unique constraint "classes_name_unique_idx"'
};

describe('insertClassWithUniqueCode', () => {
	it('returns the inserted row on the first successful attempt', async () => {
		const insertAttempt = vi.fn(async (code: string) => ({
			data: { id: '1', code },
			error: null
		}));

		const { data, error } = await insertClassWithUniqueCode(insertAttempt);

		expect(error).toBeNull();
		expect(data?.id).toBe('1');
		expect(insertAttempt).toHaveBeenCalledTimes(1);
	});

	it('retries with a new code on a unique-constraint collision, then succeeds', async () => {
		const seenCodes: string[] = [];
		let attempts = 0;
		const insertAttempt = vi.fn(async (code: string) => {
			seenCodes.push(code);
			attempts++;
			if (attempts < 3) {
				return { data: null, error: codeCollision };
			}
			return { data: { id: '1', code }, error: null };
		});

		const { data, error } = await insertClassWithUniqueCode(insertAttempt);

		expect(error).toBeNull();
		expect(data?.id).toBe('1');
		expect(insertAttempt).toHaveBeenCalledTimes(3);
		// Each retry used a freshly generated code, not the same colliding one.
		expect(new Set(seenCodes).size).toBe(3);
	});

	it('gives up after maxAttempts consecutive collisions', async () => {
		const insertAttempt = vi.fn(async () => ({
			data: null,
			error: codeCollision
		}));

		const { data, error } = await insertClassWithUniqueCode(insertAttempt, { maxAttempts: 4 });

		expect(data).toBeNull();
		expect(error?.code).toBe(UNIQUE_VIOLATION_CODE);
		expect(insertAttempt).toHaveBeenCalledTimes(4);
	});

	it('does not retry on a non-collision error', async () => {
		const insertAttempt = vi.fn(async () => ({
			data: null,
			error: { code: '23503', message: 'foreign key violation' }
		}));

		const { data, error } = await insertClassWithUniqueCode(insertAttempt);

		expect(data).toBeNull();
		expect(error?.message).toBe('foreign key violation');
		expect(insertAttempt).toHaveBeenCalledTimes(1);
	});

	it('does not retry when the class name is already taken', async () => {
		const insertAttempt = vi.fn(async () => ({ data: null, error: nameCollision }));

		const { data, error } = await insertClassWithUniqueCode(insertAttempt);

		expect(data).toBeNull();
		expect(error).toBe(nameCollision);
		expect(insertAttempt).toHaveBeenCalledTimes(1);
	});
});
