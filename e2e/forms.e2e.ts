import { expect, test, type Page } from '@playwright/test';
import { currentSchoolYear, selectableSchoolYears } from '../src/lib/school-year';
import { createCalendarFixture, service, signIn, type CalendarFixture } from './fixtures';

/**
 * Shared iX form components (#66 B7): the I/O matrix rows "Link rows" and
 * "Required select empty". Uses the calendar fixture's class C (admin-only,
 * no syllabus, the fixture student not enrolled) and its admin.
 */

test.describe.configure({ mode: 'serial' });

let fx: CalendarFixture;
// A second approved student in class A, so the enrol panel still has
// someone to offer after the fixture student is added to class C.
let otherStudentId: string | undefined;

test.beforeAll(async () => {
	fx = await createCalendarFixture();
	const { data, error } = await service.auth.admin.createUser({
		email: `e2e-66-student-${fx.tag}@students.internal.invalid`,
		password: crypto.randomUUID(),
		email_confirm: true,
		app_metadata: { role: 'student' }
	});
	if (error || !data.user) throw new Error(`create other student: ${error?.message}`);
	otherStudentId = data.user.id;
	const { error: approveError } = await service
		.from('profiles')
		.update({
			class_id: fx.classA.id,
			status: 'approved',
			registration_name: `E2E66 Other ${fx.tag}`,
			display_name: `E2E66 Other ${fx.tag}`
		})
		.eq('id', otherStudentId);
	if (approveError) throw new Error(`approve other student: ${approveError.message}`);
	const { data: enrolled } = await service
		.from('class_enrollments')
		.select('class_id')
		.eq('student_id', otherStudentId)
		.eq('class_id', fx.classA.id);
	if (!enrolled?.length) {
		const { error: enrollError } = await service
			.from('class_enrollments')
			.insert({ student_id: otherStudentId, class_id: fx.classA.id });
		if (enrollError) throw new Error(`enroll other student: ${enrollError.message}`);
	}
});

test.afterAll(async () => {
	// Before the fixture cleanup: a class with students cannot be deleted.
	if (otherStudentId) {
		const { error } = await service.auth.admin.deleteUser(otherStudentId);
		if (error) throw new Error(`delete other student: ${error.message}`);
	}
	await fx?.cleanup();
});

/** Waits for hydration and for the iX form components to be defined. */
async function openForm(page: Page, path: string) {
	await page.goto(path);
	await page.waitForFunction(() => customElements.get('ix-select') !== undefined);
	await page.waitForLoadState('networkidle');
}

