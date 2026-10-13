import { beforeEach, describe, expect, it, vi } from 'vitest';

const createUser = vi.fn();
const approvedParentExists = vi.fn();
const studentRegistrationState = vi.fn();
const takenStudentUsernames = vi.fn();
const deleteUser = vi.fn();
const updateAuthUserEmailAndPassword = vi.fn();
/** The profile email update: `{ data: { id } | null, error }`. */
const recordEmail = vi.fn();
const profileUpdates: unknown[] = [];
vi.mock('$lib/supabase/admin', () => ({
	createSupabaseAdminClient: () => ({
		auth: { admin: { createUser, deleteUser } },
		from: (table: string) => ({
			update: (values: unknown) => {
				profileUpdates.push({ table, values });
				const chain = {
					eq: (...args: unknown[]) => (profileUpdates.push(['eq', ...args]), chain),
					select: () => chain,
					maybeSingle: () => recordEmail()
				};
				return chain;
			}
		})
	}),
	updateAuthUserEmailAndPassword: (...args: unknown[]) => updateAuthUserEmailAndPassword(...args)
}));
vi.mock('$lib/server/student-credentials', async (original) => ({
	...(await original<typeof import('$lib/server/student-credentials')>()),
	takenStudentUsernames: (...args: unknown[]) => takenStudentUsernames(...args)
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
		takenStudentUsernames.mockReset();
		takenStudentUsernames.mockImplementation(async () => new Set<string>());
		deleteUser.mockReset();
		deleteUser.mockResolvedValue({ error: null });
		updateAuthUserEmailAndPassword.mockReset();
		updateAuthUserEmailAndPassword.mockResolvedValue({ error: null });
		recordEmail.mockReset();
		recordEmail.mockResolvedValue({ data: { id: 's1' }, error: null });
		profileUpdates.length = 0;
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

	const DUPLICATE = { error: { code: '23505', message: 'duplicate key value' } };
	const receipt = (cookies: { set: ReturnType<typeof vi.fn> }) =>
		JSON.parse(cookies.set.mock.calls[0][1]);

	it('creates a pre-confirmed student on a synthetic pending- address (the only one the database accepts)', async () => {
		approvedParentExists.mockResolvedValue(true);
		const { e } = registerEvent();

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
	});

	it('#100: gives the new account the username address and a 6-digit PIN, and puts both in the receipt', async () => {
		approvedParentExists.mockResolvedValue(true);
		const { e, cookies } = registerEvent();

		await expect(actions.register(e)).rejects.toMatchObject({ status: 303 });

		expect(updateAuthUserEmailAndPassword).toHaveBeenCalledTimes(1);
		const [id, minted] = updateAuthUserEmailAndPassword.mock.calls[0];
		expect(id).toBe('s1');
		expect(minted.email).toBe('tenzindolma@students.internal.invalid');
		expect(minted.password).toMatch(/^[0-9]{6}$/);
		expect(createUser.mock.invocationCallOrder[0]).toBeLessThan(
			updateAuthUserEmailAndPassword.mock.invocationCallOrder[0]
		);
		// The profile gets the address and nothing else -- never the PIN.
		expect(profileUpdates).toEqual([
			{ table: 'profiles', values: { email: 'tenzindolma@students.internal.invalid' } },
			['eq', 'id', 's1']
		]);

		expect(cookies.set).toHaveBeenCalledTimes(1);
		expect(receipt(cookies)).toEqual({
			name: 'Tenzin Dolma',
			className: 'Class A',
			classCode: 'ABC123',
			username: 'tenzindolma',
			pin: minted.password
		});
		expect(cookies.set.mock.calls[0][2]).toEqual({
			path: '/join/pending',
			maxAge: 600,
			httpOnly: true,
			sameSite: 'lax'
		});
	});

	it('#100: takes the next free username when the slug is in use', async () => {
		approvedParentExists.mockResolvedValue(true);
		takenStudentUsernames.mockResolvedValue(new Set(['tenzindolma', 'tenzindolma2']));
		const { e, cookies } = registerEvent();

		await expect(actions.register(e)).rejects.toMatchObject({ status: 303 });

		expect(updateAuthUserEmailAndPassword).toHaveBeenCalledTimes(1);
		expect(updateAuthUserEmailAndPassword.mock.calls[0][1].email).toBe(
			'tenzindolma3@students.internal.invalid'
		);
		expect(receipt(cookies).username).toBe('tenzindolma3');
	});

	it('#100: on a duplicate-address error it tries the next username with a new PIN', async () => {
		approvedParentExists.mockResolvedValue(true);
		updateAuthUserEmailAndPassword
			.mockResolvedValueOnce(DUPLICATE)
			.mockResolvedValueOnce({ error: null });
		const { e, cookies } = registerEvent();

		await expect(actions.register(e)).rejects.toMatchObject({ status: 303 });

		const calls = updateAuthUserEmailAndPassword.mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0][1].email).toBe('tenzindolma@students.internal.invalid');
		expect(calls[1][1].email).toBe('tenzindolma2@students.internal.invalid');
		expect(createUser).toHaveBeenCalledTimes(1);
		expect(deleteUser).not.toHaveBeenCalled();
		expect(receipt(cookies)).toMatchObject({ username: 'tenzindolma2', pin: calls[1][1].password });
	});

	it('#100: after 5 taken usernames it reports the generic error, removes the account and sets no cookie', async () => {
		approvedParentExists.mockResolvedValue(true);
		updateAuthUserEmailAndPassword.mockResolvedValue(DUPLICATE);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { e, cookies } = registerEvent();

		expect(await actions.register(e)).toMatchObject({
			status: 400,
			data: { error: m.join_error_generic(), guardianEmail: 'Pema@Example.com' }
		});
		const calls = updateAuthUserEmailAndPassword.mock.calls;
		expect(calls.map((c) => c[1].email.split('@')[0])).toEqual([
			'tenzindolma',
			'tenzindolma2',
			'tenzindolma3',
			'tenzindolma4',
			'tenzindolma5'
		]);
		expect(deleteUser).toHaveBeenCalledTimes(1);
		expect(deleteUser).toHaveBeenCalledWith('s1');
		expect(profileUpdates).toEqual([]);
		expect(cookies.set).not.toHaveBeenCalled();
		// The PIN is never logged.
		for (const c of calls) expect(JSON.stringify(logged.mock.calls)).not.toContain(c[1].password);
		logged.mockRestore();
	});

	it('#100: when the usernames run out and the account cannot be removed, the registration stands without credentials', async () => {
		approvedParentExists.mockResolvedValue(true);
		updateAuthUserEmailAndPassword.mockResolvedValue(DUPLICATE);
		deleteUser.mockResolvedValue({ error: { message: 'delete down' } });
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { e, cookies } = registerEvent();

		await expect(actions.register(e)).rejects.toMatchObject({
			status: 303,
			location: '/join/pending'
		});
		expect(deleteUser).toHaveBeenCalledTimes(1);
		expect(receipt(cookies)).toEqual({
			name: 'Tenzin Dolma',
			className: 'Class A',
			classCode: 'ABC123'
		});
		logged.mockRestore();
	});

	it.each([
		[
			'setting the username fails',
			() => updateAuthUserEmailAndPassword.mockResolvedValue({ error: { message: 'boom' } })
		],
		[
			'the profile address cannot be saved',
			() => recordEmail.mockResolvedValue({ data: null, error: { message: 'boom' } })
		],
		[
			'the profile row is not found',
			() => recordEmail.mockResolvedValue({ data: null, error: null })
		],
		['the username scan fails', () => takenStudentUsernames.mockRejectedValue(new Error('down'))]
	])(
		'#100: the registration still succeeds when %s -- the receipt has no credentials and the account stays',
		async (_label, arrange) => {
			approvedParentExists.mockResolvedValue(true);
			arrange();
			const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			const { e, cookies } = registerEvent();

			await expect(actions.register(e)).rejects.toMatchObject({
				status: 303,
				location: '/join/pending'
			});

			expect(deleteUser).not.toHaveBeenCalled();
			expect(receipt(cookies)).toEqual({
				name: 'Tenzin Dolma',
				className: 'Class A',
				classCode: 'ABC123'
			});
			expect(logged).toHaveBeenCalled();
			for (const c of updateAuthUserEmailAndPassword.mock.calls) {
				expect(JSON.stringify(logged.mock.calls)).not.toContain(c[1].password);
			}
			logged.mockRestore();
		}
	);

	it('#100: a failed createUser sets no credentials', async () => {
		approvedParentExists.mockResolvedValue(true);
		createUser.mockResolvedValue({ data: { user: null }, error: { message: 'Database error' } });
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { e } = registerEvent();

		expect(await actions.register(e)).toMatchObject({ status: 400 });
		expect(updateAuthUserEmailAndPassword).not.toHaveBeenCalled();
		expect(takenStudentUsernames).not.toHaveBeenCalled();
		logged.mockRestore();
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
