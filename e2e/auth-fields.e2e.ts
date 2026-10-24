import { expect, test, type Page } from '@playwright/test';
import { createCalendarFixture, openHelp, service, signIn, type CalendarFixture } from './fixtures';

/**
 * The native fields of /join (#66 B7b; mobile-first story 6b), /register
 * and /account (stories 5 and 6), the signed-out header, and the
 * email-link pages (#89).
 */

test.describe.configure({ mode: 'serial' });

let fx: CalendarFixture;

test.beforeAll(async () => {
	fx = await createCalendarFixture();
});

test.afterAll(async () => {
	await fx?.cleanup();
});

/**
 * Captures the next POST to `action` and aborts it, so a form's posted
 * fields can be checked without creating an account.
 */
async function capturePost(page: Page, action: string): Promise<() => Promise<string>> {
	let body: string | null = null;
	await page.route(`**/*?/${action}`, async (route) => {
		body = route.request().postData() ?? '';
		await route.abort();
	});
	return async () => {
		await expect.poll(() => body !== null).toBe(true);
		return body ?? '';
	};
}

/** Whether a multipart/urlencoded body carries `name` = `value`. */
function posted(body: string, name: string, value: string): boolean {
	return (
		new URLSearchParams(body).get(name) === value ||
		new RegExp(
			`name="${name}"\\r\\n\\r\\n${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r\\n`
		).test(body)
	);
}

/** An auth page (mobile-first story 6): its new-UI root is hydrated. */
async function authReady(page: Page) {
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

test('join: class code is uppercased, name and guardian email unlock the next steps', async ({
	page
}) => {
	const { data: cls, error } = await service
		.from('classes')
		.select('code')
		.eq('id', fx.classA.id)
		.single();
	if (error || !cls?.code) throw new Error(`read class code: ${error?.message}`);

	await page.goto('/join');
	await authReady(page);

	// Step 1: typed lowercase, shown (and checked) as uppercase.
	const code = page.getByLabel('What is your class code?');
	await code.pressSequentially(cls.code.toLowerCase());
	await expect(code).toHaveValue(cls.code);
	// The visible fields post nothing: the hidden fields of step 3 do.
	await expect(code).not.toHaveAttribute('name');
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.getByText(`${fx.classA.name} · ${cls.code}`)).toBeVisible();

	// Step 2: Continue stays disabled until a name is typed.
	const next = page.getByRole('button', { name: 'Continue' });
	await expect(next).toBeDisabled();
	await page.getByLabel('Full name').fill(`E2E Join ${fx.tag}`);
	await expect(page.getByLabel('Full name')).not.toHaveAttribute('name');
	await expect(next).toBeEnabled();
	await next.click();

	// Step 3: the name travels in the hidden field; Submit needs email + consent.
	await expect(page.locator('input[type="hidden"][name="registrationName"]')).toHaveValue(
		`E2E Join ${fx.tag}`
	);
	const submit = page.getByRole('button', { name: 'Submit' });
	await page.getByLabel("Guardian's email").fill(`e2e-join-${fx.tag}@example.test`);
	await expect(submit).toBeDisabled();
	await page.getByRole('checkbox').check();
	await expect(submit).toBeEnabled();

	const body = await capturePost(page, 'register');
	await submit.click();
	const sent = await body();
	expect(posted(sent, 'guardianEmail', `e2e-join-${fx.tag}@example.test`)).toBe(true);
	expect(posted(sent, 'guardianConsent', 'on')).toBe(true);
	expect(posted(sent, 'registrationName', `E2E Join ${fx.tag}`)).toBe(true);
	expect(posted(sent, 'classId', fx.classA.id)).toBe(true);
	expect(posted(sent, 'classCode', cls.code)).toBe(true);
});

/** The stepper's steps (mobile-first story 6b: an ordered list). */
const joinSteps = (page: Page) => page.getByTestId('join-steps').getByRole('listitem');

/** The step (1-based) marked `aria-current="step"`; exactly one must be. */
async function currentStep(page: Page): Promise<number> {
	const marked = await joinSteps(page).evaluateAll((steps) =>
		steps.flatMap((s, i) => (s.getAttribute('aria-current') === 'step' ? [i + 1] : []))
	);
	if (marked.length !== 1) throw new Error(`steps marked current: ${JSON.stringify(marked)}`);
	return marked[0];
}

