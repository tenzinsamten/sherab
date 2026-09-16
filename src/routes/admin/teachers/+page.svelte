<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.teachers_heading()} — Sherab Admin</title>
</svelte:head>

<p class="page-kicker">{m.teachers_section_label()}</p>
<div class="page-header">
	<h1 class="page-heading">{m.teachers_heading()}</h1>
	<span class="page-counter">{String(data.teachers.length).padStart(2, '0')}</span>
</div>
<hr class="page-hr" />

{#if data.loadError}
	<p class="banner-error" role="alert">{m.load_error_generic()}</p>
{/if}
{#if form?.error}
	<p class="banner-error" role="alert">{form.error}</p>
{/if}
{#if form?.tempPassword}
	<p class="banner-success" role="status">
		{m.teachers_created_success({ email: form.email ?? '', password: form.tempPassword })}
	</p>
{/if}

<div
	style="max-width: 520px; padding: var(--space-6) 0; border-bottom: 1px solid var(--color-border);"
>
	<p class="section-label">{m.teachers_create_heading()}</p>
	{#if data.classes.length === 0}
		<p style="color: var(--color-muted-foreground);">{m.teachers_need_class_first()}</p>
	{:else}
		<form method="POST" action="?/create" use:enhance>
			<div class="field">
				<label for="email">{m.teachers_email_label()}</label>
				<input id="email" name="email" type="email" required value={form?.email ?? ''} />
			</div>
			<div class="field">
				<label for="displayName">{m.teachers_display_name_label()}</label>
				<input id="displayName" name="displayName" type="text" value={form?.displayName ?? ''} />
			</div>
			<fieldset style="border: none; padding: 0; margin: 0 0 var(--space-4);">
				<legend class="section-label" style="margin-bottom: var(--space-2);"
					>{m.teachers_assign_legend()}</legend
				>
				<div style="border-top: 1px solid var(--color-border);">
					{#each data.classes as cls (cls.id)}
						{@const checked = form?.classIds?.includes(cls.id) ?? false}
						<label class="check-row" class:checked>
							<input type="checkbox" name="classIds" value={cls.id} {checked} />
							<span class="check-glyph" aria-hidden="true">{checked ? '✓' : ''}</span>
							<span style="flex:1;">{cls.name}</span>
							<code>{cls.code}</code>
						</label>
					{/each}
				</div>
			</fieldset>
			<button class="btn" type="submit">{m.teachers_create_submit()}</button>
		</form>
	{/if}
</div>

<p class="section-label" style="margin-top: var(--space-6);">{m.teachers_all_heading()}</p>
{#if data.teachers.length === 0}
	<p style="color: var(--color-muted-foreground);">{m.teachers_empty()}</p>
{:else}
	{#each data.teachers as teacher (teacher.id)}
		<div
			class="grid-table-row"
			style="grid-template-columns: minmax(0,1.1fr) minmax(0,1.4fr) auto;"
		>
			<span style="font-weight:600;">{teacher.display_name ?? '—'}</span>
			<span
				style="color: var(--color-muted-foreground); font-size: var(--text-sm); overflow-wrap: anywhere;"
				>{teacher.email}</span
			>
			<span>
				{#if teacher.classes.length === 0}
					<span style="color: var(--color-muted-foreground);">{m.teachers_none()}</span>
				{:else}
					{teacher.classes.map((c) => `${c.name} (${c.code})`).join(', ')}
				{/if}
			</span>
		</div>
	{/each}
{/if}
