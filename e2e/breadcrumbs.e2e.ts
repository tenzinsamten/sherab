import { expect, test, type Page } from '@playwright/test';
import { currentSchoolYear, formatSchoolYear } from '../src/lib/school-year';
import { service, signIn, type TestUser } from './fixtures';

/**
 * iX breadcrumbs on nested pages (#61): the I/O matrix rows "Navigate up",
 * "Deep trail on a phone", "Student from Done", "Parent tab" and "Former
 * class", plus the admin and student class trails and the current page's
 * aria-current. Its own fixture: a class taught by one teacher, one approved
 * student (with a parent) enrolled in it, one homework given to the student,
 * and one syllabus; plus a second class the student has left, with a
 * finished homework from it.
 */

test.describe.configure({ mode: 'serial' });

const tag = crypto.randomUUID().slice(0, 8);
const className = `E2E61 ${tag}`;
const formerClassName = `E2E61 former ${tag}`;
const studentName = `E2E61 Student ${tag}`;
const homeworkTitle = `E2E61 homework ${tag}`;
const formerHomeworkTitle = `E2E61 former homework ${tag}`;
const schoolYear = currentSchoolYear();

let admin: TestUser;
let teacher: TestUser;
let student: TestUser;
let parent: TestUser;
let classId: string;
let assignmentId: string;
let instanceId: string;
let formerInstanceId: string;
let syllabusId: string;
/** Deletion order: students first (a class with students cannot be deleted), parents last. */
const userIds: string[] = [];
const classIds: string[] = [];

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`${what}: ${result.error.message}`);
	return result.data;
}

async function createUser(role: 'admin' | 'teacher' | 'student' | 'parent'): Promise<TestUser> {
	const domain = role === 'student' ? 'students.internal.invalid' : 'example.test';
	const email = `e2e-61-${role}-${tag}@${domain}`;
	const password = crypto.randomUUID();
	const { data, error } = await service.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		app_metadata: { role }
	});
	if (error || !data.user) throw new Error(`create ${role}: ${error?.message}`);
	if (role === 'student') userIds.unshift(data.user.id);
	else if (role === 'parent') userIds.push(data.user.id);
	else userIds.splice(userIds.length - (parent ? 1 : 0), 0, data.user.id);
	return { id: data.user.id, email, password };
}

/** Safe to run twice: whatever was deleted is dropped from the lists. */
async function cleanup() {
	const problems: string[] = [];
	for (const id of userIds.slice()) {
		const { error } = await service.auth.admin.deleteUser(id);
		if (error) problems.push(`delete user ${id}: ${error.message}`);
		else userIds.splice(userIds.indexOf(id), 1);
	}
	if (classIds.length) {
		// Homework and syllabi cascade with the class.
		const { error } = await service.from('classes').delete().in('id', classIds);
		if (error) problems.push(`delete classes: ${error.message}`);
		else classIds.length = 0;
	}
	if (problems.length) throw new Error(problems.join('; '));
}

async function createClass(name: string): Promise<string> {
	const id = check(
		await service
			.from('classes')
			.insert({ name, code: `B${crypto.randomUUID().slice(0, 5).toUpperCase()}` })
			.select('id')
			.single(),
		`create class ${name}`
	).id;
	classIds.push(id);
	check(
		await service.from('class_teachers').insert({ class_id: id, teacher_id: teacher.id }),
		'assign teacher'
	);
	return id;
}

async function enroll(cls: string) {
	const enrolled = check(
		await service
			.from('class_enrollments')
			.select('class_id')
			.eq('student_id', student.id)
			.eq('class_id', cls),
		'read enrollment'
	);
	if (!enrolled?.length) {
		check(
			await service.from('class_enrollments').insert({ student_id: student.id, class_id: cls }),
			'enroll student'
		);
	}
}

/** A one-off homework for the student, due in a week. */
async function giveHomework(cls: string, title: string) {
	const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
	const assignment = check(
		await service
			.from('homework_assignments')
			.insert({
				class_id: cls,
				title,
				skill_area: 'language',
				whole_class: false,
				created_by: teacher.id
			})
			.select('id')
			.single(),
		'create assignment'
	).id;
	const instance = check(
		await service
			.from('homework_instances')
			.insert({ assignment_id: assignment, class_id: cls, period_start: due, due_date: due })
			.select('id')
			.single(),
		'create instance'
	).id;
	const assigned = check(
		await service
			.from('homework_status_history')
			.select('id')
			.eq('instance_id', instance)
			.eq('student_id', student.id),
		'read assignment status'
	);
	if (!assigned?.length) {
		check(
			await service.from('homework_status_history').insert({
				instance_id: instance,
				student_id: student.id,
				class_id: cls,
				status: 'assigned',
				recorded_by: teacher.id
			}),
			'assign homework'
		);
	}
	return { assignment, instance };
}

