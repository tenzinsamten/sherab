<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { SCHOOL_TIME_ZONE } from '$lib/berlin-date';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { confirmAction, showToast } from '$lib/ix';
	import CredentialFields from '$lib/components/CredentialFields.svelte';
	import { createPending } from '$lib/pending.svelte';
	import { ixFieldError } from '$lib/ix-fields';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

	// Pending rows submitted without a team. <ix-select required> doesn't
	// block a submit by itself: stop an empty one here and show the select's
	// invalid state instead of posting (as EnrollmentPanel does).
	const teamMissing = new SvelteSet<string>();
	function submitApprove(studentId: string): SubmitFunction {
		const submit = pending.submit(`approve:${studentId}`);
		return (input) => {
			if (!input.formData.get('teamId')) {
				input.cancel();
				teamMissing.add(studentId);
				return;
			}
			return submit(input);
		};
	}

	// Approval shows the student's one-time username/PIN, so it stays on
	// screen; rejected/cleared are short confirmations, so they're toasts.
	// A partial approval (credentials live, record not saved) shows them too,
	// as a warning -- its error toast no longer carries them (#41).
	let credential = $derived(
		form && 'username' in form && form.username && form.pin
			? {
					partial: !form.success,
					message: form.success
						? m.requests_outcome_approved({ name: form.studentName || '' })
						: m.requests_error_approve_partial(),
					fields: [
						{ label: m.credential_username(), value: form.username },
						{ label: m.credential_pin(), value: form.pin }
					]
				}
			: null
	);

	// Story 7-5: only the rows the viewer may decide count (never their own child).
	let sickActionable = $derived(data.sickPending.filter((r) => !r.ownChild).length);
	// Story 7-6: likewise, never a deletion request for the admin's own child.
	let deletionActionable = $derived(data.deletionPending.filter((r) => !r.ownChild).length);
	// B12b (#67): likewise, never a class join request for the viewer's own child.
	let joinActionable = $derived(data.joinPending.filter((r) => !r.ownChild).length);

	// B12b (#67): Approve and Reject both ask first, then post the shared
	// hidden form for the chosen row and decision.
	let joinForm: HTMLFormElement | undefined = $state();
	let joinTarget = $state({
		id: '',
		name: '',
		className: '',
		decision: 'approved' as 'approved' | 'rejected'
	});
	async function decideJoin(
		row: { id: string; studentName: string; className: string },
		decision: 'approved' | 'rejected'
	) {
		const params = { name: row.studentName, className: row.className };
		const ok = await confirmAction(
			m.common_confirm_title(),
			decision === 'approved'
				? m.requests_join_approve_confirm(params)
				: m.requests_join_reject_confirm(params),
			decision === 'approved' ? m.requests_approve() : m.requests_reject(),
			m.common_cancel()
		);
		if (!ok) return;
		joinTarget = { id: row.id, name: row.studentName, className: row.className, decision };
		await tick();
		joinForm?.requestSubmit();
	}

	// Story 7-6: Approve erases the child for good, so it asks first.
	let approveDeletionForm: HTMLFormElement | undefined = $state();
	let deletionTarget = $state({ id: '', name: '' });
	async function approveDeletion(row: { id: string; studentName: string | null }) {
		const name = row.studentName ?? '';
		const ok = await confirmAction(
			m.common_confirm_title(),
			m.requests_deletion_approve_confirm({ name }),
			m.requests_deletion_erase(),
			m.common_cancel()
		);
		if (!ok) return;
		deletionTarget = { id: row.id, name };
		await tick();
		approveDeletionForm?.requestSubmit();
	}

	// Wall-clock dates: format as UTC so no time zone shifts the day.
	function formatDay(date: string): string {
		try {
			return new Intl.DateTimeFormat(getLocale(), {
				weekday: 'short',
				day: 'numeric',
				month: 'long',
				year: 'numeric',
				timeZone: 'UTC'
			}).format(new Date(`${date}T00:00:00Z`));
		} catch {
			return date;
		}
	}

	// B12b (#67): a request someone else decided meanwhile -- reload so its
	// stale row (and buttons) go; the error toast comes from the layout.
	$effect(() => {
		if (form && 'joinStale' in form && form.joinStale) invalidateAll();
	});

	// B12b (#67): the request date, in the school's time zone so server and
	// browser render the same day.
	function formatRequestDate(iso: string): string {
		try {
			return new Intl.DateTimeFormat(getLocale(), {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				timeZone: SCHOOL_TIME_ZONE
			}).format(new Date(iso));
		} catch {
			return iso;
		}
	}

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
</script>

