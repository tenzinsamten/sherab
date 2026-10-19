<script lang="ts">
	import { onMount } from 'svelte';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * My classes, mobile-first story 4: one card per class (whole card a
	 * link), stacked on a phone, a grid from 48em.
	 */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<svelte:head>
	<title>{m.nav_my_classes()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div>
			<p class={ui.kicker}>{m.student_section_label()}</p>
			<h1 class={ui.heading}>{m.nav_my_classes()}</h1>
		</div>
		<Badge variant="secondary" class="text-sm">{num(data.classes.length)}</Badge>
	</header>

	{#if data.classes.length === 0}
		<section class={ui.card}>
			<EmptyState
				header={data.loadError ? m.student_homework_load_failed() : m.student_no_classes()}
				icon={BookOpen}
			/>
		</section>
	{:else}
		<ul class="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="class-cards">
			{#each data.classes as cls (cls.id)}
				<li class="min-w-0">
					<a
						href={resolve('/student/classes/[classId]', { classId: cls.id })}
						class="{ui.tileLink} group"
					>
						<div
							class="{ui.card} flex h-full flex-col gap-2 transition-colors group-hover:bg-muted"
						>
							<h2 class="flex items-center justify-between gap-2 text-lg leading-snug font-bold">
								<span class="min-w-0 wrap-break-word">{cls.name}</span>
								<ChevronRight class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
							</h2>
							<p class="{ui.muted} wrap-break-word">
								{cls.teachers.length > 0
									? m.student_class_taught_by({ names: cls.teachers.join(', ') })
									: m.student_class_no_teachers()}
							</p>
							<p>{m.student_class_todo_count({ count: num(cls.todo) })}</p>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