test.beforeAll(async () => {
	test.setTimeout(60_000);
	try {
		admin = await createUser('admin');
		teacher = await createUser('teacher');
		parent = await createUser('parent');
		classId = await createClass(className);
		const formerClassId = await createClass(formerClassName);

		student = await createUser('student');
		check(
			await service
				.from('profiles')
				.update({
					class_id: classId,
					status: 'approved',
					registration_name: studentName,
					display_name: studentName
				})
				.eq('id', student.id),
			'approve student'
		);
		await enroll(classId);
		await enroll(formerClassId);
		check(
			await service.from('parents').update({ status: 'approved' }).eq('id', parent.id),
			'approve parent'
		);
		check(
			await service.from('profiles').update({ parent_id: parent.id }).eq('id', student.id),
			'link parent'
		);

		({ assignment: assignmentId, instance: instanceId } = await giveHomework(
			classId,
			homeworkTitle
		));

		// Former class: a finished homework (finished homework stays visible
		// after leaving a class), then the student leaves that class.
		formerInstanceId = (await giveHomework(formerClassId, formerHomeworkTitle)).instance;
		check(
			await service.from('homework_status_history').insert({
				instance_id: formerInstanceId,
				student_id: student.id,
				class_id: formerClassId,
				status: 'done',
				recorded_by: student.id
			}),
			'finish former homework'
		);
		check(
			await service
				.from('class_enrollments')
				.delete()
				.eq('student_id', student.id)
				.eq('class_id', formerClassId),
			'leave former class'
		);

		syllabusId = check(
			await service
				.from('class_syllabi')
				.insert({ class_id: classId, school_year: schoolYear })
				.select('id')
				.single(),
			'create syllabus'
		).id;
	} catch (error) {
		await cleanup().catch(() => undefined);
		throw error;
	}
});

test.afterAll(async () => {
	await cleanup();
});

/** Waits for hydration and for the breadcrumb to be upgraded by iX. */
async function open(page: Page, path: string) {
	await page.goto(path);
	await page.waitForFunction(() => customElements.get('ix-breadcrumb-item') !== undefined);
	await page.waitForLoadState('networkidle');
}

const crumbs = (page: Page) => page.locator('ix-breadcrumb');
const currentCrumb = (page: Page) => page.locator('ix-breadcrumb [aria-current="page"]');

/** The old "Back to …" buttons sat in the page header; none is left there. */
async function expectNoBackButton(page: Page) {
	await expect(page.locator('.page-header ix-button[variant="secondary"]')).toHaveCount(0);
}

/** Marks the loaded document, so a full page load (which drops the mark) can be told apart. */
async function markDocument(page: Page) {
	await page.evaluate(() => {
		(window as unknown as { __e2eMark?: boolean }).__e2eMark = true;
	});
}
async function expectSameDocument(page: Page) {
	expect(
		await page.evaluate(() => (window as unknown as { __e2eMark?: boolean }).__e2eMark === true)
	).toBe(true);
}

test('navigate up: the Homework crumb on a homework page goes to the list without a reload', async ({
	page
}) => {
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}/homework/${assignmentId}`);

	await expect(currentCrumb(page)).toContainText(homeworkTitle);
	await expect(crumbs(page).getByRole('link', { name: 'Dashboard' })).toBeVisible();
	await expect(crumbs(page).getByRole('link', { name: className })).toBeVisible();
	await expectNoBackButton(page);

	await markDocument(page);
	await crumbs(page).getByRole('link', { name: 'Homework', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/teacher/classes/${classId}/homework$`));
	await expect(page.locator('h1')).toHaveText('Homework');
	await expectSameDocument(page);
	await expect(currentCrumb(page)).toContainText('Homework');
});

