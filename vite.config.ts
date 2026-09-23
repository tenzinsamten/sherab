import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				// <ix-button>/<ix-menu-item> render a real focusable <button> in
				// their shadow DOM, which the compiler can't see, so its
				// "static element with a click handler" checks misfire on them.
				warningFilter: (warning) =>
					!(
						(warning.code === 'a11y_click_events_have_key_events' ||
							warning.code === 'a11y_no_static_element_interactions') &&
						warning.message.includes('`<ix-')
					)
			},
			adapter: adapter()
		}),

		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			emitTsDeclarations: true,
			// Default strategy (['cookie', 'globalVariable', 'baseLocale']) never
			// checks the URL at all, so the locale-prefixed links localizeHref()
			// generates (e.g. /de/...) were silently never honored -- 'url' must
			// come first so an explicit locale link overrides a previously-set
			// cookie; 'cookie' after that persists the choice across plain,
			// unprefixed navigation (e.g. clicking "Sign in" -> /login).
			strategy: ['url', 'cookie', 'baseLocale']
		}),

		// AD-1: SvelteKit serves the frontend as an installable PWA.
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Sherab',
				short_name: 'Sherab',
				description: 'Munich Tibetan Sunday School class tracker',
				start_url: '/',
				display: 'standalone',
				background_color: '#ffffff',
				theme_color: '#0f172a',
				// purpose: 'maskable' deliberately omitted -- the source art is
				// full-bleed with no safe-zone padding, so Android's adaptive-icon
				// circular mask would crop it; revisit once a padded export exists.
				icons: [
					{ src: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
					{ src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
					{ src: '/favicon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
				]
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
