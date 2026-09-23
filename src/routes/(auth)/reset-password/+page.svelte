<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
</script>

<svelte:head>
	<title>{m.reset_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.reset_heading()}>
	<form method="POST" use:enhance>
		<div class="field">
			<label for="password">{m.reset_password_label()}</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="new-password"
				minlength="6"
				required
			/>
		</div>
		<div class="field">
			<label for="confirm">{m.reset_confirm_label()}</label>
			<input
				id="confirm"
				name="confirm"
				type="password"
				autocomplete="new-password"
				minlength="6"
				required
			/>
		</div>
		<ix-button class="block" type="submit">{m.reset_submit()}</ix-button>
	</form>
</AuthCard>
