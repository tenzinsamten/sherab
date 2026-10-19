<script lang="ts">
	import { onMount } from 'svelte';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import Info from '@lucide/svelte/icons/info';
	import LogOut from '@lucide/svelte/icons/log-out';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * An unapproved or rejected student's only page, mobile-first story 4: a
	 * status card with Check again (pending only) and Sign out. A failed
	 * load claims no status.
	 */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

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

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div>
			<h1 class={ui.heading}>{data.name || heading}</h1>
		</div>
		{#if data.state === 'pending' && !data.loadError}
			<Badge variant="warning">{m.join_pending_status_badge()}</Badge>
		{/if}
	</header>

	<section
		class="{ui.card} flex flex-col items-center gap-4"
		data-testid="student-status"
		data-state={data.loadError ? 'error' : data.state}
	>
		{#if data.loadError}
			<!-- The profile could not be read: no status is claimed. -->
			<EmptyState header={m.load_error_generic()} icon={Info} />
		{:else if data.state === 'rejected'}
			<EmptyState
				header={m.student_rejected_heading()}
				subHeader={m.student_rejected_body()}
				icon={Info}
			/>
		{:else}
			<EmptyState
				header={m.student_pending_heading()}
				subHeader={m.student_pending_body()}
				icon={Hourglass}
			/>
		{/if}
		<div class="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
			{#if data.state === 'pending' && !data.loadError}
				<!-- A full page load, so the menu is there once the student is approved. -->
				<Button
					href={resolve('/student')}
					data-sveltekit-reload
					class="{ui.touch} w-full sm:w-auto"
				>
					<RefreshCw aria-hidden="true" />
					{m.student_pending_check_again()}
				</Button>
			{/if}
			<form method="POST" action={resolve('/logout')}>
				<Button type="submit" variant="outline" class="{ui.touch} w-full sm:w-auto">
					<LogOut aria-hidden="true" />
					{m.nav_sign_out()}
				</Button>
			</form>
		</div>
	</section>
</div>
