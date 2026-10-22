<script lang="ts">
	import { onMount } from 'svelte';
	import Users from '@lucide/svelte/icons/users';
	import { num } from '$lib/format';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * Every parent account, its status and children (read-only).
	 * Mobile-first story 9: stacked cards below 80em, a full table from 80em
	 * (the Requests pattern); in a card, the children carry their column's
	 * name as a label.
	 */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	// An expression, not literal text, so Svelte keeps the space: "Anna, Pema".
	const SEPARATOR = ', ';

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
								</td>
								<td role="cell" class={td}>
									<p class={cardLabel}>{m.parents_col_children()}</p>
									{#if parent.children.length === 0}
										<span class={ui.muted}>—</span>
									{:else}
										{#each parent.children as child, i (child.id)}
											{@const marker = childMarker(child.status)}
											{#if i > 0}{SEPARATOR}{/if}<span>{child.name}</span>{#if marker}<span
													class={ui.muted}>{` ${marker}`}</span
												>{/if}
										{/each}
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
