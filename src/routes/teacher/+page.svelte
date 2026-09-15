<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.teacher_my_classes_heading()} — Sherab</title>
</svelte:head>

<p class="section-label">{m.teacher_section_label()}</p>
<h1>{m.teacher_my_classes_heading()}</h1>

{#if data.loadError}
	<p class="banner-error" role="alert">{m.load_error_generic()}</p>
{/if}
{#if data.classes.length === 0}
	<div class="card">
		<p style="color: var(--color-muted-foreground); margin: 0;">{m.teacher_no_classes()}</p>
	</div>
{:else}
	<div
		style="display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));"
	>
		{#each data.classes as cls (cls.id)}
			<div class="card">
				<h2 style="margin: 0 0 var(--space-2) 0; font-size: var(--text-lg);">{cls.name}</h2>
				<p style="margin: 0; color: var(--color-muted-foreground);">
					{m.teacher_class_code_label({ code: cls.code })}
				</p>
				<p style="margin: var(--space-2) 0 0 0;">
					<a
						class="btn btn-outline"
						style="text-decoration:none;"
						href={resolve('/teacher/classes/[id]', { id: cls.id })}>{m.teacher_view_roster()}</a
					>
				</p>
			</div>
		{/each}
	</div>
{/if}
