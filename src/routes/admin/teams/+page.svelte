<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { confirmAction, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

	$effect(() => {
		if (form && 'team' in form && form.team)
			showToast('success', m.teams_created_success({ name: form.team.name }));
		if (form && 'deleted' in form && form.deleted)
			showToast('success', m.teams_deleted_success({ name: form.deleted }));
	});

	let deleteForm: HTMLFormElement | undefined = $state();
	let deleteTarget = $state({ id: '', name: '' });

	async function deleteTeam(team: { id: string; name: string }) {
		const ok = await confirmAction(
			m.common_confirm_title(),
			m.teams_delete_confirm({ name: team.name }),
			m.common_delete(),
			m.common_cancel()
		);
		if (!ok) return;
		deleteTarget = { id: team.id, name: team.name };
		await tick();
		deleteForm?.requestSubmit();
	}
</script>

<svelte:head>
	<title>{m.teams_heading()} — Sherab Admin</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.teams_section_label()}</p>
			<h1 class="page-heading">{m.teams_heading()}</h1>
		</div>
		<span class="page-counter">{data.teams.length}</span>
	</header>

	<section class="card">
		<h2>{m.teams_create_heading()}</h2>
		<form
			method="POST"
			action="?/create"
			use:enhance={pending.submit('create')}
			class="actions"
			style="align-items:flex-end;"
		>
			<div class="field" style="flex:1; min-width:14rem; margin:0;">
				<label for="name">{m.teams_name_label()}</label>
				<input
					id="name"
					name="name"
					type="text"
					required
					value={form?.success ? '' : (form && 'name' in form && form.name) || ''}
				/>
			</div>
			<ix-button
				type="submit"
				icon="add"
				loading={pending.is('create') || undefined}
				disabled={pending.busy || undefined}>{m.teams_create_submit()}</ix-button
			>
		</form>
	</section>

	<section class="card">
		<h2>{m.teams_all_heading()}</h2>
		{#if data.teams.length === 0}
			<p class="muted">{m.teams_empty()}</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>{m.teams_col_name()}</th>
							<th>{m.teams_col_members()}</th>
							<th>{m.teams_col_created()}</th>
							<th><span class="sr-only">{m.teams_col_actions()}</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.teams as team (team.id)}
							<tr>
								<td>{team.name}</td>
								<td>{team.memberCount}</td>
								<td class="muted">{new Date(team.created_at).toLocaleDateString()}</td>
								<td style="text-align:right;">
									{#if team.memberCount === 0}
										<ix-button
											variant="danger-tertiary"
											icon="trashcan"
											loading={pending.is(`delete:${team.id}`) || undefined}
											disabled={pending.busy || undefined}
											onclick={() => deleteTeam(team)}
										>
											{m.teams_delete()}
										</ix-button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<form
		bind:this={deleteForm}
		method="POST"
		action="?/delete"
		use:enhance={pending.submit(() => `delete:${deleteTarget.id}`)}
		hidden
	>
		<input type="hidden" name="teamId" value={deleteTarget.id} />
		<input type="hidden" name="teamName" value={deleteTarget.name} />
	</form>
</div>
