<script lang="ts">
	import { num } from '$lib/format';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import StudentHomeworkRows from '$lib/components/StudentHomeworkRows.svelte';
	import StudentProgressTiles from '$lib/components/StudentProgressTiles.svelte';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/ix';
	import { ixFieldError } from '$lib/ix-fields';
	import { createPending } from '$lib/pending.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

	// #67: the "Join another class" code field. Upper-cased as typed, like
	// /join; cleared after a request is sent. A refused code comes back in
	// form.code (also without JavaScript) and is shown again with its error.
	const refused = (f: ActionData) =>
		f && 'code' in f && 'joinError' in f && f.joinError
			? { code: f.code ?? '', error: String(f.joinError) }
			: null;
	let joinCode = $state(untrack(() => refused(form)?.code ?? ''));
	let joinCodeError = $state<string | null>(untrack(() => refused(form)?.error ?? null));

	$effect(() => {
		if (!form) return;
		if ('success' in form && form.success)
			showToast('success', m.student_homework_mark_done_success());
		if ('joinSent' in form && form.joinSent) {
			showToast('success', m.student_join_sent({ name: form.joinSent }));
			joinCode = '';
			joinCodeError = null;
		}
		if ('joinDismissed' in form && form.joinDismissed)
			showToast('success', m.student_join_dismissed());
		if ('joinError' in form && form.joinError) {
			// A refused code shows under the field only (announced there by
			// role="alert"); a failed dismiss has no field, so it's a toast.
			const r = refused(form);
			if (r) {
				joinCode = r.code;
				joinCodeError = r.error;
			} else {
				showToast('error', form.joinError);
			}
		}
	});

	const homeworkHref = resolve('/student/homework');

	// A failed load shows "—" rather than a misleading zero.
	let tiles = $derived([
		{ label: m.student_tile_todo(), value: data.tiles.todo, href: homeworkHref },
		{ label: m.student_tile_overdue(), value: data.tiles.overdue, href: homeworkHref },
		{
			label: m.student_tile_done_week(),
			value: data.tiles.doneThisWeek,
			href: `${homeworkHref}?filter=done`
		}
	]);
</script>

<svelte:head>
	<title>{m.student_dashboard_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.student_section_label()}</p>
			<h1 class="page-heading">{m.student_dashboard_heading()}</h1>
		</div>
	</header>

	<div class="tile-grid" style="margin-bottom: var(--space-4);">
		{#each tiles as tile (tile.label)}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tile.href is built on resolve() above. -->
			<a href={tile.href} class="tile-link">
				<ix-card variant="outline">
					<ix-card-content>
						<p class="section-label">{tile.label}</p>
						<p
							class={tile.value === 0 || data.loadError
								? 'stat-tile-value muted'
								: 'stat-tile-value'}
						>
							{data.loadError ? '—' : num(tile.value)}
						</p>
					</ix-card-content>
				</ix-card>
			</a>
		{/each}
		<a href={resolve('/leaderboard')} class="tile-link">
			<ix-card variant="outline">
				<ix-card-content>
					<p class="section-label">{m.student_tile_team()}</p>
					{#if data.team}
						<p class="stat-tile-value">
							{m.student_team_rank({ rank: num(data.team.rank), total: num(data.team.total) })}
						</p>
						<p class="muted" style="margin:0;">{data.team.name}</p>
					{:else}
						<p class="stat-tile-value muted">—</p>
					{/if}
				</ix-card-content>
			</ix-card>
		</a>
	</div>

	<StudentProgressTiles streak={data.streak} badges={data.badges} loadError={data.loadError} />

	<section class="card">
		<div class="card-header">
			<h2>{m.student_next_due_heading()}</h2>
			<a href={homeworkHref}>{m.student_see_all_homework()}</a>
		</div>
		{#if data.nextDue.length === 0}
			<p class="muted" style="margin:0;">
				{data.loadError ? m.student_homework_load_failed() : m.student_homework_empty()}
			</p>
		{:else}
			<StudentHomeworkRows items={data.nextDue} />
		{/if}
	</section>

	<section class="card">
		<h2>{m.nav_my_classes()}</h2>
		{#if data.classes.length === 0}
			<p class="muted" style="margin:0;">
				{data.loadError ? m.student_homework_load_failed() : m.student_no_classes()}
			</p>
		{:else}
			<div class="class-cards">
				{#each data.classes as cls (cls.id)}
					<a href={resolve('/student/classes/[classId]', { classId: cls.id })} class="tile-link">
						<ix-card variant="outline">
							<ix-card-content>
								<p class="section-label">{cls.name}</p>
								<p class="muted" style="margin:0;">
									{m.student_class_todo_count({ count: num(cls.todo) })}
								</p>
							</ix-card-content>
						</ix-card>
					</a>
				{/each}
			</div>
		{/if}
	</section>

	<section class="card">
		<h2>{m.student_join_heading()}</h2>
		<p class="muted">{m.student_join_intro()}</p>
		<!-- novalidate: the server checks the code, and iX's own validation
		     would replace the error's aria-describedby (see $lib/ix-fields). -->
		<form
			method="POST"
			action="?/requestJoin"
			novalidate
			class="actions join-form"
			use:enhance={pending.submit('requestJoin', { reset: false })}
		>
			<div class="field join-field">
				<ix-input
					id="joinCode"
					name="code"
					label={m.student_join_code_label()}
					required
					value={joinCode}
					onvalueChange={(event: CustomEvent<string>) => {
						joinCode = event.detail.toUpperCase();
						joinCodeError = null;
					}}
					{@attach ixFieldError(joinCodeError ? 'joinCode-error' : undefined)}
				></ix-input>
				{#if joinCodeError}
					<p id="joinCode-error" class="field-error" role="alert">{joinCodeError}</p>
				{/if}
			</div>
			<ix-button
				type="submit"
				loading={pending.is('requestJoin') || undefined}
				disabled={pending.busy || undefined}>{m.student_join_submit()}</ix-button
			>
		</form>

		{#if data.joinLoadError}
			<p class="muted" role="alert" style="margin:0;">{m.student_join_load_failed()}</p>
		{:else if data.joinRequests.length > 0}
			<ul class="join-list">
				{#each data.joinRequests as req (req.id)}
					<li class="join-row">
						<ix-pill variant={req.status === 'pending' ? 'warning' : 'alarm'}>
							{req.status === 'pending'
								? m.student_join_status_pending()
								: m.student_join_status_rejected()}
						</ix-pill>
						<span>{req.className}</span>
						{#if req.status === 'rejected'}
							<form
								method="POST"
								action="?/dismissJoin"
								class="join-dismiss"
								use:enhance={pending.submit(`dismissJoin:${req.id}`)}
							>
								<input type="hidden" name="id" value={req.id} />
								<ix-button
									type="submit"
									variant="tertiary"
									icon="cancel"
									loading={pending.is(`dismissJoin:${req.id}`) || undefined}
									disabled={pending.busy || undefined}>{m.student_join_dismiss()}</ix-button
								>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.card-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}

	.card-header h2 {
		margin: 0;
	}

	.join-form {
		align-items: flex-start;
	}

	.join-field {
		flex: 1;
		min-width: 12rem;
		margin: 0;
	}

	.join-form ix-button {
		/* Line the button up with the field, below its label. */
		margin-top: 1.25rem;
	}

	.join-list {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}

	.join-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.join-dismiss {
		margin-left: auto;
	}

	.class-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: var(--space-4);
	}
</style>
