<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import logoSeal from '$lib/assets/logo-seal-blue.png';
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
	<div class="split-screen">
		<div class="poster-panel poster-blue">
			<div>
				<img
					src={logoSeal}
					alt={m.home_poster_seal_alt()}
					width="110"
					height="110"
					style="display:block; margin-bottom: var(--space-4);"
				/>
				<p class="poster-eyebrow">{m.home_poster_eyebrow()}</p>
				<h1 class="poster-hero">{m.home_poster_hero()}</h1>
			</div>
			<p class="poster-footer">{m.home_poster_blurb()}</p>
		</div>
		<div class="form-panel">
			<div class="form-panel-inner">
				<p class="section-label">{m.login_section_label()}</p>
				<h2 style="font-size: var(--text-2xl); margin: var(--space-2) 0 0;">
					{m.home_welcome_title()}
				</h2>
				<p style="color: var(--color-muted-foreground);">{m.home_welcome_signin_prompt()}</p>
				<div style="display:flex; flex-direction:column; gap: var(--space-2); max-width: 320px;">
					<a class="btn" style="justify-content:flex-start;" href={resolve('/login')}
						>{m.nav_sign_in()}</a
					>
					<a class="btn btn-outline" style="justify-content:flex-start;" href={resolve('/join')}
						>{m.nav_join()}</a
					>
					<a
						class="btn btn-outline"
						style="justify-content:flex-start; border:none; text-decoration:underline; text-underline-offset:4px;"
						href={resolve('/signup')}>{m.signup_heading()}</a
					>
				</div>
			</div>
		</div>
	</div>
{:else if data.profile.role === 'admin'}
	<p class="page-kicker">{m.home_signed_in_as_admin()}</p>
	<h1 class="page-heading">
		{m.home_admin_greeting({ name: data.profile.display_name ?? data.profile.email })}
	</h1>
	<hr class="page-hr" />
	<p style="color: var(--color-muted-foreground); max-width: 56ch;">{m.home_admin_subtitle()}</p>
	<div style="display:flex; flex-wrap:wrap; gap: var(--space-2); margin-top: var(--space-4);">
		<a class="btn" href={resolve('/admin/classes')}>{m.home_manage_classes()}</a>
		<a class="btn btn-outline" href={resolve('/admin/teachers')}>{m.home_manage_teachers()}</a>
		<a class="btn btn-outline" href={resolve('/admin/teams')}>{m.home_manage_teams()}</a>
		<a class="btn btn-outline" href={resolve('/requests')}>
			{data.pendingRequestsCount
				? m.nav_requests_with_count({ count: data.pendingRequestsCount })
				: m.home_review_requests()}
		</a>
	</div>
{:else if data.profile.role === 'teacher'}
	<p class="page-kicker">{m.home_signed_in_as_teacher()}</p>
	<h1 class="page-heading">
		{m.home_teacher_greeting({ name: data.profile.display_name ?? data.profile.email })}
	</h1>
	<hr class="page-hr" />
	<p style="color: var(--color-muted-foreground); max-width: 56ch;">{m.home_teacher_subtitle()}</p>
	<div style="display:flex; flex-wrap:wrap; gap: var(--space-2); margin-top: var(--space-4);">
		<a class="btn" href={resolve('/teacher')}>{m.home_see_my_classes()}</a>
		<a class="btn btn-outline" href={resolve('/requests')}>
			{data.pendingRequestsCount
				? m.nav_requests_with_count({ count: data.pendingRequestsCount })
				: m.home_review_requests()}
		</a>
	</div>
{:else if data.profile.role === 'student'}
	<div class="card">
		<h1 style="margin-top:0;">
			{m.home_student_greeting({ name: data.profile.display_name ?? data.profile.email })}
		</h1>
		<p>{m.home_student_subtitle()}</p>
		<p>
			<a class="btn" href={resolve('/student')}>{m.home_see_my_homework()}</a>
		</p>
	</div>
{:else}
	<div class="card">
		<p>Signed in.</p>
	</div>
{/if}
