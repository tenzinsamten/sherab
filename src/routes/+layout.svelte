<script lang="ts">
	import '../app.css';
	import '$lib/ui/tailwind.css';
	import { onMount } from 'svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/toast';
	import AppHeader from '$lib/components/shell/AppHeader.svelte';
	import BottomNav from '$lib/components/shell/BottomNav.svelte';
	import HelpSheet from '$lib/components/shell/HelpSheet.svelte';
	import NavProgress from '$lib/components/shell/NavProgress.svelte';
	import PortalRoot from '$lib/components/shell/PortalRoot.svelte';
	import PublicHeader from '$lib/components/shell/PublicHeader.svelte';
	import SideNav from '$lib/components/shell/SideNav.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import NewBadgeDialog from '$lib/components/NewBadgeDialog.svelte';
	import PageTour from '$lib/components/PageTour.svelte';
	import { runningActions } from '$lib/busy.svelte';
	import { HELP_ROLES, helpRoleFor } from '$lib/help';
	import { navItems, tabItems } from '$lib/nav';
	import { releasePush, syncPush } from '$lib/push-client';
	import { roleHome } from '$lib/role-home';
	import { tourFor } from '$lib/tours';

	let { children, data } = $props();

	// Story 11: a navigation in progress, or a page action (createPending,
	// counted app-wide) posting and reloading data. Both show the loading
	// bar after 150 ms (NavProgress, which also sets `busyShown`). Only a
	// navigation blocks <main> (inert, from the first moment, so a fast
	// double tap is caught) and fades it once the bar shows; an action never
	// does, because inert would move focus off its pressed button. The
	// header, side nav and bottom nav sit outside <main> and stay usable, so
	// a slow navigation can be replaced by another one.
	let navBusy = $derived(navigating.to !== null);
	let busy = $derived(navBusy || runningActions() > 0);
	let busyShown = $state(false);
	// The transition only while fading out, so an arriving page shows at full
	// opacity at once instead of fading in from 60%. Whole class tokens, so
	// Tailwind's scanner finds them.
	let mainFade = $derived(navBusy && busyShown ? 'opacity-60 transition-opacity' : '');

	onMount(() => {
		// #81: without this nothing registers the service worker the build emits.
		if (pwaInfo) {
			import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
		}
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

	// #100: a student who is not approved (pending or rejected) has only the
	// status page, so no nav entries and no account page.
	let unapprovedStudent = $derived(
		data.profile?.role === 'student' && data.profile.status !== 'approved'
	);

	// Story 2: the side nav (from 80em) and the bottom tab bar (below it),
	// per role in the order of stack.md (src/lib/nav.ts).
	// spec-parent-message-board story 3: no Board link while the parent
	// shell belongs to a parent who is not approved (the board would 403).
	let boardHidden = $derived(role === 'parent' && !data.parentApproved);
	let navOptions = $derived({
		pendingRequests: data.pendingRequestsCount,
		unapprovedStudent,
		boardHidden
	});
	let sideItems = $derived(navItems(role, navOptions));
	let tabs = $derived(tabItems(role, navOptions));

	// #87: the help overlay opens on the active role's guide (the parents'
	// for an admin), so that tab comes first.
	let helpRoles = $derived.by(() => {
		const own = helpRoleFor(null, role);
		return [own, ...HELP_ROLES.filter((r) => r !== own)];
	});

	// #101: the page's guided tour for the active role, if it has one. Help
	// offers to run it again; PageTour starts it by itself the first time.
	let tour = $derived(tourFor(role, page.route.id, page.url.searchParams.get('tab')));
	let pageTour: PageTour | undefined = $state();
	let helpOpen = $state(false);

	function openHelp() {
		helpOpen = true;
	}

	// A page change (a link, back/forward, goto) closes Help.
	$effect(() => {
		void page.url.pathname;
		helpOpen = false;
	});

	// Help closes first: the tour points at the page behind it, so it
	// starts once the sheet has finished closing (HelpSheet's onClosed).
	let replayPending = false;
	function replayTour() {
		replayPending = true;
		helpOpen = false;
	}

	async function helpClosed() {
		if (!replayPending) return;
		replayPending = false;
		const started = await pageTour?.start();
		if (!started) showToast('info', m.tour_nothing_here());
	}

	// #122: the skip link moves focus to the page's <main>, focusable only
	// until it loses focus again.
	function skipToContent(event: MouseEvent) {
		const main = document.getElementById('main');
		if (!main) return;
		event.preventDefault();
		main.tabIndex = -1;
		main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
		main.focus();
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

<!-- Story 11: one bar for both shells (mounted once, outside the branches,
     so signing in or out never restarts it mid-load). -->
<NavProgress {busy} bind:shown={busyShown} />
<!-- #122: first in the tab order, above the screen until focused (not
     sr-only: Tailwind's not-sr-only would force it static); skips the header
     and the navigation to the page (both shells' <main> are #main). With JS
     it focuses <main> without a hash or history entry, and <main> is
     focusable only for that moment (else a click on its text would focus it). -->
<a
	data-ui="new"
	href="#main"
	onclick={skipToContent}
	class="fixed top-2 left-2 z-50 -translate-y-[calc(100%+1rem)] rounded-md bg-background px-4 py-3 font-medium text-foreground focus:translate-y-0 focus:shadow-md focus:outline-2 focus:outline-solid focus:outline-offset-2 focus:outline-ring"
	>{m.skip_to_content()}</a
>
{#if data.profile}
	<!-- Story 2: the new shell. Its chrome carries data-ui="new"; every page
	     inside <main> has its own new-UI root. -->
	<div class="flex min-h-dvh flex-col" data-app-shell>
		<AppHeader
			{homeHref}
			{userName}
			roles={data.roles}
			{role}
			{roleNames}
			showAccount={!unapprovedStudent}
			showHelp={role === 'student'}
			onAccount={() => void goto(resolve('/account'))}
			onHelp={openHelp}
			onSwitchRole={switchRole}
			onSignOut={() => void signOut()}
		/>
		<div class="flex flex-1">
			{#if sideItems.length > 0}
				<SideNav
					items={sideItems}
					pathname={page.url.pathname}
					initialExpanded={data.menuExpanded}
					onHelp={openHelp}
				/>
			{/if}
			<!-- The content gutter: 1rem on a phone, 2rem from 48em, at least the
			     safe-area inset. Only here: `ui.page` centres the page and caps
			     its width but adds no side margin. -->
			<main
				id="main"
				class="min-w-0 flex-1 outline-none pt-3 pr-[max(1rem,env(safe-area-inset-right))] pb-1 pl-[max(1rem,env(safe-area-inset-left))] motion-reduce:transition-none md:pr-[max(2rem,env(safe-area-inset-right))] md:pl-[max(2rem,env(safe-area-inset-left))] {mainFade}"
				aria-busy={busy || undefined}
				inert={navBusy || undefined}
			>
				{@render children()}
			</main>
		</div>
		{#if tabs.length > 0}
			<BottomNav items={tabs} pathname={page.url.pathname} onHelp={openHelp} />
		{/if}
	</div>
	<HelpSheet
		bind:open={helpOpen}
		{helpRoles}
		{role}
		hasTour={Boolean(tour)}
		onReplayTour={replayTour}
		onClosed={() => void helpClosed()}
	/>
	<form bind:this={signOutForm} method="POST" action={resolve('/logout')} hidden></form>
	<form bind:this={roleForm} method="POST" action={resolve('/role')} hidden>
		<input bind:this={roleInput} type="hidden" name="role" />
	</form>
	<PageTour
		bind:this={pageTour}
		{role}
		userId={data.profile.id}
		seen={data.profile.tours_seen ?? []}
		{helpOpen}
	/>
	<!-- Badge detail CAP-9: the student's own view only. Students have no
	     page tours (src/lib/tours.ts), so the two never open together. -->
	{#if role === 'student' && data.newBadges.length > 0}
		<NewBadgeDialog badges={data.newBadges} userId={data.profile.id} />
	{/if}
{:else}
	<!-- Signed out (story 6): the header and the page, no navigation. The
	     page is laid out edge to edge (viewport-fit=cover), so the page keeps
	     clear of a landscape iPhone's notch and the home indicator. -->
	<div class="flex min-h-dvh flex-col bg-muted" data-public-shell>
		<PublicHeader homeHref={resolve('/')} />
		<main
			id="main"
			class="min-w-0 flex-1 outline-none pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] motion-reduce:transition-none {mainFade}"
			aria-busy={busy || undefined}
			inert={navBusy || undefined}
		>
			{@render children()}
		</main>
	</div>
{/if}
<!-- Story 10: every toast (showToast, $lib/toast), top right as iX's were,
     5 s, dismissible, listed rather than stacked (expand); inside a new-UI
     root so the reset and utilities apply. -->
<div data-ui="new">
	<Toaster
		position="top-right"
		duration={5000}
		richColors
		expand
		closeButton
		closeButtonAriaLabel={m.common_close()}
	/>
</div>
<PortalRoot />
