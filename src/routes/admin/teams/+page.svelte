<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { formatInstant, num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { confirmAction, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import LocalizedNameFields from '$lib/components/LocalizedNameFields.svelte';
	import { otherNames } from '$lib/localized-name';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	type TeamRow = (typeof data.teams)[number];

	const pending = createPending();

	// Changes on each successful create, remounting the create form (see
	// {#key}): <ix-input> doesn't take part in form reset.
	let createKey = $state<unknown>(null);
	// #76: the team whose names are being edited (one row at a time).
	let editingId = $state<string | null>(null);

	$effect(() => {
		if (form && 'team' in form && form.team) {
			showToast('success', m.teams_created_success({ name: form.team.name }));
			createKey = form;
		}
		if (form && 'deleted' in form && form.deleted)
			showToast('success', m.teams_deleted_success({ name: form.deleted }));
		if (form && 'renamed' in form && form.renamed) {
			editingId = null;
			showToast('success', m.names_saved({ name: form.renamed }));
		}
	});

	// A failed create keeps what was typed.
	let createdNames = $derived(
		form && 'name' in form && !form.success
			? { name: form.name, nameBo: form.nameBo, nameDe: form.nameDe }
			: { name: '', nameBo: '', nameDe: '' }
	);

	// A failed save keeps what was typed; otherwise the team's current names.
	function editValues(team: TeamRow) {
		if (form && 'renameValues' in form && form.renameValues && form.renameId === team.id) {
			return form.renameValues;
		}
		return { name: team.name, nameBo: team.name_bo, nameDe: team.name_de };
	}

	let deleteForm: HTMLFormElement | undefined = $state();
	let deleteTarget = $state({ id: '', name: '' });

	async function deleteTeam(team: TeamRow) {
		const ok = await confirmAction(
			m.common_confirm_title(),
			m.teams_delete_confirm({ name: team.label }),
			m.common_delete(),
			m.common_cancel()
		);
		if (!ok) return;
		deleteTarget = { id: team.id, name: team.label };
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
		<span class="page-counter">{num(data.teams.length)}</span>
	</header>

	<section class="card">
		<h2>{m.teams_create_heading()}</h2>
		{#key createKey}
			<form method="POST" action="?/create" use:enhance={pending.submit('create')} novalidate>
				<LocalizedNameFields label={m.teams_name_label()} values={createdNames} />
				<ix-button
					type="submit"
					icon="add"
					loading={pending.is('create') || undefined}
					disabled={pending.busy || undefined}>{m.teams_create_submit()}</ix-button
				>
			</form>
		{/key}
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
								<td>
									{team.label}
									{#each otherNames(team) as other (other.lang)}
										<span class="muted other-name" lang={other.lang}>{other.name}</span>
									{/each}
								</td>
								<td>{num(team.memberCount)}</td>
								<td class="muted">{formatInstant(team.created_at)}</td>
								<td>
									<div class="actions" style="justify-content:flex-end;">
										<ix-button
											variant="tertiary"
											icon="pen"
											disabled={pending.busy || undefined}
											onclick={() => (editingId = editingId === team.id ? null : team.id)}
										>
											{m.names_edit()}
										</ix-button>
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
									</div>
								</td>
							</tr>
							{#if editingId === team.id}
								<tr>
									<td colspan="4">
										<form
											method="POST"
											action="?/rename"
											use:enhance={pending.submit(`rename:${team.id}`)}
											novalidate
										>
											<input type="hidden" name="teamId" value={team.id} />
											<fieldset>
												<legend>{m.names_edit_title({ name: team.label })}</legend>
												<LocalizedNameFields
													label={m.teams_name_label()}
													idPrefix="edit-{team.id}-"
													values={editValues(team)}
												/>
											</fieldset>
											<div class="actions">
												<ix-button
													type="submit"
													loading={pending.is(`rename:${team.id}`) || undefined}
													disabled={pending.busy || undefined}>{m.names_save()}</ix-button
												>
												<ix-button
													variant="secondary"
													disabled={pending.busy || undefined}
													onclick={() => (editingId = null)}
												>
													{m.common_cancel()}
												</ix-button>
											</div>
										</form>
									</td>
								</tr>
							{/if}
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

<style>
	.other-name {
		display: block;
		font-size: var(--theme-font-size-default);
	}
</style>
