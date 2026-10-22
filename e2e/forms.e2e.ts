import { expect, test, type Page } from '@playwright/test';
import { currentSchoolYear, selectableSchoolYears } from '../src/lib/school-year';
import {
	createCalendarFixture,
	fixtureTeam,
	service,
	signIn,
	type CalendarFixture
} from './fixtures';

/**
 * Shared form components (#66 B7): the I/O matrix rows "Link rows" and
 * "Required select empty". Uses the calendar fixture's class C (admin-only,
 * no syllabus, the fixture student not enrolled) and its admin.
 */

test.describe.configure({ mode: 'serial' });

let fx: CalendarFixture;
// A second approved student in class A, so the enrol panel still has
// someone to offer after the fixture student is added to class C.
let otherStudentId: string | undefined;
const otherStudentTeam = fixtureTeam('e2e-66');

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
			display_name: `E2E66 Other ${fx.tag}`,
			team_id: await otherStudentTeam.id()
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
	try {
		// Before the fixture cleanup: a class with students cannot be deleted.
		if (otherStudentId) {
			const { error } = await service.auth.admin.deleteUser(otherStudentId);
			if (error) throw new Error(`delete other student: ${error.message}`);
		}
		const teamProblem = await otherStudentTeam.remove();
		if (teamProblem) throw new Error(teamProblem);
	} finally {
		// Also when the steps above fail, so the fixture is not left behind.
		await fx?.cleanup();
	}
});

/** A syllabus's own page: where adding a syllabus lands. */
const SYLLABUS_PAGE = /\/syllabus\/[0-9a-f-]{36}$/;

/** Waits for the page's new-UI root to be hydrated (mobile-first story 9: the admin pages). */
async function openForm(page: Page, path: string) {
	await page.goto(path);
	await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
	await page.waitForLoadState('networkidle');
}