test('join: the steps follow the flow, and a finished step goes back keeping values', async ({
	page
}) => {
	const { data: cls, error } = await service
		.from('classes')
		.select('code')
		.eq('id', fx.classA.id)
		.single();
	if (error || !cls?.code) throw new Error(`read class code: ${error?.message}`);

	await page.goto('/join');
	await authReady(page);
	const steps = joinSteps(page);
	// Numbered, in order (the number is a decoration hidden from screen readers).
	await expect(steps).toHaveText([
		/^1\s*Class code$/,
		/^2\s*Your name$/,
		/^3\s*Parent consent$/,
		/^4\s*Waiting for approval$/
	]);
	await expect.poll(() => currentStep(page)).toBe(1);
	await expect(page.getByText('Step 1 of 4: Class code')).toBeAttached();

	// No step is a button yet: the current and later steps can't be picked.
	await expect(page.getByTestId('join-steps').getByRole('button')).toHaveCount(0);

	await page.getByLabel('What is your class code?').fill(cls.code);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect.poll(() => currentStep(page)).toBe(2);
	await expect(page.getByText('Step 2 of 4: Your name')).toBeAttached();
	// Step 1 is done: a check mark and "done" for screen readers, not only colour.
	await expect(steps.nth(0)).toHaveAttribute('data-state', 'done');
	await expect(steps.nth(0).getByRole('button')).toHaveAccessibleName('Class code, done');
	await expect(steps.nth(0).locator('svg')).toBeVisible();
	await page.getByLabel('Full name').fill(`E2E Steps ${fx.tag}`);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect.poll(() => currentStep(page)).toBe(3);
	await expect(page.getByText('Step 3 of 4: Parent consent')).toBeAttached();
	await expect(page.getByTestId('join-steps').getByRole('button')).toHaveCount(2);
	const email = `e2e-steps-${fx.tag}@example.test`;
	await page.getByLabel("Guardian's email").fill(email);
	await page.getByRole('checkbox').check();

	// Back to step 1 by picking it: focus moves to the code field, which
	// still holds the typed code.
	await page.getByRole('button', { name: 'Class code, done' }).click();
	await expect.poll(() => currentStep(page)).toBe(1);
	const code = page.getByLabel('What is your class code?');
	await expect(code).toBeFocused();
	await expect(code).toHaveValue(cls.code);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect.poll(() => currentStep(page)).toBe(2);
	await expect(page.getByLabel('Full name')).toHaveValue(`E2E Steps ${fx.tag}`);

	// Continue to step 3 again: email and consent are still filled in.
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect.poll(() => currentStep(page)).toBe(3);
	await expect(page.getByLabel("Guardian's email")).toHaveValue(email);
	await expect(page.getByRole('checkbox')).toBeChecked();
	await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();

	// Picking step 2 focuses the name field.
	await page.getByRole('button', { name: 'Your name, done' }).click();
	await expect.poll(() => currentStep(page)).toBe(2);
	await expect(page.getByLabel('Full name')).toBeFocused();

	// The Back button still moves the steps too.
	await page.getByRole('button', { name: 'Back' }).click();
	await expect.poll(() => currentStep(page)).toBe(1);
});

test('join pending: the first three steps are done and "Waiting for approval" is current', async ({
	page
}) => {
	await page.goto('/join/pending');
	await authReady(page);
	await expect(joinSteps(page)).toHaveCount(4);
	await expect.poll(() => currentStep(page)).toBe(4);
	await expect(page.getByText('Step 4 of 4: Waiting for approval')).toBeAttached();
	for (const i of [0, 1, 2]) {
		await expect(joinSteps(page).nth(i)).toHaveAttribute('data-state', 'done');
	}
	// A done row that is no button is still read as "<label>, done": the
	// visible label is hidden from screen readers, the one message is not.
	const first = joinSteps(page).nth(0);
	await expect(first.locator('[data-step-sr]')).toHaveText('Class code, done');
	await expect(first.locator('[data-step-label] > [aria-hidden="true"]')).toHaveText('Class code');
	// Nothing to go back to from here.
	await expect(page.getByTestId('join-steps').getByRole('button')).toHaveCount(0);
});

