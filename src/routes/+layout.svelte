<script lang="ts">
	import '@siemens/ix/dist/siemens-ix/siemens-ix.css';
	import '../app.css';
	import { onMount } from 'svelte';
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getLocale, locales, localizeHref } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages.js';
	import { avatarLabel, headerHomeLink, routeIxLinks, setupIx, showToast } from '$lib/ix';
	import { initials } from '$lib/initials';
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

	// resolve() for an arbitrary pathname. Passing a Pathname union straight to
	// resolve()'s per-route overloads stops type-checking once the app has more
	// than 25 routes (TypeScript's union comparison limit).
	const resolvePathname = (path: string) => (resolve as (p: Pathname) => string)(path as Pathname);

	let homeHref = $derived(resolve(roleHome(data.profile?.role) ?? '/'));

	let signOutForm: HTMLFormElement | undefined = $state();

	// #64: the header avatar's menu shows the display name (falling back to
	// the e-mail), with initials on the avatar itself. No role anywhere (#62).
	let userName = $derived(data.profile?.display_name?.trim() || data.profile?.email || '');

	type NavItem = {
		href: string;
		label: string;
		icon: string;
		exact?: boolean;
		/** #60: shown as the iX menu item's count pill (omitted at 0). */
		notifications?: number;
	};

	let navItems = $derived.by((): NavItem[] => {
		const role = data.profile?.role;
		const requests = {
			href: resolve('/requests'),
			label: m.nav_requests(),
			icon: 'user-check',
			notifications: data.pendingRequestsCount || undefined
		};
		const leaderboard = {
			href: resolve('/leaderboard'),
			label: m.nav_leaderboard(),
			icon: 'trophy'
		};
		const calendar = {
			href: resolve('/calendar'),
			label: m.nav_calendar(),
			icon: 'calendar'
		};
		if (role === 'admin') {
			return [
				{ href: resolve('/admin'), label: m.nav_dashboard(), icon: 'dashboard', exact: true },
				{ href: resolve('/admin/classes'), label: m.nav_classes(), icon: 'book' },
				{ href: resolve('/admin/teachers'), label: m.nav_teachers(), icon: 'user-reading' },
				{ href: resolve('/admin/parents'), label: m.nav_parents(), icon: 'user-management' },
				{ href: resolve('/admin/teams'), label: m.nav_teams(), icon: 'user-group' },
				calendar,
				requests,
				leaderboard
			];
		}
		if (role === 'teacher') {
			return [
				{ href: resolve('/teacher'), label: m.nav_dashboard(), icon: 'dashboard', exact: true },
				calendar,
				requests,
				leaderboard
			];
		}
		if (role === 'student') {
			return [
				{ href: resolve('/student'), label: m.nav_dashboard(), icon: 'dashboard', exact: true },
				{ href: resolve('/student/classes'), label: m.nav_my_classes(), icon: 'book' },
				{ href: resolve('/student/homework'), label: m.nav_my_homework(), icon: 'tasks-open' },
				calendar,
				{ ...leaderboard, label: m.nav_team_leaderboard() }
			];
		}
		if (role === 'parent') {
			return [
				{ href: resolve('/parent'), label: m.nav_dashboard(), icon: 'dashboard', exact: true },
				{ href: resolve('/parent/homework'), label: m.nav_homework(), icon: 'tasks-open' },
				calendar
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

{#snippet languageItems()}
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
{/snippet}

{#if data.profile}
	<ix-application>
		<ix-application-header name="Sherab" use:headerHomeLink={homeHref}>
			<!-- Decision 1 (#64): signed in, the language picker sits in the
			     default right-hand slot next to the avatar; on small screens
			     iX folds it into the header's "more" menu. -->
			<ix-dropdown-button
				enable-top-layer
				variant="subtle-tertiary"
				icon="globe"
				label={localeFlags[getLocale()]?.name ?? getLocale()}
				aria-label={m.footer_locale_label()}
			>
				{@render languageItems()}
			</ix-dropdown-button>
			<ix-avatar
				slot="ix-application-header-avatar"
				username={userName}
				initials={initials(userName) || undefined}
				use:avatarLabel={userName
					? m.header_account_menu_label({ name: userName })
					: m.nav_account()}
			>
				<ix-dropdown-item
					icon="user"
					label={m.nav_account()}
					onclick={() => void goto(resolve('/account'))}
				></ix-dropdown-item>
				<ix-dropdown-item
					icon="log-out"
					label={m.nav_sign_out()}
					onclick={() => signOutForm?.requestSubmit()}
				></ix-dropdown-item>
			</ix-avatar>
		</ix-application-header>

		<ix-menu start-expanded={data.menuExpanded || undefined} use:rememberMenuExpand>
			{#each navItems as item (item.href)}
				<ix-menu-item
					href={item.href}
					icon={item.icon}
					active={isActive(item) || undefined}
					notifications={item.notifications}
				>
					{item.label}
				</ix-menu-item>
			{/each}
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
			<!-- The "avatar" slot is the header's only right-hand slot that never
			     collapses into the small-screen "more" overflow menu, so the
			     language switch stays one tap away on phones. -->
			<ix-dropdown-button
				slot="ix-application-header-avatar"
				enable-top-layer
				variant="subtle-tertiary"
				icon="globe"
				label={localeFlags[getLocale()]?.name ?? getLocale()}
				aria-label={m.footer_locale_label()}
			>
				{@render languageItems()}
			</ix-dropdown-button>
		</ix-application-header>
		<main class="app-public-main">
			{@render children()}
		</main>
	</div>
{/if}
