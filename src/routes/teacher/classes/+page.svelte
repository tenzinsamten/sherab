<script lang="ts">
	import { onMount } from 'svelte';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import TeacherClassCards from '$lib/components/TeacherClassCards.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * The teacher's classes (#108), opened from the Classes tab: the
	 * dashboard's class cards (name, code, View roster) without its tiles.
	 */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<svelte:head>
	<title>{m.teacher_my_classes_heading()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div>
			<p class={ui.kicker}>{m.requests_kicker_teacher()}</p>
			<h1 class={ui.heading}>{m.teacher_my_classes_heading()}</h1>
		</div>
		{#if !data.loadError}
			<Badge variant="secondary" class="text-sm">{num(data.classes.length)}</Badge>
		{/if}
	</header>

	{#if data.classes.length === 0}
		<section class={ui.card}>
			<EmptyState
				header={data.loadError ? m.load_error_generic() : m.teacher_no_classes()}
				icon={BookOpen}
			/>
		</section>
	{:else}
		<TeacherClassCards classes={data.classes} headingLevel={2} />
	{/if}
</div>