test('join: an unknown class code marks the field invalid and stays on step 1', async ({
	page
}) => {
	await page.goto('/join');
	await authReady(page);
	const code = page.getByLabel('What is your class code?');
	await code.fill('ZZZZZZZZ');
	await page.getByRole('button', { name: 'Continue' }).click();
	const error = page.locator('#classCode-error');
	await expect(error).toHaveText('No class has that code. Check it with your teacher.');
	await expect(error).toHaveAttribute('role', 'alert');
	await expect(code).toHaveAttribute('aria-invalid', 'true');
	await expect(code).toHaveAccessibleDescription(
		'No class has that code. Check it with your teacher.'
	);
	await expect(
		page
			.locator('[data-sonner-toast]')
			.getByText('No class has that code. Check it with your teacher.')
	).toBeVisible();
	await expect(page.locator('#registrationName')).toHaveCount(0);
	// Typing again clears the invalid state.
	await code.fill('ZZZZZZZY');
	await expect(code).not.toHaveAttribute('aria-invalid');
	await expect(error).toHaveCount(0);
});

test('join: an empty class code says so under the field', async ({ page }) => {
	await page.goto('/join');
	await authReady(page);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.locator('#classCode-error')).toHaveText('Enter your class code.');
	await expect(page.getByLabel('What is your class code?')).toHaveAttribute('aria-invalid', 'true');
	await expect(page.locator('#registrationName')).toHaveCount(0);
});

test('register: the display name is posted with the email and passwords', async ({ page }) => {
	await page.goto('/register');
	await authReady(page);
	const name = `E2E Register ${fx.tag}`;
	await page.locator('#displayName').fill(name);
	await page.locator('#email').fill(`e2e-register-${fx.tag}@example.test`);
	await page.locator('#password').fill('secret-123');
	await page.locator('#confirm').fill('secret-123');
	const body = await capturePost(page, 'register');
	await page.getByRole('button', { name: 'Create account' }).click();
	expect(posted(await body(), 'displayName', name)).toBe(true);
});

test('register: each password field has its own show/hide button (#82)', async ({ page }) => {
	await page.goto('/register');
	await authReady(page);
	const password = page.locator('#password');
	const confirm = page.locator('#confirm');
	await password.fill('secret-123');
	await confirm.fill('secret-456');
	await expect(password).toHaveAttribute('type', 'password');
	await expect(confirm).toHaveAttribute('type', 'password');

	const show = page.getByRole('button', { name: 'Show password' });
	await expect(show).toHaveCount(2);
	await expect(show.first()).toHaveAttribute('type', 'button');
	await expect(show.first()).toHaveAttribute('aria-pressed', 'false');
	// The button sits inside the field, at its end.
	const fieldBox = (await password.boundingBox())!;
	const buttonBox = (await show.first().boundingBox())!;
	expect(buttonBox.x).toBeGreaterThan(fieldBox.x + fieldBox.width / 2);
	expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(fieldBox.x + fieldBox.width);
	expect(buttonBox.y).toBeGreaterThanOrEqual(fieldBox.y);
	expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(fieldBox.y + fieldBox.height);

	// The first toggle shows only the first field, and does not submit the form.
	await show.first().focus();
	await page.keyboard.press('Enter');
	await expect(password).toHaveAttribute('type', 'text');
	await expect(password).toHaveValue('secret-123');
	await expect(confirm).toHaveAttribute('type', 'password');
	await expect(page).toHaveURL(/\/register$/);
	// #129: the name stays "Show password"; only aria-pressed says it is shown.
	await expect(page.getByRole('button', { name: 'Hide password' })).toHaveCount(0);
	await expect(show).toHaveCount(2);
	await expect(show.first()).toHaveAttribute('aria-pressed', 'true');
	// No title: "Show password" would contradict the eye-off icon.
	await expect(show.first()).not.toHaveAttribute('title');
	await expect(show.nth(1)).toHaveAttribute('aria-pressed', 'false');
	// The field keeps what the form action reads.
	await expect(password).toHaveAttribute('name', 'password');
	await expect(password).toHaveAttribute('autocomplete', 'new-password');
	await expect(password).toHaveAttribute('required', '');

	await show.first().click();
	await expect(password).toHaveAttribute('type', 'password');
	await expect(show).toHaveCount(2);
	await expect(show.first()).toHaveAttribute('aria-pressed', 'false');
});

