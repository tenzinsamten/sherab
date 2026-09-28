<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// An expression, not literal text, so Svelte keeps the space: "Anna, Pema".
	const SEPARATOR = ', ';

	function childMarker(status: 'pending' | 'approved' | 'rejected' | null) {
		if (status === 'pending') return m.parents_child_pending();
		if (status === 'rejected') return m.parents_child_rejected();
		return '';
	}
</script>

<svelte:head>
	<title>{m.parents_heading()} — Sherab Admin</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.parents_section_label()}</p>
			<h1 class="page-heading">{m.parents_heading()}</h1>
		</div>
		{#if !data.loadError}
			<span class="page-counter">{data.parents.length}</span>
		{/if}
	</header>

	{#if data.loadError}
		<ix-message-bar type="danger" persistent style="display:block; margin-bottom: var(--space-4);">
			{m.parents_load_error()}
		</ix-message-bar>
	{:else}
		{#if data.pendingCount > 0}
			<p>
				<a href={resolve('/requests')}>{m.parents_pending_link({ count: data.pendingCount })}</a>
			</p>
		{/if}

		<section class="card">
			{#if data.parents.length === 0}
				<ix-empty-state
					header={m.parents_empty_heading()}
					sub-header={m.parents_empty_body()}
					icon="user-group"
				></ix-empty-state>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>{m.parents_col_name()}</th>
								<th>{m.parents_col_email()}</th>
								<th>{m.parents_col_status()}</th>
								<th>{m.parents_col_children()}</th>
							</tr>
						</thead>
						<tbody>
							{#each data.parents as parent (parent.id)}
								<tr>
									<td>{parent.name}</td>
									<td class="muted" style="overflow-wrap:anywhere;">{parent.email}</td>
									<td>
										<div class="actions">
											{#if parent.status === 'approved'}
												<ix-pill variant="success">{m.parents_status_approved()}</ix-pill>
											{:else if parent.status === 'rejected'}
												<ix-pill variant="neutral">{m.parents_status_rejected()}</ix-pill>
											{:else}
												<ix-pill variant="warning">{m.parents_status_pending()}</ix-pill>
											{/if}
											{#if !parent.emailConfirmedAt}
												<ix-pill variant="warning">{m.requests_email_unconfirmed()}</ix-pill>
											{/if}
										</div>
									</td>
									<td>
										{#if parent.children.length === 0}
											<span class="muted">—</span>
										{:else}
											{#each parent.children as child, i (child.id)}
												{@const marker = childMarker(child.status)}
												{#if i > 0}{SEPARATOR}{/if}<span>{child.name}</span>{#if marker}<span
														class="muted">{` ${marker}`}</span
													>{/if}
											{/each}
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
