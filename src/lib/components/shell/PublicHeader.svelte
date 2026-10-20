<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import LocaleMenu from './LocaleMenu.svelte';
	import logoWhite from '$lib/assets/sherab-logo-white.svg';

	/**
	 * The signed-out header (story 6, CAP-6): the logo as the home link and
	 * the language switch, the same navy bar as the signed-in AppHeader.
	 */
	let { homeHref }: { homeHref: string } = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- homeHref is resolve()d by the layout. -->

<header
	data-ui="new"
	data-testid="public-header"
	class="box-content flex h-14 items-center gap-1 bg-frame pt-[env(safe-area-inset-top)] pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.5rem,env(safe-area-inset-left))] text-frame-foreground"
>
	<a
		href={homeHref}
		data-testid="header-home"
		class="flex h-11 shrink-0 items-center rounded-md px-1.5 focus-visible:outline-2 focus-visible:outline-frame-foreground"
	>
		<img src={logoWhite} alt={m.nav_logo_alt()} width="58" height="32" class="block h-8 w-auto" />
	</a>

	<div class="ml-auto flex items-center">
		<LocaleMenu />
	</div>
</header>