test('link rows: a blank middle row is skipped, rows 1 and 3 save and reopen in order', async ({
	page
}) => {
	const posts: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes('?/update')) posts.push(r.postData() ?? '');
	});
	await signIn(page, fx.admin);
	await openForm(page, `/admin/classes/${fx.classC.id}/syllabus`);
	await page.getByRole('button', { name: 'Add syllabus' }).click();
	await page.waitForURL(/edit=1/);
	await page.waitForLoadState('networkidle');

	// The syllabus text is rich text in a chosen language (#75): Tibetan, a
	// bold first line, then a plain one.
	const editor = page.locator('.rte-input');
	await expect(editor).toHaveAttribute('contenteditable', 'true');
	const language = page.locator('ix-select[name="contentLanguage"]');
	await expect(language).toHaveJSProperty('value', 'en');
	await language.locator('input').first().click();
	await language.locator('ix-select-item[value="bo"]').click();
	await expect(language).toHaveJSProperty('value', 'bo');
	await editor.click();
	const bold = page.getByRole('button', { name: 'Bold', exact: true });
	await bold.click();
	await page.keyboard.type('སློབ་ཚན་དང་པོ།');
	await bold.click();
	await page.keyboard.press('Enter');
	await page.keyboard.type('Week 2: songs');
	await page.getByRole('button', { name: 'Add link' }).click();
	await page.getByRole('button', { name: 'Add link' }).click();
	// iX fields: typing goes into the native <input> in their shadow DOM.
	const urls = page.locator('ix-input[name="linkUrl"] input');
	const labels = page.locator('ix-input[name="linkLabel"] input');
	await expect(urls).toHaveCount(3);
	await urls.nth(0).fill('https://a.example');
	await labels.nth(0).fill('Alphabet');
	await urls.nth(2).fill('https://c.example');
	await labels.nth(2).fill('Songs');
	await page.getByRole('button', { name: 'Save syllabus' }).click();
	await expect(page.locator('ix-toast').getByText('Syllabus saved.')).toBeVisible();

	// Posted in row order, the blank row as empty strings.
	expect(posts).toHaveLength(1);
	const form = new URLSearchParams(posts[0]);
	expect(form.getAll('linkUrl')).toEqual(['https://a.example', '', 'https://c.example']);
	expect(form.getAll('linkLabel')).toEqual(['Alphabet', '', 'Songs']);

	// Stored without the blank row (parseReferenceLinks ignores an empty URL).
	// The add form preselects the current school year.
	const { data: saved } = await service
		.from('class_syllabi')
		.select('school_year, content_doc, content_language, links')
		.eq('class_id', fx.classC.id)
		.single();
	expect(saved).toEqual({
		school_year: currentSchoolYear(),
		content_doc: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'སློབ་ཚན་དང་པོ།', marks: [{ type: 'bold' }] }]
				},
				{ type: 'paragraph', content: [{ type: 'text', text: 'Week 2: songs' }] }
			]
		},
		content_language: 'bo',
		links: [
			{ url: 'https://a.example', label: 'Alphabet' },
			{ url: 'https://c.example', label: 'Songs' }
		]
	});

	// Saved: shown formatted, in the Tibetan font under the English interface.
	const shown = page.locator('.rich-text');
	await expect(shown).toHaveAttribute('lang', 'bo');
	await expect(shown).toHaveCSS('font-family', /Atisha/);
	await expect(shown.locator('p strong')).toHaveText('སློབ་ཚན་དང་པོ།');
	await expect(shown.locator('p').nth(1)).toHaveText('Week 2: songs');

	// Reopened: text, language and both links, in order.
	await openForm(page, page.url().replace(/\?.*$/, ''));
	await page.getByRole('button', { name: 'Edit syllabus' }).click();
	await expect(page.locator('.rte-input')).toHaveAttribute('contenteditable', 'true');
	await expect(page.locator('.rte-input p')).toHaveText(['སློབ་ཚན་དང་པོ།', 'Week 2: songs']);
	await expect(page.locator('ix-select[name="contentLanguage"]')).toHaveJSProperty('value', 'bo');
	await expect(page.locator('ix-input[name="linkUrl"]')).toHaveCount(2);
	await expect(page.locator('ix-input[name="linkUrl"]').nth(0)).toHaveJSProperty(
		'value',
		'https://a.example'
	);
	await expect(page.locator('ix-input[name="linkLabel"]').nth(0)).toHaveJSProperty(
		'value',
		'Alphabet'
	);
	await expect(page.locator('ix-input[name="linkUrl"]').nth(1)).toHaveJSProperty(
		'value',
		'https://c.example'
	);
	await expect(page.locator('ix-input[name="linkLabel"]').nth(1)).toHaveJSProperty(
		'value',
		'Songs'
	);
});

test('syllabus add: with the current year taken, the first addable year is preselected and stored', async ({
	page
}) => {
	// The link-rows test above created class C's current-year syllabus.
	const current = currentSchoolYear();
	const { data: existing } = await service
		.from('class_syllabi')
		.select('school_year')
		.eq('class_id', fx.classC.id);
	expect(existing).toEqual([{ school_year: current }]);
	const firstAddable = selectableSchoolYears(current, [current])[0];

	const posts: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes('?/create')) posts.push(r.postData() ?? '');
	});
	await signIn(page, fx.admin);
	await openForm(page, `/admin/classes/${fx.classC.id}/syllabus`);
	await expect(page.locator('#schoolYear')).toHaveJSProperty('value', String(firstAddable));
	await page.getByRole('button', { name: 'Add syllabus' }).click();
	await page.waitForURL(/edit=1/);

	expect(posts).toHaveLength(1);
	expect(new URLSearchParams(posts[0]).get('schoolYear')).toBe(String(firstAddable));
	const { data: years } = await service
		.from('class_syllabi')
		.select('school_year')
		.eq('class_id', fx.classC.id)
		.order('school_year');
	expect(years).toEqual(
		[current, firstAddable].sort((a, b) => a - b).map((school_year) => ({ school_year }))
	);
});

