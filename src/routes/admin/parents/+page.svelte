<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Unlink from '@lucide/svelte/icons/unlink';
	import Users from '@lucide/svelte/icons/users';
	import { enhance } from '$app/forms';
	import { formatInstant, num } from '$lib/format';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/toast';
	import { createConfirm } from '$lib/confirm.svelte';
	import { createPending } from '$lib/pending.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * Every parent account, its status and children.
	 * Mobile-first story 9: stacked cards below 80em, a full table from 80em
	 * (the Requests pattern); in a card, the children carry their column's
	 * name as a label.
	 * spec-second-parent story 4 (CAP-4): each child shows who invited the
	 * parent (or that they registered the child), the link date and the
	 * co-parent; a child with two parents, not the admin's own, offers Remove
	 * for this parent's link, after a confirmation naming both.
	 * spec-parent-message-board story 2 (CAP-4): an approved parent's status
	 * cell shows whether they can post on the board, with one button that
	 * turns it on or off (no confirmation: it is easy to reverse).
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();
	const confirm = createConfirm();

	// Errors toast app-wide (+layout.svelte); the success toast is this page's.
	$effect(() => {
		const result = form;
		if (!result) return;
		untrack(() => {
			if ('linkRemoved' in result && result.linkRemoved)
				showToast('success', m.parents_link_removed_success());
			if ('boardPosting' in result && result.boardPosting) {
				const { parentId, on } = result.boardPosting;
				const name = data.parents.find((p) => p.id === parentId)?.name ?? '';
				showToast(
					'success',
					on
						? m.parents_board_on_success({ parent: name })
						: m.parents_board_off_success({ parent: name })
				);
			}
		});
	});

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	function childMarker(status: 'pending' | 'approved' | 'rejected' | null) {
		if (status === 'pending') return m.parents_child_pending();
		if (status === 'rejected') return m.parents_child_rejected();
		return '';
	}

	// One markup for both layouts: stacked cards below 80em, a table from 80em
	// (copied from /requests).
	const table = 'block w-full min-w-0 xl:table xl:border-collapse';
	const thead = 'hidden xl:table-header-group';
	const th =
		'border-b border-border px-3 py-2 text-left align-bottom text-sm font-medium text-muted-foreground';
	const tbody = 'flex min-w-0 flex-col gap-3 xl:table-row-group';
	const tr =
		'flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4 xl:table-row xl:rounded-none xl:border-0 xl:border-b xl:p-0';
	const td = 'block min-w-0 wrap-break-word xl:table-cell xl:px-3 xl:py-3 xl:align-middle';
	const cardLabel = `${ui.label} mb-1 xl:hidden`;
	/** A long email breaks anywhere (`wrap-break-word` would win over it and widen the column). */
	const tdEmail = 'block min-w-0 wrap-anywhere xl:table-cell xl:px-3 xl:py-3 xl:align-middle';
</script>

