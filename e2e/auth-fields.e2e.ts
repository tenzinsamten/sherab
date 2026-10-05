import { expect, test, type Page } from '@playwright/test';
import { createCalendarFixture, service, signIn, type CalendarFixture } from './fixtures';

/**
 * iX fields on /join and /account (#66 B7b). Credential fields stay native
 * (see signIn); these cover the converted ones: typing reaches the Svelte
 * state behind them, and /account's display name still saves.
 */

test.describe.configure({ mode: 'serial' });

let fx: CalendarFixture;

test.beforeAll(async () => {
	fx = await createCalendarFixture();
});

test.afterAll(async () => {
	await fx?.cleanup();
});

/** Types into an <ix-input>'s native control (its shadow DOM <input>). */
async function typeInto(page: Page, id: string, text: string) {
	await page.locator(`#${id} input`).first().fill(text);
}

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

async function waitForIx(page: Page) {
	await page.waitForFunction(() => customElements.get('ix-input') !== undefined);
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
	await waitForIx(page);

	// Step 1: typed lowercase, held (and checked) as uppercase.
	await typeInto(page, 'classCode', cls.code.toLowerCase());
	await expect(page.locator('#classCode')).toHaveJSProperty('value', cls.code);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.getByText(`${fx.classA.name} · ${cls.code}`)).toBeVisible();

	// Step 2: Continue stays disabled until a name is typed.
	const next = page.getByRole('button', { name: 'Continue' });
	await expect(next).toBeDisabled();
	await typeInto(page, 'registrationName', `E2E Join ${fx.tag}`);
	await expect(next).toBeEnabled();
	await next.click();

	// Step 3: the name travels in the hidden field; Submit needs email + consent.
	await expect(page.locator('input[type="hidden"][name="registrationName"]')).toHaveValue(
		`E2E Join ${fx.tag}`
	);
	const submit = page.getByRole('button', { name: 'Submit' });
	await typeInto(page, 'guardianEmail', `e2e-join-${fx.tag}@example.test`);
	await expect(submit).toBeDisabled();
	await page.getByRole('checkbox').click();
	await expect(submit).toBeEnabled();

	// The form-associated <ix-input> posts guardianEmail with the rest.
	const body = await capturePost(page, 'register');
	await submit.click();
	const sent = await body();
	expect(posted(sent, 'guardianEmail', `e2e-join-${fx.tag}@example.test`)).toBe(true);
	expect(posted(sent, 'registrationName', `E2E Join ${fx.tag}`)).toBe(true);
});

/** The workflow step (1-based) whose inner element iX marks as current. */
async function currentStep(page: Page): Promise<number> {
	return page
		.locator('ix-workflow-step')
		.evaluateAll((steps) =>
			steps.findIndex((s) => s.shadowRoot?.querySelector('[aria-current="step"]'))
		)
		.then((i) => {
			// -1: iX's markup changed; fail loudly rather than report "step 0".
			if (i < 0) throw new Error('no ix-workflow-step is marked aria-current="step"');
			return i + 1;
		});
}

test('join: workflow steps follow the flow, and a finished step goes back keeping values', async ({
	page
}) => {
	const { data: cls, error } = await service
		.from('classes')
		.select('code')
		.eq('id', fx.classA.id)
		.single();
	if (error || !cls?.code) throw new Error(`read class code: ${error?.message}`);

	await page.goto('/join');
	await waitForIx(page);
	const steps = page.locator('ix-workflow-step');
	// The steps' own (light DOM) labels; their shadow DOM adds icon names.
	expect(await steps.evaluateAll((els) => els.map((el) => el.textContent?.trim()))).toEqual([
		'Class code',
		'Your name',
		'Parent consent',
		'Waiting for approval'
	]);
	await expect.poll(() => currentStep(page)).toBe(1);
	await expect(page.getByText('Step 1 of 4: Class code')).toBeAttached();
	// Vertical, so the steps fit the card: no sideways scrolling on a phone.
	await expect(page.locator('ix-workflow-steps')).toHaveJSProperty('vertical', true);

	// A later step is disabled and can't be picked.
	await expect(steps.nth(1)).toHaveJSProperty('disabled', true);
	await expect(steps.nth(2)).toHaveJSProperty('disabled', true);
	await steps.nth(2).click({ force: true });
	await expect.poll(() => currentStep(page)).toBe(1);
	await expect(page.locator('#classCode')).toBeVisible();

	await typeInto(page, 'classCode', cls.code);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect.poll(() => currentStep(page)).toBe(2);
	await typeInto(page, 'registrationName', `E2E Steps ${fx.tag}`);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect.poll(() => currentStep(page)).toBe(3);
	await expect(page.getByText('Step 3 of 4: Parent consent')).toBeAttached();
	const email = `e2e-steps-${fx.tag}@example.test`;
	await typeInto(page, 'guardianEmail', email);
	await page.getByRole('checkbox').click();

	// Back to step 1 by clicking it: focus moves to the code field, which
	// still holds the typed code.
	await steps.nth(0).click();
	await expect.poll(() => currentStep(page)).toBe(1);
	await expect(page.locator('#classCode input').first()).toBeFocused();
	await expect(page.locator('#classCode')).toHaveJSProperty('value', cls.code);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect.poll(() => currentStep(page)).toBe(2);
	await expect(page.locator('#registrationName')).toHaveJSProperty('value', `E2E Steps ${fx.tag}`);

	// Continue to step 3 again: email and consent are still filled in.
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect.poll(() => currentStep(page)).toBe(3);
	await expect(page.locator('#guardianEmail')).toHaveJSProperty('value', email);
	await expect(page.getByRole('checkbox')).toBeChecked();
	await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();

	// The Back button still moves the steps too.
	await page.getByRole('button', { name: 'Back' }).click();
	await expect.poll(() => currentStep(page)).toBe(2);
});

