<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.classes_heading()} — Sherab Admin</title>
</svelte:head>

<p class="section-label">{m.classes_section_label()}</p>
<h1>{m.classes_heading()}</h1>

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

<div class="card" style="margin-bottom: var(--space-6);">
	<h2 style="margin-top:0; font-size: var(--text-lg);">{m.classes_create_heading()}</h2>
	<form method="POST" action="?/create" use:enhance>
		<div class="field">
			<label for="name">{m.classes_name_label()}</label>
			<input id="name" name="name" type="text" required value={form?.name ?? ''} />
		</div>
		<button class="btn" type="submit">{m.classes_create_submit()}</button>
	</form>
</div>

<div class="card">
	<h2 style="margin-top:0; font-size: var(--text-lg);">{m.classes_all_heading()}</h2>
	{#if data.classes.length === 0}
		<p style="color: var(--color-muted-foreground);">{m.classes_empty()}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>{m.classes_col_name()}</th>
					<th>{m.classes_col_code()}</th>
					<th>{m.classes_col_created()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.classes as cls (cls.id)}
					<tr>
						<td>{cls.name}</td>
						<td><code>{cls.code}</code></td>
						<td>{new Date(cls.created_at).toLocaleDateString()}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
