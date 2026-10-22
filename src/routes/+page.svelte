<script lang="ts">
	import BookOpen from '@lucide/svelte/icons/book-open';
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import Flame from '@lucide/svelte/icons/flame';
	import LogIn from '@lucide/svelte/icons/log-in';
	import Music from '@lucide/svelte/icons/music';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard, { auth } from '$lib/components/AuthCard.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ui } from '$lib/ui/classes';
	import { cn } from '$lib/utils';

	// #16: what a new parent needs before signing in. Static text only.
	// Section h2s sit one step below the card's h1; h3s are card titles
	// without their bottom margin (the body's mt-1 spaces them).
	const sectionHeading = 'mb-4 text-xl leading-tight font-bold wrap-break-word';
	const itemTitle = cn(ui.cardTitle, 'mb-0 wrap-break-word');
	const steps = [
		{ title: m.home_join_1_title, body: m.home_join_1_body },
		{ title: m.home_join_2_title, body: m.home_join_2_body },
		{ title: m.home_join_3_title, body: m.home_join_3_body }
	];
	const tracks = [
		{
			icon: CalendarCheck,
			title: m.home_tracks_attendance_title,
			body: m.home_tracks_attendance_body
		},
		{ icon: BookOpen, title: m.home_tracks_homework_title, body: m.home_tracks_homework_body },
		{ icon: Music, title: m.home_tracks_skills_title, body: m.home_tracks_skills_body },
		{ icon: Flame, title: m.home_tracks_streaks_title, body: m.home_tracks_streaks_body }
	];
</script>

<svelte:head>
	<title>Sherab</title>
</svelte:head>

<AuthCard title={m.home_welcome_title()} subtitle={m.home_poster_blurb()}>
	<p class="text-center {ui.muted}">{m.home_welcome_signin_prompt()}</p>
	<div class="mt-4 flex flex-col gap-3">
		<Button href={resolve('/login')} class="{ui.touch} w-full gap-2">
			<LogIn class="size-5" aria-hidden="true" />
			{m.nav_sign_in()}
		</Button>
		<Button href={resolve('/join')} variant="outline" class="{ui.touch} w-full">
			{m.nav_join()}
		</Button>
	</div>

	{#snippet footer()}
		<a href={resolve('/help')} class={auth.link}>{m.help_link()}</a>
	{/snippet}

	{#snippet after()}
		<div
			data-testid="home-sections"
			class="mt-8 flex w-full max-w-5xl min-w-0 flex-col gap-8 md:mt-12 md:gap-12"
		>
			<section aria-labelledby="home-join-heading" data-testid="home-join">
				<h2 id="home-join-heading" class={sectionHeading}>{m.home_join_heading()}</h2>
				<ol class="flex flex-col gap-3">
					{#each steps as step, i (i)}
						<li class="{ui.card} flex gap-4">
							<span
								class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground tabular-nums"
								aria-hidden="true">{i + 1}</span
							>
							<div class="min-w-0">
								<h3 class={itemTitle}>{step.title()}</h3>
								<p class="mt-1 wrap-break-word {ui.muted}">{step.body()}</p>
							</div>
						</li>
					{/each}
				</ol>
			</section>

			<section aria-labelledby="home-tracks-heading" data-testid="home-tracks">
				<h2 id="home-tracks-heading" class={sectionHeading}>{m.home_tracks_heading()}</h2>
				<ul class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					{#each tracks as track, i (i)}
						<li class={ui.card}>
							<track.icon class="mb-2 size-6 text-primary" aria-hidden="true" />
							<h3 class={itemTitle}>{track.title()}</h3>
							<p class="mt-1 wrap-break-word {ui.muted}">{track.body()}</p>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	{/snippet}
</AuthCard>
