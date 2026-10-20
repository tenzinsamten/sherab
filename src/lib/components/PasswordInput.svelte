<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as m from '$lib/paraglide/messages.js';

	/**
	 * A native password <input> with a show/hide button inside it, at its end
	 * (#82). The input stays native and keeps whatever the page passes (id, name,
	 * autocomplete, required, ...), so labels, form actions and password
	 * managers work as before (#66, B7b); only its `type` flips between
	 * "password" and "text". Each field starts hidden and toggles on its own.
	 * Its own `data-ui="new"` root (mobile-first story 5), so it works on a
	 * new-UI page and inside iX markup alike.
	 */
	let { class: className, ...props }: Omit<HTMLInputAttributes, 'type' | 'files'> = $props();

	let shown = $state(false);
	let toggleLabel = $derived(shown ? m.password_hide() : m.password_show());
</script>

<div data-ui="new" class="password-input relative flex min-w-0">
	<!-- `[&::-ms-reveal]:hidden`: Edge draws its own reveal button; ours replaces it. -->
	<Input
		{...props}
		type={shown ? 'text' : 'password'}
		class="flex-1 bg-background pe-12 [&::-ms-reveal]:hidden {className ?? ''}"
	/>
	<button
		type="button"
		class="password-toggle absolute inset-y-0 end-0 inline-flex w-11 items-center justify-center rounded-e-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
		aria-label={toggleLabel}
		title={toggleLabel}
		aria-pressed={shown}
		aria-controls={props.id}
		onclick={() => (shown = !shown)}
	>
		{#if shown}
			<EyeOff class="size-5" aria-hidden="true" />
		{:else}
			<Eye class="size-5" aria-hidden="true" />
		{/if}
	</button>
</div>
