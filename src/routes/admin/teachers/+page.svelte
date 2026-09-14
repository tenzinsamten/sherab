<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.teachers_heading()} — Sherab Admin</title>
</svelte:head>

<p class="section-label">{m.teachers_section_label()}</p>
<h1>{m.teachers_heading()}</h1>

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

<div class="card" style="margin-bottom: var(--space-6);">
	<h2 style="margin-top:0; font-size: var(--text-lg);">{m.teachers_create_heading()}</h2>
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
			<fieldset class="field" style="border: none; padding: 0;">
				<legend style="font-weight: 600; font-size: var(--text-sm);"
					>{m.teachers_assign_legend()}</legend
				>
				<div style="display: flex; flex-wrap: wrap; gap: var(--space-2);">
					{#each data.classes as cls (cls.id)}
						<label
							style="display:flex; align-items:center; gap: var(--space-1); border: var(--border-clay-quiet); border-radius: var(--radius-clay-quiet); padding: var(--space-2) var(--space-3);"
						>
							<input
								type="checkbox"
								name="classIds"
								value={cls.id}
								checked={form?.classIds?.includes(cls.id) ?? false}
							/>
							{cls.name} ({cls.code})
						</label>
					{/each}
				</div>
			</fieldset>
			<button class="btn" type="submit">{m.teachers_create_submit()}</button>
		</form>
	{/if}
</div>

<div class="card">
	<h2 style="margin-top:0; font-size: var(--text-lg);">{m.teachers_all_heading()}</h2>
	{#if data.teachers.length === 0}
		<p style="color: var(--color-muted-foreground);">{m.teachers_empty()}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>{m.teachers_col_name()}</th>
					<th>{m.teachers_col_email()}</th>
					<th>{m.teachers_col_classes()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.teachers as teacher (teacher.id)}
					<tr>
						<td>{teacher.display_name ?? '—'}</td>
						<td>{teacher.email}</td>
						<td>
							{#if teacher.classes.length === 0}
								<span style="color: var(--color-muted-foreground);">{m.teachers_none()}</span>
							{:else}
								{teacher.classes.map((c) => `${c.name} (${c.code})`).join(', ')}
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
