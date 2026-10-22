import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

/**
 * Mobile-first story 9, I/O matrix row "Parents": the admin parents page as
 * the server renders it. Status badges, children listed, the Requests link
 * while a parent waits, the danger message on a load error and the empty
 * state. No iX is left.
 */
type Parent = {
	id: string;
	name: string;
	email: string;
	status: 'pending' | 'approved' | 'rejected';
	emailConfirmedAt: string | null;
	children: { id: string; name: string; status: 'pending' | 'approved' | 'rejected' | null }[];
};

function parent(id: string, overrides: Partial<Parent> = {}): Parent {
	return {
		id,
		name: `Parent ${id}`,
		email: `${id}@example.test`,
		status: 'approved',
		emailConfirmedAt: '2026-10-01T10:00:00Z',
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
						{ id: 'c1', name: 'Anna', status: 'approved' },
						{ id: 'c2', name: 'Pema', status: 'pending' },
						{ id: 'c3', name: 'Tenzin', status: 'rejected' }
					]
				}),
				parent('b')
			]
		});
		const a = row(body, 'Parent a');
		expect(a).toContain('<span>Anna</span>, <span>Pema</span>');
		expect(a).toContain(` ${m.parents_child_pending()}`);
		expect(a).toContain(` ${m.parents_child_rejected()}`);
		expect(a).toContain(m.parents_col_children());
		expect(row(body, 'Parent b')).toContain('—');
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
