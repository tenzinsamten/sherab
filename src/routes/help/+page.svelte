<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import HelpFaq from '$lib/components/HelpFaq.svelte';
	import HelpGuide from '$lib/components/HelpGuide.svelte';
	import { HELP_ROLES, helpRoleFor, helpTabLabels } from '$lib/help';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	/**
	 * #87: how-to guides for parents, teachers and students, and shared FAQs.
	 * Open without signing in, so someone who can't get in yet can read it;
	 * signed in, the same content opens from the menu's help button (root
	 * layout). Link-based tabs (?role=), like the parent's child page; a
	 * signed-in visitor starts on their own role's guide.
	 */
	let { data }: PageProps = $props();

	let role = $derived(
		helpRoleFor(page.url.searchParams.get('role'), data.activeRole ?? data.profile?.role)
	);
	const baseHref = resolve('/help');
</script>

<svelte:head>
	<title>{m.help_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<h1 class="page-heading">{m.help_heading()}</h1>
			<p class="page-subtitle">{m.help_subtitle()}</p>
		</div>
	</header>

	<nav class="tabs" aria-label={m.help_tabs_label()}>
		<ul>
			{#each HELP_ROLES as tab (tab)}
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- baseHref is resolve()d; only ?role= is added. -->
					<a href="{baseHref}?role={tab}" aria-current={role === tab ? 'page' : undefined}>
						{helpTabLabels[tab]()}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<section class="card" aria-label={helpTabLabels[role]()}>
		<HelpGuide {role} />
	</section>

	<section class="card" aria-labelledby="help-faq-heading">
		<h2 id="help-faq-heading">{m.help_faq_heading()}</h2>
		<HelpFaq />
	</section>
</div>

<style>
	.tabs {
		margin-bottom: var(--space-4);
		border-bottom: 1px solid var(--theme-color-soft-bdr, rgba(0, 0, 0, 0.1));
		overflow-x: auto;
	}

	.tabs ul {
		display: flex;
		gap: var(--space-1);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.tabs a {
		display: inline-block;
		padding: var(--space-2) var(--space-3);
		color: inherit;
		text-decoration: none;
		white-space: nowrap;
		border-bottom: 3px solid transparent;
	}

	.tabs a:hover,
	.tabs a:focus-visible {
		text-decoration: underline;
	}

	.tabs a[aria-current='page'] {
		font-weight: 700;
		border-bottom-color: var(--theme-color-primary, currentColor);
	}
</style>
