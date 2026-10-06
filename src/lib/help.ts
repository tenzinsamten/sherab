import * as m from '$lib/paraglide/messages.js';

/** The three guides on /help (#87). Admins get none. */
export const HELP_ROLES = ['parent', 'teacher', 'student'] as const;
export type HelpRole = (typeof HELP_ROLES)[number];

export type HelpEntry = {
	title: () => string;
	body: () => string;
	/**
	 * Screenshot name under static/help/<language>/ (no extension), taken by
	 * `npm run help:screenshots` (e2e/help-screenshots.e2e.ts).
	 */
	image?: string;
};

/** Size of every screenshot in CSS pixels (the files are 1.5x). */
export const HELP_IMAGE_SIZE = { width: 390, height: 640 };

/** Address of a step's screenshot in the viewer's language. */
export function helpImageSrc(image: string, locale: string): string {
	return `/help/${locale}/${image}.png`;
}

/** The guide a visitor sees first: their own role's, else the parents'. */
export function helpRoleFor(requested: string | null, role: string | null | undefined): HelpRole {
	const known = (value: string | null | undefined): value is HelpRole =>
		HELP_ROLES.includes(value as HelpRole);
	if (known(requested)) return requested;
	return known(role) ? role : 'parent';
}

export const helpTabLabels: Record<HelpRole, () => string> = {
	parent: m.help_tab_parent,
	teacher: m.help_tab_teacher,
	student: m.help_tab_student
};

/** Each guide's steps, in the order a new user meets them. */
export const helpGuides: Record<HelpRole, HelpEntry[]> = {
	parent: [
		{ title: m.help_parent_1_title, body: m.help_parent_1_body, image: 'parent-1' },
		{ title: m.help_parent_2_title, body: m.help_parent_2_body },
		{ title: m.help_parent_3_title, body: m.help_parent_3_body },
		{ title: m.help_parent_4_title, body: m.help_parent_4_body, image: 'parent-4' },
		{ title: m.help_parent_5_title, body: m.help_parent_5_body, image: 'parent-5' },
		{ title: m.help_parent_6_title, body: m.help_parent_6_body, image: 'parent-6' },
		{ title: m.help_parent_7_title, body: m.help_parent_7_body, image: 'parent-7' },
		{ title: m.help_parent_8_title, body: m.help_parent_8_body, image: 'parent-8' },
		{ title: m.help_parent_9_title, body: m.help_parent_9_body }
	],
	teacher: [
		{ title: m.help_teacher_1_title, body: m.help_teacher_1_body, image: 'teacher-1' },
		{ title: m.help_teacher_2_title, body: m.help_teacher_2_body, image: 'teacher-2' },
		{ title: m.help_teacher_3_title, body: m.help_teacher_3_body, image: 'teacher-3' },
		{ title: m.help_teacher_4_title, body: m.help_teacher_4_body, image: 'teacher-4' },
		{ title: m.help_teacher_5_title, body: m.help_teacher_5_body, image: 'teacher-5' },
		{ title: m.help_teacher_6_title, body: m.help_teacher_6_body, image: 'teacher-6' },
		{ title: m.help_teacher_7_title, body: m.help_teacher_7_body },
		{ title: m.help_teacher_8_title, body: m.help_teacher_8_body, image: 'teacher-8' },
		{ title: m.help_teacher_9_title, body: m.help_teacher_9_body, image: 'teacher-9' },
		{ title: m.help_teacher_10_title, body: m.help_teacher_10_body }
	],
	student: [
		{ title: m.help_student_1_title, body: m.help_student_1_body, image: 'student-1' },
		{ title: m.help_student_2_title, body: m.help_student_2_body },
		{ title: m.help_student_3_title, body: m.help_student_3_body, image: 'student-3' },
		{ title: m.help_student_4_title, body: m.help_student_4_body, image: 'student-4' },
		{ title: m.help_student_5_title, body: m.help_student_5_body, image: 'student-5' },
		{ title: m.help_student_6_title, body: m.help_student_6_body, image: 'student-6' },
		{ title: m.help_student_7_title, body: m.help_student_7_body, image: 'student-7' },
		{ title: m.help_student_8_title, body: m.help_student_8_body, image: 'student-8' },
		{ title: m.help_student_9_title, body: m.help_student_9_body }
	]
};

/** Questions shared by every role; `title` is the question. */
export const helpFaq: HelpEntry[] = [
	{ title: m.help_faq_1_q, body: m.help_faq_1_a },
	{ title: m.help_faq_2_q, body: m.help_faq_2_a },
	{ title: m.help_faq_3_q, body: m.help_faq_3_a },
	{ title: m.help_faq_4_q, body: m.help_faq_4_a },
	{ title: m.help_faq_5_q, body: m.help_faq_5_a },
	{ title: m.help_faq_6_q, body: m.help_faq_6_a },
	{ title: m.help_faq_7_q, body: m.help_faq_7_a },
	{ title: m.help_faq_8_q, body: m.help_faq_8_a },
	{ title: m.help_faq_9_q, body: m.help_faq_9_a },
	{ title: m.help_faq_10_q, body: m.help_faq_10_a }
];
