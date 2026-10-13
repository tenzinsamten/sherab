<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let heading = $derived(
		data.loadError
			? m.load_error_generic()
			: data.state === 'rejected'
				? m.student_rejected_heading()
				: m.student_pending_heading()
	);
</script>

<svelte:head>
	<title>{heading} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<h1 class="page-heading">{data.name || heading}</h1>
		</div>
		{#if data.state === 'pending' && !data.loadError}
			<ix-pill variant="warning">{m.join_pending_status_badge()}</ix-pill>
		{/if}
	</header>

	<section
		class="card"
		data-testid="student-status"
		data-state={data.loadError ? 'error' : data.state}
	>
		{#if data.loadError}
			<!-- The profile could not be read: no status is claimed. -->
			<ix-empty-state header={m.load_error_generic()} icon="info"></ix-empty-state>
		{:else if data.state === 'rejected'}
			<ix-empty-state
				header={m.student_rejected_heading()}
				sub-header={m.student_rejected_body()}
				icon="info"
			></ix-empty-state>
		{:else}
			<ix-empty-state
				header={m.student_pending_heading()}
				sub-header={m.student_pending_body()}
				icon="hourglass"
			></ix-empty-state>
		{/if}
		<div class="actions">
			{#if data.state === 'pending' && !data.loadError}
				<!-- A full page load, so the menu is there once the student is approved. -->
				<a class="check-again" href={resolve('/student')} data-sveltekit-reload>
					{m.student_pending_check_again()}
				</a>
			{/if}
			<form method="POST" action={resolve('/logout')}>
				<ix-button type="submit" variant="secondary" icon="log-out">{m.nav_sign_out()}</ix-button>
			</form>
		</div>
	</section>
</div>

<style>
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		margin-top: var(--space-4);
	}
</style>
