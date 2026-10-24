<script lang="ts">
	import SearchXIcon from '@lucide/svelte/icons/search-x';
	import ShieldXIcon from '@lucide/svelte/icons/shield-x';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { errorKind } from '$lib/error-page';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { roleHome } from '$lib/role-home';
	import { ui } from '$lib/ui/classes';

	/**
	 * #115: every error under the root layout (an unknown address, a 403 from
	 * a role layout, an error thrown in a load or an action; a `fail()` stays
	 * on its page as a toast) lands here, inside the shell, so the header and
	 * navigation stay. The server's own message ("Admin access only.") is
	 * English and not meant for users, so only the status number is shown with
	 * a translated text, and a way back: the role's home, or `/` signed out,
	 * and for anything but a missing or refused page, the same address again
	 * (a plain link, so it reloads with or without JavaScript).
	 */
	let kind = $derived(errorKind(page.status));
	let heading = $derived(
		kind === 'not-found'
			? m.error_not_found_heading()
			: kind === 'forbidden'
				? m.error_forbidden_heading()
				: m.error_generic_heading()
	);
	let body = $derived(
		kind === 'not-found'
			? m.error_not_found_body()
			: kind === 'forbidden'
				? m.error_forbidden_body()
				: m.error_generic_body()
	);
	let Icon = $derived(
		kind === 'not-found' ? SearchXIcon : kind === 'forbidden' ? ShieldXIcon : TriangleAlertIcon
	);
	let signedIn = $derived(Boolean(page.data.profile));
	let homeHref = $derived(
		resolve(roleHome(page.data.activeRole ?? page.data.profile?.role) ?? '/')
	);
	// Signed out there is no shell gutter, so the frame pads itself (as /help).
	let frame = $derived(
		signedIn
			? ui.page
			: 'flex min-w-0 flex-col gap-4 px-4 pt-6 pb-8 md:mx-auto md:max-w-5xl md:gap-6'
	);
</script>

<svelte:head>
	<title>{heading} — Sherab</title>
</svelte:head>

<div data-ui="new" class={frame} data-testid="error-page">
	<section class="{ui.card} flex max-w-prose flex-col items-start gap-4">
		<span
			class="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
		>
			<Icon class="size-5" aria-hidden={true} />
		</span>
		<div class="min-w-0">
			<h1 class={ui.heading}>{heading}</h1>
			<p class="{ui.subtitle} text-base">{body}</p>
			<p class="mt-2 text-sm text-muted-foreground" data-testid="error-status">
				{m.error_status({ status: num(page.status) })}
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if kind === 'generic'}
				<Button
					href={page.url.pathname + page.url.search}
					data-sveltekit-reload
					class={ui.touch}
					data-testid="error-retry"
				>
					{m.error_try_again()}
				</Button>
			{/if}
			<Button
				href={homeHref}
				variant={kind === 'generic' ? 'outline' : 'default'}
				class={ui.touch}
				data-testid="error-home"
			>
				{signedIn ? m.error_back_home() : m.error_back_start()}
			</Button>
		</div>
	</section>
</div>
