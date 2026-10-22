<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';

	/**
	 * A teacher's class cards (name, code, View roster), one column on a phone and a
	 * grid on a tablet. Shared by the teacher dashboard and /teacher/classes
	 * (#108). Only the dashboard's copy carries the `teacher-home` tour
	 * targets (`tourTargets`), so the tour never finds two of each.
	 */
	let {
		classes,
		headingLevel = 3,
		tourTargets = false
	}: {
		classes: { id: string; name: string; code: string }[];
		/** 3 under the dashboard's "My Classes" h2; 2 under a page's h1. */
		headingLevel?: 2 | 3;
		tourTargets?: boolean;
	} = $props();

	const tour = (name: string) => (tourTargets ? name : undefined);
</script>

<ul class="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3" data-testid="class-cards">
	{#each classes as cls (cls.id)}
		<li class="min-w-0">
			<div class="{ui.card} flex h-full flex-col gap-3" data-tour={tour('teacher-class-card')}>
				<div class="flex min-w-0 flex-col gap-1">
					<svelte:element
						this={`h${headingLevel}`}
						class="text-lg leading-snug font-bold wrap-break-word">{cls.name}</svelte:element
					>
					<p class="{ui.muted} wrap-break-word" data-tour={tour('teacher-class-code')}>
						{m.teacher_class_code_label({ code: cls.code })}
					</p>
				</div>
				<Button
					variant="secondary"
					href={resolve('/teacher/classes/[id]', { id: cls.id })}
					class="{ui.touch} mt-auto w-full gap-2 md:w-fit"
					data-tour={tour('teacher-class-open')}
				>
					{m.teacher_view_roster()}
					<ChevronRight class="size-5" aria-hidden="true" />
				</Button>
			</div>
		</li>
	{/each}
</ul>
