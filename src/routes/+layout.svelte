<script lang="ts">
	import '../app.css';
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getLocale, locales, localizeHref } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages.js';
	import navMark from '$lib/assets/logo-seal-blue.png';
	import flagTibet from '$lib/assets/flag-tibet.svg';

	const localeFlags: Record<string, { emoji?: string; icon?: string; name: string }> = {
		en: { emoji: '🇬🇧', name: 'English' },
		de: { emoji: '🇩🇪', name: 'Deutsch' },
		bo: { icon: flagTibet, name: 'བོད་སྐད།' }
	};

	let { children, data } = $props();

	function isActive(href: string) {
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/favicon-32.png" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>

<div class="app-shell">
	<nav
			style="display:flex; align-items:center; gap: var(--space-2); padding: var(--space-3) var(--space-6); background: var(--color-surface-inverse); border-bottom: 1px solid rgba(255, 255, 255, 0.25);"
		>
			<a
				href={resolve('/')}
				style="display:flex; align-items:center; gap: var(--space-2); font-family: var(--font-display); font-size: 18px; font-weight: 900; text-transform:uppercase; letter-spacing:-0.02em; color: var(--color-on-surface-inverse); text-decoration: none; margin-right: var(--space-4);"
			>
				<span
					role="img"
					aria-label={m.nav_seal_aria_label()}
					style="display:block; width:44px; height:44px; flex:none; background: currentColor; mask: url({navMark}) center / contain no-repeat; -webkit-mask: url({navMark}) center / contain no-repeat;"
				></span>
				Sherab
			</a>
	{#if data.profile}
		<span style="margin-left:auto;"></span>
		{#if data.profile.role === 'admin'}
			{@const classesHref = resolve('/admin/classes')}
			{@const teachersHref = resolve('/admin/teachers')}
			{@const teamsHref = resolve('/admin/teams')}
			{@const requestsHref = resolve('/requests')}
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
			<a
				href={teamsHref}
				class="nav-link"
				class:active={isActive(teamsHref)}
				aria-current={isActive(teamsHref) ? 'page' : undefined}
			>
				{m.nav_teams()}
			</a>
			<a
				href={requestsHref}
				class="nav-link"
				class:active={isActive(requestsHref)}
				aria-current={isActive(requestsHref) ? 'page' : undefined}
			>
				{data.pendingRequestsCount
					? m.nav_requests_with_count({ count: data.pendingRequestsCount })
					: m.nav_requests()}
			</a>
		{:else if data.profile.role === 'teacher'}
			{@const teacherHref = resolve('/teacher')}
			{@const requestsHref = resolve('/requests')}
			<a
				href={teacherHref}
				class="nav-link"
				class:active={isActive(teacherHref)}
				aria-current={isActive(teacherHref) ? 'page' : undefined}
			>
				{m.nav_my_classes()}
			</a>
			<a
				href={requestsHref}
				class="nav-link"
				class:active={isActive(requestsHref)}
				aria-current={isActive(requestsHref) ? 'page' : undefined}
			>
				{data.pendingRequestsCount
					? m.nav_requests_with_count({ count: data.pendingRequestsCount })
					: m.nav_requests()}
			</a>
		{:else if data.profile.role === 'student'}
			{@const studentHref = resolve('/student')}
			<a
				href={studentHref}
				class="nav-link"
				class:active={isActive(studentHref)}
				aria-current={isActive(studentHref) ? 'page' : undefined}
			>
				{m.nav_my_homework()}
			</a>
		{/if}
		<span
			style="display:flex; align-items:center; padding: 0 var(--space-4); color: var(--color-on-surface-inverse); opacity: 0.7; font-size: var(--text-sm);"
		>
			{data.profile.email} ({data.profile.role})
		</span>
		<form method="POST" action={resolve('/logout')}>
			<button type="submit" class="nav-link">{m.nav_sign_out()}</button>
		</form>
	{:else}
		{@const loginHref = resolve('/login')}
		{@const joinHref = resolve('/join')}
		<span style="margin-left:auto;"></span>
		<a
			href={loginHref}
			class="nav-link"
			class:active={isActive(loginHref)}
			aria-current={isActive(loginHref) ? 'page' : undefined}
		>
			{m.nav_sign_in()}
		</a>
		<a
			href={joinHref}
			class="nav-link"
			class:active={isActive(joinHref)}
			aria-current={isActive(joinHref) ? 'page' : undefined}
		>
			{m.nav_join()}
		</a>
		{/if}
		</nav>

		<main class="app-main">
			{#if data.loadError}
				<p class="banner-error" role="alert">{m.load_error_generic()}</p>
			{/if}
			{@render children()}
		</main>

		<div
			style="display:flex; flex-wrap:wrap; gap: var(--space-4); padding: var(--space-2) var(--space-6); background: var(--color-primary-tint); border-top: 2px solid var(--color-foreground); font-variant-numeric: tabular-nums; font-size: 0.6875rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-muted-foreground);"
		>
			<span aria-hidden="true">{m.footer_locale_label()}</span>
			{#each locales as locale (locale)}
				{@const active = getLocale() === locale}
				{@const flag = localeFlags[locale]}
				<a
					href={resolve(localizeHref(page.url.pathname, { locale }) as Pathname)}
					data-sveltekit-reload
					lang={locale}
					title={flag?.name ?? locale}
					aria-label={flag?.name ?? locale}
					aria-current={active ? 'true' : undefined}
					style="display:inline-flex; align-items:center; gap: var(--space-1); border-bottom: 2px solid {active
						? 'var(--color-primary)'
						: 'transparent'}; text-decoration: none; opacity: {active ? 1 : 0.6};"
				>
					{#if flag?.icon}
						<img src={flag.icon} alt="" width="18" height="12" style="display:block;" />
					{:else if flag?.emoji}
						<span aria-hidden="true" style="font-size: 1rem; line-height:1;">{flag.emoji}</span>
					{:else}
						{locale}
					{/if}
				</a>
			{/each}
		</div>
	</div>

