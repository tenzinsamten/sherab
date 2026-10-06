<script lang="ts">
	import '@siemens/ix/dist/siemens-ix/siemens-ix.css';
	import '../app.css';
	import { onMount } from 'svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getLocale, locales, setLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages.js';
	import {
		avatarLabel,
		dropdownButtonLabelRoom,
		headerHomeLink,
		menuAboutPanels,
		menuItemLabelRoom,
		routeIxLinks,
		setupIx,
		showToast
	} from '$lib/ix';
	import { initials } from '$lib/initials';
	import HelpFaq from '$lib/components/HelpFaq.svelte';
	import HelpGuide from '$lib/components/HelpGuide.svelte';
	import { HELP_ROLES, helpRoleFor, helpTabLabels } from '$lib/help';
	import { rememberMenuExpand } from '$lib/menu';
	import { releasePush, syncPush } from '$lib/push-client';
	import { roleHome } from '$lib/role-home';
	import flagTibet from '$lib/assets/flag-tibet.svg';
	import logoWhite from '$lib/assets/sherab-logo-white.svg';

	const localeFlags: Record<string, { emoji?: string; icon?: string; name: string }> = {
		en: { emoji: '🇬🇧', name: 'English' },
		de: { emoji: '🇩🇪', name: 'Deutsch' },
		bo: { icon: flagTibet, name: 'བོད་སྐད།' }
	};

	let { children, data } = $props();

	onMount(() => {
		setupIx();
		// #81: without this nothing registers the service worker the build emits.
		if (pwaInfo) {
			import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
		}
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

	// B13 (#68): menu, home link and `/` follow the active role -- the only
	// role for a single-role login, the picked one for a login whose profile
	// role isn't parent (in practice a teacher or admin) that is also an
	// approved parent. Access itself never depends on it.
	let role = $derived(data.activeRole ?? data.profile?.role);
	let homeHref = $derived(resolve(roleHome(role) ?? '/'));

	// #92: a browser subscribed to homework notifications belongs to whoever
	// is signed in. Runs on load and again when another account signs in
	// without a full page load; a signed-out browser is left alone.
	let pushOwner = '';
	$effect(() => {
		const userId = data.session?.user.id ?? '';
		if (userId === pushOwner) return;
		pushOwner = userId;
		if (userId) void syncPush();
	});

	// The account stops receiving on this browser, then signs out.
	async function signOut() {
		await releasePush();
		signOutForm?.requestSubmit();
	}

	let signOutForm: HTMLFormElement | undefined = $state();
	let roleForm: HTMLFormElement | undefined = $state();
	let roleInput: HTMLInputElement | undefined = $state();

	const roleNames: Record<string, () => string> = {
		admin: m.role_name_admin,
		teacher: m.role_name_teacher,
		parent: m.role_name_parent,
		student: m.role_name_student
	};

	// Always posted, even for the checked role: on a /teacher or /parent page
	// the URL decided the check, and the cookie may still hold the other role.
	function switchRole(next: string) {
		if (!roleForm || !roleInput) return;
		roleInput.value = next;
		roleForm.requestSubmit();
	}

	// #64: the header avatar's menu shows the display name (falling back to
	// the e-mail), with initials on the avatar itself. No role label next to
	// the name (#62); B13 lists the roles as menu items only for a login
	// holding more than one.
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

	// #87: the help overlay opens on the active role's guide (the parents'
	// for an admin), so that tab comes first.
	let helpRoles = $derived.by(() => {
		const own = helpRoleFor(null, role);
		return [own, ...HELP_ROLES.filter((r) => r !== own)];
	});

	function isActive(item: NavItem) {
		const path = page.url.pathname;
		return item.exact ? path === item.href : path === item.href || path.startsWith(item.href + '/');
	}
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	{#if pwaInfo}
		<link rel="manifest" href={pwaInfo.webManifest.href} />
	{/if}
</svelte:head>

{#snippet languageItems()}
	{#each locales as locale (locale)}
		{@const flag = localeFlags[locale]}
		<!-- #79: writes the language cookie and reloads the page (the server
		     picks names and messages from it). -->
		<ix-dropdown-item
			checked={getLocale() === locale || undefined}
			lang={locale}
			onclick={() => setLocale(locale)}
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
			<!-- ≥ 48em the logo is the home link and the name text is hidden;
			     below it iX hides this slot and the name is the link. -->
			<a slot="logo" class="header-logo" href={homeHref}>
				<img src={logoWhite} alt={m.nav_logo_alt()} width="58" height="32" />
			</a>
			<!-- Decision 1 (#64): signed in, the language picker sits in the
			     default right-hand slot next to the avatar; on small screens
			     iX folds it into the header's "more" menu. -->
			<ix-dropdown-button
				enable-top-layer
				variant="subtle-tertiary"
				icon="globe"
				label={localeFlags[getLocale()]?.name ?? getLocale()}
				aria-label={m.footer_locale_label()}
				use:dropdownButtonLabelRoom
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
				{#if data.roles.length > 1}
					<!-- B13 (#68): only a login holding more than one role sees these. -->
					<ix-dropdown-header label={m.role_switch_label()}></ix-dropdown-header>
					{#each data.roles as held (held)}
						<ix-dropdown-item
							data-role-option={held}
							label={roleNames[held]?.() ?? held}
							checked={held === role || undefined}
							onclick={() => switchRole(held)}
						></ix-dropdown-item>
					{/each}
					<ix-divider></ix-divider>
				{/if}
				<ix-dropdown-item
					icon="user"
					label={m.nav_account()}
					onclick={() => void goto(resolve('/account'))}
				></ix-dropdown-item>
				<ix-dropdown-item icon="log-out" label={m.nav_sign_out()} onclick={() => void signOut()}
				></ix-dropdown-item>
			</ix-avatar>
		</ix-application-header>

		<ix-menu
			start-expanded={data.menuExpanded || undefined}
			i18n-legal={m.nav_help()}
			use:rememberMenuExpand
		>
			{#each navItems as item (item.href)}
				<ix-menu-item
					href={item.href}
					icon={item.icon}
					active={isActive(item) || undefined}
					notifications={item.notifications}
					use:menuItemLabelRoom
				>
					{item.label}
				</ix-menu-item>
			{/each}
			<!-- #87: iX's "About and legal" overlay, opened from the button at the
			     foot of the menu, holds the guides and FAQs as its tabs. -->
			<!-- svelte-ignore a11y_unknown_aria_attribute (an iX prop, the close button's label) -->
			<ix-menu-about
				label={m.help_heading()}
				aria-label-close-button={m.help_close()}
				use:menuAboutPanels
			>
				{#each helpRoles as helpRole (helpRole)}
					<ix-menu-about-item tab-key={helpRole} label={helpTabLabels[helpRole]()}>
						<HelpGuide role={helpRole} />
					</ix-menu-about-item>
				{/each}
				<ix-menu-about-item tab-key="faq" label={m.help_faq_heading()}>
					<HelpFaq />
				</ix-menu-about-item>
			</ix-menu-about>
		</ix-menu>
		<form bind:this={signOutForm} method="POST" action={resolve('/logout')} hidden></form>
		<form bind:this={roleForm} method="POST" action={resolve('/role')} hidden>
			<input bind:this={roleInput} type="hidden" name="role" />
		</form>

		<ix-content>
			{@render children()}
		</ix-content>
	</ix-application>
{:else}
	<!-- Signed out: no side menu, so the header stands alone -- inside
	     <ix-application> it would always show a menu toggle on small screens. -->
	<div class="app-public">
		<ix-application-header name="Sherab" use:headerHomeLink={resolve('/')}>
			<a slot="logo" class="header-logo" href={resolve('/')}>
				<img src={logoWhite} alt={m.nav_logo_alt()} width="58" height="32" />
			</a>
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
				use:dropdownButtonLabelRoom
			>
				{@render languageItems()}
			</ix-dropdown-button>
		</ix-application-header>
		<main class="app-public-main">
			{@render children()}
		</main>
	</div>
{/if}