test('link rows: a blank middle row is skipped, rows 1 and 3 save and reopen in order (in a syllabus section)', async ({
	page
}) => {
	const posts: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes('?/updateSection')) {
			posts.push(r.postData() ?? '');
		}
	});
	await signIn(page, fx.admin);
	await openForm(page, `/admin/classes/${fx.classC.id}/syllabus`);
	await page.getByRole('button', { name: 'Add syllabus' }).click();
	await page.waitForURL(SYLLABUS_PAGE);
	await page.waitForLoadState('networkidle');

	// A new syllabus has no sections (0038); adding one opens its form.
	await expect(page.getByText('No sections yet.')).toBeVisible();
	await page.locator('#section-title-new').fill('Songs');
	await page.getByRole('button', { name: 'Add section' }).click();

	// The section's description is rich text in a chosen language (#75):
	// Tibetan, a bold first line, then a plain one.
	const editor = page.locator('.rte-input');
	await expect(editor).toHaveAttribute('contenteditable', 'true');
	const language = page.locator('select[name="contentLanguage"]');
	await expect(language).toHaveValue('en');
	await language.selectOption('bo');
	await expect(language).toHaveValue('bo');
	await editor.click();
	const bold = page.getByRole('button', { name: 'Bold', exact: true });
	await bold.click();
	await page.keyboard.type('སློབ་ཚན་དང་པོ།');
	await bold.click();
	await page.keyboard.press('Enter');
	await page.keyboard.type('Week 2: songs');
	await page.getByRole('button', { name: 'Add link' }).click();
	await page.getByRole('button', { name: 'Add link' }).click();
	const urls = page.locator('input[name="linkUrl"]');
	const labels = page.locator('input[name="linkLabel"]');
	await expect(urls).toHaveCount(3);
	await urls.nth(0).fill('https://a.example');
	await labels.nth(0).fill('Alphabet');
	await urls.nth(2).fill('https://c.example');
	await labels.nth(2).fill('Songs');
	await page.getByRole('button', { name: 'Save section' }).click();
	await expect(page.locator('[data-sonner-toast]').getByText('Section saved.')).toBeVisible();

	// Posted in row order, the blank row as empty strings.
	expect(posts).toHaveLength(1);
	const form = new URLSearchParams(posts[0]);
	expect(form.getAll('linkUrl')).toEqual(['https://a.example', '', 'https://c.example']);
	expect(form.getAll('linkLabel')).toEqual(['Alphabet', '', 'Songs']);

	// Stored without the blank row (parseReferenceLinks ignores an empty URL).
	// The add form preselects the current school year.
	const { data: saved } = await service
		.from('class_syllabi')
		.select(
			'school_year, content_doc, links, class_syllabus_sections(position, title, content_doc, content_language, links)'
		)
		.eq('class_id', fx.classC.id)
		.single();
	expect(saved).toEqual({
		school_year: currentSchoolYear(),
		// The syllabus's own text and links are no longer written (0038).
		content_doc: null,
		links: [],
		class_syllabus_sections: [
			{
				position: 1,
				title: 'Songs',
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
			}
		]
	});

	// Saved: shown formatted, in the Tibetan font under the English interface.
	const shown = page.locator('.rich-text');
	await expect(shown).toHaveAttribute('lang', 'bo');
	await expect(shown).toHaveCSS('font-family', /Atisha/);
	await expect(shown.locator('p strong')).toHaveText('སློབ་ཚན་དང་པོ།');
	await expect(shown.locator('p').nth(1)).toHaveText('Week 2: songs');

	// Reopened: title, text, language and both links, in order.
	await openForm(page, page.url().replace(/\?.*$/, ''));
	await page.getByRole('button', { name: 'Edit section' }).click();
	await expect(
		page.locator('form[action="?/updateSection"] input[name="title"]').first()
	).toHaveValue('Songs');
	await expect(page.locator('.rte-input')).toHaveAttribute('contenteditable', 'true');
	await expect(page.locator('.rte-input p')).toHaveText(['སློབ་ཚན་དང་པོ།', 'Week 2: songs']);
	await expect(page.locator('select[name="contentLanguage"]')).toHaveValue('bo');
	await expect(page.locator('input[name="linkUrl"]')).toHaveCount(2);
	await expect(page.locator('input[name="linkUrl"]').nth(0)).toHaveValue('https://a.example');
	await expect(page.locator('input[name="linkLabel"]').nth(0)).toHaveValue('Alphabet');
	await expect(page.locator('input[name="linkUrl"]').nth(1)).toHaveValue('https://c.example');
	await expect(page.locator('input[name="linkLabel"]').nth(1)).toHaveValue('Songs');
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
	await expect(page.locator('#schoolYear')).toHaveValue(String(firstAddable));
	await page.getByRole('button', { name: 'Add syllabus' }).click();
	await page.waitForURL(SYLLABUS_PAGE);

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
	// The message under the select, announced and linked to it.
	const error = page.locator('#enroll-student-error');
	await expect(error).toHaveText('Choose a student to add.');
	await expect(error).toHaveAttribute('role', 'alert');
	await expect(select).toHaveAttribute('aria-invalid', 'true');
	await expect(select).toHaveAttribute('aria-describedby', 'enroll-student-error');

	expect(blocked).toEqual([]);

	// Pick the fixture student: each option keeps its label (name, username, classes).
	allowEnroll = true;
	const option = select.locator('option', { hasText: `Student ${fx.tag}` });
	await expect(option).toHaveCount(1);
	await expect(option).toContainText(`(${fx.student.email.split('@')[0]}) — `);
	await expect(option).toContainText(fx.classA.name);
	await select.selectOption(fx.student.id);
	await expect(select).not.toHaveAttribute('aria-invalid', 'true');
	await expect(error).toHaveCount(0);
	await submit.click();
	await expect(
		page.locator('[data-sonner-toast]').getByText('Student added to the class.')
	).toBeVisible();
	expect(enrollPosts).toHaveLength(1);
	expect(new URLSearchParams(enrollPosts[0]).get('studentId')).toBe(fx.student.id);
	await expect(page.getByTestId('member-list')).toContainText(`Student ${fx.tag}`);

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
	// Focus moves to the select, not <body>.
	await expect(selectAfter).toBeFocused();
	await expect(selectAfter).not.toHaveAttribute('aria-invalid', 'true');
	await expect(selectAfter).toHaveValue('');
	await page.getByRole('button', { name: 'Add to class' }).click();
	await expect(selectAfter).toHaveAttribute('aria-invalid', 'true');
	await expect(error).toHaveText('Choose a student to add.');
	expect(blocked).toEqual([]);
	expect(enrollPosts).toHaveLength(1);
});

