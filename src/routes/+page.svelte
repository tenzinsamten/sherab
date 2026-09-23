<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard from '$lib/components/AuthCard.svelte';
</script>

<svelte:head>
	<title>Sherab</title>
</svelte:head>

<AuthCard title={m.home_welcome_title()} subtitle={m.home_poster_blurb()}>
	<p class="muted" style="text-align:center; margin: 0;">{m.home_welcome_signin_prompt()}</p>
	<div class="stacked-actions">
		<ix-button class="block" href={resolve('/login')} icon="log-in">{m.nav_sign_in()}</ix-button>
		<ix-button class="block" variant="secondary" href={resolve('/join')}>{m.nav_join()}</ix-button>
	</div>
</AuthCard>
