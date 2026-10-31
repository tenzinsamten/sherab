import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { formatInstant } from '$lib/format';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

/**
 * Mobile-first story 9, I/O matrix row "Parents": the admin parents page as
 * the server renders it. Status badges, children listed, the Requests link
 * while a parent waits, the danger message on a load error and the empty
 * state. No iX is left.
 */
type Child = {
	id: string;
	name: string;
	status: 'pending' | 'approved' | 'rejected' | null;
	linkedAt: string;
	invitedBy: string | null;
	coParent: string | null;
	canRemove: boolean;
};

type Parent = {
	id: string;
	name: string;
	email: string;
	status: 'pending' | 'approved' | 'rejected';
	emailConfirmedAt: string | null;
	canPostBoard: boolean;
	children: Child[];
};

const LINKED_AT = '2026-09-01T10:00:00Z';

function child(id: string, name: string, overrides: Partial<Child> = {}): Child {
	return {
		id,
		name,
		status: 'approved',
		linkedAt: LINKED_AT,
		invitedBy: null,
		coParent: null,
		canRemove: false,
		...overrides
	};
}

function parent(id: string, overrides: Partial<Parent> = {}): Parent {
	return {
		id,
		name: `Parent ${id}`,
		email: `${id}@example.test`,
		status: 'approved',
		emailConfirmedAt: '2026-10-01T10:00:00Z',
		canPostBoard: false,
		children: [],
		...overrides
	};
}

function renderPage(data: { parents?: Parent[]; pendingCount?: number; loadError?: boolean }) {
	return render(Page, {
		props: {
			params: {},
			data: { parents: [], pendingCount: 0, loadError: false, ...data }
		} as never
	}).body.replace(/<!--[\s\S]*?-->/g, ''); // without Svelte's hydration markers
}

/** The markup of one parent's row. */
const row = (body: string, name: string) =>
	(body.match(/<tr[^>]*data-testid="parent-row"[\s\S]*?<\/tr>/g) ?? []).find((tr) =>
		tr.includes(`>${name}<`)
	) ?? '';

