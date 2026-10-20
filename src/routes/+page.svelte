<script lang="ts">
	import LogIn from '@lucide/svelte/icons/log-in';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import AuthCard, { auth } from '$lib/components/AuthCard.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ui } from '$lib/ui/classes';
</script>

<svelte:head>
	<title>Sherab</title>
</svelte:head>

<AuthCard title={m.home_welcome_title()} subtitle={m.home_poster_blurb()}>
	<p class="text-center {ui.muted}">{m.home_welcome_signin_prompt()}</p>
	<div class="mt-4 flex flex-col gap-3">
		<Button href={resolve('/login')} class="{ui.touch} w-full gap-2">
			<LogIn class="size-5" aria-hidden="true" />
			{m.nav_sign_in()}
		</Button>
		<Button href={resolve('/join')} variant="outline" class="{ui.touch} w-full">
			{m.nav_join()}
		</Button>
	</div>

	{#snippet footer()}
		<a href={resolve('/help')} class={auth.link}>{m.help_link()}</a>
	{/snippet}
</AuthCard>
