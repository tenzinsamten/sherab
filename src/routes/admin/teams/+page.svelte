<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.teams_heading()} — Sherab Admin</title>
</svelte:head>

<p class="section-label">{m.teams_section_label()}</p>
<h1>{m.teams_heading()}</h1>

{#if data.loadError}
	<p class="banner-error" role="alert">{m.load_error_generic()}</p>
{/if}
{#if form?.error}
	<p class="banner-error" role="alert">{form.error}</p>
{/if}
{#if form?.team}
	<p class="banner-success" role="status">
		{m.teams_created_success({ name: form.team.name })}
	</p>
{/if}

<div class="card" style="margin-bottom: var(--space-6);">
	<h2 style="margin-top:0; font-size: var(--text-lg);">{m.teams_create_heading()}</h2>
	<form method="POST" action="?/create" use:enhance>
		<div class="field">
			<label for="name">{m.teams_name_label()}</label>
			<input id="name" name="name" type="text" required value={form?.name ?? ''} />
		</div>
		<button class="btn" type="submit">{m.teams_create_submit()}</button>
	</form>
</div>

<div class="card">
	<h2 style="margin-top:0; font-size: var(--text-lg);">{m.teams_all_heading()}</h2>
	{#if data.teams.length === 0}
		<p style="color: var(--color-muted-foreground);">{m.teams_empty()}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>{m.teams_col_name()}</th>
					<th>{m.teams_col_created()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.teams as team (team.id)}
					<tr>
						<td>{team.name}</td>
						<td>{new Date(team.created_at).toLocaleDateString()}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
