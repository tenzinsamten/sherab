<script lang="ts">
	import { resolve } from '$app/paths';
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
						{#if child.status === 'pending'}
							<ix-card variant="outline" passive>
								<ix-card-content>
									<p class="child-name"><strong>{child.name}</strong></p>
									<ix-pill variant="warning">{m.parent_child_waiting()}</ix-pill>
								</ix-card-content>
							</ix-card>
						{:else}
							<!-- #56: the whole card opens the child's page. -->
							<a href={resolve('/parent/children/[id]', { id: child.id })} class="tile-link">
								<ix-card variant="outline">
									<ix-card-content>
										<p class="child-name">
											<strong>{child.name}</strong>
											<ix-icon name="chevron-right" size="16" aria-hidden="true"></ix-icon>
										</p>
										<p class="muted child-classes">
											<span class="section-label">{m.parent_card_classes()}</span>
											{child.classes.length > 0
												? child.classes.join(', ')
												: m.parent_card_no_classes()}
										</p>
										<dl class="counts">
											<div>
												<dt class="section-label">{m.parent_card_open()}</dt>
												<dd class={child.open === 0 ? 'stat-tile-value muted' : 'stat-tile-value'}>
													{child.open}
												</dd>
											</div>
											<div>
												<dt class="section-label">{m.parent_card_overdue()}</dt>
												<dd>
													{#if child.overdue > 0}
														<ix-pill variant="alarm">{child.overdue}</ix-pill>
													{:else}
														<span class="stat-tile-value muted">0</span>
													{/if}
												</dd>
											</div>
										</dl>
									</ix-card-content>
								</ix-card>
							</a>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.children {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: var(--space-4);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.child-name {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin: 0 0 var(--space-2);
	}

	.child-classes {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0 0 var(--space-3);
	}

	.counts {
		display: flex;
		gap: var(--space-6);
		margin: 0;
	}

	.counts dd {
		margin: 0;
	}
</style>
