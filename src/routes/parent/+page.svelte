<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.parent_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.parent_kicker()}</p>
			<h1 class="page-heading">{m.parent_heading()}</h1>
		</div>
		{#if data.state === 'pending'}
			<ix-pill variant="warning">{m.parent_status_pending()}</ix-pill>
		{/if}
	</header>

	<section class="card">
		{#if data.state === 'unconfirmed'}
			<ix-empty-state
				header={m.parent_unconfirmed_heading()}
				sub-header={m.parent_unconfirmed_body({ email: data.email })}
				icon="mail"
			></ix-empty-state>
		{:else if data.state === 'pending'}
			<ix-empty-state
				header={m.parent_pending_heading()}
				sub-header={m.parent_pending_body()}
				icon="hourglass"
			></ix-empty-state>
		{:else if data.state === 'rejected'}
			<ix-empty-state
				header={m.parent_rejected_heading()}
				sub-header={m.parent_rejected_body()}
				icon="info"
			></ix-empty-state>
		{:else if data.loadError}
			<ix-empty-state header={m.load_error_generic()} icon="info"></ix-empty-state>
		{:else if data.children.length === 0}
			<ix-empty-state
				header={m.parent_empty_heading()}
				sub-header={m.parent_empty_body()}
				icon="user-group"
			></ix-empty-state>
		{:else}
			<ul class="children" aria-label={m.parent_children_label()}>
				{#each data.children as child (child.id)}
					<li>
						<strong>{child.name}</strong>
						{#if child.status === 'pending'}
							<ix-pill variant="warning">{m.parent_child_waiting()}</ix-pill>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.children {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.children li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
</style>
