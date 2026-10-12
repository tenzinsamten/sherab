import { beforeEach, describe, expect, it, vi } from 'vitest';

const createUser = vi.fn();
const approvedParentExists = vi.fn();
const studentRegistrationState = vi.fn();
vi.mock('$lib/supabase/admin', () => ({
	createSupabaseAdminClient: () => ({ auth: { admin: { createUser } } })
}));
vi.mock('$lib/server/parent-registration', () => ({
	approvedParentExists: (...args: unknown[]) => approvedParentExists(...args),
	studentRegistrationState: (...args: unknown[]) => studentRegistrationState(...args)
}));

const { actions } = await import('./+page.server');
const m = await import('$lib/paraglide/messages.js');

const NO_PARENT =
	'No parent account found. Check the email is correct, or ask your parent to register first.';

function registerEvent() {
	const body = new FormData();
	body.set('classId', 'c1');
	body.set('className', 'Class A');
	body.set('classCode', 'ABC123');
	body.set('registrationName', 'Tenzin Dolma');
	body.set('guardianEmail', '  Pema@Example.com ');
	body.set('guardianConsent', 'on');
	const cookies = { set: vi.fn() };
	const e = {
		request: new Request('https://app.test/join', { method: 'POST', body }),
		cookies,
		locals: {}
	} as unknown as Parameters<typeof actions.register>[0];
	return { e, cookies };
}

describe('join register (Story 7-2)', () => {
	beforeEach(() => {
		createUser.mockReset();
		createUser.mockResolvedValue({ data: { user: { id: 's1' } }, error: null });
		approvedParentExists.mockReset();
		studentRegistrationState.mockReset();
		studentRegistrationState.mockResolvedValue('available');
	});

	it('shows the exact FR-3 message and creates nothing when no approved parent is found', async () => {
		approvedParentExists.mockResolvedValue(false);
		const { e, cookies } = registerEvent();

		const result = await actions.register(e);

		expect(m.join_error_no_parent()).toBe(NO_PARENT);
		expect(result).toMatchObject({ status: 400, data: { error: m.join_error_no_parent() } });
		expect(approvedParentExists).toHaveBeenCalledWith(expect.anything(), 'Pema@Example.com');
		// #98: the rule is per parent, so without a parent the state is not read.
		expect(studentRegistrationState).not.toHaveBeenCalled();
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

	it('#98: looks up the parent first, then the state for that parent email and name', async () => {
		approvedParentExists.mockResolvedValue(true);
		const { e } = registerEvent();

		await expect(actions.register(e)).rejects.toMatchObject({ status: 303 });

		expect(studentRegistrationState).toHaveBeenCalledTimes(1);
		expect(studentRegistrationState).toHaveBeenCalledWith(
			expect.anything(),
			'Pema@Example.com',
			'Tenzin Dolma'
		);
		expect(approvedParentExists.mock.invocationCallOrder[0]).toBeLessThan(
			studentRegistrationState.mock.invocationCallOrder[0]
		);
		expect(studentRegistrationState.mock.invocationCallOrder[0]).toBeLessThan(
			createUser.mock.invocationCallOrder[0]
		);
	});

	it('#98: sends the family to "Join another class" when the parent already has an approved student with this name', async () => {
		approvedParentExists.mockResolvedValue(true);
		studentRegistrationState.mockResolvedValue('approved');
		const { e, cookies } = registerEvent();

		expect(m.join_error_already_student()).toContain('Join another class');
		expect(m.join_error_already_student()).not.toBe(m.join_error_duplicate());
		expect(await actions.register(e)).toMatchObject({
			status: 400,
			data: { error: m.join_error_already_student(), guardianEmail: 'Pema@Example.com' }
		});
		expect(createUser).not.toHaveBeenCalled();
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it.each(['pending', 'rejected'] as const)(
		'#98: refuses with the duplicate message when the parent already has a %s student with this name',
		async (state) => {
			approvedParentExists.mockResolvedValue(true);
			studentRegistrationState.mockResolvedValue(state);
			const { e, cookies } = registerEvent();

			expect(await actions.register(e)).toMatchObject({
				status: 400,
				data: { error: m.join_error_duplicate(), guardianEmail: 'Pema@Example.com' }
			});
			expect(createUser).not.toHaveBeenCalled();
			expect(cookies.set).not.toHaveBeenCalled();
		}
	);

	it('#98: reports the generic error with status 500 and creates nothing when the state lookup fails', async () => {
		approvedParentExists.mockResolvedValue(true);
		studentRegistrationState.mockRejectedValue(new Error('lookup down'));
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { e, cookies } = registerEvent();

		expect(await actions.register(e)).toMatchObject({
			status: 500,
			data: { error: m.join_error_generic(), guardianEmail: 'Pema@Example.com' }
		});
		// The parent lookup ran first; the failure is the state lookup's.
		expect(approvedParentExists).toHaveBeenCalledTimes(1);
		expect(approvedParentExists.mock.invocationCallOrder[0]).toBeLessThan(
			studentRegistrationState.mock.invocationCallOrder[0]
		);
		expect(logged).toHaveBeenCalled();
		expect(createUser).not.toHaveBeenCalled();
		expect(cookies.set).not.toHaveBeenCalled();
		logged.mockRestore();
	});

	it.each([
		['pending', () => m.join_error_duplicate()],
		['rejected', () => m.join_error_duplicate()],
		['approved', () => m.join_error_already_student()]
	] as const)(
		'#98 race: createUser fails and the re-read state is %s, so the matching duplicate message is shown',
		async (stateNow, message) => {
			approvedParentExists.mockResolvedValue(true);
			studentRegistrationState.mockResolvedValueOnce('available').mockResolvedValueOnce(stateNow);
			createUser.mockResolvedValue({ data: { user: null }, error: { message: 'Database error' } });
			const { e, cookies } = registerEvent();

			expect(await actions.register(e)).toMatchObject({
				status: 400,
				data: { error: message() }
			});
			expect(createUser).toHaveBeenCalledTimes(1);
			expect(studentRegistrationState).toHaveBeenCalledTimes(2);
			// The duplicate answer comes before the parent re-check.
			expect(approvedParentExists).toHaveBeenCalledTimes(1);
			expect(cookies.set).not.toHaveBeenCalled();
		}
	);

	it('#98 race: when the state re-read fails after a failed createUser, the generic error is shown in the form', async () => {
		approvedParentExists.mockResolvedValue(true);
		studentRegistrationState
			.mockResolvedValueOnce('available')
			.mockRejectedValueOnce(new Error('lookup down'));
		createUser.mockResolvedValue({ data: { user: null }, error: { message: 'Database error' } });
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { e, cookies } = registerEvent();

		expect(await actions.register(e)).toMatchObject({
			status: 400,
			data: { error: m.join_error_generic(), guardianEmail: 'Pema@Example.com' }
		});
		expect(studentRegistrationState).toHaveBeenCalledTimes(2);
		expect(logged).toHaveBeenCalled();
		expect(cookies.set).not.toHaveBeenCalled();
		logged.mockRestore();
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
		const { e, cookies } = registerEvent();

		expect(await actions.register(e)).toMatchObject({
			status: 400,
			data: { error: m.join_error_generic() }
		});
		expect(studentRegistrationState).toHaveBeenCalledTimes(2);
		expect(approvedParentExists).toHaveBeenCalledTimes(2);
		expect(cookies.set).not.toHaveBeenCalled();
	});
});
