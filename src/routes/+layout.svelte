<script lang="ts">
	import '../app.css';
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages.js';
	import favicon from '$lib/assets/favicon.svg';

	let { children, data } = $props();

	function isActive(href: string) {
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<nav
	style="display:flex; align-items:center; gap: var(--space-2); padding: var(--space-3) var(--space-6); background: var(--color-surface-inverse); border-bottom: 1px solid rgba(255, 255, 255, 0.25);"
>
	<a
		href={resolve('/')}
		style="font-family: var(--font-display); text-transform:uppercase; letter-spacing:-0.01em; color: var(--color-on-surface-inverse); text-decoration: none; margin-right: var(--space-4);"
	>
		Sherab
	</a>
	{#if data.profile}
		{#if data.profile.role === 'admin'}
			{@const classesHref = resolve('/admin/classes')}
			{@const teachersHref = resolve('/admin/teachers')}
			<a
				href={classesHref}
				class="nav-link"
				class:active={isActive(classesHref)}
				aria-current={isActive(classesHref) ? 'page' : undefined}
			>
				{m.nav_classes()}
			</a>
			<a
				href={teachersHref}
				class="nav-link"
				class:active={isActive(teachersHref)}
				aria-current={isActive(teachersHref) ? 'page' : undefined}
			>
				{m.nav_teachers()}
			</a>
		{:else if data.profile.role === 'teacher'}
			{@const teacherHref = resolve('/teacher')}
			<a
				href={teacherHref}
				class="nav-link"
				class:active={isActive(teacherHref)}
				aria-current={isActive(teacherHref) ? 'page' : undefined}
			>
				{m.nav_my_classes()}
			</a>
		{/if}
		<span
			style="margin-left:auto; color: var(--color-on-surface-inverse); opacity: 0.7; font-size: var(--text-sm);"
		>
			{data.profile.email} ({data.profile.role})
		</span>
		<form method="POST" action={resolve('/logout')}>
			<button type="submit" class="nav-link">{m.nav_sign_out()}</button>
		</form>
	{:else}
		{@const loginHref = resolve('/login')}
		<span style="margin-left:auto;"></span>
		<a
			href={loginHref}
			class="nav-link"
			class:active={isActive(loginHref)}
			aria-current={isActive(loginHref) ? 'page' : undefined}
		>
			{m.nav_sign_in()}
		</a>
	{/if}
</nav>

<main style="max-width: 960px; margin: 0 auto; padding: var(--space-6);">
	{#if data.loadError}
		<p class="banner-error" role="alert">{m.load_error_generic()}</p>
	{/if}
	{@render children()}
</main>

<div style="display:none">
	{#each locales as locale (locale)}
		<a href={resolve(localizeHref(page.url.pathname, { locale }) as Pathname)}>{locale}</a>
	{/each}
</div>
