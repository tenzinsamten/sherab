<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	let outcomeMessage = $derived.by(() => {
		if (!form?.success) return null;
		const name = form.studentName || '';
		if (form.action === 'approved') {
			return m.requests_outcome_approved({ name, username: form.username, pin: form.pin });
		}
		if (form.action === 'rejected') {
			return m.requests_outcome_rejected({ name });
		}
		if (form.action === 'cleared') {
			return m.requests_outcome_cleared({ name });
		}
		return null;
	});
</script>

<svelte:head>
	<title>{m.requests_heading()} — Sherab</title>
</svelte:head>

<p class="page-kicker">
	{data.role === 'admin' ? m.requests_kicker_admin() : m.requests_kicker_teacher()}
</p>
<div class="page-header">
	<h1 class="page-heading">{m.requests_heading()}</h1>
	<span class="page-counter">{String(data.pending.length).padStart(2, '0')}</span>
</div>
<hr class="page-hr" />
<p style="color: var(--color-muted-foreground); max-width: 56ch; margin-top: var(--space-4);">
	{data.role === 'admin' ? m.requests_admin_subtitle() : m.requests_teacher_subtitle()}
</p>

{#if data.loadError}
	<p class="banner-error" role="alert">{m.load_error_generic()}</p>
{/if}
{#if form?.error}
	<p class="banner-error" role="alert">{form.error}</p>
{/if}
{#if outcomeMessage}
	<p class="banner-success" role="status" aria-live="polite">{outcomeMessage}</p>
{/if}

{#if data.pending.length === 0}
	<div
		style="margin-top: var(--space-6); padding: var(--space-6); border: 2px solid var(--color-border);"
	>
		<p style="margin:0; font-weight:700; font-size: var(--text-lg);">
			{m.requests_empty_heading()}
		</p>
		<p style="margin: var(--space-1) 0 0 0; color: var(--color-muted-foreground);">
			{m.requests_empty_body()}
		</p>
	</div>
{:else}
	<div
		class="grid-table-header"
		style="grid-template-columns: minmax(0,1fr) auto; margin-top: var(--space-6);"
	>
		<span>{m.requests_col_student()}</span>
		<span></span>
	</div>
	{#each data.pending as student (student.id)}
		<div class="grid-table-row" style="grid-template-columns: minmax(0,1fr) auto;">
			<div>
				<p
					style="margin:0; font-weight:700; font-size: var(--text-lg); display:flex; align-items:center; gap: var(--space-2);"
				>
					{student.registrationName}
					{#if !student.emailConfirmedAt}
						<span class="tag">{m.requests_unverified_badge()}</span>
					{/if}
				</p>
				<p style="margin:0; color: var(--color-muted-foreground); font-size: var(--text-sm);">
					{#if student.class}
						<code>{student.class.code}</code> · {student.class.name} ·
					{/if}
					{new Date(student.createdAt).toLocaleDateString()}
				</p>
			</div>

			<div style="display:flex; flex-wrap:wrap; align-items:center; gap: var(--space-2);">
				<form
					method="POST"
					action="?/approve"
					use:enhance
					style="display:flex; align-items:center; gap: var(--space-2);"
				>
					<input type="hidden" name="studentId" value={student.id} />
					<input type="hidden" name="studentName" value={student.registrationName} />
					<label style="display:flex; flex-direction:column; gap:2px;">
						<span class="section-label" style="margin:0;">{m.requests_team_label()}</span>
						<select name="teamId" required disabled={data.teams.length === 0}>
							<option value="" disabled selected>{m.requests_team_placeholder()}</option>
							{#each data.teams as team (team.id)}
								<option value={team.id}>{team.name}</option>
							{/each}
						</select>
					</label>
					<button
						class="btn"
						type="submit"
						disabled={data.teams.length === 0 || !student.emailConfirmedAt}
					>
						{m.requests_approve()}
					</button>
				</form>

				<form method="POST" action="?/reject" use:enhance>
					<input type="hidden" name="studentId" value={student.id} />
					<input type="hidden" name="studentName" value={student.registrationName} />
					<button class="btn btn-outline" type="submit">{m.requests_reject()}</button>
				</form>
			</div>
		</div>
	{/each}
	{#if data.teams.length === 0}
		<p class="field-error" style="margin-top: var(--space-3);">{m.requests_no_teams_note()}</p>
	{/if}
{/if}

<div
	style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap: var(--space-3); margin-top: var(--space-8); padding: var(--space-3); background: var(--color-primary-tint); border-top: 2px solid var(--color-foreground);"
>
	<span class="section-label" style="margin:0;">
		{m.requests_decided_heading({
			approved: data.decided.filter((s) => s.status === 'approved').length,
			rejected: data.decided.filter((s) => s.status === 'rejected').length
		})}
	</span>
</div>

{#if data.decided.length === 0}
	<p style="color: var(--color-muted-foreground); margin-top: var(--space-3);">
		{m.requests_decided_empty()}
	</p>
{:else}
	{#each data.decided as student (student.id)}
		<div class="grid-table-row" style="grid-template-columns: auto minmax(0,1fr) auto;">
			{#if student.status === 'approved'}
				<span class="tag tag-primary">{m.requests_status_approved()}</span>
			{:else}
				<span class="tag">{m.requests_status_rejected()}</span>
			{/if}
			<span
				style="font-weight:600; color: {student.status === 'rejected'
					? 'var(--color-muted-foreground)'
					: 'inherit'};"
			>
				{student.registrationName}
			</span>
			{#if student.status === 'rejected'}
				<form method="POST" action="?/clearRejected" use:enhance>
					<input type="hidden" name="studentId" value={student.id} />
					<input type="hidden" name="studentName" value={student.registrationName} />
					<button class="btn btn-outline" type="submit">{m.requests_clear_rejected()}</button>
				</form>
			{:else}
				<span></span>
			{/if}
		</div>
	{/each}
{/if}