test('enrol: no student chosen sends nothing and marks the select; choosing one enrols them and clears it', async ({
	page
}) => {
	// An empty submit must never reach the server: fail the test on any
	// ?/enroll request while the select is empty.
	let allowEnroll = false;
	const enrollPosts: string[] = [];
	const blocked: string[] = [];
	await page.route(/\?\/enroll/, async (route) => {
		if (!allowEnroll) {
			blocked.push(route.request().url());
			return route.abort();
		}
		enrollPosts.push(route.request().postData() ?? '');
		return route.continue();
	});
	await signIn(page, fx.admin);
	await openForm(page, `/admin/classes/${fx.classC.id}/students`);

	const select = page.locator('#enroll-student');
	const submit = page.getByRole('button', { name: 'Add to class' });
	await submit.click();
	await expect(select).toHaveClass(/\bix-invalid\b/);
	// Light-DOM message, announced and linked to the select's native input.
	const error = page.locator('#enroll-student-error');
	await expect(error).toHaveText('Choose a student to add.');
	await expect(error).toHaveAttribute('role', 'alert');
	const selectInput = select.locator('input').first();
	await expect(selectInput).toHaveAttribute('aria-invalid', 'true');
	await expect
		.poll(() =>
			selectInput.evaluate((el) =>
				(el.ariaDescribedByElements ?? []).map((d) => d.textContent?.trim()).join(' ')
			)
		)
		.toBe('Choose a student to add.');

	expect(blocked).toEqual([]);

	// Open the list and pick the fixture student.
	allowEnroll = true;
	await select.locator('input').first().click();
	await page.locator(`ix-select-item[label*="Student ${fx.tag}"]`).click();
	await expect(select).not.toHaveClass(/\bix-invalid\b/);
	await expect(error).toHaveCount(0);
	await submit.click();
	await expect(page.locator('ix-toast').getByText('Student added to the class.')).toBeVisible();
	expect(enrollPosts).toHaveLength(1);
	expect(new URLSearchParams(enrollPosts[0]).get('studentId')).toBe(fx.student.id);
	await expect(page.locator('.member-list')).toContainText(`Student ${fx.tag}`);

	const { data: row } = await service
		.from('class_enrollments')
		.select('student_id')
		.eq('class_id', fx.classC.id)
		.eq('student_id', fx.student.id)
		.maybeSingle();
	expect(row).not.toBeNull();

	// The select is empty again, and submitting it is blocked again.
	allowEnroll = false;
	const selectAfter = page.locator('#enroll-student');
	// Focus moves to the remounted select, not <body>.
	await expect(selectAfter).toBeFocused();
	await expect(selectAfter).not.toHaveClass(/\bix-invalid\b/);
	await expect
		.poll(() =>
			selectAfter.evaluate((el) => {
				const v = (el as HTMLElement & { value?: unknown }).value;
				return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
			})
		)
		.toBe(true);
	await page.getByRole('button', { name: 'Add to class' }).click();
	await expect(selectAfter).toHaveClass(/\bix-invalid\b/);
	expect(blocked).toEqual([]);
	expect(enrollPosts).toHaveLength(1);
});

