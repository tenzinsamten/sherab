<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Send from '@lucide/svelte/icons/send';
	import X from '@lucide/svelte/icons/x';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import StudentHomeworkRows from '$lib/components/StudentHomeworkRows.svelte';
	import StudentProgressTiles from '$lib/components/StudentProgressTiles.svelte';
	import { num } from '$lib/format';
	import { showToast } from '$lib/ix';
	import * as m from '$lib/paraglide/messages.js';
	import { createPending } from '$lib/pending.svelte';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * The student dashboard (#46, #67), mobile-first story 4: the homework
	 * and team tiles in two columns on a phone (four from 48em), streak and
	 * badges, the next homework due, a card per class (a grid on a tablet)
	 * and the "Join another class" card.
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

	// Set once the page is interactive (tests wait for it before tapping).
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	// #67: the "Join another class" code field. Upper-cased as typed, like
	// /join; cleared after a request is sent. A refused code comes back in
	// form.code (also without JavaScript) and is shown again with its error.
	const refused = (f: ActionData) =>
		f && 'code' in f && 'joinError' in f && f.joinError
			? { code: f.code ?? '', error: String(f.joinError) }
			: null;
	let joinCode = $state(untrack(() => refused(form)?.code ?? ''));
	let joinCodeError = $state<string | null>(untrack(() => refused(form)?.error ?? null));
	let joinInput = $state<HTMLInputElement | null>(null);

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
			// role="alert"), and focus goes back to the field; a failed
			// dismiss has no field, so it's a toast.
			const r = refused(form);
			if (r) {
				joinCode = r.code;
				joinCodeError = r.error;
				void tick().then(() => joinInput?.focus());
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

	const tile = `${ui.card} flex h-full flex-col gap-1 transition-colors group-hover:bg-muted`;
	const tileLink = `${ui.tileLink} group min-w-0`;
	const cardHeader = 'mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1';
</script>

<svelte:head>
	<title>{m.student_dashboard_heading()} — Sherab</title>
</svelte:head>

{#snippet spinner(key: string)}
	{#if pending.is(key)}
		<LoaderCircle class="animate-spin" aria-hidden="true" />
	{/if}
{/snippet}

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div>
			<p class={ui.kicker}>{m.student_section_label()}</p>
			<h1 class={ui.heading}>{m.student_dashboard_heading()}</h1>
		</div>
	</header>

	<ul class="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4" data-testid="dashboard-tiles">
		{#each tiles as t (t.label)}
			<li class="min-w-0">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- t.href is built on resolve() above. -->
				<a href={t.href} class={tileLink}>
					<div class={tile}>
						<p class="{ui.label} wrap-break-word">{t.label}</p>
						<p class="{ui.stat} {t.value === 0 || data.loadError ? ui.muted : ''}">
							{data.loadError ? '—' : num(t.value)}
						</p>
					</div>
				</a>
			</li>
		{/each}
		<li class="min-w-0">
			<!-- #97: with a team, the tile opens the team's students (that page
			     leads on to the leaderboard); without one, the leaderboard. -->
			<a
				href={data.teamId
					? resolve('/teams/[teamId]', { teamId: data.teamId })
					: resolve('/leaderboard')}
				class={tileLink}
			>
				<div class={tile}>
					<p class="{ui.label} wrap-break-word">{m.student_tile_team()}</p>
					{#if data.team}
						<p class="{ui.stat} wrap-break-word">
							{m.student_team_rank({ rank: num(data.team.rank), total: num(data.team.total) })}
						</p>
						<p class="{ui.muted} wrap-break-word">{data.team.name}</p>
					{:else}
						<p class="{ui.stat} {ui.muted}">—</p>
					{/if}
				</div>
			</a>
		</li>
	</ul>

	<StudentProgressTiles
		streak={data.streak}
		badges={data.badges}
		badgeProgress={data.badgeProgress}
		progressLoadError={data.progressLoadError}
		loadError={data.loadError}
		seeAllHref={resolve('/student/badges')}
	/>

	<section class={ui.card} aria-labelledby="next-due-heading">
		<div class={cardHeader}>
			<h2 id="next-due-heading" class="text-lg leading-snug font-bold">
				{m.student_next_due_heading()}
			</h2>
			<a href={homeworkHref} class="{ui.link} inline-flex min-h-11 items-center">
				{m.student_see_all_homework()}
			</a>
		</div>
		{#if data.nextDue.length === 0}
			<p class={ui.muted}>
				{data.loadError ? m.student_homework_load_failed() : m.student_homework_empty()}
			</p>
		{:else}
			<StudentHomeworkRows items={data.nextDue} />
		{/if}
	</section>

	<section class={ui.card} aria-labelledby="classes-heading">
		<h2 id="classes-heading" class={ui.cardTitle}>{m.nav_my_classes()}</h2>
		{#if data.classes.length === 0}
			<p class={ui.muted}>
				{data.loadError ? m.student_homework_load_failed() : m.student_no_classes()}
			</p>
		{:else}
			<ul class="grid gap-3 md:grid-cols-2 lg:grid-cols-3" data-testid="class-cards">
				{#each data.classes as cls (cls.id)}
					<li class="min-w-0">
						<a href={resolve('/student/classes/[classId]', { classId: cls.id })} class={tileLink}>
							<div
								class="flex h-full items-center justify-between gap-2 rounded-lg border border-border p-4 transition-colors group-hover:bg-muted"
							>
								<span class="flex min-w-0 flex-col gap-1">
									<span class="font-bold wrap-break-word">{cls.name}</span>
									<span class={ui.muted}>
										{m.student_class_todo_count({ count: num(cls.todo) })}
									</span>
								</span>
								<ChevronRight class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
							</div>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class={ui.card} aria-labelledby="join-heading" data-testid="join-card">
		<h2 id="join-heading" class={ui.cardTitle}>{m.student_join_heading()}</h2>
		<p class="{ui.muted} mb-3">{m.student_join_intro()}</p>
		<!-- novalidate: the server checks the code and answers under the field. -->
		<form
			method="POST"
			action="?/requestJoin"
			novalidate
			class="flex flex-col gap-1.5"
			use:enhance={pending.submit('requestJoin', { reset: false })}
		>
			<label for="joinCode" class="text-sm font-medium">{m.student_join_code_label()}</label>
			<!-- The button sits level with the field whatever the label's height
			     (Tibetan, wrapped German); the error stays under the field. -->
			<div class="flex flex-col gap-3 md:flex-row md:items-start">
				<div class="flex min-w-0 flex-1 flex-col gap-1.5">
					<!-- A refused code posted without JavaScript: focus is on the field. -->
					<Input
						id="joinCode"
						name="code"
						bind:ref={joinInput}
						value={joinCode}
						oninput={(event) => {
							const field = event.currentTarget;
							joinCode = field.value.toUpperCase();
							if (field.value !== joinCode) {
								// Keep the caret where it was (an edit mid-code).
								const { selectionStart, selectionEnd } = field;
								field.value = joinCode;
								field.setSelectionRange(selectionStart, selectionEnd);
							}
							joinCodeError = null;
						}}
						required
						autocomplete="off"
						autocapitalize="characters"
						spellcheck={false}
						autofocus={joinCodeError ? true : undefined}
						class="uppercase"
						aria-invalid={joinCodeError ? 'true' : undefined}
						aria-describedby={joinCodeError ? 'joinCode-error' : undefined}
					/>
					{#if joinCodeError}
						<p id="joinCode-error" class={ui.error} role="alert">{joinCodeError}</p>
					{/if}
				</div>
				<Button
					type="submit"
					class="{ui.touch} w-full md:w-auto"
					disabled={pending.busy}
					aria-busy={pending.is('requestJoin') || undefined}
				>
					{#if pending.is('requestJoin')}
						{@render spinner('requestJoin')}
					{:else}
						<Send aria-hidden="true" />
					{/if}
					{m.student_join_submit()}
				</Button>
			</div>
		</form>

		{#if data.joinLoadError}
			<p class="{ui.muted} mt-3" role="alert">{m.student_join_load_failed()}</p>
		{:else if data.joinRequests.length > 0}
			<ul class="{ui.rows} mt-4" data-testid="join-requests">
				{#each data.joinRequests as req (req.id)}
					<li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-2" data-testid="join-request">
						<Badge
							variant={req.status === 'pending' ? 'warning' : 'alarm'}
							data-testid="join-status"
						>
							{req.status === 'pending'
								? m.student_join_status_pending()
								: m.student_join_status_rejected()}
						</Badge>
						<span class="min-w-0 flex-1 wrap-break-word">{req.className}</span>
						{#if req.status === 'rejected'}
							<form
								method="POST"
								action="?/dismissJoin"
								use:enhance={pending.submit(`dismissJoin:${req.id}`)}
							>
								<input type="hidden" name="id" value={req.id} />
								<Button
									type="submit"
									variant="ghost"
									class={ui.touch}
									disabled={pending.busy}
									aria-busy={pending.is(`dismissJoin:${req.id}`) || undefined}
								>
									{#if pending.is(`dismissJoin:${req.id}`)}
										{@render spinner(`dismissJoin:${req.id}`)}
									{:else}
										<X aria-hidden="true" />
									{/if}
									{m.student_join_dismiss()}
								</Button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
