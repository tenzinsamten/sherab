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

<p class="section-label">{m.requests_section_label()}</p>
<h1>{m.requests_heading()}</h1>
<p style="color: var(--color-muted-foreground);">
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

<div class="card" style="margin-bottom: var(--space-6);">
	<h2 style="margin-top:0; font-size: var(--text-lg);">{m.requests_pending_heading()}</h2>

	{#if data.pending.length === 0}
		<div style="border: var(--border-clay-quiet); padding: var(--space-4);">
			<p style="margin:0; font-weight:700;">{m.requests_empty_heading()}</p>
			<p style="margin: var(--space-1) 0 0 0; color: var(--color-muted-foreground);">
				{m.requests_empty_body()}
			</p>
		</div>
	{:else}
		<ul style="list-style:none; padding:0; margin:0;">
			{#each data.pending as student (student.id)}
				<li
					style="border-bottom: 1px solid var(--color-border); padding: var(--space-3) 0; display:flex; flex-wrap:wrap; align-items:center; gap: var(--space-3);"
				>
					<div style="flex: 1 1 220px;">
						<p style="margin:0; font-weight:700;">{student.registrationName}</p>
						<p style="margin:0; color: var(--color-muted-foreground); font-size: var(--text-sm);">
							{#if student.class}
								<code>{student.class.code}</code> · {student.class.name} ·
							{/if}
							{new Date(student.createdAt).toLocaleDateString()}
						</p>
					</div>

					<form
						method="POST"
						action="?/approve"
						use:enhance
						style="display:flex; align-items:center; gap: var(--space-2);"
					>
						<input type="hidden" name="studentId" value={student.id} />
						<input type="hidden" name="studentName" value={student.registrationName} />
						<label style="display:flex; flex-direction:column; gap:2px;">
							<span
								style="font-size: 0.6875rem; letter-spacing:0.06em; text-transform:uppercase; color: var(--color-muted-foreground);"
								>{m.requests_team_label()}</span
							>
							<select name="teamId" required disabled={data.teams.length === 0}>
								<option value="" disabled selected>{m.requests_team_placeholder()}</option>
								{#each data.teams as team (team.id)}
									<option value={team.id}>{team.name}</option>
								{/each}
							</select>
						</label>
						<button class="btn" type="submit" disabled={data.teams.length === 0}>
							{m.requests_approve()}
						</button>
					</form>

					<form method="POST" action="?/reject" use:enhance>
						<input type="hidden" name="studentId" value={student.id} />
						<input type="hidden" name="studentName" value={student.registrationName} />
						<button class="btn btn-outline" type="submit">{m.requests_reject()}</button>
					</form>
				</li>
			{/each}
		</ul>
		{#if data.teams.length === 0}
			<p class="field-error" style="margin-top: var(--space-3);">{m.requests_no_teams_note()}</p>
		{/if}
	{/if}
</div>

<div class="card">
	<h2 style="margin-top:0; font-size: var(--text-lg);">
		{m.requests_decided_heading({
			approved: data.decided.filter((s) => s.status === 'approved').length,
			rejected: data.decided.filter((s) => s.status === 'rejected').length
		})}
	</h2>

	{#if data.decided.length === 0}
		<p style="color: var(--color-muted-foreground);">{m.requests_decided_empty()}</p>
	{:else}
		<ul style="list-style:none; padding:0; margin:0;">
			{#each data.decided as student (student.id)}
				<li
					style="border-bottom: 1px solid var(--color-border); padding: var(--space-3) 0; display:flex; flex-wrap:wrap; align-items:center; gap: var(--space-3);"
				>
					<div style="flex: 1 1 220px;">
						<p
							style="margin:0; font-weight:700; color: {student.status === 'rejected'
								? 'var(--color-muted-foreground)'
								: 'inherit'};"
						>
							{student.registrationName}
						</p>
						<p style="margin:0; color: var(--color-muted-foreground); font-size: var(--text-sm);">
							{#if student.class}
								<code>{student.class.code}</code> · {student.class.name} ·
							{/if}
							{student.reviewedAt ? new Date(student.reviewedAt).toLocaleDateString() : ''}
						</p>
					</div>

					{#if student.status === 'approved'}
						<span
							style="background: var(--color-primary); color: var(--color-on-primary); font-weight:700; text-transform:uppercase; letter-spacing:0.04em; font-size: var(--text-sm); padding: var(--space-1) var(--space-3);"
						>
							{m.requests_status_approved()}
						</span>
					{:else}
						<span
							style="background: var(--color-muted); color: var(--color-muted-foreground); font-weight:700; text-transform:uppercase; letter-spacing:0.04em; font-size: var(--text-sm); padding: var(--space-1) var(--space-3);"
						>
							{m.requests_status_rejected()}
						</span>
						<form method="POST" action="?/clearRejected" use:enhance>
							<input type="hidden" name="studentId" value={student.id} />
							<input type="hidden" name="studentName" value={student.registrationName} />
							<button class="btn btn-outline" type="submit">{m.requests_clear_rejected()}</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
