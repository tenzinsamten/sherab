<script lang="ts">
	import { onMount } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { formatInstant, num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import { createConfirm } from '$lib/confirm.svelte';
	import { createPending } from '$lib/pending.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import LocalizedNameFields from '$lib/components/LocalizedNameFields.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { otherNames } from '$lib/localized-name';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * The admin's teams: create one, and per team edit its names inline
	 * (#76), open its students (#97) and delete it while it has no members.
	 * Mobile-first story 9: the same card/table pattern as /admin/classes.
	 * The name fields are native, so a successful create clears them with
	 * the form reset (no remount).
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	type TeamRow = (typeof data.teams)[number];

	const pending = createPending();
	const confirm = createConfirm();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	// #76: the team whose names are being edited (one row at a time).
	let editingId = $state<string | null>(null);

	$effect(() => {
		if (form && 'team' in form && form.team) {
			showToast('success', m.teams_created_success({ name: form.team.name }));
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

	// One markup for both layouts: stacked cards below 80em, a table from 80em
	// (copied from /requests).
	const table = 'block w-full min-w-0 xl:table xl:border-collapse';
	const thead = 'hidden xl:table-header-group';
	const th =
		'border-b border-border px-3 py-2 text-left align-bottom text-sm font-medium text-muted-foreground';
	const tbody = 'flex min-w-0 flex-col gap-3 xl:table-row-group';
	const tr =
		'flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4 xl:table-row xl:rounded-none xl:border-0 xl:border-b xl:p-0';
	const td = 'block min-w-0 wrap-break-word xl:table-cell xl:px-3 xl:py-3 xl:align-middle';
	const tdActions = `${td} xl:w-px xl:text-right`;
	const actions = 'flex min-w-0 flex-wrap gap-2 xl:flex-nowrap xl:justify-end';
	/** A form or button holding one row action: full width in a card, its own width in the table. */
	const actionItem = 'min-w-0 flex-1 basis-32 xl:flex-none xl:basis-auto';
	const actionButton = `${ui.touch} w-full gap-2 xl:w-auto`;
	/** A value's column name, shown in a card only (the table has its header). */
	const cardLabel = `${ui.label} mb-1 xl:hidden`;
	const formButton = `${ui.touch} gap-2`;
</script>

<svelte:head>
	<title>{m.teams_heading()} — Sherab Admin</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.teams_section_label()}</p>
			<h1 class={ui.heading}>{m.teams_heading()}</h1>
		</div>
		<Badge variant="secondary" class="min-h-7 px-3 text-sm" data-testid="page-counter">
			{num(data.teams.length)}
		</Badge>
	</header>

	<section class="{ui.card} flex flex-col gap-4" data-testid="team-create">
		<h2 class={ui.cardTitle}>{m.teams_create_heading()}</h2>
		<form
			method="POST"
			action="?/create"
			class="flex min-w-0 flex-col gap-4"
			use:enhance={pending.submit('create')}
			novalidate
		>
			<LocalizedNameFields label={m.teams_name_label()} values={createdNames} />
			<div>
				<Button
					type="submit"
					class="{formButton} w-full sm:w-auto"
					aria-busy={pending.is('create') || undefined}
					disabled={pending.busy}
				>
					{#if pending.is('create')}
						<LoaderCircle class="animate-spin" aria-hidden="true" />
					{:else}
						<Plus aria-hidden="true" />
					{/if}
					{m.teams_create_submit()}
				</Button>
			</div>
		</form>
	</section>

	<section class="{ui.card} flex flex-col gap-3" data-testid="team-list">
		<h2 class={ui.cardTitle}>{m.teams_all_heading()}</h2>
		{#if data.teams.length === 0}
			<p class={ui.muted}>{m.teams_empty()}</p>
		{:else}
			<!-- WebKit drops table semantics from a restyled table (cards below 80em): the roles keep them. -->
			<!-- svelte-ignore a11y_no_redundant_roles -->
			<table role="table" class={table}>
				<thead role="rowgroup" class={thead}>
					<tr role="row">
						<th role="columnheader" class={th}>{m.teams_col_name()}</th>
						<th role="columnheader" class={th}>{m.teams_col_members()}</th>
						<th role="columnheader" class={th}>{m.teams_col_created()}</th>
						<th role="columnheader" class={th}
							><span class="sr-only">{m.teams_col_actions()}</span></th
						>
					</tr>
				</thead>
				<tbody role="rowgroup" class={tbody}>
					{#each data.teams as team (team.id)}
						<tr role="row" class={tr} data-testid="team-row" data-team-id={team.id}>
							<td role="cell" class={td}>
								<!-- #97: opens the team's students. The link's name stays the
								     team name (it is the cell's name too); what it opens is
								     its description. -->
								<a
									href={resolve('/teams/[teamId]', { teamId: team.id })}
									class="{ui.link} inline-flex min-h-11 min-w-11 items-center font-semibold xl:font-normal"
									title={m.team_students_link_label({ team: team.label })}>{team.label}</a
								>
								{#each otherNames(team) as other (other.lang)}
									<span class="block text-base {ui.muted}" lang={other.lang}>{other.name}</span>
								{/each}
							</td>
							<td role="cell" class={td}>
								<p class={cardLabel}>{m.teams_col_members()}</p>
								<span>{num(team.memberCount)}</span>
							</td>
							<td role="cell" class="{td} {ui.muted}">
								<p class={cardLabel}>{m.teams_col_created()}</p>
								<span>{formatInstant(team.created_at)}</span>
							</td>
							<td role="cell" class={tdActions}>
								<div class={actions}>
									<div class={actionItem}>
										<Button
											variant="outline"
											class={actionButton}
											aria-expanded={editingId === team.id}
											disabled={pending.busy}
											onclick={() => (editingId = editingId === team.id ? null : team.id)}
										>
											<Pencil aria-hidden="true" />
											{m.names_edit()}
										</Button>
									</div>
									{#if team.memberCount === 0}
										<form
											method="POST"
											action="?/delete"
											class={actionItem}
											use:enhance={pending.submit(`delete:${team.id}`, {
												// Asked at submit time (`use:enhance` keeps the options it
												// mounted with): the name as renamed in place.
												confirm: () =>
													confirm.ask(
														m.teams_delete_confirm({ name: team.label }),
														m.common_delete(),
														{
															destructive: true
														}
													)
											})}
										>
											<input type="hidden" name="teamId" value={team.id} />
											<input type="hidden" name="teamName" value={team.label} />
											<Button
												type="submit"
												variant="destructive"
												class={actionButton}
												aria-busy={pending.is(`delete:${team.id}`) || undefined}
												disabled={pending.busy}
											>
												{#if pending.is(`delete:${team.id}`)}
													<LoaderCircle class="animate-spin" aria-hidden="true" />
												{:else}
													<Trash2 aria-hidden="true" />
												{/if}
												{m.teams_delete()}
											</Button>
										</form>
									{/if}
								</div>
							</td>
						</tr>
						{#if editingId === team.id}
							<tr
								role="row"
								class="{tr} -mt-1 border-primary xl:border-primary"
								data-testid="team-edit-row"
							>
								<td role="cell" colspan="4" class="{td} xl:py-4">
									<form
										method="POST"
										action="?/rename"
										class="flex min-w-0 flex-col gap-4"
										use:enhance={pending.submit(`rename:${team.id}`)}
										novalidate
									>
										<input type="hidden" name="teamId" value={team.id} />
										<fieldset class="flex min-w-0 flex-col gap-4">
											<legend class="mb-3 font-bold wrap-break-word">
												{m.names_edit_title({ name: team.label })}
											</legend>
											<LocalizedNameFields
												label={m.teams_name_label()}
												idPrefix="edit-{team.id}-"
												values={editValues(team)}
											/>
										</fieldset>
										<div class="flex min-w-0 flex-wrap gap-2">
											<Button
												type="submit"
												class="{formButton} flex-1 sm:flex-none"
												aria-busy={pending.is(`rename:${team.id}`) || undefined}
												disabled={pending.busy}
											>
												{#if pending.is(`rename:${team.id}`)}
													<LoaderCircle class="animate-spin" aria-hidden="true" />
												{/if}
												{m.names_save()}
											</Button>
											<Button
												variant="outline"
												class="{formButton} flex-1 sm:flex-none"
												disabled={pending.busy}
												onclick={() => (editingId = null)}
											>
												{m.common_cancel()}
											</Button>
										</div>
									</form>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<ConfirmDialog {confirm} />
</div>
