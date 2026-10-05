<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import * as m from '$lib/paraglide/messages.js';

	/**
	 * A native password <input> with a show/hide button inside it, at its end
	 * (#82). The input stays native and keeps whatever the page passes (id, name,
	 * autocomplete, required, ...), so labels, form actions and password
	 * managers work as before (#66, B7b); only its `type` flips between
	 * "password" and "text". Each field starts hidden and toggles on its own.
	 */
	let props: Omit<HTMLInputAttributes, 'type'> = $props();

	let shown = $state(false);
	let toggleLabel = $derived(shown ? m.password_hide() : m.password_show());
</script>

<div class="password-input">
	<input {...props} type={shown ? 'text' : 'password'} />
	<button
		type="button"
		class="password-toggle"
		aria-label={toggleLabel}
		title={toggleLabel}
		aria-pressed={shown}
		aria-controls={props.id}
		onclick={() => (shown = !shown)}
		><ix-icon name={shown ? 'eye-cancelled' : 'eye'} size="16" aria-hidden="true"></ix-icon></button
	>
</div>

<style>
	.password-input {
		position: relative;
		display: flex;
	}

	/* Room for the button at the end of the field. The `:not()`s only lift
	   this above the shared `.field input` padding in app.css. */
	.password-input > input:not([type='checkbox']):not([type='radio']) {
		flex: 1 1 auto;
		min-width: 0;
		padding-inline-end: 2.5rem;
	}

	/* Edge draws its own reveal button; ours replaces it. */
	.password-input > input::-ms-reveal {
		display: none;
	}

	/* Inside the field, at its end, as tall as the field. */
	.password-toggle {
		position: absolute;
		inset-block: 1px;
		inset-inline-end: 1px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		padding: 0;
		background: transparent;
		color: var(--theme-color-soft-text);
		border: 0;
		border-radius: var(--theme-input--border-radius);
		font: inherit;
		cursor: pointer;
	}

	.password-toggle:hover {
		color: var(--theme-color-std-text);
		background: var(--theme-color-ghost--hover);
	}

	.password-toggle:focus-visible {
		outline: 1px solid var(--theme-color-focus-bdr);
		outline-offset: -1px;
	}
</style>
