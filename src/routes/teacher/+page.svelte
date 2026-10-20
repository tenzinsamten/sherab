<script lang="ts">
	import { onMount } from 'svelte';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * The teacher dashboard, mobile-first story 7: the stat tiles in two
	 * columns on a phone (three from 48em), then a card per class (code and
	 * the Open link) in one column on a phone and a grid on a tablet.
	 */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	let pendingRequestsCount = $derived(data.pendingRequestsCount ?? 0);

	let tiles = $derived([
		{
			label: m.dashboard_tile_students(),
			value: data.studentsCount,
			text: num(data.studentsCount)
		},
		{
			label: m.dashboard_tile_pending_requests(),
			value: pendingRequestsCount,
			text: num(pendingRequestsCount),
			href: resolve('/requests')
		},
		{
			label: m.dashboard_tile_due_this_week(),
			value: data.dueThisWeek,
			text: num(data.dueThisWeek)
		},
		{
			label: m.dashboard_tile_overdue(),
			value: data.overdue,
			text: num(data.overdue)
		},
		{
			label: m.dashboard_tile_awaiting_review(),
			value: data.awaitingReview,
			text: num(data.awaitingReview)
		},
		{
			label: m.dashboard_tile_completion(),
			value: data.completionPercent,
			text: m.dashboard_tile_completion_value({ percent: num(data.completionPercent) })
		}
	] as { label: string; value: number; text: string; href?: string }[]);

	const tile = `${ui.card} flex h-full flex-col gap-1`;
</script>

<svelte:head>
	<title>{m.dashboard_heading()} — Sherab</title>
</svelte:head>

{#snippet tileBody(t: { label: string; value: number; text: string })}
	<p class="{ui.label} wrap-break-word">{t.label}</p>
	<!-- Same muted-not-hidden zero convention as the admin dashboard. -->
	<p class="{ui.stat} wrap-break-word {t.value === 0 ? ui.muted : ''}">{t.text}</p>
{/snippet}

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div>
			<p class={ui.kicker}>{m.teacher_section_label()}</p>
			<h1 class={ui.heading}>{m.dashboard_heading()}</h1>
		</div>
	</header>

	{#if data.classes.length === 0}
		<section class={ui.card}>
			<EmptyState header={m.teacher_no_classes()} icon={BookOpen} />
		</section>
	{:else}
		<ul class="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4" data-testid="dashboard-tiles">
			{#each tiles as t (t.label)}
				<li class="min-w-0">
					{#if t.href}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- t.href is already resolve()d in the tiles array above. -->
						<a href={t.href} class="{ui.tileLink} group min-w-0">
							<div class="{tile} transition-colors group-hover:bg-muted">
								{@render tileBody(t)}
							</div>
						</a>
					{:else}
						<div class={tile}>{@render tileBody(t)}</div>
					{/if}
				</li>
			{/each}
		</ul>

		<section aria-labelledby="my-classes-heading">
			<h2 id="my-classes-heading" class="mb-3 text-xl leading-snug font-bold">
				{m.teacher_my_classes_heading()}
			</h2>
			<ul class="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3" data-testid="class-cards">
				{#each data.classes as cls (cls.id)}
					<li class="min-w-0">
						<div class="{ui.card} flex h-full flex-col gap-3" data-tour="teacher-class-card">
							<div class="flex min-w-0 flex-col gap-1">
								<h3 class="text-lg leading-snug font-bold wrap-break-word">{cls.name}</h3>
								<p class="{ui.muted} wrap-break-word" data-tour="teacher-class-code">
									{m.teacher_class_code_label({ code: cls.code })}
								</p>
							</div>
							<Button
								variant="secondary"
								href={resolve('/teacher/classes/[id]', { id: cls.id })}
								class="{ui.touch} mt-auto w-full gap-2 md:w-fit"
								data-tour="teacher-class-open"
							>
								{m.teacher_view_roster()}
								<ChevronRight class="size-5" aria-hidden="true" />
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