test('account: the display name shows the saved one and saves a new one', async ({ page }) => {
	await signIn(page, fx.teacher);
	await page.goto('/account');
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');

	const { data: before } = await service
		.from('profiles')
		.select('display_name')
		.eq('id', fx.teacher.id)
		.single();
	// Native fields with visible labels (mobile-first story 5); the email is read-only.
	await expect(page.getByLabel('Display name')).toHaveValue(before?.display_name ?? '');
	await expect(page.getByLabel('Email')).toHaveValue(fx.teacher.email);
	await expect(page.getByLabel('Email')).toHaveAttribute('readonly', '');

	const name = `E2E Renamed ${fx.tag}`;
	await page.getByLabel('Display name').fill(name);
	await page.getByRole('button', { name: 'Save name' }).click();
	await expect(page.locator('[data-sonner-toast]').getByText('Name updated.')).toBeVisible();

	const { data: after } = await service
		.from('profiles')
		.select('display_name')
		.eq('id', fx.teacher.id)
		.single();
	expect(after?.display_name).toBe(name);
	await page.reload();
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await expect(page.getByLabel('Display name')).toHaveValue(name);
});

test('login: the Sherab logo shows above the card title', async ({ page }) => {
	await page.goto('/login');
	const logo = page.locator('main [data-auth-card] header img');
	await expect(logo).toBeVisible();
	await expect(logo).toHaveAttribute('alt', 'Sherab – ཤེས་རབ་');
	await expect(logo).toHaveAttribute('src', /sherab-logo-blue/);
});

test('signed-out header: the Sherab logo is the home link', async ({ page }) => {
	await page.goto('/login');
	await authReady(page);
	const header = page.getByTestId('public-header');
	const logoLink = header.getByTestId('header-home');
	await expect(logoLink.getByRole('img', { name: 'Sherab – ཤེས་རབ་' })).toBeVisible();
	await expect(header.getByTestId('language-menu')).toBeVisible();
	await logoLink.click();
	await expect(page).toHaveURL(/\/$/);
});

