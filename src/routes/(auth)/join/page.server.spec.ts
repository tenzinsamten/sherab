import { beforeEach, describe, expect, it, vi } from 'vitest';

const createUser = vi.fn();
const approvedParentExists = vi.fn();
vi.mock('$lib/supabase/admin', () => ({
	createSupabaseAdminClient: () => ({ auth: { admin: { createUser } } })
}));
vi.mock('$lib/server/parent-registration', () => ({
	approvedParentExists: (...args: unknown[]) => approvedParentExists(...args)
}));

const { actions } = await import('./+page.server');
const m = await import('$lib/paraglide/messages.js');

const NO_PARENT =
	'No parent account found. Check the email is correct, or ask your parent to register first.';

function registerEvent(available: boolean | null = true) {
	const body = new FormData();
	body.set('classId', 'c1');
	body.set('className', 'Class A');
	body.set('classCode', 'ABC123');
	body.set('registrationName', 'Tenzin Dolma');
	body.set('guardianEmail', '  Pema@Example.com ');
	body.set('guardianConsent', 'on');
	const cookies = { set: vi.fn() };
	const rpc = vi.fn().mockResolvedValue({ data: available, error: null });
	const e = {
		request: new Request('https://app.test/join', { method: 'POST', body }),
		cookies,
		locals: { supabase: { rpc } }
	} as unknown as Parameters<typeof actions.register>[0];
	return { e, cookies, rpc };
}

describe('join register (Story 7-2)', () => {
	beforeEach(() => {
		createUser.mockReset();
		createUser.mockResolvedValue({ data: { user: { id: 's1' } }, error: null });
		approvedParentExists.mockReset();
	});

	it('shows the exact FR-3 message and creates nothing when no approved parent is found', async () => {
		approvedParentExists.mockResolvedValue(false);
		const { e, cookies } = registerEvent();

		const result = await actions.register(e);

		expect(m.join_error_no_parent()).toBe(NO_PARENT);
		expect(result).toMatchObject({ status: 400, data: { error: m.join_error_no_parent() } });
		expect(approvedParentExists).toHaveBeenCalledWith(expect.anything(), 'Pema@Example.com');
		expect(createUser).not.toHaveBeenCalled();
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('creates a pre-confirmed student with a synthetic pending- email when the parent is found', async () => {
		approvedParentExists.mockResolvedValue(true);
		const { e, cookies } = registerEvent();

		await expect(actions.register(e)).rejects.toMatchObject({
			status: 303,
			location: '/join/pending'
		});

		expect(createUser).toHaveBeenCalledTimes(1);
		const args = createUser.mock.calls[0][0];
		expect(args.email).toMatch(/^pending-[0-9a-f-]{36}@students\.internal\.invalid$/);
		expect(args.email_confirm).toBe(true);
		expect(typeof args.password).toBe('string');
		expect(args.password.length).toBeGreaterThanOrEqual(32);
		expect(args.app_metadata).toBeUndefined();
		expect(args.user_metadata).toMatchObject({
			role: 'student',
			class_id: 'c1',
			registration_name: 'Tenzin Dolma',
			guardian_email: 'Pema@Example.com'
		});
		expect(args.user_metadata.guardian_consent_given_at).toEqual(expect.any(String));

		expect(cookies.set).toHaveBeenCalledTimes(1);
		expect(JSON.parse(cookies.set.mock.calls[0][1])).toEqual({
			name: 'Tenzin Dolma',
			className: 'Class A',
			classCode: 'ABC123'
		});
	});

	it('refuses a taken (class, name) pair before looking up the parent', async () => {
		const { e } = registerEvent(false);
		expect(await actions.register(e)).toMatchObject({
			status: 400,
			data: { error: m.join_error_duplicate() }
		});
		expect(approvedParentExists).not.toHaveBeenCalled();
		expect(createUser).not.toHaveBeenCalled();
	});

	it('reports the FR-3 message when the parent disappears between the pre-check and sign-up', async () => {
		approvedParentExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
		createUser.mockResolvedValue({ data: { user: null }, error: { message: 'Database error' } });
		const { e, cookies } = registerEvent();

		expect(await actions.register(e)).toMatchObject({
			status: 400,
			data: { error: m.join_error_no_parent() }
		});
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('reports the generic error with status 500 and creates nothing when the parent lookup fails', async () => {
		approvedParentExists.mockRejectedValue(new Error('lookup down'));
		const { e, cookies } = registerEvent();

		expect(await actions.register(e)).toMatchObject({
			status: 500,
			data: { error: m.join_error_generic() }
		});
		expect(createUser).not.toHaveBeenCalled();
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('reports the generic error when createUser fails but the parent and the pair are still fine', async () => {
		approvedParentExists.mockResolvedValue(true);
		createUser.mockResolvedValue({ data: { user: null }, error: { message: 'Database error' } });
		const { e, cookies } = registerEvent(true);

		expect(await actions.register(e)).toMatchObject({
			status: 400,
			data: { error: m.join_error_generic() }
		});
		expect(approvedParentExists).toHaveBeenCalledTimes(2);
		expect(cookies.set).not.toHaveBeenCalled();
	});
});