test('join: on a phone-sized screen the steps fit without sideways scrolling', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await page.goto('/join');
	await waitForIx(page);
	await expect(page.locator('ix-workflow-step')).toHaveCount(4);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});

test('join pending: the first three steps are done and "Waiting for approval" is current', async ({
	page
}) => {
	await page.goto('/join/pending');
	await waitForIx(page);
	await expect(page.locator('ix-workflow-step')).toHaveCount(4);
	await expect.poll(() => currentStep(page)).toBe(4);
	await expect(page.getByText('Step 4 of 4: Waiting for approval')).toBeAttached();
	for (const i of [0, 1, 2]) {
		await expect(page.locator('ix-workflow-step').nth(i)).toHaveAttribute('status', 'success');
	}
});

test('join: an unknown class code marks the field invalid and stays on step 1', async ({
	page
}) => {
	await page.goto('/join');
	await waitForIx(page);
	await typeInto(page, 'classCode', 'ZZZZZZZZ');
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page.locator('#classCode')).toHaveClass(/\bix-invalid\b/);
	const error = page.locator('#classCode-error');
	await expect(error).toHaveText('No class has that code. Check it with your teacher.');
	await expect(error).toHaveAttribute('role', 'alert');
	const native = page.locator('#classCode input').first();
	await expect(native).toHaveAttribute('aria-invalid', 'true');
	// Linked across the shadow root, which toHaveAccessibleDescription doesn't follow.
	await expect
		.poll(() =>
			native.evaluate((el) =>
				(el.ariaDescribedByElements ?? []).map((d) => d.textContent?.trim()).join(' ')
			)
		)
		.toBe('No class has that code. Check it with your teacher.');
	await expect(page.locator('#registrationName')).toHaveCount(0);
	// Typing again clears the invalid state.
	await typeInto(page, 'classCode', 'ZZZZZZZY');
	await expect(page.locator('#classCode')).not.toHaveClass(/\bix-invalid\b/);
	await expect(error).toHaveCount(0);
});

test('register: the iX display name is posted with the native email and passwords', async ({
	page
}) => {
	await page.goto('/register');
	await waitForIx(page);
	const name = `E2E Register ${fx.tag}`;
	await typeInto(page, 'displayName', name);
	await page.locator('#email').fill(`e2e-register-${fx.tag}@example.test`);
	await page.locator('#password').fill('secret-123');
	await page.locator('#confirm').fill('secret-123');
	const body = await capturePost(page, 'register');
	await page.getByRole('button', { name: 'Create account' }).click();
	expect(posted(await body(), 'displayName', name)).toBe(true);
});

test('register: each password field has its own show/hide button (#82)', async ({ page }) => {
	await page.goto('/register');
	await waitForIx(page);
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
	const hide = page.getByRole('button', { name: 'Hide password' });
	await expect(hide).toHaveCount(1);
	await expect(hide).toHaveAttribute('aria-pressed', 'true');
	// The field keeps what the form action reads.
	await expect(password).toHaveAttribute('name', 'password');
	await expect(password).toHaveAttribute('autocomplete', 'new-password');
	await expect(password).toHaveAttribute('required', '');

	await hide.click();
	await expect(password).toHaveAttribute('type', 'password');
	await expect(show).toHaveCount(2);
});

