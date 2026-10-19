<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import HelpFaq from '$lib/components/HelpFaq.svelte';
	import HelpGuide from '$lib/components/HelpGuide.svelte';
	import { HELP_ROLES, helpRoleFor, helpTabLabels } from '$lib/help';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * #87: how-to guides for parents, teachers and students, and shared FAQs.
	 * Open without signing in, so someone who can't get in yet can read it;
	 * signed in, the same content opens from the shell's help sheet. Link-based
	 * tabs (?role=, ≥44px, `aria-current`), like the parent's child page; a
	 * signed-in visitor starts on their own role's guide. Mobile-first story 5.
	 */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	let role = $derived(
		helpRoleFor(page.url.searchParams.get('role'), data.activeRole ?? data.profile?.role)
	);
	const baseHref = resolve('/help');
	// Signed out there is no shell: <main> has no padding to take back.
	let frame = $derived(
		data.profile
			? ui.page
			: 'flex min-w-0 flex-col gap-4 px-4 pt-6 pb-8 md:mx-auto md:max-w-5xl md:gap-6'
	);
</script>

<svelte:head>
	<title>{m.help_heading()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={frame} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div class="min-w-0">
			<h1 class={ui.heading}>{m.help_heading()}</h1>
			<p class={ui.subtitle}>{m.help_subtitle()}</p>
		</div>
	</header>

	<nav aria-label={m.help_tabs_label()}>
		<ul class="flex flex-wrap gap-2">
			{#each HELP_ROLES as tab (tab)}
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- baseHref is resolve()d; only ?role= is added. -->
					<a
						href="{baseHref}?role={tab}"
						aria-current={role === tab ? 'page' : undefined}
						class="{ui.filter} {role === tab ? ui.filterCurrent : ui.filterOther}"
					>
						{helpTabLabels[tab]()}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<section class={ui.card} aria-label={helpTabLabels[role]()}>
		<HelpGuide {role} />
	</section>

	<section class={ui.card} aria-labelledby="help-faq-heading">
		<h2 id="help-faq-heading" class={ui.cardTitle}>{m.help_faq_heading()}</h2>
		<HelpFaq />
	</section>
</div>
