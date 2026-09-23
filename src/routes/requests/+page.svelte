<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	// Approval shows the student's one-time username/PIN, so it stays on
	// screen; rejected/cleared are short confirmations, so they're toasts.
	let credential = $derived(
		form?.success && form.action === 'approved'
			? m.requests_outcome_approved({
					name: form.studentName || '',
					username: form.username,
					pin: form.pin
				})
			: null
	);

	$effect(() => {
		if (!form?.success) return;
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
		<span class="page-counter">{data.pending.length}</span>
	</header>

	{#if credential}
		<ix-message-bar type="success" persistent style="display:block; margin-bottom: var(--space-4);">
			<span class="credential">{credential}</span>
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
										{#if !student.emailConfirmedAt}
											<ix-pill variant="warning">{m.requests_unverified_badge()}</ix-pill>
										{/if}
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
											use:enhance
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
												disabled={data.teams.length === 0 || !student.emailConfirmedAt || undefined}
											>
												{m.requests_approve()}
											</ix-button>
										</form>
										<form method="POST" action="?/reject" use:enhance>
											<input type="hidden" name="studentId" value={student.id} />
											<input type="hidden" name="studentName" value={student.registrationName} />
											<ix-button type="submit" variant="danger-secondary"
												>{m.requests_reject()}</ix-button
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
										<form method="POST" action="?/clearRejected" use:enhance>
											<input type="hidden" name="studentId" value={student.id} />
											<input type="hidden" name="studentName" value={student.registrationName} />
											<ix-button type="submit" variant="tertiary" icon="trashcan">
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
</div>