<svelte:head>
	<title>{m.requests_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">
				{data.role === 'admin' ? m.requests_kicker_admin() : m.requests_kicker_teacher()}
			</p>
			<h1 class="page-heading">{m.requests_heading()}</h1>
			<p class="page-subtitle">
				{data.role === 'admin' ? m.requests_admin_subtitle() : m.requests_teacher_subtitle()}
			</p>
		</div>
		{#if pendingTotal > 0}
			<ix-pill variant="warning">
				<span aria-hidden="true">{pendingTotal}</span>
				<span class="sr-only">{m.requests_pending_count({ count: pendingTotal })}</span>
			</ix-pill>
		{/if}
	</header>

	{#if credential}
		<ix-message-bar
			type={credential.partial ? 'warning' : 'success'}
			persistent
			style="display:block; margin-bottom: var(--space-4);"
		>
			<span>{credential.message}</span>
			<CredentialFields fields={credential.fields} />
		</ix-message-bar>
	{/if}

	<section class="card">
		{#if data.pending.length === 0}
			<ix-empty-state
				header={m.requests_empty_heading()}
				sub-header={m.requests_empty_body()}
				icon="user-check"
			></ix-empty-state>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>{m.requests_col_student()}</th>
							<th><span class="sr-only">{m.requests_approve()}</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.pending as student (student.id)}
							<tr>
								<td>
									<div class="actions">
										<strong>{student.registrationName}</strong>
									</div>
									{#if student.class}
										<!-- #55: the class they registered with; approval enrolls nothing else. -->
										<div style="margin: var(--space-1) 0;">
											{m.requests_joined_class({
												name: student.class.name,
												code: student.class.code
											})}
										</div>
									{/if}
									<div class="muted">
										{new Date(student.createdAt).toLocaleDateString()}
									</div>
								</td>
								<td>
									<div class="actions" style="justify-content:flex-end; align-items:flex-end;">
										<form
											method="POST"
											action="?/approve"
											use:enhance={submitApprove(student.id)}
											class="actions"
											style="align-items:flex-end;"
											novalidate
										>
											<input type="hidden" name="studentId" value={student.id} />
											<input type="hidden" name="studentName" value={student.registrationName} />
											<div class="field" style="margin:0;">
												<ix-select
													id="team-{student.id}"
													name="teamId"
													label={m.requests_team_label()}
													i18n-placeholder={m.requests_team_placeholder()}
													required
													disabled={data.teams.length === 0 || undefined}
													onvalueChange={() => teamMissing.delete(student.id)}
													{@attach ixFieldError(
														teamMissing.has(student.id) ? `team-${student.id}-error` : undefined
													)}
												>
													{#each data.teams as team (team.id)}
														<ix-select-item value={team.id} label={team.name}></ix-select-item>
													{/each}
												</ix-select>
												{#if teamMissing.has(student.id)}
													<p id="team-{student.id}-error" class="field-error" role="alert">
														{m.requests_error_team_required()}
													</p>
												{/if}
											</div>
											<ix-button
												type="submit"
												loading={pending.is(`approve:${student.id}`) || undefined}
												disabled={data.teams.length === 0 || pending.busy || undefined}
											>
												{m.requests_approve()}
											</ix-button>
										</form>
										<form
											method="POST"
											action="?/reject"
											use:enhance={pending.submit(`reject:${student.id}`)}
										>
											<input type="hidden" name="studentId" value={student.id} />
											<input type="hidden" name="studentName" value={student.registrationName} />
											<ix-button
												type="submit"
												variant="danger-secondary"
												loading={pending.is(`reject:${student.id}`) || undefined}
												disabled={pending.busy || undefined}>{m.requests_reject()}</ix-button
											>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if data.teams.length === 0}
				<ix-message-bar
					type="warning"
					persistent
					style="display:block; margin-top: var(--space-3);"
				>
					{m.requests_no_teams_note()}
				</ix-message-bar>
			{/if}
		{/if}
	</section>

	<section class="card">
		<h2>
			{m.requests_decided_heading({
				approved: data.decided.filter((s) => s.status === 'approved').length,
				rejected: data.decided.filter((s) => s.status === 'rejected').length
			})}
		</h2>
		{#if data.decided.length === 0}
			<p class="muted">{m.requests_decided_empty()}</p>
		{:else}
			<div class="table-wrap">
				<table>
					<tbody>
						{#each data.decided as student (student.id)}
							<tr>
								<td style="width:1%; white-space:nowrap;">
									{#if student.status === 'approved'}
										<ix-pill variant="success">{m.requests_status_approved()}</ix-pill>
									{:else}
										<ix-pill variant="neutral">{m.requests_status_rejected()}</ix-pill>
									{/if}
								</td>
								<td class:muted={student.status === 'rejected'}>{student.registrationName}</td>
								<td style="text-align:right;">
									{#if student.status === 'rejected'}
										<form
											method="POST"
											action="?/clearRejected"
											use:enhance={pending.submit(`clear:${student.id}`)}
										>
											<input type="hidden" name="studentId" value={student.id} />
											<input type="hidden" name="studentName" value={student.registrationName} />
											<ix-button
												type="submit"
												variant="tertiary"
												icon="trashcan"
												loading={pending.is(`clear:${student.id}`) || undefined}
												disabled={pending.busy || undefined}
											>
												{m.requests_clear_rejected()}
											</ix-button>
										</form>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="card" aria-labelledby="sick-heading">
		<h2 id="sick-heading">{m.requests_sick_heading()}</h2>
		<p class="muted">{m.requests_sick_subtitle()}</p>
		{#if data.sickPending.length === 0}
			<p class="muted">{m.requests_sick_empty()}</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>{m.requests_col_sick()}</th>
							<th><span class="sr-only">{m.requests_approve()}</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.sickPending as row (`${row.sessionId}:${row.studentId}`)}
							{@const key = `${row.sessionId}:${row.studentId}`}
							<tr>
								<td>
									<div class="actions">
										<strong>{row.studentName}</strong>
										<ix-pill variant="neutral">
											{m.leave_answer_sick()} · {m.leave_decision_pending()}
										</ix-pill>
									</div>
									<div class="muted">
										{row.className} ·
										<time datetime={row.day}>{formatDay(row.day)}</time>
										· {row.startTime ?? m.calendar_status_unset()}
									</div>
								</td>
								<td>
									{#if row.ownChild}
										<p class="muted" style="margin:0; text-align:right;">
											{m.requests_sick_own_child()}
										</p>
									{:else}
										<div class="actions" style="justify-content:flex-end;">
											{#each ['approved', 'rejected'] as decision (decision)}
												<form
													method="POST"
													action="?/decideSick"
													use:enhance={pending.submit(`sick:${decision}:${key}`)}
												>
													<input type="hidden" name="sessionId" value={row.sessionId} />
													<input type="hidden" name="studentId" value={row.studentId} />
													<input type="hidden" name="studentName" value={row.studentName} />
													<input type="hidden" name="decision" value={decision} />
													<ix-button
														type="submit"
														variant={decision === 'approved' ? 'primary' : 'danger-secondary'}
														loading={pending.is(`sick:${decision}:${key}`) || undefined}
														disabled={pending.busy || undefined}
													>
														{decision === 'approved' ? m.requests_approve() : m.requests_reject()}
													</ix-button>
												</form>
											{/each}
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="card">
		<h2>{m.requests_sick_decided_heading()}</h2>
		{#if data.sickDecided.length === 0}
			<p class="muted">{m.requests_sick_decided_empty()}</p>
		{:else}
			<div class="table-wrap">
				<table>
					<tbody>
						{#each data.sickDecided as row (`${row.sessionId}:${row.studentId}`)}
							<tr>
								<td style="width:1%; white-space:nowrap;">
									{#if row.decision === 'approved'}
										<ix-pill variant="success">{m.requests_status_approved()}</ix-pill>
									{:else}
										<ix-pill variant="neutral">{m.requests_status_rejected()}</ix-pill>
									{/if}
								</td>
								<td class:muted={row.decision === 'rejected'}>
									{row.studentName}
									<div class="muted">
										{row.className} ·
										<time datetime={row.day}>{formatDay(row.day)}</time>
										· {row.startTime ?? m.calendar_status_unset()}
										{#if row.decidedBySystem}
											· {m.requests_sick_auto()}
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<!-- B12b (#67): hidden while nothing is waiting, like the student queue. -->
	{#if data.joinLoadError || data.joinPending.length > 0}
		<section class="card" aria-labelledby="join-heading">
			<h2 id="join-heading">{m.requests_join_heading()}</h2>
			<p class="muted">{m.requests_join_subtitle()}</p>
			{#if data.joinLoadError}
				<p class="muted" role="alert">{m.requests_join_load_failed()}</p>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>{m.requests_col_student()}</th>
								<th><span class="sr-only">{m.requests_join_col_decision()}</span></th>
							</tr>
						</thead>
						<tbody>
							{#each data.joinPending as row (row.id)}
								<tr>
									<td>
										<strong>{row.studentName}</strong>
										<div style="margin: var(--space-1) 0;">
											{m.requests_join_asks_for({ className: row.className })}
										</div>
										<div class="muted">
											{row.currentClasses
												? m.requests_join_current({ classes: row.currentClasses })
												: m.requests_join_no_classes()} ·
											<time datetime={row.requestedAt}>{formatRequestDate(row.requestedAt)}</time>
										</div>
									</td>
									<td>
										{#if row.ownChild}
											<p class="muted" style="margin:0; text-align:right;">
												{m.requests_join_own_child()}
											</p>
										{:else}
											<div class="actions" style="justify-content:flex-end;">
												{#each ['approved', 'rejected'] as const as decision (decision)}
													<ix-button
														variant={decision === 'approved' ? 'primary' : 'danger-secondary'}
														loading={pending.is(`join:${decision}:${row.id}`) || undefined}
														disabled={pending.busy || undefined}
														onclick={() => decideJoin(row, decision)}
													>
														{decision === 'approved' ? m.requests_approve() : m.requests_reject()}
													</ix-button>
												{/each}
											</div>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			<form
				bind:this={joinForm}
				method="POST"
				action={joinTarget.decision === 'approved' ? '?/approveJoin' : '?/rejectJoin'}
				use:enhance={pending.submit(() => `join:${joinTarget.decision}:${joinTarget.id}`)}
				hidden
			>
				<input type="hidden" name="requestId" value={joinTarget.id} />
			</form>
		</section>
	{/if}

	{#if data.role === 'admin'}
		<section class="card" aria-labelledby="deletion-heading">
			<h2 id="deletion-heading">{m.requests_deletion_heading()}</h2>
			<p class="muted">{m.requests_deletion_subtitle()}</p>
			{#if data.deletionPending.length === 0}
				<p class="muted">{m.requests_deletion_empty()}</p>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>{m.requests_col_student()}</th>
								<th><span class="sr-only">{m.requests_approve()}</span></th>
							</tr>
						</thead>
						<tbody>
							{#each data.deletionPending as row (row.id)}
								<tr>
									<td>
										<strong>{row.studentName}</strong>
										<div class="muted">
											{m.requests_deletion_requested_by({ name: row.requesterName })} ·
											{new Date(row.requestedAt).toLocaleDateString()}
										</div>
									</td>
									<td>
										{#if row.ownChild}
											<p class="muted" style="text-align:right; margin:0;">
												{m.requests_deletion_own_child()}
											</p>
										{:else}
											<div class="actions" style="justify-content:flex-end;">
												<ix-button
													variant="danger-primary"
													loading={pending.is(`approveDeletion:${row.id}`) || undefined}
													disabled={pending.busy || undefined}
													onclick={() => approveDeletion(row)}
												>
													{m.requests_approve()}
												</ix-button>
												<form
													method="POST"
													action="?/rejectDeletion"
													use:enhance={pending.submit(`rejectDeletion:${row.id}`)}
												>
													<input type="hidden" name="requestId" value={row.id} />
													<input type="hidden" name="studentName" value={row.studentName ?? ''} />
													<ix-button
														type="submit"
														variant="secondary"
														loading={pending.is(`rejectDeletion:${row.id}`) || undefined}
														disabled={pending.busy || undefined}>{m.requests_reject()}</ix-button
													>
												</form>
											</div>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			<form
				bind:this={approveDeletionForm}
				method="POST"
				action="?/approveDeletion"
				use:enhance={pending.submit(() => `approveDeletion:${deletionTarget.id}`)}
				hidden
			>
				<input type="hidden" name="requestId" value={deletionTarget.id} />
				<input type="hidden" name="studentName" value={deletionTarget.name} />
			</form>
		</section>

		<section class="card">
			<h2>{m.requests_deletion_decided_heading()}</h2>
			{#if data.deletionDecided.length === 0}
				<p class="muted">{m.requests_deletion_decided_empty()}</p>
			{:else}
				<div class="table-wrap">
					<table>
						<tbody>
							{#each data.deletionDecided as row (row.id)}
								<tr>
									<td style="width:1%; white-space:nowrap;">
										{#if row.status === 'approved'}
											<ix-pill variant="success">{m.requests_status_approved()}</ix-pill>
										{:else}
											<ix-pill variant="neutral">{m.requests_status_rejected()}</ix-pill>
										{/if}
									</td>
									<td class:muted={row.status === 'rejected'}>
										{row.studentName ?? m.requests_deletion_deleted_student()}
										<div class="muted">
											{m.requests_deletion_requested_by({ name: row.requesterName })} ·
											{new Date(row.requestedAt).toLocaleDateString()}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
		<section class="card" aria-labelledby="parents-heading">
			<h2 id="parents-heading">{m.requests_parents_heading()}</h2>
			<p class="muted">{m.requests_parents_subtitle()}</p>
			{#if data.parentsPending.length === 0}
				<p class="muted">{m.requests_parents_empty()}</p>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>{m.requests_col_parent()}</th>
								<th><span class="sr-only">{m.requests_approve()}</span></th>
							</tr>
						</thead>
						<tbody>
							{#each data.parentsPending as parent (parent.id)}
								<tr>
									<td>
										<div class="actions">
											<strong>{parent.name}</strong>
											{#if parent.emailConfirmedAt}
												<ix-pill variant="success">{m.requests_email_confirmed()}</ix-pill>
											{:else}
												<ix-pill variant="warning">{m.requests_email_unconfirmed()}</ix-pill>
											{/if}
										</div>
										<div class="muted">
											{parent.email} · {new Date(parent.createdAt).toLocaleDateString()}
										</div>
									</td>
									<td>
										<div class="actions" style="justify-content:flex-end;">
											<form
												method="POST"
												action="?/approveParent"
												use:enhance={pending.submit(`approveParent:${parent.id}`)}
											>
												<input type="hidden" name="parentId" value={parent.id} />
												<input type="hidden" name="parentName" value={parent.name} />
												<ix-button
													type="submit"
													loading={pending.is(`approveParent:${parent.id}`) || undefined}
													disabled={!parent.emailConfirmedAt || pending.busy || undefined}
												>
													{m.requests_approve()}
												</ix-button>
											</form>
											<form
												method="POST"
												action="?/rejectParent"
												use:enhance={pending.submit(`rejectParent:${parent.id}`)}
											>
												<input type="hidden" name="parentId" value={parent.id} />
												<input type="hidden" name="parentName" value={parent.name} />
												<ix-button
													type="submit"
													variant="danger-secondary"
													loading={pending.is(`rejectParent:${parent.id}`) || undefined}
													disabled={pending.busy || undefined}>{m.requests_reject()}</ix-button
												>
											</form>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="card">
			<h2>{m.requests_parents_decided_heading()}</h2>
			{#if data.parentsDecided.length === 0}
				<p class="muted">{m.requests_parents_decided_empty()}</p>
			{:else}
				<div class="table-wrap">
					<table>
						<tbody>
							{#each data.parentsDecided as parent (parent.id)}
								<tr>
									<td style="width:1%; white-space:nowrap;">
										{#if parent.status === 'approved'}
											<ix-pill variant="success">{m.requests_status_approved()}</ix-pill>
										{:else}
											<ix-pill variant="neutral">{m.requests_status_rejected()}</ix-pill>
										{/if}
									</td>
									<td class:muted={parent.status === 'rejected'}>
										{parent.name}
										<div class="muted">{parent.email}</div>
									</td>
									<td style="text-align:right;">
										{#if parent.status === 'rejected'}
											<!-- Its account delete failed earlier: retry it. -->
											<form
												method="POST"
												action="?/rejectParent"
												use:enhance={pending.submit(`rejectParent:${parent.id}`)}
											>
												<input type="hidden" name="parentId" value={parent.id} />
												<input type="hidden" name="parentName" value={parent.name} />
												<ix-button
													type="submit"
													variant="tertiary"
													icon="trashcan"
													loading={pending.is(`rejectParent:${parent.id}`) || undefined}
													disabled={pending.busy || undefined}
												>
													{m.requests_clear_rejected()}
												</ix-button>
											</form>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}
</div>
