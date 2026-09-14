<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let justSignedUp = $derived(page.url.searchParams.has('justSignedUp'));
</script>

<svelte:head>
	<title>Sherab</title>
</svelte:head>

{#if justSignedUp}
	<p class="banner-success" role="status">
		{m.home_just_signed_up()}
	</p>
{/if}

{#if !data.profile}
	<div class="card" style="max-width: 480px;">
		<h1 style="margin-top:0;">{m.home_welcome_title()}</h1>
		<p>{m.home_welcome_signin_prompt()}</p>
		<a class="btn" href={resolve('/login')}>{m.nav_sign_in()}</a>
	</div>
{:else if data.profile.role === 'admin'}
	<div class="card">
		<h1 style="margin-top:0;">
			{m.home_admin_greeting({ name: data.profile.display_name ?? data.profile.email })}
		</h1>
		<p>{m.home_admin_subtitle()}</p>
		<p>
			<a class="btn" href={resolve('/admin/classes')}>{m.home_manage_classes()}</a>
			<a class="btn btn-outline" href={resolve('/admin/teachers')}>{m.home_manage_teachers()}</a>
		</p>
	</div>
{:else if data.profile.role === 'teacher'}
	<div class="card">
		<h1 style="margin-top:0;">
			{m.home_teacher_greeting({ name: data.profile.display_name ?? data.profile.email })}
		</h1>
		<p>{m.home_teacher_subtitle()}</p>
		<a class="btn" href={resolve('/teacher')}>{m.home_see_my_classes()}</a>
	</div>
{:else}
	<div class="card">
		<p>Signed in.</p>
	</div>
{/if}
