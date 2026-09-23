<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.signup_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.signup_heading()} subtitle={m.signup_notice()}>
	<form method="POST" use:enhance>
		<div class="field">
			<label for="email">{m.signup_email_label()}</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				required
				value={form?.email ?? ''}
			/>
		</div>
		<div class="field">
			<label for="password">{m.signup_password_label()}</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="new-password"
				minlength="6"
				required
			/>
		</div>
		<ix-button class="block" type="submit">{m.signup_submit()}</ix-button>
	</form>
</AuthCard>