test('admin team create: the name field is empty again after a create (#66 B8a)', async ({
	page
}) => {
	const name = `E2E66 Team ${fx.tag}`;
	try {
		await signIn(page, fx.admin);
		await openForm(page, '/admin/teams');

		// Story 9 matrix "Create team": a missing name keeps the error toast and
		// saves nothing.
		const field = page.locator('#name');
		await field.fill(name);
		await page.getByRole('button', { name: 'Create team' }).click();
		await expect(
			page.locator('[data-sonner-toast]').getByText('The Tibetan team name is required.')
		).toBeVisible();
		await expect(field).toHaveValue(name);
		const { data: notSaved } = await service.from('teams').select('id').eq('name', name);
		expect(notSaved).toEqual([]);

		await field.fill(name);
		// #76: the Tibetan name is required too.
		await page.locator('#name-bo').fill(`${name} bo`);
		await expect(field).toHaveValue(name);
		await page.getByRole('button', { name: 'Create team' }).click();
		await expect(
			page.locator('[data-sonner-toast]').getByText(`Team "${name}" created.`)
		).toBeVisible();
		// #76: the cell shows the name and, under it, the names in the other languages.
		const cell = page.getByRole('cell', { name: `${name} ${name} bo`, exact: true });
		await expect(cell).toBeVisible();
		await expect(cell.locator('[lang="bo"]')).toHaveText(`${name} bo`);
		await expect(page.locator('#name')).toHaveValue('');
		await expect(page.locator('#name-bo')).toHaveValue('');

		// A duplicate name fails: the toast shows and the name is kept.
		await page.locator('#name').fill(name);
		// #76: the Tibetan name is required too.
		await page.locator('#name-bo').fill(`${name} bo`);
		await page.getByRole('button', { name: 'Create team' }).click();
		await expect(page.locator('[data-sonner-toast]').getByText(/already/i)).toBeVisible();
		await expect(page.locator('#name')).toHaveValue(name);
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
		await openForm(page, '/admin/teams');

		const row = page.locator('tr').filter({ hasText: name });
		await row.getByRole('button', { name: 'Edit names' }).click();
		const form = page.locator('form[action="?/rename"]');
		await expect(form.locator('input[name="name"]')).toHaveValue(name);

		// Tibetan is required: saving without it fails and keeps the form open.
		await form.locator('input[name="nameDe"]').fill(german);
		await form.getByRole('button', { name: 'Save names' }).click();
		await expect(
			page.locator('[data-sonner-toast]').getByText('The Tibetan team name is required.')
		).toBeVisible();
		await expect(form.locator('input[name="nameDe"]')).toHaveValue(german);

		await form.locator('input[name="nameBo"]').fill(tibetan);
		await form.getByRole('button', { name: 'Save names' }).click();
		await expect(
			page.locator('[data-sonner-toast]').getByText(`Names of “${name}” saved.`)
		).toBeVisible();
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

		// #80: under Tibetan, dates and numbers are written in Tibetan (the
		// Gregorian date, Tibetan digits); the browser has no Tibetan data.
		const tibetanRow = page.locator('tr').filter({ hasText: tibetan });
		await expect(
			tibetanRow.getByText(/^ཕྱི་ལོ་ [༠-༩]{4} ཟླ་ [༠-༩]{1,2} ཚེས་ [༠-༩]{1,2}$/)
		).toBeVisible();
		await expect(tibetanRow.getByRole('cell', { name: '༠', exact: true })).toBeVisible();
		await expect(page.getByTestId('page-counter')).toHaveText(/^[༠-༩]+$/);

		// #79: a locale link sets the language and lands on the plain address;
		// the language then holds across in-app navigation.
		await expect(page).toHaveURL(/\/admin\/teams$/);
		// #86: the nav label is not clipped, so Tibetan letters are not cut.
		// The nav's own name is Tibetan here too, so it is found by its test id.
		const leaderboardLink = page
			.getByTestId('side-nav')
			.getByRole('link', { name: 'རྩེ་ཕུད་སྒྲིག་ཐོ།' });
		await expect(leaderboardLink).toBeVisible();
		expect(
			await leaderboardLink.evaluate((link) =>
				[...link.querySelectorAll('span')].every(
					(span) => span.scrollHeight <= span.clientHeight + 1
				)
			)
		).toBe(true);
		await leaderboardLink.click();
		await expect(page).toHaveURL(/\/leaderboard$/);
		await expect(page.getByText(tibetan, { exact: true })).toBeVisible();
		await expect(page.getByText(name, { exact: true })).toHaveCount(0);

		// #80: the calendar's weekday headings and title are Tibetan too.
		await page.goto('/calendar');
		await expect(page.getByRole('columnheader').filter({ hasText: 'སྤེན་པ' })).toBeVisible();
		await expect(
			page.getByRole('heading', { name: /^ཕྱི་ལོ་ [༠-༩]{4} ཟླ་ [༠-༩]{1,2}$/ })
		).toBeVisible();
		await page.goto('/leaderboard');

		// The language picker switches the name too. Opened only once the page
		// has settled: a list opened while the header is still being set up
		// closes again.
		await page.waitForLoadState('networkidle');
		await page.getByTestId('language-menu').click();
		await page.getByRole('menuitemradio', { name: 'Deutsch' }).click();
		await expect(page.locator('html')).toHaveAttribute('lang', 'de');
		await expect(page).toHaveURL(/\/leaderboard$/);
		await expect(page.getByText(german, { exact: true })).toBeVisible();
		await expect(page.getByText(tibetan, { exact: true })).toHaveCount(0);
	} finally {
		await service.from('teams').delete().eq('name', name);
	}
});

