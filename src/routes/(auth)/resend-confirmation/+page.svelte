<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<svelte:head>
	<title>{m.resend_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.resend_heading()} subtitle={m.resend_description()}>
	{#if form?.success}
		<!-- Stays on the page (a toast would be gone before the mail arrives). -->
		<p role="status">{m.resend_success()}</p>
	{/if}
	<form method="POST" use:enhance>
		<div class="field">
			<label for="email">{m.forgot_email_label()}</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				required
				value={form?.email ?? data.email}
			/>
		</div>
		<ix-button class="block" type="submit">{m.resend_submit()}</ix-button>
	</form>

	{#snippet footer()}
		<a href={resolve('/login')}>{m.forgot_back_to_login()}</a>
	{/snippet}
</AuthCard>