test('help: open signed out from the sign-in page, one guide per role and the FAQs (#87)', async ({
	page
}) => {
	await page.goto('/login');
	await page.getByRole('link', { name: 'Need help?' }).click();
	await expect(page).toHaveURL(/\/help$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible();

	// Signed out: the parents' guide first.
	const tabs = page.getByRole('navigation', { name: 'Guides' });
	await expect(tabs.getByRole('link', { name: 'For parents' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

	await tabs.getByRole('link', { name: 'For students' }).click();
	await expect(page).toHaveURL(/\/help\?role=student$/);
	await expect(page.getByRole('heading', { name: 'Join your class' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Create your account' })).toHaveCount(0);

	// An FAQ answer shows once its question is opened.
	const answer = page.getByText('Look in your spam folder. Then try to sign in');
	await expect(answer).toBeHidden();
	await page.getByText('I did not get the confirmation email.').click();
	await expect(answer).toBeVisible();
});

test('help: a signed-in teacher opens it from the nav, on the teachers’ guide (#87)', async ({
	page
}) => {
	await signIn(page, fx.teacher);
	await page.goto('/teacher');
	const step = page.getByRole('heading', { name: 'Approve new students' });
	await expect(step).toBeHidden();

	const help = await openHelp(page);
	await expect(help.getByRole('heading', { name: 'Help' })).toBeVisible();
	await expect(step).toBeVisible();
	// The other guides and the FAQs are tabs of the same sheet.
	await help.getByRole('tab', { name: 'For parents' }).click();
	await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
	await expect(step).toBeHidden();
	await help.getByRole('tab', { name: 'Common questions' }).click();
	await expect(page.getByText('I did not get the confirmation email.')).toBeVisible();

	await help.getByRole('button', { name: 'Close help' }).click();
	await expect(page.getByText('I did not get the confirmation email.')).toBeHidden();
	await expect(page).toHaveURL(/\/teacher$/);
});

/** The hashed token of the newest local mail of `type` to `to` (Mailpit, `supabase start`). */
async function mailToken(to: string, type: 'signup' | 'recovery'): Promise<string> {
	const mailpit = 'http://127.0.0.1:54324/api/v1';
	for (let attempt = 0; attempt < 40; attempt++) {
		const list = (await (
			await fetch(`${mailpit}/search?query=${encodeURIComponent(`to:${to}`)}`)
		).json()) as { messages?: { ID: string }[] };
		for (const message of list.messages ?? []) {
			const full = (await (await fetch(`${mailpit}/message/${message.ID}`)).json()) as {
				HTML?: string;
				Text?: string;
			};
			const link = ((full.HTML || full.Text || '').match(/href="([^"]+)"/) ?? [])[1];
			const url = link ? new URL(link.replace(/&amp;/g, '&')) : null;
			if (url?.searchParams.get('type') === type) return url.searchParams.get('token') ?? '';
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`no ${type} mail for ${to}`);
}

test('email links: opening one only shows a button; pressing it confirms, on any device (#89)', async ({
	page,
	browser
}) => {
	const email = `e2e-89-${fx.tag}@example.test`;
	const password = `pw-${crypto.randomUUID()}`;
	try {
		await page.goto('/register');
		await authReady(page);
		await page.locator('#displayName').fill('E2E89 Parent');
		await page.locator('#email').fill(email);
		await page.locator('#password').fill(password);
		await page.locator('#confirm').fill(password);
		await page.getByRole('button', { name: 'Create account' }).click();
		await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
		// The receipt offers a new link, with the email filled in.
		await page.getByRole('link', { name: 'Send a new confirmation link' }).click();
		await expect(page).toHaveURL(/\/resend-confirmation\?email=/);
		await expect(page.locator('#email')).toHaveValue(email);

		// "Another device": browsers that share no cookies with the one above.
		const token = await mailToken(email, 'signup');
		const link = `/auth/confirm?token_hash=${token}&type=email`;

		// A mail app fetching the link first must not use it up.
		const scanner = await (await browser.newContext()).newPage();
		await scanner.goto(link);
		await expect(scanner.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();

		const phone = await (await browser.newContext()).newPage();
		await phone.goto(link);
		await authReady(phone);
		await phone.getByRole('button', { name: 'Confirm my email' }).click();
		await expect(phone).toHaveURL(/\/parent$/);

		// Used now: a second press says so in the card and offers a new link.
		await authReady(scanner);
		await scanner.getByRole('button', { name: 'Confirm my email' }).click();
		await expect(scanner).toHaveURL(/\/login\?error=confirm$/);
		await expect(scanner.getByRole('alert')).toContainText('invalid or has expired');
		await expect(scanner.getByRole('link', { name: 'Send a new confirmation link' })).toBeVisible();

		// The same for a reset-password mail.
		const reset = await (await browser.newContext()).newPage();
		await reset.goto('/forgot-password');
		await authReady(reset);
		await reset.locator('#email').fill(email);
		await reset.getByRole('button', { name: 'Send reset link' }).click();
		const recoveryToken = await mailToken(email, 'recovery');
		const other = await (await browser.newContext()).newPage();
		await other.goto(`/auth/confirm?token_hash=${recoveryToken}&type=recovery`);
		await authReady(other);
		await expect(other.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
		await other.getByRole('button', { name: 'Continue' }).click();
		await expect(other).toHaveURL(/\/reset-password$/);
	} finally {
		const { data } = await service.from('profiles').select('id').eq('email', email);
		for (const row of data ?? []) await service.auth.admin.deleteUser(row.id);
	}
});

test('resend confirmation: the same answer for any address (#89)', async ({ page }) => {
	await page.goto('/resend-confirmation');
	await authReady(page);
	await page.locator('#email').fill(`nobody-${fx.tag}@example.test`);
	await page.getByRole('button', { name: 'Send link' }).click();
	await expect(page.getByRole('status')).toContainText(
		'If this email is waiting for confirmation, a new link is on its way.'
	);
});