test('phone: a deep trail collapses into "…" without sideways scroll, and a collapsed crumb navigates', async ({
	page
}) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await signIn(page, teacher);
	await open(page, `/teacher/classes/${classId}/syllabus/${syllabusId}`);

	const previous = page.locator('ix-breadcrumb ix-dropdown-button.previous-button');
	await expect(previous).toBeVisible();
	await expect(currentCrumb(page)).toContainText(formatSchoolYear(schoolYear));
	// Only the last two levels show; Dashboard and the class are in the dropdown.
	await expect(crumbs(page).getByRole('link', { name: 'Syllabus' })).toBeVisible();
	await expect(crumbs(page).getByRole('link', { name: className })).toHaveCount(0);

	const fits = await page.evaluate(() => {
		const trail = document.querySelector('ix-breadcrumb')!.getBoundingClientRect();
		const pageEl = document.querySelector('.page')!;
		return {
			trailInside: trail.right <= window.innerWidth + 0.5,
			noPageScroll: pageEl.scrollWidth <= pageEl.clientWidth,
			noDocScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth
		};
	});
	expect(fits).toEqual({ trailInside: true, noPageScroll: true, noDocScroll: true });

	await markDocument(page);
	await previous.click();
	await page.locator('ix-breadcrumb ix-dropdown-item', { hasText: className }).click();
	await expect(page).toHaveURL(new RegExp(`/teacher/classes/${classId}$`));
	await expect(page.locator('h1')).toHaveText(className);
	await expectSameDocument(page);
});

test('admin: the class level is plain text; Syllabus and Classes crumbs lead up', async ({
	page
}) => {
	await signIn(page, admin);
	await open(page, `/admin/classes/${classId}/syllabus/${syllabusId}`);

	await expect(currentCrumb(page)).toContainText(formatSchoolYear(schoolYear));
	await expectNoBackButton(page);
	// Admin has no class page: the class crumb is shown, but not as a link.
	await expect(page.locator('ix-breadcrumb-item', { hasText: className })).toHaveCount(1);
	await expect(crumbs(page).getByRole('link', { name: className })).toHaveCount(0);

	await crumbs(page).getByRole('link', { name: 'Syllabus' }).click();
	await expect(page).toHaveURL(new RegExp(`/admin/classes/${classId}/syllabus$`));
	await expect(currentCrumb(page)).toContainText('Syllabus');

	await crumbs(page).getByRole('link', { name: 'Classes' }).click();
	await expect(page).toHaveURL(/\/admin\/classes$/);
});

test('student: the My classes crumb on a class page leads to the class list', async ({ page }) => {
	await signIn(page, student);
	await open(page, `/student/classes/${classId}`);

	await expect(currentCrumb(page)).toContainText(className);
	await expectNoBackButton(page);
	await crumbs(page).getByRole('link', { name: 'My classes' }).click();
	await expect(page).toHaveURL(/\/student\/classes$/);
});

test('student from Done: the My Homework crumb keeps the Done filter', async ({ page }) => {
	await signIn(page, student);
	await open(page, `/student/homework/${instanceId}?from=done`);

	await expect(currentCrumb(page)).toContainText(homeworkTitle);
	await expectNoBackButton(page);
	await crumbs(page).getByRole('link', { name: 'My Homework' }).click();
	await expect(page).toHaveURL(/\/student\/homework\?filter=done$/);
});

test('former class: homework from a class the student left still shows its trail', async ({
	page
}) => {
	await signIn(page, student);
	await open(page, `/student/homework/${formerInstanceId}`);

	await expect(page.locator('.page-kicker')).toHaveText('Former class');
	await expect(page.locator('ix-breadcrumb-item')).toHaveCount(2);
	await expect(crumbs(page).getByRole('link', { name: 'My Homework' })).toBeVisible();
	await expect(currentCrumb(page)).toContainText(formerHomeworkTitle);
});

test('parent tab: the last crumb names the open tab and follows a tab switch', async ({ page }) => {
	await signIn(page, parent);
	await open(page, `/parent/children/${student.id}?tab=sessions`);

	await expect(currentCrumb(page)).toContainText('Sessions');
	await expect(crumbs(page).getByRole('link', { name: 'Dashboard' })).toBeVisible();
	await expect(crumbs(page).getByRole('link', { name: studentName })).toBeVisible();

	await page.locator('nav.tabs').getByRole('link', { name: 'Homework' }).click();
	await expect(page).toHaveURL(/tab=homework/);
	await expect(currentCrumb(page)).toContainText('Homework');
	await expect(currentCrumb(page)).toHaveCount(1);

	// On Overview the child level is the current page: no link to itself.
	await page.locator('nav.tabs').getByRole('link', { name: 'Overview' }).click();
	await expect(currentCrumb(page)).toContainText('Overview');
	await expect(crumbs(page).getByRole('link', { name: studentName })).toHaveCount(0);
});
