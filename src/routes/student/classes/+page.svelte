<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.nav_my_classes()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.student_section_label()}</p>
			<h1 class="page-heading">{m.nav_my_classes()}</h1>
		</div>
		<span class="page-counter">{data.classes.length}</span>
	</header>

	{#if data.classes.length === 0}
		<ix-empty-state
			header={data.loadError ? m.student_homework_load_failed() : m.student_no_classes()}
			icon="book"
		></ix-empty-state>
	{:else}
		<div class="class-cards">
			{#each data.classes as cls (cls.id)}
				<a href={resolve('/student/classes/[classId]', { classId: cls.id })} class="tile-link">
					<ix-card variant="outline">
						<ix-card-content>
							<h2 class="class-name">{cls.name}</h2>
							<p class="muted" style="margin:0;">
								{cls.teachers.length > 0
									? m.student_class_taught_by({ names: cls.teachers.join(', ') })
									: m.student_class_no_teachers()}
							</p>
							<p style="margin: var(--space-2) 0 0;">
								{m.student_class_todo_count({ count: cls.todo })}
							</p>
						</ix-card-content>
					</ix-card>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.class-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: var(--space-4);
	}

	.class-name {
		margin: 0 0 var(--space-1);
	}
</style>
