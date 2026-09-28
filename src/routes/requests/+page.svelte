<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { confirmAction, showToast } from '$lib/ix';
	import CredentialFields from '$lib/components/CredentialFields.svelte';
	import { createPending } from '$lib/pending.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

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
		<span class="page-counter"
			>{data.pending.length +
				data.parentsPending.length +
				sickActionable +
				deletionActionable}</span
		>
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
									<div class="muted">
										{#if student.class}
											<code>{student.class.code}</code> · {student.class.name} ·
										{/if}
										{new Date(student.createdAt).toLocaleDateString()}
									</div>
								</td>
								<td>
									<div class="actions" style="justify-content:flex-end; align-items:flex-end;">
										<form
											method="POST"
											action="?/approve"
											use:enhance={pending.submit(`approve:${student.id}`)}
											class="actions"
											style="align-items:flex-end;"
										>
											<input type="hidden" name="studentId" value={student.id} />
											<input type="hidden" name="studentName" value={student.registrationName} />
											<div class="field" style="margin:0;">
												<label for="team-{student.id}">{m.requests_team_label()}</label>
												<select
													id="team-{student.id}"
													name="teamId"
													required
													disabled={data.teams.length === 0}
												>
													<option value="" disabled selected>{m.requests_team_placeholder()}</option
													>
													{#each data.teams as team (team.id)}
														<option value={team.id}>{team.name}</option>
													{/each}
												</select>
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
