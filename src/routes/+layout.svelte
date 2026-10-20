<script lang="ts">
	import '@siemens/ix/dist/siemens-ix/siemens-ix.css';
	import '../app.css';
	import '$lib/ui/tailwind.css';
	import { onMount } from 'svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';
	import { routeIxLinks, setupIx, showToast } from '$lib/ix';
	import AppHeader from '$lib/components/shell/AppHeader.svelte';
	import BottomNav from '$lib/components/shell/BottomNav.svelte';
	import HelpSheet from '$lib/components/shell/HelpSheet.svelte';
	import PortalRoot from '$lib/components/shell/PortalRoot.svelte';
	import PublicHeader from '$lib/components/shell/PublicHeader.svelte';
	import SideNav from '$lib/components/shell/SideNav.svelte';
	import NewBadgeDialog from '$lib/components/NewBadgeDialog.svelte';
	import PageTour from '$lib/components/PageTour.svelte';
	import { HELP_ROLES, helpRoleFor } from '$lib/help';
	import { navItems, tabItems } from '$lib/nav';
	import { releasePush, syncPush } from '$lib/push-client';
	import { roleHome } from '$lib/role-home';
	import { tourFor } from '$lib/tours';

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

	// #100: a student who is not approved (pending or rejected) has only the
	// status page, so no nav entries and no account page.
	let unapprovedStudent = $derived(
		data.profile?.role === 'student' && data.profile.status !== 'approved'
	);

	// Story 2: the side nav (from 80em) and the bottom tab bar (below it),
	// per role in the order of stack.md (src/lib/nav.ts).
	let navOptions = $derived({
		pendingRequests: data.pendingRequestsCount,
		unapprovedStudent
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
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	{#if pwaInfo}
		<link rel="manifest" href={pwaInfo.webManifest.href} />
	{/if}
</svelte:head>

{#if data.profile}
	<!-- Story 2: the new shell. Its chrome carries data-ui="new"; a page
	     inside <main> is iX until migrated, then has its own new-UI root. -->
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
			<!-- iX's content area padding, so the pages inside are unchanged. -->
			<main
				class="min-w-0 flex-1 pt-3 pr-[max(2rem,env(safe-area-inset-right))] pb-1 pl-[max(2rem,env(safe-area-inset-left))]"
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
			class="min-w-0 flex-1 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
		>
			{@render children()}
		</main>
	</div>
{/if}
<PortalRoot />
