<script lang="ts">
	import { onMount, tick } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as m from '$lib/paraglide/messages.js';
	import { formatDay as formatIsoDay, formatInstant, num } from '$lib/format';
	import { showToast } from '$lib/ix';
	import { createConfirm } from '$lib/confirm.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import CopyField from '$lib/components/CopyField.svelte';
	import CredentialFields from '$lib/components/CredentialFields.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { createPending } from '$lib/pending.svelte';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * Requests: registrations, sick notes, upcoming leave and class join
	 * requests (teacher and admin), plus deletion and parent requests (admin).
	 * Mobile-first story 5: each section's rows are stacked cards below 80em
	 * and a full table from 80em (one markup, so the tour's `data-tour` rows
	 * are the visible ones at every width); questions are the new alert
	 * dialog; once a decided row leaves, focus goes to the next row, or to
	 * the section heading.
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();
	const confirm = createConfirm();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	// Approval shows the student's username, so it stays on screen;
	// rejected/cleared are short confirmations, so they're toasts.
	// #100: a student registered with a username and PIN keeps both, and the
	// approver sees the username and a note that the family has the PIN. Only
	// an older registration gets a one-time PIN here. A partial approval of
	// such a one (credentials live, record not saved) shows them too, as a
	// warning -- its error toast no longer carries them (#41).
	let credential = $derived.by(() => {
		if (!form || !('username' in form) || !form.username) return null;
		const pin = 'pin' in form && form.pin ? form.pin : null;
		if (!form.success && !pin) return null;
		const names = {
			name: form.studentName || '',
			team: ('teamName' in form && form.teamName) || ''
		};
		const username = { label: m.credential_username(), value: form.username };
		return {
			partial: !form.success,
			message: !form.success
				? m.requests_error_approve_partial()
				: pin
					? m.requests_outcome_approved(names)
					: m.requests_outcome_approved_has_pin(names),
			fields: pin ? [username, { label: m.credential_pin(), value: pin }] : [username]
		};
	});

	// A new outcome (approval with sign-in details) is at the top of the page;
	// on a phone it is scrolled into view, focus stays where it is.
	let outcomeBox: HTMLElement | undefined = $state();
	$effect(() => {
		if (credential && outcomeBox) outcomeBox.scrollIntoView({ block: 'nearest' });
	});

	// Story 7-5: only the rows the viewer may decide count (never their own child).
	let sickActionable = $derived(data.sickPending.filter((r) => !r.ownChild).length);
	// Story 7-6: likewise, never a deletion request for the admin's own child.
	let deletionActionable = $derived(data.deletionPending.filter((r) => !r.ownChild).length);
	// B12b (#67): likewise, never a class join request for the viewer's own child.
	let joinActionable = $derived(data.joinPending.filter((r) => !r.ownChild).length);

	/**
	 * Where focus goes once a decision is saved: the decided row leaves its
	 * list, so the row now in its place (the next one) or the one before it,
	 * else the section's heading, else (the section is gone) the page's. Only when focus was lost with the row; after an error the row
	 * stays and so does focus.
	 */
	type Spot = { row: Element; list: Element | null; index: number; section: Element | null };
	function spotOf(element: Element | null | undefined): Spot | null {
		const row = element?.closest('[data-request-row]');
		if (!row) return null;
		const list = row.parentElement;
		return {
			row,
			list,
			index: list ? [...list.children].indexOf(row) : -1,
			section: row.closest('section')
		};
	}
	async function refocus(spot: Spot | null) {
		await tick();
		if (!spot || spot.row.isConnected) return;
		const active = document.activeElement;
		if (active && active !== document.body && active.isConnected) return;
		const rows = spot.list?.isConnected ? spot.list.children : null;
		const near = rows ? (rows[spot.index] ?? rows[spot.index - 1]) : null;
		const candidates = [
			near instanceof HTMLElement && near.matches('[data-request-row]') ? near : null,
			spot.section?.querySelector<HTMLElement>('[data-section-heading]')
		];
		const target = candidates.find((el) => el?.isConnected);
		if (target) return target.focus();
		// The section is gone (its last join request was decided): the page heading.
		const heading = document.querySelector<HTMLElement>('main h1');
		if (!heading) return;
		if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
		heading.focus();
	}

	/**
	 * `pending.submit` plus the focus move above. `from` names the row for a
	 * shared hidden form (join, deletion approval), which sits in no row.
	 */
	function decide(
		key: string | (() => string),
		options: Parameters<typeof pending.submit>[1] = {},
		from?: () => Element | null | undefined
	): SubmitFunction {
		const submit = pending.submit(key, options);
		return async (input) => {
			const spot = spotOf(from ? from() : input.formElement);
			const after = await submit(input);
			if (!after) return;
			return async (result) => {
				await after(result);
				await refocus(spot);
			};
		};
	}

	// B12b (#67): Approve and Reject both ask first, then post the shared
	// hidden form for the chosen row and decision.
	let joinForm: HTMLFormElement | undefined = $state();
	let joinRow: Element | null = null;
	let joinTarget = $state({
		id: '',
		name: '',
		className: '',
		decision: 'approved' as 'approved' | 'rejected'
	});
	async function decideJoin(
		row: { id: string; studentName: string; className: string },
		decision: 'approved' | 'rejected',
		button: Element
	) {
		if (pending.busy) return;
		const params = { name: row.studentName, className: row.className };
		const ok = await confirm.ask(
			decision === 'approved'
				? m.requests_join_approve_confirm(params)
				: m.requests_join_reject_confirm(params),
			decision === 'approved' ? m.requests_approve() : m.requests_reject(),
			{ destructive: decision === 'rejected' }
		);
		if (!ok) return;
		joinRow = button;
		joinTarget = { id: row.id, name: row.studentName, className: row.className, decision };
		await tick();
		joinForm?.requestSubmit();
	}

	// #90: approving a parent whose email is unconfirmed asks first; the
	// server only does it with the flag this sets.
	function submitApproveParent(parent: {
		id: string;
		name: string;
		email: string;
		emailConfirmedAt: string | null;
	}): SubmitFunction {
		const submit = decide(`approveParent:${parent.id}`);
		return async (input) => {
			if (!parent.emailConfirmedAt) {
				if (pending.busy) return input.cancel();
				const ok = await confirm.ask(
					m.requests_parent_approve_unconfirmed_confirm({ name: parent.name, email: parent.email }),
					m.requests_approve()
				);
				if (!ok) return input.cancel();
				input.formData.set('withoutConfirmation', '1');
			}
			return submit(input);
		};
	}

	// Story 7-6: Approve erases the child for good, so it asks first.
	let approveDeletionForm: HTMLFormElement | undefined = $state();
	let deletionRow: Element | null = null;
	let deletionTarget = $state({ id: '', name: '' });
	async function approveDeletion(row: { id: string; studentName: string | null }, button: Element) {
		if (pending.busy) return;
		const name = row.studentName ?? '';
		const ok = await confirm.ask(
			m.requests_deletion_approve_confirm({ name }),
			m.requests_deletion_erase(),
			{ destructive: true }
		);
		if (!ok) return;
		deletionRow = button;
		deletionTarget = { id: row.id, name };
		await tick();
		approveDeletionForm?.requestSubmit();
	}

	// Wall-clock dates: format as UTC so no time zone shifts the day.
	const formatDay = (date: string) =>
		formatIsoDay(date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

	// B12b (#67): a request someone else decided meanwhile -- reload so its
	// stale row (and buttons) go; the error toast comes from the layout.
	$effect(() => {
		if (form && 'joinStale' in form && form.joinStale) invalidateAll();
	});

	// B12b (#67): the request date, in the school's time zone so server and
	// browser render the same day.
	const formatRequestDate = (iso: string) => formatInstant(iso);

	$effect(() => {
		if (!form?.success) return;
		if ('deletionStudentName' in form) {
			const name = form.deletionStudentName || '';
			if (form.action === 'deletionApproved')
				showToast('success', m.requests_deletion_outcome_approved({ name }));
			if (form.action === 'deletionRejected')
				showToast('success', m.requests_deletion_outcome_rejected({ name }));
			return;
		}
		if (form.action === 'joinApproved' || form.action === 'joinRejected') {
			// Names come from the clicked row, not from the server's answer.
			if (form.requestId !== joinTarget.id) return;
			const params = { name: joinTarget.name, className: joinTarget.className };
			if (form.action === 'joinApproved')
				showToast('success', m.requests_join_outcome_approved(params));
			if (form.action === 'joinRejected')
				showToast('success', m.requests_join_outcome_rejected(params));
			return;
		}
		if ('sickStudentName' in form) {
			const name = form.sickStudentName || '';
			if (form.action === 'sickApproved')
				showToast('success', m.requests_sick_outcome_approved({ name }));
			if (form.action === 'sickRejected')
				showToast('success', m.requests_sick_outcome_rejected({ name }));
			return;
		}
		if ('parentName' in form) {
			const name = form.parentName || '';
			if (form.action === 'parentApproved')
				showToast('success', m.requests_parent_outcome_approved({ name }));
			if (form.action === 'parentRejected')
				showToast('success', m.requests_parent_outcome_rejected({ name }));
			if (form.action === 'parentConfirmationResent')
				showToast('success', m.requests_parent_outcome_resent({ name }));
			if (form.action === 'parentStaffRejected')
				showToast('success', m.requests_parent_staff_outcome_rejected({ name }));
			return;
		}
		const name = form.studentName || '';
		if (form.action === 'rejected') showToast('success', m.requests_outcome_rejected({ name }));
		if (form.action === 'cleared') showToast('success', m.requests_outcome_cleared({ name }));
	});
	// #60: the header count as a pill, hidden when nothing is waiting.
	let pendingTotal = $derived(
		data.pending.length +
			data.parentsPending.length +
			sickActionable +
			deletionActionable +
			joinActionable
	);

	// One markup for both layouts: stacked cards below 80em, a table from 80em.
	const table = 'block w-full min-w-0 xl:table xl:border-collapse';
	const thead = 'hidden xl:table-header-group';
	const th =
		'border-b border-border px-3 py-2 text-left align-bottom text-sm font-medium text-muted-foreground';
	const tbody = 'flex min-w-0 flex-col gap-3 xl:table-row-group';
	const tr =
		'flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring xl:table-row xl:rounded-none xl:border-0 xl:border-b xl:p-0';
	const td = 'block min-w-0 wrap-break-word xl:table-cell xl:px-3 xl:py-3 xl:align-middle';
	/** The status pill column of a decided list: as narrow as its pill. */
	const tdPill = `${td} xl:w-px xl:whitespace-nowrap`;
	const tdActions = `${td} empty:hidden xl:w-px xl:text-right`;
	const actions = 'flex min-w-0 flex-wrap gap-2 xl:flex-nowrap xl:justify-end';
	/** A form holding one action button: full width in a card, its own width in the table. */
	const actionForm = 'min-w-0 flex-1 basis-32 xl:flex-none xl:basis-auto';
	const actionButton = `${ui.touch} w-full xl:w-auto`;
	const meta = `text-sm ${ui.muted}`;
	const sectionCard = `${ui.card} flex flex-col gap-3`;
	const sectionHeading = 'text-lg leading-snug font-bold outline-none';
	const ownChild = `${ui.muted} xl:text-right`;
</script>

<svelte:head>
	<title>{m.requests_heading()} — Sherab</title>
</svelte:head>

{#snippet spinner(key: string)}
	{#if pending.is(key)}
		<LoaderCircle class="animate-spin" aria-hidden="true" />
	{/if}
{/snippet}

{#snippet decidedPill(status: string | null)}
	{#if status === 'approved'}
		<Badge variant="success">{m.requests_status_approved()}</Badge>
	{:else}
		<Badge variant="secondary">{m.requests_status_rejected()}</Badge>
	{/if}
{/snippet}

{#snippet staffPill(parent: { ownRequest: boolean; staffRole: string | null })}
	{#if parent.ownRequest}
		<Badge variant="info">{m.requests_parent_staff_own()}</Badge>
	{:else if parent.staffRole === 'admin'}
		<Badge variant="info">{m.requests_parent_staff_admin()}</Badge>
	{:else if parent.staffRole === 'teacher'}
		<Badge variant="info">{m.requests_parent_staff_teacher()}</Badge>
	{/if}
{/snippet}

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>
				{data.role === 'admin' ? m.requests_kicker_admin() : m.requests_kicker_teacher()}
			</p>
			<h1 class={ui.heading}>{m.requests_heading()}</h1>
			<p class={ui.subtitle}>
				{data.role === 'admin' ? m.requests_admin_subtitle() : m.requests_teacher_subtitle()}
			</p>
		</div>
		{#if pendingTotal > 0}
			<Badge variant="warning" class="min-h-7 px-3 text-sm" data-testid="requests-count">
				<span aria-hidden="true">{num(pendingTotal)}</span>
				<span class="sr-only">{m.requests_pending_count({ count: num(pendingTotal) })}</span>
			</Badge>
		{/if}
	</header>

	{#if credential}
		<div
			bind:this={outcomeBox}
			role="status"
			data-testid="requests-outcome"
			data-state={credential.partial ? 'warning' : 'success'}
			class="flex min-w-0 flex-col gap-2 rounded-lg border p-4 {credential.partial
				? 'border-warning bg-warning/10'
				: 'border-success bg-success/10'}"
		>
			<p class="wrap-break-word">{credential.message}</p>
			{#if credential.fields.length > 1}
				<CredentialFields fields={credential.fields} />
			{:else}
				<CopyField label={credential.fields[0].label} value={credential.fields[0].value} />
			{/if}
		</div>
	{/if}

	<div class="grid min-w-0 grid-cols-1 gap-4 md:gap-6">
		<section
			class={sectionCard}
			aria-label={m.requests_pending_heading()}
			data-testid="requests-registrations"
		>
			{#if data.pending.length === 0}
				<div tabindex="-1" data-section-heading class="outline-none">
					<EmptyState
						header={m.requests_empty_heading()}
						subHeader={m.requests_empty_body()}
						icon={UserCheck}
					/>
				</div>
			{:else}
				<!-- WebKit drops table semantics from a restyled table (cards below 80em): the roles keep them. -->
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<table role="table" class={table}>
					<thead role="rowgroup" class={thead}>
						<tr role="row">
							<th role="columnheader" class={th}>{m.requests_col_student()}</th>
							<th role="columnheader" class={th}
								><span class="sr-only">{m.requests_approve()}</span></th
							>
						</tr>
					</thead>
					<tbody role="rowgroup" class={tbody}>
						{#each data.pending as student (student.id)}
							<tr
								role="row"
								class={tr}
								tabindex="-1"
								data-request-row
								data-testid="request-row"
								data-tour="requests-registrations"
							>
								<td role="cell" class={td}>
									<strong class="wrap-break-word">{student.registrationName}</strong>
									{#if student.class}
										<!-- #55: the class they registered with; approval enrolls nothing else. -->
										<p class="my-1">
											{m.requests_joined_class({
												name: student.class.name,
												code: student.class.code
											})}
										</p>
									{/if}
									<p class={meta}>{formatRequestDate(student.createdAt)}</p>
								</td>
								<td role="cell" class={tdActions}>
									<div class={actions}>
										<!-- #99: no team field: the database assigns the team at approval. -->
										<form
											method="POST"
											action="?/approve"
											class={actionForm}
											use:enhance={decide(`approve:${student.id}`)}
										>
											<input type="hidden" name="studentId" value={student.id} />
											<input type="hidden" name="studentName" value={student.registrationName} />
											<Button
												type="submit"
												class={actionButton}
												aria-busy={pending.is(`approve:${student.id}`) || undefined}
												disabled={!data.hasTeams || pending.busy}
											>
												{@render spinner(`approve:${student.id}`)}
												{m.requests_approve()}
											</Button>
										</form>
										<form
											method="POST"
											action="?/reject"
											class={actionForm}
											use:enhance={decide(`reject:${student.id}`, {
												confirm: confirm.with(
													m.requests_reject_confirm({ name: student.registrationName ?? '' }),
													m.requests_reject(),
													{ destructive: true }
												)
											})}
										>
											<input type="hidden" name="studentId" value={student.id} />
											<input type="hidden" name="studentName" value={student.registrationName} />
											<Button
												type="submit"
												variant="destructive"
												class={actionButton}
												aria-busy={pending.is(`reject:${student.id}`) || undefined}
												disabled={pending.busy}
											>
												{@render spinner(`reject:${student.id}`)}
												{m.requests_reject()}
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if !data.hasTeams}
					<p
						class="rounded-lg border border-warning bg-warning/10 p-3 wrap-break-word"
						data-testid="requests-no-teams"
					>
						{m.requests_no_teams_note()}
					</p>
				{/if}
			{/if}
		</section>

		<section class={sectionCard} aria-labelledby="decided-heading" data-testid="requests-decided">
			<h2 id="decided-heading" class={sectionHeading} tabindex="-1" data-section-heading>
				{m.requests_decided_heading({
					approved: num(data.decided.filter((s) => s.status === 'approved').length),
					rejected: num(data.decided.filter((s) => s.status === 'rejected').length)
				})}
			</h2>
			{#if data.decided.length === 0}
				<p class={ui.muted}>{m.requests_decided_empty()}</p>
			{:else}
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<table role="table" class={table}>
					<tbody role="rowgroup" class={tbody}>
						{#each data.decided as student (student.id)}
							<tr role="row" class={tr} tabindex="-1" data-request-row data-testid="request-row">
								<td role="cell" class={tdPill}>{@render decidedPill(student.status)}</td>
								<td role="cell" class="{td} {student.status === 'rejected' ? ui.muted : ''}">
									{student.registrationName}
								</td>
								<td role="cell" class={tdActions}>
									{#if student.status === 'rejected'}
										<form
											method="POST"
											action="?/clearRejected"
											class={actionForm}
											use:enhance={decide(`clear:${student.id}`, {
												confirm: confirm.with(
													m.requests_clear_rejected_confirm({
														name: student.registrationName ?? ''
													}),
													m.requests_clear_rejected(),
													{ destructive: true }
												)
											})}
										>
											<input type="hidden" name="studentId" value={student.id} />
											<input type="hidden" name="studentName" value={student.registrationName} />
											<Button
												type="submit"
												variant="ghost"
												class={actionButton}
												aria-busy={pending.is(`clear:${student.id}`) || undefined}
												disabled={pending.busy}
											>
												{#if pending.is(`clear:${student.id}`)}
													{@render spinner(`clear:${student.id}`)}
												{:else}
													<Trash2 aria-hidden="true" />
												{/if}
												{m.requests_clear_rejected()}
											</Button>
										</form>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<section class={sectionCard} aria-labelledby="sick-heading" data-testid="requests-sick">
			<h2 id="sick-heading" class={sectionHeading} tabindex="-1" data-section-heading>
				{m.requests_sick_heading()}
			</h2>
			<p class={ui.muted}>{m.requests_sick_subtitle()}</p>
			{#if data.sickPending.length === 0}
				<p class={ui.muted}>{m.requests_sick_empty()}</p>
			{:else}
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<table role="table" class={table}>
					<thead role="rowgroup" class={thead}>
						<tr role="row">
							<th role="columnheader" class={th}>{m.requests_col_sick()}</th>
							<th role="columnheader" class={th}
								><span class="sr-only">{m.requests_approve()}</span></th
							>
						</tr>
					</thead>
					<tbody role="rowgroup" class={tbody}>
						{#each data.sickPending as row (`${row.sessionId}:${row.studentId}`)}
							{@const key = `${row.sessionId}:${row.studentId}`}
							<tr
								role="row"
								class={tr}
								tabindex="-1"
								data-request-row
								data-testid="request-row"
								data-tour="requests-sick"
							>
								<td role="cell" class={td}>
									<div class="flex flex-wrap items-center gap-2">
										<strong class="wrap-break-word">{row.studentName}</strong>
										<Badge variant="secondary">
											{m.leave_answer_sick()} · {m.leave_decision_pending()}
										</Badge>
									</div>
									<p class={meta}>
										{row.className} ·
										<time datetime={row.day}>{formatDay(row.day)}</time>
										· {row.startTime ?? m.calendar_status_unset()}
									</p>
								</td>
								<td role="cell" class={tdActions}>
									{#if row.ownChild}
										<p class={ownChild}>{m.requests_sick_own_child()}</p>
									{:else}
										<div class={actions}>
											{#each ['approved', 'rejected'] as decision (decision)}
												<form
													method="POST"
													action="?/decideSick"
													class={actionForm}
													use:enhance={decide(`sick:${decision}:${key}`, {
														confirm: confirm.with(
															decision === 'approved'
																? m.requests_sick_approve_confirm({
																		name: row.studentName,
																		date: formatDay(row.day)
																	})
																: m.requests_sick_reject_confirm({
																		name: row.studentName,
																		date: formatDay(row.day)
																	}),
															decision === 'approved' ? m.requests_approve() : m.requests_reject(),
															{ destructive: decision === 'rejected' }
														)
													})}
												>
													<input type="hidden" name="sessionId" value={row.sessionId} />
													<input type="hidden" name="studentId" value={row.studentId} />
													<input type="hidden" name="studentName" value={row.studentName} />
													<input type="hidden" name="decision" value={decision} />
													<Button
														type="submit"
														variant={decision === 'approved' ? 'default' : 'destructive'}
														class={actionButton}
														aria-busy={pending.is(`sick:${decision}:${key}`) || undefined}
														disabled={pending.busy}
													>
														{@render spinner(`sick:${decision}:${key}`)}
														{decision === 'approved' ? m.requests_approve() : m.requests_reject()}
													</Button>
												</form>
											{/each}
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<section
			class={sectionCard}
			aria-labelledby="sick-decided-heading"
			data-testid="requests-sick-decided"
		>
			<h2 id="sick-decided-heading" class={sectionHeading} tabindex="-1" data-section-heading>
				{m.requests_sick_decided_heading()}
			</h2>
			{#if data.sickDecided.length === 0}
				<p class={ui.muted}>{m.requests_sick_decided_empty()}</p>
			{:else}
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<table role="table" class={table}>
					<tbody role="rowgroup" class={tbody}>
						{#each data.sickDecided as row (`${row.sessionId}:${row.studentId}`)}
							<tr role="row" class={tr} data-testid="request-row">
								<td role="cell" class={tdPill}>{@render decidedPill(row.decision)}</td>
								<td role="cell" class="{td} {row.decision === 'rejected' ? ui.muted : ''}">
									<span class="wrap-break-word">{row.studentName}</span>
									<p class={meta}>
										{row.className} ·
										<time datetime={row.day}>{formatDay(row.day)}</time>
										· {row.startTime ?? m.calendar_status_unset()}
										{#if row.decidedBySystem}
											· {m.requests_sick_auto()}
										{/if}
									</p>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<!-- #107: planned leave of the coming weeks; a list, no decision. -->
		<section
			class={sectionCard}
			aria-labelledby="upcoming-leave-heading"
			data-testid="requests-upcoming-leave"
		>
			<h2 id="upcoming-leave-heading" class={sectionHeading}>
				{m.requests_upcoming_leave_heading()}
			</h2>
			<p class={ui.muted}>{m.requests_upcoming_leave_subtitle()}</p>
			{#if data.upcomingLeaveError}
				<p class={ui.muted} role="alert">{m.requests_upcoming_leave_load_failed()}</p>
			{:else if data.upcomingLeave.length === 0}
				<p class={ui.muted}>{m.requests_upcoming_leave_empty()}</p>
			{:else}
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<table role="table" class={table}>
					<tbody role="rowgroup" class={tbody}>
						{#each data.upcomingLeave as row (`${row.sessionId}:${row.studentId}`)}
							<tr role="row" class={tr} data-testid="request-row">
								<td role="cell" class={td}>
									<div class="flex flex-wrap items-center gap-2">
										<strong class="wrap-break-word">{row.studentName}</strong>
										<Badge variant="warning">
											{m.leave_answer_on_leave()}{#if row.classification}
												· {row.classification === 'planned'
													? m.leave_class_planned()
													: m.leave_class_short_notice()}{/if}
										</Badge>
									</div>
									<p class={meta}>
										{row.className} ·
										<time datetime={row.day}>{formatDay(row.day)}</time>
										· {row.startTime ?? m.calendar_status_unset()}
									</p>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<!-- B12b (#67): hidden while nothing is waiting, like the student queue. -->
		{#if data.joinLoadError || data.joinPending.length > 0}
			<section class={sectionCard} aria-labelledby="join-heading" data-testid="requests-join">
				<h2 id="join-heading" class={sectionHeading} tabindex="-1" data-section-heading>
					{m.requests_join_heading()}
				</h2>
				<p class={ui.muted}>{m.requests_join_subtitle()}</p>
				{#if data.joinLoadError}
					<p class={ui.muted} role="alert">{m.requests_join_load_failed()}</p>
				{:else}
					<!-- svelte-ignore a11y_no_redundant_roles -->
					<table role="table" class={table}>
						<thead role="rowgroup" class={thead}>
							<tr role="row">
								<th role="columnheader" class={th}>{m.requests_col_student()}</th>
								<th role="columnheader" class={th}
									><span class="sr-only">{m.requests_join_col_decision()}</span></th
								>
							</tr>
						</thead>
						<tbody role="rowgroup" class={tbody}>
							{#each data.joinPending as row (row.id)}
								<tr
									role="row"
									class={tr}
									tabindex="-1"
									data-request-row
									data-testid="request-row"
									data-tour="requests-join"
								>
									<td role="cell" class={td}>
										<strong class="wrap-break-word">{row.studentName}</strong>
										<p class="my-1">
											{m.requests_join_asks_for({ className: row.className })}
										</p>
										<p class={meta}>
											{row.currentClasses
												? m.requests_join_current({ classes: row.currentClasses })
												: m.requests_join_no_classes()} ·
											<time datetime={row.requestedAt}>{formatRequestDate(row.requestedAt)}</time>
										</p>
									</td>
									<td role="cell" class={tdActions}>
										{#if row.ownChild}
											<p class={ownChild}>{m.requests_join_own_child()}</p>
										{:else}
											<div class={actions}>
												{#each ['approved', 'rejected'] as const as decision (decision)}
													<div class={actionForm}>
														<Button
															variant={decision === 'approved' ? 'default' : 'destructive'}
															class={actionButton}
															aria-busy={pending.is(`join:${decision}:${row.id}`) || undefined}
															aria-haspopup="dialog"
															disabled={pending.busy}
															onclick={(event) => decideJoin(row, decision, event.currentTarget)}
														>
															{@render spinner(`join:${decision}:${row.id}`)}
															{decision === 'approved' ? m.requests_approve() : m.requests_reject()}
														</Button>
													</div>
												{/each}
											</div>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
				<form
					bind:this={joinForm}
					method="POST"
					action={joinTarget.decision === 'approved' ? '?/approveJoin' : '?/rejectJoin'}
					use:enhance={decide(
						() => `join:${joinTarget.decision}:${joinTarget.id}`,
						{},
						() => joinRow
					)}
					hidden
				>
					<input type="hidden" name="requestId" value={joinTarget.id} />
				</form>
			</section>
		{/if}

		{#if data.role === 'admin'}
			<section
				class={sectionCard}
				aria-labelledby="deletion-heading"
				data-testid="requests-deletion"
			>
				<h2 id="deletion-heading" class={sectionHeading} tabindex="-1" data-section-heading>
					{m.requests_deletion_heading()}
				</h2>
				<p class={ui.muted}>{m.requests_deletion_subtitle()}</p>
				{#if data.deletionPending.length === 0}
					<p class={ui.muted}>{m.requests_deletion_empty()}</p>
				{:else}
					<!-- svelte-ignore a11y_no_redundant_roles -->
					<table role="table" class={table}>
						<thead role="rowgroup" class={thead}>
							<tr role="row">
								<th role="columnheader" class={th}>{m.requests_col_student()}</th>
								<th role="columnheader" class={th}
									><span class="sr-only">{m.requests_approve()}</span></th
								>
							</tr>
						</thead>
						<tbody role="rowgroup" class={tbody}>
							{#each data.deletionPending as row (row.id)}
								<tr role="row" class={tr} tabindex="-1" data-request-row data-testid="request-row">
									<td role="cell" class={td}>
										<strong class="wrap-break-word">{row.studentName}</strong>
										<p class={meta}>
											{m.requests_deletion_requested_by({ name: row.requesterName })} ·
											{formatRequestDate(row.requestedAt)}
										</p>
									</td>
									<td role="cell" class={tdActions}>
										{#if row.ownChild}
											<p class={ownChild}>{m.requests_deletion_own_child()}</p>
										{:else}
											<div class={actions}>
												<div class={actionForm}>
													<Button
														variant="destructive"
														class={actionButton}
														aria-busy={pending.is(`approveDeletion:${row.id}`) || undefined}
														aria-haspopup="dialog"
														disabled={pending.busy}
														onclick={(event) => approveDeletion(row, event.currentTarget)}
													>
														{@render spinner(`approveDeletion:${row.id}`)}
														{m.requests_approve()}
													</Button>
												</div>
												<form
													method="POST"
													action="?/rejectDeletion"
													class={actionForm}
													use:enhance={decide(`rejectDeletion:${row.id}`, {
														confirm: confirm.with(
															m.requests_deletion_reject_confirm({ name: row.studentName ?? '' }),
															m.requests_reject()
														)
													})}
												>
													<input type="hidden" name="requestId" value={row.id} />
													<input type="hidden" name="studentName" value={row.studentName ?? ''} />
													<Button
														type="submit"
														variant="outline"
														class={actionButton}
														aria-busy={pending.is(`rejectDeletion:${row.id}`) || undefined}
														disabled={pending.busy}
													>
														{@render spinner(`rejectDeletion:${row.id}`)}
														{m.requests_reject()}
													</Button>
												</form>
											</div>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
				<form
					bind:this={approveDeletionForm}
					method="POST"
					action="?/approveDeletion"
					use:enhance={decide(
						() => `approveDeletion:${deletionTarget.id}`,
						{},
						() => deletionRow
					)}
					hidden
				>
					<input type="hidden" name="requestId" value={deletionTarget.id} />
					<input type="hidden" name="studentName" value={deletionTarget.name} />
				</form>
			</section>

			<section
				class={sectionCard}
				aria-labelledby="deletion-decided-heading"
				data-testid="requests-deletion-decided"
			>
				<h2 id="deletion-decided-heading" class={sectionHeading}>
					{m.requests_deletion_decided_heading()}
				</h2>
				{#if data.deletionDecided.length === 0}
					<p class={ui.muted}>{m.requests_deletion_decided_empty()}</p>
				{:else}
					<!-- svelte-ignore a11y_no_redundant_roles -->
					<table role="table" class={table}>
						<tbody role="rowgroup" class={tbody}>
							{#each data.deletionDecided as row (row.id)}
								<tr role="row" class={tr} data-testid="request-row">
									<td role="cell" class={tdPill}>{@render decidedPill(row.status)}</td>
									<td role="cell" class="{td} {row.status === 'rejected' ? ui.muted : ''}">
										<span class="wrap-break-word"
											>{row.studentName ?? m.requests_deletion_deleted_student()}</span
										>
										<p class={meta}>
											{m.requests_deletion_requested_by({ name: row.requesterName })} ·
											{formatRequestDate(row.requestedAt)}
										</p>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>

			<section class={sectionCard} aria-labelledby="parents-heading" data-testid="requests-parents">
				<h2 id="parents-heading" class={sectionHeading} tabindex="-1" data-section-heading>
					{m.requests_parents_heading()}
				</h2>
				<p class={ui.muted}>{m.requests_parents_subtitle()}</p>
				{#if data.parentsPending.length === 0}
					<p class={ui.muted}>{m.requests_parents_empty()}</p>
				{:else}
					<!-- svelte-ignore a11y_no_redundant_roles -->
					<table role="table" class={table}>
						<thead role="rowgroup" class={thead}>
							<tr role="row">
								<th role="columnheader" class={th}>{m.requests_col_parent()}</th>
								<th role="columnheader" class={th}
									><span class="sr-only">{m.requests_approve()}</span></th
								>
							</tr>
						</thead>
						<tbody role="rowgroup" class={tbody}>
							{#each data.parentsPending as parent (parent.id)}
								<tr role="row" class={tr} tabindex="-1" data-request-row data-testid="request-row">
									<td role="cell" class={td}>
										<div class="flex flex-wrap items-center gap-2">
											<strong class="wrap-break-word">{parent.name}</strong>
											{@render staffPill(parent)}
											{#if parent.emailConfirmedAt}
												<Badge variant="success">{m.requests_email_confirmed()}</Badge>
											{:else}
												<Badge variant="warning">{m.requests_email_unconfirmed()}</Badge>
											{/if}
										</div>
										<p class="{meta} wrap-anywhere">
											{parent.email} · {formatRequestDate(parent.createdAt)}
										</p>
									</td>
									<td role="cell" class={tdActions}>
										<div class={actions}>
											{#if !parent.emailConfirmedAt}
												<form
													method="POST"
													action="?/resendParentConfirmation"
													class={actionForm}
													use:enhance={pending.submit(`resendParent:${parent.id}`)}
												>
													<input type="hidden" name="parentId" value={parent.id} />
													<input type="hidden" name="parentName" value={parent.name} />
													<Button
														type="submit"
														variant="outline"
														class={actionButton}
														aria-busy={pending.is(`resendParent:${parent.id}`) || undefined}
														disabled={pending.busy}
													>
														{@render spinner(`resendParent:${parent.id}`)}
														{m.requests_parent_resend()}
													</Button>
												</form>
											{/if}
											<form
												method="POST"
												action="?/approveParent"
												class={actionForm}
												use:enhance={submitApproveParent(parent)}
											>
												<input type="hidden" name="parentId" value={parent.id} />
												<input type="hidden" name="parentName" value={parent.name} />
												<Button
													type="submit"
													class={actionButton}
													aria-busy={pending.is(`approveParent:${parent.id}`) || undefined}
													disabled={pending.busy}
												>
													{@render spinner(`approveParent:${parent.id}`)}
													{m.requests_approve()}
												</Button>
											</form>
											<form
												method="POST"
												action="?/rejectParent"
												class={actionForm}
												use:enhance={decide(`rejectParent:${parent.id}`, {
													confirm: confirm.with(
														parent.staffRole
															? m.requests_parent_staff_reject_confirm({ name: parent.name })
															: m.requests_parent_reject_confirm({ name: parent.name }),
														m.requests_reject(),
														{ destructive: true }
													)
												})}
											>
												<input type="hidden" name="parentId" value={parent.id} />
												<input type="hidden" name="parentName" value={parent.name} />
												<Button
													type="submit"
													variant="destructive"
													class={actionButton}
													aria-busy={pending.is(`rejectParent:${parent.id}`) || undefined}
													disabled={pending.busy}
												>
													{@render spinner(`rejectParent:${parent.id}`)}
													{m.requests_reject()}
												</Button>
											</form>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>

			<section
				class={sectionCard}
				aria-labelledby="parents-decided-heading"
				data-testid="requests-parents-decided"
			>
				<h2 id="parents-decided-heading" class={sectionHeading} tabindex="-1" data-section-heading>
					{m.requests_parents_decided_heading()}
				</h2>
				{#if data.parentsDecided.length === 0}
					<p class={ui.muted}>{m.requests_parents_decided_empty()}</p>
				{:else}
					<!-- svelte-ignore a11y_no_redundant_roles -->
					<table role="table" class={table}>
						<tbody role="rowgroup" class={tbody}>
							{#each data.parentsDecided as parent (parent.id)}
								<tr role="row" class={tr} tabindex="-1" data-request-row data-testid="request-row">
									<td role="cell" class={tdPill}>{@render decidedPill(parent.status)}</td>
									<td role="cell" class="{td} {parent.status === 'rejected' ? ui.muted : ''}">
										<div class="flex flex-wrap items-center gap-2">
											<span class="wrap-break-word">{parent.name}</span>
											{@render staffPill(parent)}
										</div>
										<p class="{meta} wrap-anywhere">{parent.email}</p>
									</td>
									<td role="cell" class={tdActions}>
										{#if parent.status === 'rejected' && !parent.staffRole}
											<!-- Its account delete failed earlier: retry it. A staff
											     member's rejected request keeps its login (B14a). -->
											<form
												method="POST"
												action="?/rejectParent"
												class={actionForm}
												use:enhance={decide(`rejectParent:${parent.id}`, {
													confirm: confirm.with(
														m.requests_parent_reject_confirm({ name: parent.name }),
														m.requests_clear_rejected(),
														{ destructive: true }
													)
												})}
											>
												<input type="hidden" name="parentId" value={parent.id} />
												<input type="hidden" name="parentName" value={parent.name} />
												<Button
													type="submit"
													variant="ghost"
													class={actionButton}
													aria-busy={pending.is(`rejectParent:${parent.id}`) || undefined}
													disabled={pending.busy}
												>
													{#if pending.is(`rejectParent:${parent.id}`)}
														{@render spinner(`rejectParent:${parent.id}`)}
													{:else}
														<Trash2 aria-hidden="true" />
													{/if}
													{m.requests_clear_rejected()}
												</Button>
											</form>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>
		{/if}
	</div>
</div>

<ConfirmDialog {confirm} />