<svelte:head>
	<title>{m.parents_heading()} — Sherab Admin</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.parents_section_label()}</p>
			<h1 class={ui.heading}>{m.parents_heading()}</h1>
		</div>
		{#if !data.loadError}
			<Badge variant="secondary" class="min-h-7 px-3 text-sm" data-testid="page-counter">
				{num(data.parents.length)}
			</Badge>
		{/if}
	</header>

	{#if data.loadError}
		<p
			class="rounded-lg border border-destructive bg-destructive/10 p-4 wrap-break-word text-destructive"
			role="alert"
			data-testid="parents-load-error"
		>
			{m.parents_load_error()}
		</p>
	{:else}
		{#if data.pendingCount > 0}
			<p class="wrap-break-word">
				<a href={resolve('/requests')} class="{ui.link} inline-flex min-h-11 items-center">
					{m.parents_pending_link({ count: num(data.pendingCount) })}
				</a>
			</p>
		{/if}

		<section class={ui.card} data-testid="parents-list">
			{#if data.parents.length === 0}
				<EmptyState
					header={m.parents_empty_heading()}
					subHeader={m.parents_empty_body()}
					icon={Users}
				/>
			{:else}
				<!-- WebKit drops table semantics from a restyled table (cards below 80em): the roles keep them. -->
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<table role="table" class={table}>
					<thead role="rowgroup" class={thead}>
						<tr role="row">
							<th role="columnheader" class={th}>{m.parents_col_name()}</th>
							<th role="columnheader" class={th}>{m.parents_col_email()}</th>
							<th role="columnheader" class={th}>{m.parents_col_status()}</th>
							<th role="columnheader" class={th}>{m.parents_col_children()}</th>
						</tr>
					</thead>
					<tbody role="rowgroup" class={tbody}>
						{#each data.parents as parent (parent.id)}
							<tr role="row" class={tr} data-testid="parent-row">
								<td role="cell" class="{td} font-semibold xl:font-normal">{parent.name}</td>
								<td role="cell" class="{tdEmail} {ui.muted}">{parent.email}</td>
								<td role="cell" class={td}>
									<div class="flex min-w-0 flex-wrap gap-2">
										{#if parent.status === 'approved'}
											<Badge variant="success">{m.parents_status_approved()}</Badge>
										{:else if parent.status === 'rejected'}
											<Badge variant="secondary">{m.parents_status_rejected()}</Badge>
										{:else}
											<Badge variant="warning">{m.parents_status_pending()}</Badge>
										{/if}
										{#if !parent.emailConfirmedAt}
											<Badge variant="warning">{m.requests_email_unconfirmed()}</Badge>
										{/if}
									</div>
									{#if parent.status === 'approved'}
										{@const boardKey = `setBoardPosting:${parent.id}`}
										<div
											class="mt-2 flex min-w-0 flex-col items-start gap-2"
											data-testid="board-posting"
											data-on={parent.canPostBoard}
										>
											<Badge variant={parent.canPostBoard ? 'success' : 'secondary'}>
												{parent.canPostBoard
													? m.parents_board_can_post()
													: m.parents_board_cannot_post()}
											</Badge>
											<form
												method="POST"
												action="?/setBoardPosting"
												use:enhance={pending.submit(boardKey)}
											>
												<input type="hidden" name="parentId" value={parent.id} />
												<input
													type="hidden"
													name="on"
													value={parent.canPostBoard ? 'false' : 'true'}
												/>
												<Button
													type="submit"
													variant={parent.canPostBoard ? 'outline' : 'default'}
													class="{ui.touch} gap-2"
													aria-label={parent.canPostBoard
														? m.parents_board_stop_label({ parent: parent.name })
														: m.parents_board_allow_label({ parent: parent.name })}
													aria-busy={pending.is(boardKey) || undefined}
													disabled={pending.busy}
													data-testid="board-posting-toggle"
												>
													{#if pending.is(boardKey)}
														<LoaderCircle class="animate-spin" aria-hidden="true" />
													{/if}
													{parent.canPostBoard ? m.parents_board_stop() : m.parents_board_allow()}
												</Button>
											</form>
										</div>
									{/if}
								</td>
								<td role="cell" class={td}>
									<p class={cardLabel}>{m.parents_col_children()}</p>
									{#if parent.children.length === 0}
										<span class={ui.muted}>—</span>
									{:else}
										<ul class="flex min-w-0 flex-col gap-3">
											{#each parent.children as child (child.id)}
												{@const marker = childMarker(child.status)}
												{@const key = `removeParentLink:${parent.id}:${child.id}`}
												<li class="flex min-w-0 flex-col gap-1" data-testid="parent-child">
													<p class="wrap-break-word">
														<span class="font-medium">{child.name}</span>{#if marker}<span
																class={ui.muted}>{` ${marker}`}</span
															>{/if}
													</p>
													<p
														class="text-sm wrap-break-word {ui.muted}"
														data-testid="parent-child-link"
													>
														{child.invitedBy === null
															? m.parents_link_registered()
															: m.parents_link_invited_by({ name: child.invitedBy })}
														<span aria-hidden="true">·</span>
														{m.parents_link_since({ date: formatInstant(child.linkedAt) })}
													</p>
													{#if child.coParent !== null}
														<p
															class="text-sm wrap-anywhere {ui.muted}"
															data-testid="parent-child-co-parent"
														>
															{m.parents_link_co_parent({ name: child.coParent })}
														</p>
													{/if}
													{#if child.canRemove}
														<form
															method="POST"
															action="?/removeParentLink"
															class="mt-1"
															use:enhance={pending.submit(key, {
																confirm: () =>
																	confirm.ask(
																		m.parents_link_remove_confirm({
																			parent: parent.name,
																			child: child.name
																		}),
																		m.parents_link_remove(),
																		{ destructive: true }
																	)
															})}
														>
															<input type="hidden" name="studentId" value={child.id} />
															<input type="hidden" name="parentId" value={parent.id} />
															<Button
																type="submit"
																variant="outline"
																class="{ui.touch} gap-2"
																aria-label={m.parents_link_remove_label({
																	parent: parent.name,
																	child: child.name
																})}
																aria-busy={pending.is(key) || undefined}
																disabled={pending.busy}
																data-testid="remove-parent-link"
															>
																{#if pending.is(key)}
																	<LoaderCircle class="animate-spin" aria-hidden="true" />
																{:else}
																	<Unlink aria-hidden="true" />
																{/if}
																{m.parents_link_remove()}
															</Button>
														</form>
													{/if}
												</li>
											{/each}
										</ul>
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

<ConfirmDialog {confirm} />
