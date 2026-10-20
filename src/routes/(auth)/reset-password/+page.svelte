<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard, { auth } from '$lib/components/AuthCard.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
</script>

<svelte:head>
	<title>{m.reset_heading()} — Sherab</title>
</svelte:head>

<AuthCard title={m.reset_heading()}>
	<form method="POST" use:enhance class={auth.form}>
		<div class={auth.field}>
			<label for="password" class={auth.label}>{m.reset_password_label()}</label>
			<PasswordInput
				id="password"
				name="password"
				autocomplete="new-password"
				minlength={6}
				required
			/>
		</div>
		<div class={auth.field}>
			<label for="confirm" class={auth.label}>{m.reset_confirm_label()}</label>
			<PasswordInput
				id="confirm"
				name="confirm"
				autocomplete="new-password"
				minlength={6}
				required
			/>
		</div>
		<Button type="submit" class={auth.submit}>{m.reset_submit()}</Button>
	</form>
</AuthCard>