test('admin team create: the name field is empty again after a create (#66 B8a)', async ({
	page
}) => {
	const name = `E2E66 Team ${fx.tag}`;
	try {
		await signIn(page, fx.admin);
		await page.goto('/admin/teams');
		await page.waitForFunction(() => customElements.get('ix-input') !== undefined);
		await page.waitForLoadState('networkidle');

		const field = page.locator('#name');
		await field.locator('input').first().fill(name);
		// #76: the Tibetan name is required too.
		await page.locator('#name-bo input').first().fill(`${name} bo`);
		await expect(field).toHaveJSProperty('value', name);
		await page.getByRole('button', { name: 'Create team' }).click();
		await expect(page.locator('ix-toast').getByText(`Team "${name}" created.`)).toBeVisible();
		// #76: the cell shows the name and, under it, the names in the other languages.
		const cell = page.getByRole('cell', { name: `${name} ${name} bo`, exact: true });
		await expect(cell).toBeVisible();
		await expect(cell.locator('[lang="bo"]')).toHaveText(`${name} bo`);
		await expect(page.locator('#name')).toHaveJSProperty('value', '');

		// A duplicate name fails: the toast shows and the name is kept.
		await page.locator('#name input').first().fill(name);
		// #76: the Tibetan name is required too.
		await page.locator('#name-bo input').first().fill(`${name} bo`);
		await page.getByRole('button', { name: 'Create team' }).click();
		await expect(page.locator('ix-toast').getByText(/already/i)).toBeVisible();
		await expect(page.locator('#name')).toHaveJSProperty('value', name);
	} finally {
		await service.from('teams').delete().eq('name', name);
	}
});

test('admin team names: edit the names, and each interface language shows its own (#76)', async ({
	page
}) => {
	const name = `E2E76 Team ${fx.tag}`;
	const tibetan = `སྡེ་ཚན ${fx.tag}`;
	const german = `E2E76 Gruppe ${fx.tag}`;
	// An existing team: English name only, as before 0036.
	const { error: insertError } = await service.from('teams').insert({ name });
	if (insertError) throw new Error(`create team: ${insertError.message}`);
	try {
		await signIn(page, fx.admin);
		await page.goto('/admin/teams');
		await page.waitForFunction(() => customElements.get('ix-input') !== undefined);
		await page.waitForLoadState('networkidle');

		const row = page.locator('tr').filter({ hasText: name });
		await row.getByRole('button', { name: 'Edit names' }).click();
		const form = page.locator('form[action="?/rename"]');
		await expect(form.locator('ix-input[name="name"]')).toHaveJSProperty('value', name);

		// Tibetan is required: saving without it fails and keeps the form open.
		await form.locator('ix-input[name="nameDe"] input').first().fill(german);
		await form.getByRole('button', { name: 'Save names' }).click();
		await expect(
			page.locator('ix-toast').getByText('The Tibetan team name is required.')
		).toBeVisible();
		await expect(form.locator('ix-input[name="nameDe"]')).toHaveJSProperty('value', german);

		await form.locator('ix-input[name="nameBo"] input').first().fill(tibetan);
		await form.getByRole('button', { name: 'Save names' }).click();
		await expect(page.locator('ix-toast').getByText(`Names of “${name}” saved.`)).toBeVisible();
		await expect(form).toHaveCount(0);

		// English interface: the English name, the other two under it.
		const cell = page.locator('td').filter({ hasText: name });
		await expect(cell.locator('[lang="bo"]')).toHaveText(tibetan);
		await expect(cell.locator('[lang="de"]')).toHaveText(german);

		// German and Tibetan interfaces lead with their own name.
		await page.goto('/de/admin/teams');
		await expect(page.locator('td').filter({ hasText: german }).locator('[lang="en"]')).toHaveText(
			name
		);
		await page.goto('/bo/admin/teams');
		await expect(page.locator('td').filter({ hasText: tibetan }).locator('[lang="de"]')).toHaveText(
			german
		);

		// The leaderboard shows the team under the viewer's language.
		await page.goto('/de/leaderboard');
		await expect(page.getByText(german, { exact: true })).toBeVisible();
		await expect(page.getByText(name, { exact: true })).toHaveCount(0);
	} finally {
		await service.from('teams').delete().eq('name', name);
	}
});

