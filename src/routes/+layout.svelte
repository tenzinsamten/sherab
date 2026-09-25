<script lang="ts">
	import '@siemens/ix/dist/siemens-ix/siemens-ix.css';
	import '../app.css';
	import { onMount } from 'svelte';
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getLocale, locales, localizeHref } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages.js';
	import { headerHomeLink, routeIxLinks, setupIx, showToast } from '$lib/ix';
	import { rememberMenuExpand } from '$lib/menu';
	import { roleHome } from '$lib/role-home';
	import flagTibet from '$lib/assets/flag-tibet.svg';

	const localeFlags: Record<string, { emoji?: string; icon?: string; name: string }> = {
		en: { emoji: '🇬🇧', name: 'English' },
		de: { emoji: '🇩🇪', name: 'Deutsch' },
		bo: { icon: flagTibet, name: 'བོད་སྐད།' }
	};

	let { children, data } = $props();

	onMount(() => {
		setupIx();
		return routeIxLinks();
	});

	// Every form action on every route returns `fail(..., { error })` on
	// failure -- page.form is that latest action result app-wide, so error
	// toasts live here once instead of in each page. Plain variables (not
	// $state) just remember what was already shown.
	let lastForm: unknown;
	$effect(() => {
		const form = page.form as { error?: unknown } | null;
		if (!form || form === lastForm) return;
		lastForm = form;
		if (typeof form.error === 'string' && form.error) showToast('error', form.error);
	});

	let lastLoadErrorUrl = '';
	$effect(() => {
		const url = page.url.href;
		if (page.data.loadError && url !== lastLoadErrorUrl) {
			lastLoadErrorUrl = url;
			showToast('error', m.load_error_generic());
		}
	});

	// Signup redirects with ?justSignedUp=1; `/` forwards the query to the
	// role's start page, so the confirmation is shown wherever the user lands.
	$effect(() => {
		if (page.url.searchParams.has('justSignedUp')) showToast('success', m.home_just_signed_up());
	});

	// resolve() for an arbitrary pathname. Passing a Pathname union straight to
	// resolve()'s per-route overloads stops type-checking once the app has more
	// than 25 routes (TypeScript's union comparison limit).
	const resolvePathname = (path: string) => (resolve as (p: Pathname) => string)(path as Pathname);

	let homeHref = $derived(resolve(roleHome(data.profile?.role) ?? '/'));

	let signOutForm: HTMLFormElement | undefined = $state();

	type NavItem = { href: string; label: string; icon: string; exact?: boolean };

	let navItems = $derived.by((): NavItem[] => {
		const role = data.profile?.role;
		const requests = {
			href: resolve('/requests'),
			label: data.pendingRequestsCount
				? m.nav_requests_with_count({ count: data.pendingRequestsCount })
				: m.nav_requests(),
			icon: 'user-check'
		};
		const leaderboard = {
			href: resolve('/leaderboard'),
			label: m.nav_leaderboard(),
			icon: 'trophy'
		};
		if (role === 'admin') {
			return [
				{ href: resolve('/admin'), label: m.nav_dashboard(), icon: 'dashboard', exact: true },
				{ href: resolve('/admin/classes'), label: m.nav_classes(), icon: 'book' },
				{ href: resolve('/admin/teachers'), label: m.nav_teachers(), icon: 'user-reading' },
				{ href: resolve('/admin/teams'), label: m.nav_teams(), icon: 'user-group' },
				requests,
				leaderboard
			];
		}
		if (role === 'teacher') {
			return [
				{ href: resolve('/teacher'), label: m.nav_dashboard(), icon: 'dashboard', exact: true },
				requests,
				leaderboard
			];
		}
		if (role === 'student') {
			return [
				{ href: resolve('/student'), label: m.nav_my_homework(), icon: 'tasks-open' },
				leaderboard
			];
		}
		return [];
	});

	function isActive(item: NavItem) {
		const path = page.url.pathname;
		return item.exact ? path === item.href : path === item.href || path.startsWith(item.href + '/');
	}
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/favicon-32.png" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>

{#snippet headerItems()}
	<!-- The "avatar" slot is the header's only right-hand slot that never
	     collapses into the small-screen "more" overflow menu, so the language
	     switch stays one tap away on phones. -->
	<ix-dropdown-button
		slot="ix-application-header-avatar"
		enable-top-layer
		variant="subtle-tertiary"
		icon="globe"
		label={localeFlags[getLocale()]?.name ?? getLocale()}
		aria-label={m.footer_locale_label()}
	>
		{#each locales as locale (locale)}
			{@const flag = localeFlags[locale]}
			<!-- Full page load (not client routing): the locale is read server-side. -->
			<ix-dropdown-item
				checked={getLocale() === locale || undefined}
				lang={locale}
				onclick={() =>
					window.location.assign(resolvePathname(localizeHref(page.url.pathname, { locale })))}
			>
				<span class="locale-option">
					{#if flag?.icon}
						<img src={flag.icon} alt="" width="18" height="12" />
					{:else if flag?.emoji}
						<span aria-hidden="true">{flag.emoji}</span>
					{/if}
					{flag?.name ?? locale}
				</span>
			</ix-dropdown-item>
		{/each}
	</ix-dropdown-button>
{/snippet}

{#if data.profile}
	<ix-application>
		<ix-application-header
			name="Sherab"
			name-suffix={data.profile.role}
			use:headerHomeLink={homeHref}
		>
			{@render headerItems()}
		</ix-application-header>

		<ix-menu start-expanded={data.menuExpanded || undefined} use:rememberMenuExpand>
			{#each navItems as item (item.href)}
				<ix-menu-item href={item.href} icon={item.icon} active={isActive(item) || undefined}>
					{item.label}
				</ix-menu-item>
			{/each}
			{#if data.profile?.role === 'admin' || data.profile?.role === 'teacher'}
				<ix-menu-item
					slot="bottom"
					href={resolve('/account')}
					icon="user"
					active={page.url.pathname.endsWith('/account') || undefined}
				>
					{m.nav_account()}
				</ix-menu-item>
			{/if}
			<ix-menu-item slot="bottom" icon="log-out" onclick={() => signOutForm?.requestSubmit()}>
				{m.nav_sign_out()}
			</ix-menu-item>
		</ix-menu>
		<form bind:this={signOutForm} method="POST" action={resolve('/logout')} hidden></form>

		<ix-content>
			{@render children()}
		</ix-content>
	</ix-application>
{:else}
	<!-- Signed out: no side menu, so the header stands alone -- inside
	     <ix-application> it would always show a menu toggle on small screens. -->
	<div class="app-public">
		<ix-application-header name="Sherab" use:headerHomeLink={resolve('/')}>
			{@render headerItems()}
		</ix-application-header>
		<main class="app-public-main">
			{@render children()}
		</main>
	</div>
{/if}
