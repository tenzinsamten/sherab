<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.classes_heading()} — Sherab Admin</title>
</svelte:head>

<p class="page-kicker">{m.classes_section_label()}</p>
<div class="page-header">
	<h1 class="page-heading">{m.classes_heading()}</h1>
	<span class="page-counter">{String(data.classes.length).padStart(2, '0')}</span>
</div>
<hr class="page-hr" />

{#if data.loadError}
	<p class="banner-error" role="alert">{m.load_error_generic()}</p>
{/if}
{#if form?.error}
	<p class="banner-error" role="alert">{form.error}</p>
{/if}
{#if form?.class}
	<p class="banner-success" role="status">
		{m.classes_created_success({ name: form.class.name, code: form.class.code })}
	</p>
{/if}

<div
	style="display:flex; flex-wrap:wrap; align-items:flex-end; gap: var(--space-3); padding: var(--space-6) 0; border-bottom: 1px solid var(--color-border);"
>
	<form
		method="POST"
		action="?/create"
		use:enhance
		style="flex:1; min-width:220px; display:flex; flex-wrap:wrap; align-items:flex-end; gap: var(--space-3);"
	>
		<div class="field" style="flex:1; min-width:220px; margin-bottom:0;">
			<label for="name">{m.classes_name_label()}</label>
			<input id="name" name="name" type="text" required value={form?.name ?? ''} />
		</div>
		<button class="btn" type="submit">{m.classes_create_submit()}</button>
	</form>
</div>

<p class="section-label" style="margin-top: var(--space-6);">{m.classes_all_heading()}</p>
{#if data.classes.length === 0}
	<p style="color: var(--color-muted-foreground);">{m.classes_empty()}</p>
{:else}
	<div class="grid-table-header" style="grid-template-columns: minmax(0,1fr) 120px 140px;">
		<span>{m.classes_col_name()}</span>
		<span>{m.classes_col_code()}</span>
		<span>{m.classes_col_created()}</span>
	</div>
	{#each data.classes as cls (cls.id)}
		<div class="grid-table-row" style="grid-template-columns: minmax(0,1fr) 120px 140px;">
			<span style="font-weight:600;">{cls.name}</span>
			<code>{cls.code}</code>
			<span style="color: var(--color-muted-foreground); font-size: var(--text-sm);"
				>{new Date(cls.created_at).toLocaleDateString()}</span
			>
		</div>
	{/each}
{/if}
