<script lang="ts" module>
	import flagTibet from '$lib/assets/flag-tibet.svg';

	/** Each interface language's flag and its own name. */
	export const localeFlags: Record<string, { emoji?: string; icon?: string; name: string }> = {
		en: { emoji: '🇬🇧', name: 'English' },
		de: { emoji: '🇩🇪', name: 'Deutsch' },
		bo: { icon: flagTibet, name: 'བོད་སྐད།' }
	};
</script>

<script lang="ts">
	import Globe from '@lucide/svelte/icons/globe';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale, locales, setLocale } from '$lib/paraglide/runtime';

	/**
	 * The language switch of the navy header, signed in (AppHeader) and
	 * signed out (the root layout) alike (story 6). Must sit inside a
	 * `data-ui="new"` root.
	 */
	let locale = $derived(getLocale());

	const itemClass = 'min-h-11 gap-2.5 px-2.5 py-2 text-base';
</script>

{#snippet localeLabel(code: string)}
	{@const flag = localeFlags[code]}
	{#if flag?.icon}
		<img src={flag.icon} alt="" width="18" height="12" class="block shrink-0" />
	{:else if flag?.emoji}
		<span aria-hidden="true">{flag.emoji}</span>
	{/if}
	<span>{flag?.name ?? code}</span>
{/snippet}

<!-- #79: picking a language writes the cookie and reloads the page (the
     server picks names and messages from it). -->
<DropdownMenu.Root>
	<DropdownMenu.Trigger
		data-testid="language-menu"
		aria-label="{m.footer_locale_label()} {localeFlags[locale]?.name ?? locale}"
		class="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm whitespace-nowrap hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-frame-foreground aria-expanded:bg-sidebar-accent"
	>
		<Globe class="size-5 shrink-0" aria-hidden="true" />
		<span>{localeFlags[locale]?.name ?? locale}</span>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-auto min-w-44">
		<DropdownMenu.RadioGroup value={locale}>
			{#each locales as code (code)}
				<DropdownMenu.RadioItem
					value={code}
					lang={code}
					closeOnSelect
					class="{itemClass} pr-9"
					onSelect={() => setLocale(code)}
				>
					{@render localeLabel(code)}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