test('requests approve: an empty team sends nothing and marks the select; with a team the student is approved', async ({
	page
}) => {
	const teamName = `E2E66 Approve Team ${fx.tag}`;
	const registrationName = `E2E66 Pending ${fx.tag}`;
	let teamId: string | undefined;
	let studentId: string | undefined;
	try {
		const { data: team, error: teamError } = await service
			.from('teams')
			.insert({ name: teamName })
			.select('id')
			.single();
		if (teamError || !team) throw new Error(`create team: ${teamError?.message}`);
		teamId = team.id;
		// A pending student who registered for class C.
		const { data: created, error: createError } = await service.auth.admin.createUser({
			email: `pending-${crypto.randomUUID()}@students.internal.invalid`,
			password: crypto.randomUUID(),
			email_confirm: true,
			app_metadata: { role: 'student' }
		});
		if (createError || !created.user) throw new Error(`create pending: ${createError?.message}`);
		studentId = created.user.id;
		const { error: pendingError } = await service
			.from('profiles')
			.update({ class_id: fx.classC.id, status: 'pending', registration_name: registrationName })
			.eq('id', studentId);
		if (pendingError) throw new Error(`make pending: ${pendingError.message}`);

		// An empty submit must never reach the server.
		let allowApprove = false;
		const blocked: string[] = [];
		const approvePosts: string[] = [];
		await page.route(/\?\/approve/, async (route) => {
			if (!allowApprove) {
				blocked.push(route.request().url());
				return route.abort();
			}
			approvePosts.push(route.request().postData() ?? '');
			return route.continue();
		});
		await signIn(page, fx.admin);
		await openForm(page, '/requests');

		const select = page.locator(`#team-${studentId}`);
		const row = page.locator('tr').filter({ has: select });
		await expect(row).toContainText(registrationName);
		await row.getByRole('button', { name: 'Approve' }).click();
		await expect(select).toHaveClass(/\bix-invalid\b/);
		const error = page.locator(`#team-${studentId}-error`);
		await expect(error).toHaveText('Choose a team before approving.');
		const selectInput = select.locator('input').first();
		await expect(selectInput).toHaveAttribute('aria-invalid', 'true');
		await expect
			.poll(() =>
				selectInput.evaluate((el) =>
					(el.ariaDescribedByElements ?? []).map((d) => d.textContent?.trim()).join(' ')
				)
			)
			.toBe('Choose a team before approving.');
		expect(blocked).toEqual([]);

		// Pick the team and approve.
		allowApprove = true;
		await selectInput.click();
		await select.locator(`ix-select-item[label="${teamName}"]`).click();
		await expect(select).toHaveJSProperty('value', team.id);
		await expect(select).not.toHaveClass(/\bix-invalid\b/);
		await expect(error).toHaveCount(0);
		await row.getByRole('button', { name: 'Approve' }).click();
		await expect(page.locator('ix-message-bar')).toContainText(`${registrationName} was approved`);
		expect(approvePosts).toHaveLength(1);
		const posted = new URLSearchParams(approvePosts[0]);
		expect(posted.get('studentId')).toBe(studentId);
		expect(posted.get('teamId')).toBe(team.id);
		await expect(page.locator(`#team-${studentId}`)).toHaveCount(0);

		const { data: profile } = await service
			.from('profiles')
			.select('status, team_id')
			.eq('id', studentId)
			.single();
		expect(profile).toEqual({ status: 'approved', team_id: team.id });
	} finally {
		// The student first: a team with members cannot be deleted.
		if (studentId) await service.auth.admin.deleteUser(studentId);
		if (teamId) await service.from('teams').delete().eq('id', teamId);
	}
});