test('admin class edit: opens with its badge subject and a names-only save keeps it (badge detail CAP-1)', async ({
	page
}) => {
	const name = `E2E Badge ${fx.tag}`;
	const renamed = `E2E Badge renamed ${fx.tag}`;
	const { data: cls, error: insertError } = await service
		.from('classes')
		.insert({
			name,
			name_bo: `གར ${fx.tag}`,
			code: `B${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
			badge_subject: 'dance'
		})
		.select('id')
		.single();
	if (insertError || !cls) throw new Error(`create class: ${insertError?.message}`);
	try {
		await signIn(page, fx.admin);
		await openForm(page, '/admin/classes');

		const row = page.locator('tr').filter({ hasText: name });
		await expect(row.getByRole('cell', { name: 'Dance & song', exact: true })).toBeVisible();
		await row.getByRole('button', { name: 'Edit class' }).click();
		const form = page.locator('form[action="?/rename"]');
		await expect(form.locator(`#edit-${cls.id}-subject`)).toHaveValue('dance');

		await form.locator('input[name="name"]').fill(renamed);
		await form.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(
			page.locator('[data-sonner-toast]').getByText(`“${renamed}” saved.`)
		).toBeVisible();
		await expect(form).toHaveCount(0);

		const { data } = await service
			.from('classes')
			.select('name, badge_subject')
			.eq('id', cls.id)
			.single();
		expect(data).toEqual({ name: renamed, badge_subject: 'dance' });
	} finally {
		await service.from('classes').delete().eq('id', cls.id);
	}
});

// #99: the database assigns the team at approval (0043). /requests has no
// team field any more; one click approves and the message names the team.
test('requests approve: no team field, one click approves and the message names the assigned team', async ({
	page
}) => {
	const teamName = `E2E99 Approve Team ${fx.tag}`;
	const registrationName = `E2E99 Pending ${fx.tag}`;
	let teamId: string | undefined;
	let studentId: string | undefined;
	try {
		// At least one team has to exist; the database may pick another one.
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

		const approvePosts: string[] = [];
		page.on('request', (r) => {
			if (r.method() === 'POST' && r.url().includes('?/approve')) {
				approvePosts.push(r.postData() ?? '');
			}
		});
		await signIn(page, fx.admin);
		await page.goto('/requests');
		await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
		await page.waitForLoadState('networkidle');

		// The pending row (once approved, the name is listed under "decided").
		const row = page
			.getByTestId('request-row')
			.filter({ hasText: registrationName })
			.filter({ has: page.locator('form[action="?/approve"]') });
		await expect(row).toHaveCount(1);
		// No team field: not for this row, not anywhere on the page.
		await expect(page.locator(`#team-${studentId}`)).toHaveCount(0);
		await expect(row.locator('select')).toHaveCount(0);
		await expect(page.locator('[name="teamId"]')).toHaveCount(0);

		const approve = row.getByRole('button', { name: 'Approve' });
		await expect(approve).toBeEnabled();
		await approve.click();
		const outcome = page.getByTestId('requests-outcome');
		await expect(outcome).toContainText(`${registrationName} was approved`);
		// #100: a registration still on a `pending-` address gets its username
		// and one-time PIN at approval, as before.
		await expect(outcome).toContainText('One-time sign-in');
		const minted = outcome.locator('.credential');
		await expect(minted).toHaveCount(2);
		await expect(minted.nth(1)).toHaveText(/^\d{6}$/);
		expect(approvePosts).toHaveLength(1);
		const posted = new URLSearchParams(approvePosts[0]);
		expect(posted.get('studentId')).toBe(studentId);
		expect(posted.has('teamId')).toBe(false);
		await expect(row).toHaveCount(0);

		const { data: profile } = await service
			.from('profiles')
			.select('status, team_id, teams!profiles_team_id_fkey ( name )')
			.eq('id', studentId)
			.single();
		expect(profile?.status).toBe('approved');
		expect(profile?.team_id).toEqual(expect.any(String));
		const assignedName = profile?.teams?.name;
		expect(assignedName).toEqual(expect.any(String));
		await expect(outcome).toContainText(
			`${registrationName} was approved and is in team “${assignedName}”.`
		);
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
		await openForm(page, '/admin/classes');

		// Story 9 matrix "Create class": no English name and no subject. The
		// name keeps the error toast, the subject's error is under its field,
		// and nothing is saved.
		const tibetanOnly = `E2E66 bo only ${fx.tag}`;
		await page.locator('#name-bo').fill(tibetanOnly);
		await page.getByRole('button', { name: 'Create class' }).click();
		await expect(
			page.locator('[data-sonner-toast]').getByText('Class name is required.')
		).toBeVisible();
		const subjectError = page.locator('#new-class-subject-error');
		await expect(subjectError).toHaveText('Choose the badge subject.');
		await expect(subjectError).toHaveAttribute('role', 'alert');
		await expect(page.locator('#new-class-subject')).toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('#new-class-subject')).toHaveAttribute(
			'aria-describedby',
			'new-class-subject-error'
		);
		await expect(page.locator('#name-bo')).toHaveValue(tibetanOnly);
		const { data: notSaved } = await service
			.from('classes')
			.select('id')
			.eq('name_bo', tibetanOnly);
		expect(notSaved).toEqual([]);

		// An existing name: the create fails and the name stays.
		const field = page.locator('#name');
		await field.fill(typed);
		// #76: the Tibetan name is required too.
		await page.locator('#name-bo').fill(`${typed} bo`);
		// Badge detail CAP-1: the subject is required.
		const subject = page.locator('#new-class-subject');
		await subject.selectOption('language');
		await expect(subject).toHaveValue('language');
		await page.getByRole('button', { name: 'Create class' }).click();
		await expect(page.locator('[data-sonner-toast]').getByText(/already exists/)).toBeVisible();
		await expect(field).toHaveValue(typed);
		await expect(subject).toHaveValue('language');
		// A subject picked: its error is gone.
		await expect(subjectError).toHaveCount(0);
		await expect(subject).not.toHaveAttribute('aria-invalid', 'true');

		// A half-typed name survives deleting another class.
		await field.fill('Half typed');
		await expect(field).toHaveValue('Half typed');
		await page
			.locator('tr')
			.filter({ hasText: throwaway })
			.getByRole('button', { name: 'Delete' })
			.click();
		// The new alert dialog (mobile-first story 9), its Delete red.
		const confirmDelete = page
			.getByTestId('confirm-dialog')
			.getByRole('button', { name: 'Delete', exact: true });
		await expect(confirmDelete).toHaveClass(/text-destructive/);
		await confirmDelete.click();
		await expect(
			page.locator('[data-sonner-toast]').getByText(`Class “${throwaway}” deleted.`)
		).toBeVisible();
		await expect(page.getByRole('cell', { name: throwaway, exact: true })).toHaveCount(0);
		await expect(page.locator('#name')).toHaveValue('Half typed');
	} finally {
		await service.from('classes').delete().eq('name', throwaway);
	}
});