describe('admin parents (+page.svelte)', () => {
	it('shows each status as a badge, and flags an unconfirmed email', () => {
		const body = renderPage({
			parents: [
				parent('a', { status: 'approved' }),
				parent('r', { status: 'rejected' }),
				parent('p', { status: 'pending', emailConfirmedAt: null })
			],
			pendingCount: 1
		});
		expect(body).toContain('data-ui="new"');
		expect(row(body, 'Parent a')).toContain(m.parents_status_approved());
		expect(row(body, 'Parent a')).not.toContain(m.requests_email_unconfirmed());
		expect(row(body, 'Parent r')).toContain(m.parents_status_rejected());
		expect(row(body, 'Parent p')).toContain(m.parents_status_pending());
		expect(row(body, 'Parent p')).toContain(m.requests_email_unconfirmed());
		expect(body).toMatch(/data-testid="page-counter"[^>]*>\s*3\s*</);
	});

	it('lists the children, marking pending and rejected ones, and a dash for none', () => {
		const body = renderPage({
			parents: [
				parent('a', {
					children: [
						child('c1', 'Anna'),
						child('c2', 'Pema', { status: 'pending' }),
						child('c3', 'Tenzin', { status: 'rejected' })
					]
				}),
				parent('b')
			]
		});
		const a = row(body, 'Parent a');
		expect(a.match(/data-testid="parent-child"/g)).toHaveLength(3);
		expect(a).toContain('>Anna</span>');
		expect(a).toContain('>Pema</span>');
		expect(a).toContain(` ${m.parents_child_pending()}`);
		expect(a).toContain(` ${m.parents_child_rejected()}`);
		expect(a).toContain(m.parents_col_children());
		expect(row(body, 'Parent b')).toContain('—');
	});

	it('shows who registered or invited each parent, the link date and the co-parent (story 4)', () => {
		const body = renderPage({
			parents: [
				parent('a', {
					name: 'Dolma',
					children: [child('c1', 'Anna', { coParent: 'Karma', canRemove: true })]
				}),
				parent('b', {
					name: 'Karma',
					children: [
						child('c1', 'Anna', {
							linkedAt: '2026-09-02T10:00:00Z',
							invitedBy: 'Dolma',
							coParent: 'Dolma',
							canRemove: true
						})
					]
				})
			]
		});
		const a = row(body, 'Dolma');
		expect(a).toContain(m.parents_link_registered());
		expect(a).toContain(m.parents_link_since({ date: formatInstant(LINKED_AT) }));
		expect(a).toContain(m.parents_link_co_parent({ name: 'Karma' }));
		const b = row(body, 'Karma');
		expect(b).toContain(m.parents_link_invited_by({ name: 'Dolma' }));
		expect(b).toContain(m.parents_link_since({ date: formatInstant('2026-09-02T10:00:00Z') }));
		expect(b).toContain(m.parents_link_co_parent({ name: 'Dolma' }));
		for (const r of [a, b]) {
			expect(r).toContain('action="?/removeParentLink"');
			expect(r).toContain('name="studentId" value="c1"');
			expect(r).toContain(m.parents_link_remove());
		}
		expect(a).toContain('name="parentId" value="a"');
		expect(b).toContain('name="parentId" value="b"');
	});

	it("no co-parent and no Remove for a child with one parent or the admin's own child", () => {
		const body = renderPage({
			parents: [
				parent('a', { name: 'Dolma', children: [child('c1', 'Anna')] }),
				parent('o', {
					name: 'Own',
					children: [child('c2', 'Pema', { coParent: 'Admin', canRemove: false })]
				})
			]
		});
		const a = row(body, 'Dolma');
		expect(a).not.toContain('data-testid="parent-child-co-parent"');
		expect(a).not.toContain('removeParentLink');
		const own = row(body, 'Own');
		expect(own).toContain(m.parents_link_co_parent({ name: 'Admin' }));
		expect(own).not.toContain('removeParentLink');
	});

	it('shows the board posting control only on approved rows, labelled for each state (CAP-4)', () => {
		const body = renderPage({
			parents: [
				parent('off', { name: 'Dolma' }),
				parent('on', { name: 'Karma', canPostBoard: true }),
				parent('p', { name: 'Pema', status: 'pending', canPostBoard: true }),
				parent('r', { name: 'Rinchen', status: 'rejected', canPostBoard: true })
			],
			pendingCount: 1
		});
		const off = row(body, 'Dolma');
		expect(off).toContain(m.parents_board_cannot_post());
		expect(off).toContain(m.parents_board_allow());
		expect(off).toContain(`aria-label="${m.parents_board_allow_label({ parent: 'Dolma' })}"`);
		expect(off).toContain('action="?/setBoardPosting"');
		expect(off).toContain('name="parentId" value="off"');
		expect(off).toContain('name="on" value="true"');
		expect(off).not.toContain(m.parents_board_stop());

		const on = row(body, 'Karma');
		expect(on).toContain(m.parents_board_can_post());
		expect(on).toContain(m.parents_board_stop());
		expect(on).toContain(`aria-label="${m.parents_board_stop_label({ parent: 'Karma' })}"`);
		expect(on).toContain('name="on" value="false"');
		expect(on).not.toContain(m.parents_board_allow());

		for (const name of ['Pema', 'Rinchen']) {
			const r = row(body, name);
			expect(r).not.toContain('data-testid="board-posting"');
			expect(r).not.toContain('setBoardPosting');
			expect(r).not.toContain(m.parents_board_can_post());
			expect(r).not.toContain(m.parents_board_cannot_post());
		}
	});

	it('links to Requests while a parent waits, and not otherwise', () => {
		const waiting = renderPage({
			parents: [parent('p', { status: 'pending' })],
			pendingCount: 1
		});
		expect(waiting).toMatch(/<a[^>]*href="\/requests"/);
		expect(waiting).toContain(m.parents_pending_link({ count: '1' }));
		const none = renderPage({ parents: [parent('a')] });
		expect(none).not.toMatch(/<a[^>]*href="\/requests"/);
	});

	it('shows the danger message on a load error, with no table and no counter', () => {
		const body = renderPage({ loadError: true });
		const alert = body.match(/<p[^>]*data-testid="parents-load-error"[^>]*>([\s\S]*?)<\/p>/);
		expect(alert?.[0]).toContain('role="alert"');
		expect(alert?.[0]).toContain('text-destructive');
		expect(alert?.[1].trim()).toBe(m.parents_load_error());
		expect(body).not.toContain('<table');
		expect(body).not.toContain('data-testid="page-counter"');
	});

	it('shows the empty state when there is no parent', () => {
		const body = renderPage({ parents: [] });
		expect(body).toContain('data-testid="empty-state"');
		expect(body).toContain(m.parents_empty_heading());
		expect(body).toContain(m.parents_empty_body());
		expect(body).not.toContain('<table');
	});
});