test('account: the display name shows the saved one and saves a new one', async ({ page }) => {
	await signIn(page, fx.teacher);
	await page.goto('/account');
	await waitForIx(page);

	const { data: before } = await service
		.from('profiles')
		.select('display_name')
		.eq('id', fx.teacher.id)
		.single();
	await expect(page.locator('#displayName')).toHaveJSProperty('value', before?.display_name ?? '');
	await expect(page.locator('#email')).toHaveJSProperty('value', fx.teacher.email);

	const name = `E2E Renamed ${fx.tag}`;
	await typeInto(page, 'displayName', name);
	await page.getByRole('button', { name: 'Save name' }).click();
	await expect(page.locator('ix-toast').getByText('Name updated.')).toBeVisible();

	const { data: after } = await service
		.from('profiles')
		.select('display_name')
		.eq('id', fx.teacher.id)
		.single();
	expect(after?.display_name).toBe(name);
	await page.reload();
	await waitForIx(page);
	await expect(page.locator('#displayName')).toHaveJSProperty('value', name);
});

test('login: the Sherab logo shows above the card title', async ({ page }) => {
	await page.goto('/login');
	const logo = page.locator('.auth-card-header img');
	await expect(logo).toBeVisible();
	await expect(logo).toHaveAttribute('alt', 'Sherab – ཤེས་རབ་');
	await expect(logo).toHaveAttribute('src', /sherab-logo-blue/);
});

test('signed-out header: the Sherab logo is the home link and the name text is hidden', async ({
	page
}) => {
	await page.goto('/login');
	const header = page.locator('ix-application-header');
	const logoLink = header.locator('a.header-logo');
	await expect(logoLink.getByRole('img', { name: 'Sherab – ཤེས་རབ་' })).toBeVisible();
	// Computed display of the name in iX's shadow root (a locator's
	// toBeHidden also passes when it matches nothing).
	await expect
		.poll(() =>
			header.evaluate((el) => {
				const n = el.shadowRoot?.querySelector('.left-side .name');
				return n ? getComputedStyle(n).display : 'missing';
			})
		)
		.toBe('none');
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

test('help: a signed-in teacher opens it from the foot of the menu, on the teachers’ guide (#87)', async ({
	page
}) => {
	await signIn(page, fx.teacher);
	await page.goto('/teacher');
	await page.waitForFunction(() => customElements.get('ix-menu-about') !== undefined);
	const step = page.getByRole('heading', { name: 'Approve new students' });
	await expect(step).toBeHidden();

	// iX's "About and legal" button, labelled Help.
	await page.locator('ix-menu #aboutAndLegal').click();
	await expect(page.locator('ix-menu-about').getByRole('heading', { name: 'Help' })).toBeVisible();
	await expect(step).toBeVisible();
	// The other guides and the FAQs are tabs of the same overlay.
	await page.locator('ix-menu-about').getByRole('tab', { name: 'For parents' }).click();
	await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
	await expect(step).toBeHidden();
	await page.locator('ix-menu-about').getByRole('tab', { name: 'Common questions' }).click();
	await expect(page.getByText('I did not get the confirmation email.')).toBeVisible();

	await page.locator('ix-menu-about').getByRole('button', { name: 'Close help' }).click();
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
		await waitForIx(page);
		await typeInto(page, 'displayName', 'E2E89 Parent');
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
		await phone.waitForFunction(() => customElements.get('ix-button') !== undefined);
		await phone.getByRole('button', { name: 'Confirm my email' }).click();
		await expect(phone).toHaveURL(/\/parent$/);

		// Used now: a second press says so in the card and offers a new link.
		await scanner.waitForFunction(() => customElements.get('ix-button') !== undefined);
		await scanner.getByRole('button', { name: 'Confirm my email' }).click();
		await expect(scanner).toHaveURL(/\/login\?error=confirm$/);
		await expect(scanner.getByRole('alert')).toContainText('invalid or has expired');
		await expect(scanner.getByRole('link', { name: 'Send a new confirmation link' })).toBeVisible();

		// The same for a reset-password mail.
		const reset = await (await browser.newContext()).newPage();
		await reset.goto('/forgot-password');
		await reset.waitForFunction(() => customElements.get('ix-button') !== undefined);
		await reset.waitForLoadState('networkidle');
		await reset.locator('#email').fill(email);
		await reset.getByRole('button', { name: 'Send reset link' }).click();
		const recoveryToken = await mailToken(email, 'recovery');
		const other = await (await browser.newContext()).newPage();
		await other.goto(`/auth/confirm?token_hash=${recoveryToken}&type=recovery`);
		await other.waitForFunction(() => customElements.get('ix-button') !== undefined);
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
	await waitForIx(page);
	await page.locator('#email').fill(`nobody-${fx.tag}@example.test`);
	await page.getByRole('button', { name: 'Send link' }).click();
	await expect(page.getByRole('status')).toContainText(
		'If this email is waiting for confirmation, a new link is on its way.'
	);
});