test('admin teacher create: posts email, name and classes; a failed create keeps them, a successful one clears them; reset and remove ask first (#66 B8a, mobile-first story 9b)', async ({
	page
}) => {
	const email = `e2e-66-teacher-${fx.tag}@example.test`;
	const displayName = `E2E66 Teacher ${fx.tag}`;
	const posts: Record<'create' | 'resetPassword' | 'remove', URLSearchParams[]> = {
		create: [],
		resetPassword: [],
		remove: []
	};
	page.on('request', (r) => {
		if (r.method() !== 'POST') return;
		for (const action of ['create', 'resetPassword', 'remove'] as const) {
			if (r.url().endsWith(`?/${action}`))
				posts[action].push(new URLSearchParams(r.postData() ?? ''));
		}
	});
	try {
		await signIn(page, fx.admin);
		await page.goto('/admin/teachers');
		await page.locator('main > [data-ui="new"][data-hydrated]').waitFor();
		await page.waitForLoadState('networkidle');

		const emailField = page.locator('#email');
		const nameField = page.locator('#displayName');
		const classBox = page
			.getByTestId('teacher-create')
			.getByRole('checkbox', { name: new RegExp(fx.classC.name) });
		const outcome = page.locator('[role="status"][data-testid="teachers-outcome"]');
		const dialog = page.getByTestId('confirm-dialog');

		// An existing teacher's email: the create fails, the fields and the class keep their values.
		await emailField.fill(fx.teacher.email);
		await nameField.fill(displayName);
		await classBox.check();
		await expect(classBox).toBeChecked();
		await page.getByRole('button', { name: 'Create teacher' }).click();
		await expect(
			page.locator('[data-sonner-toast]').getByText('A teacher with this email already exists.')
		).toBeVisible();
		expect(posts.create).toHaveLength(1);
		expect(posts.create[0].get('email')).toBe(fx.teacher.email);
		expect(posts.create[0].get('displayName')).toBe(displayName);
		await expect(emailField).toHaveValue(fx.teacher.email);
		await expect(nameField).toHaveValue(displayName);
		await expect(classBox).toBeChecked();
		await expect(outcome).toHaveCount(0);

		// A new email: created, the password shown in the outcome box, the form empty again.
		await emailField.fill(email);
		await page.getByRole('button', { name: 'Create teacher' }).click();
		await expect(outcome).toContainText(`Teacher account created for ${email}`);
		await expect(outcome).toHaveAttribute('data-state', 'success');
		await expect(outcome.getByText('Temporary password', { exact: true })).toBeVisible();
		await expect(outcome).toBeInViewport();
		expect(posts.create).toHaveLength(2);
		expect(posts.create[1].get('email')).toBe(email);
		expect(posts.create[1].get('displayName')).toBe(displayName);
		expect(posts.create[1].getAll('classIds')).toEqual([fx.classC.id]);
		await expect(emailField).toHaveValue('');
		await expect(nameField).toHaveValue('');
		await expect(classBox).not.toBeChecked();
		await expect(
			page.getByTestId('teacher-create').getByRole('checkbox', { checked: true })
		).toHaveCount(0);

		const row = page.getByTestId('teacher-row').filter({ hasText: email });
		await expect(row).toContainText(displayName);
		await expect(row).toContainText(fx.classC.name);
		const teacherId = await row.getAttribute('data-teacher-id');
		expect(teacherId).toBeTruthy();

		// Reset password: Cancel posts nothing; the confirm (not red) shows the new password.
		await row.getByRole('button', { name: 'Reset password' }).click();
		await expect(dialog).toContainText(`Give ${displayName} a new temporary password?`);
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toHaveCount(0);
		expect(posts.resetPassword).toHaveLength(0);
		await row.getByRole('button', { name: 'Reset password' }).click();
		const confirmReset = dialog.getByRole('button', { name: 'Reset password', exact: true });
		await expect(confirmReset).not.toHaveClass(/text-destructive/);
		await confirmReset.click();
		await expect(outcome).toContainText(`New temporary password for ${email}`);
		await expect(outcome.getByText('Temporary password', { exact: true })).toBeVisible();
		expect(posts.resetPassword).toHaveLength(1);

		// Remove: Cancel posts nothing; Remove (red) removes the row.
		await row.getByRole('button', { name: 'Remove' }).click();
		await expect(dialog).toContainText(`Remove ${displayName}?`);
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toHaveCount(0);
		expect(posts.remove).toHaveLength(0);
		await expect(row).toHaveCount(1);
		await row.getByRole('button', { name: 'Remove' }).click();
		const confirmRemove = dialog.getByRole('button', { name: 'Remove', exact: true });
		await expect(confirmRemove).toHaveClass(/text-destructive/);
		await confirmRemove.click();
		await expect(
			page.locator('[data-sonner-toast]').getByText(`${displayName} removed.`)
		).toBeVisible();
		await expect(row).toHaveCount(0);
		expect(posts.remove).toHaveLength(1);
		expect(posts.resetPassword[0].get('teacherId')).toBe(teacherId);
		expect(posts.remove[0].get('teacherId')).toBe(teacherId);
	} finally {
		const { data: rows } = await service.from('profiles').select('id').eq('email', email);
		for (const row of rows ?? []) await service.auth.admin.deleteUser(row.id);
	}
});
