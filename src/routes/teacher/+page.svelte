<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.teacher_my_classes_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.teacher_section_label()}</p>
			<h1 class="page-heading">{m.teacher_my_classes_heading()}</h1>
		</div>
	</header>

	{#if data.classes.length === 0}
		<ix-empty-state header={m.teacher_no_classes()} icon="book"></ix-empty-state>
	{:else}
		<div class="tile-grid">
			{#each data.classes as cls (cls.id)}
				<ix-card variant="outline" passive>
					<ix-card-content>
						<h2 style="margin:0;">{cls.name}</h2>
						<p class="muted" style="margin:0;">{m.teacher_class_code_label({ code: cls.code })}</p>
						<ix-button variant="secondary" href={resolve('/teacher/classes/[id]', { id: cls.id })}>
							{m.teacher_view_roster()}
						</ix-button>
					</ix-card-content>
				</ix-card>
			{/each}
		</div>
	{/if}
</div>
