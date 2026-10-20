<script lang="ts">
	import CircleQuestionMark from '@lucide/svelte/icons/circle-question-mark';
	import LogOut from '@lucide/svelte/icons/log-out';
	import User from '@lucide/svelte/icons/user';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { initials } from '$lib/initials';
	import * as m from '$lib/paraglide/messages.js';
	import LocaleMenu from './LocaleMenu.svelte';
	import logoWhite from '$lib/assets/sherab-logo-white.svg';

	/**
	 * The signed-in header (CAP-6): the logo as the home link, the language
	 * switch and the avatar menu -- nothing folds into an overflow menu.
	 */
	let {
		homeHref,
		userName,
		roles,
		role,
		roleNames,
		showAccount,
		showHelp,
		onAccount,
		onHelp,
		onSwitchRole,
		onSignOut
	}: {
		homeHref: string;
		/** Display name, falling back to the e-mail (#64). */
		userName: string;
		/** Every role this login holds; the switcher shows for more than one (B13). */
		roles: readonly string[];
		/** The active role. */
		role: string | null | undefined;
		roleNames: Record<string, () => string>;
		/** #100: not for a student who is not approved yet. */
		showAccount: boolean;
		/** A student's Help is here instead of in the nav (stack.md). */
		showHelp: boolean;
		onAccount: () => void;
		onHelp: () => void;
		onSwitchRole: (role: string) => void;
		onSignOut: () => void;
	} = $props();

	let avatarInitials = $derived(initials(userName));

	const itemClass = 'min-h-11 gap-2.5 px-2.5 py-2 text-base';
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href is resolve()d by the caller (src/lib/nav.ts, the layout). -->

<header
	data-ui="new"
	data-testid="app-header"
	class="sticky top-0 z-40 box-content flex h-14 items-center gap-1 bg-frame pt-[env(safe-area-inset-top)] pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.5rem,env(safe-area-inset-left))] text-frame-foreground"
>
	<a
		href={homeHref}
		data-testid="header-home"
		class="flex h-11 shrink-0 items-center rounded-md px-1.5 focus-visible:outline-2 focus-visible:outline-frame-foreground"
	>
		<img src={logoWhite} alt={m.nav_logo_alt()} width="58" height="32" class="block h-8 w-auto" />
	</a>

	<div class="ml-auto flex items-center gap-1">
		<LocaleMenu />

		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				data-testid="account-menu"
				aria-label={userName ? m.header_account_menu_label({ name: userName }) : m.nav_account()}
				class="inline-flex size-11 items-center justify-center rounded-full hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-frame-foreground aria-expanded:bg-sidebar-accent"
			>
				<span
					class="inline-flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
					aria-hidden="true"
				>
					{#if avatarInitials}
						{avatarInitials}
					{:else}
						<User class="size-5" />
					{/if}
				</span>
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-auto max-w-[min(20rem,calc(100vw-1rem))] min-w-56">
				{#if userName}
					<DropdownMenu.Label class="px-2.5 py-2 text-sm font-semibold break-words">
						{userName}
					</DropdownMenu.Label>
					<DropdownMenu.Separator />
				{/if}
				{#if roles.length > 1}
					<!-- B13 (#68): only a login holding more than one role sees these. -->
					<DropdownMenu.Group data-testid="role-switcher">
						<DropdownMenu.GroupHeading class="px-2.5 py-1.5 text-xs text-muted-foreground">
							{m.role_switch_label()}
						</DropdownMenu.GroupHeading>
						<DropdownMenu.RadioGroup value={role ?? ''}>
							{#each roles as held (held)}
								<!-- Always posted, even for the checked role (see switchRole). -->
								<DropdownMenu.RadioItem
									value={held}
									data-role-option={held}
									closeOnSelect
									class="{itemClass} pr-9"
									onSelect={() => onSwitchRole(held)}
								>
									{roleNames[held]?.() ?? held}
								</DropdownMenu.RadioItem>
							{/each}
						</DropdownMenu.RadioGroup>
					</DropdownMenu.Group>
					<DropdownMenu.Separator />
				{/if}
				{#if showAccount}
					<DropdownMenu.Item class={itemClass} onSelect={onAccount}>
						<User class="size-5" aria-hidden="true" />
						{m.nav_account()}
					</DropdownMenu.Item>
				{/if}
				{#if showHelp}
					<DropdownMenu.Item class={itemClass} onSelect={onHelp}>
						<CircleQuestionMark class="size-5" aria-hidden="true" />
						{m.nav_help()}
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Item class={itemClass} onSelect={onSignOut}>
					<LogOut class="size-5" aria-hidden="true" />
					{m.nav_sign_out()}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
</header>