test('admin class create: a failed create keeps the typed name, and deleting a class does not clear it (#66 B8a)', async ({
	page
}) => {
	const typed = fx.classA.name;
	const throwaway = `E2E66 Delete ${fx.tag}`;
	const { error: insertError } = await service
		.from('classes')
		.insert({ name: throwaway, code: `D${crypto.randomUUID().slice(0, 5).toUpperCase()}` });
	if (insertError) throw new Error(`create class: ${insertError.message}`);
	try {
		await signIn(page, fx.admin);
		await page.goto('/admin/classes');
		await page.waitForFunction(() => customElements.get('ix-input') !== undefined);
		await page.waitForLoadState('networkidle');

		// An existing name: the create fails and the name stays.
		const field = page.locator('#name');
		await field.locator('input').first().fill(typed);
		// #76: the Tibetan name is required too.
		await page.locator('#name-bo input').first().fill(`${typed} bo`);
		await page.getByRole('button', { name: 'Create class' }).click();
		await expect(page.locator('ix-toast').getByText(/already exists/)).toBeVisible();
		await expect(field).toHaveJSProperty('value', typed);

		// A half-typed name survives deleting another class.
		await field.locator('input').first().fill('Half typed');
		await expect(field).toHaveJSProperty('value', 'Half typed');
		await page
			.locator('tr')
			.filter({ hasText: throwaway })
			.getByRole('button', { name: 'Delete' })
			.click();
		await page.locator('ix-modal').getByRole('button', { name: 'Delete' }).last().click();
		await expect(page.locator('ix-toast').getByText(`Class “${throwaway}” deleted.`)).toBeVisible();
		await expect(page.getByRole('cell', { name: throwaway, exact: true })).toHaveCount(0);
		await expect(page.locator('#name')).toHaveJSProperty('value', 'Half typed');
	} finally {
		await service.from('classes').delete().eq('name', throwaway);
	}
});

test('admin teacher create: posts email and name; a failed create keeps them, a successful one clears them (#66 B8a)', async ({
	page
}) => {
	const email = `e2e-66-teacher-${fx.tag}@example.test`;
	const displayName = `E2E66 Teacher ${fx.tag}`;
	const posts: URLSearchParams[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes('?/create')) {
			posts.push(new URLSearchParams(r.postData() ?? ''));
		}
	});
	try {
		await signIn(page, fx.admin);
		await page.goto('/admin/teachers');
		await page.waitForFunction(() => customElements.get('ix-input') !== undefined);
		await page.waitForLoadState('networkidle');

		const emailField = page.locator('#email');
		const nameField = page.locator('#displayName');
		const classBox = page.getByRole('checkbox', { name: new RegExp(fx.classC.name) });

		// An existing teacher's email: the create fails, both fields keep their values.
		await emailField.locator('input').first().fill(fx.teacher.email);
		await nameField.locator('input').first().fill(displayName);
		await classBox.click();
		await expect(classBox).toBeChecked();
		await page.getByRole('button', { name: 'Create teacher' }).click();
		await expect(
			page.locator('ix-toast').getByText('A teacher with this email already exists.')
		).toBeVisible();
		expect(posts).toHaveLength(1);
		expect(posts[0].get('email')).toBe(fx.teacher.email);
		expect(posts[0].get('displayName')).toBe(displayName);
		await expect(emailField).toHaveJSProperty('value', fx.teacher.email);
		await expect(nameField).toHaveJSProperty('value', displayName);

		// A new email: created, and the form is empty again.
		await emailField.locator('input').first().fill(email);
		await expect(emailField).toHaveJSProperty('value', email);
		await page.getByRole('button', { name: 'Create teacher' }).click();
		await expect(page.locator('ix-message-bar')).toContainText(
			`Teacher account created for ${email}`
		);
		expect(posts).toHaveLength(2);
		expect(posts[1].get('email')).toBe(email);
		expect(posts[1].get('displayName')).toBe(displayName);
		expect(posts[1].getAll('classIds')).toEqual([fx.classC.id]);
		await expect(page.locator('#email')).toHaveJSProperty('value', '');
		await expect(page.locator('#displayName')).toHaveJSProperty('value', '');
	} finally {
		const { data: rows } = await service.from('profiles').select('id').eq('email', email);
		for (const row of rows ?? []) await service.auth.admin.deleteUser(row.id);
	}
});
