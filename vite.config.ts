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
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		}),

		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			emitTsDeclarations: true
		}),

		// AD-1: SvelteKit serves the frontend as an installable PWA.
		// Icons/screenshots are a design-system deliverable not yet produced
		// (see Story 1-1 Implementation Notes) -- this wires up the
		// registration/manifest plumbing so a later story can drop in real
		// artwork without touching build config.
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Sherab',
				short_name: 'Sherab',
				description: 'Munich Tibetan Sunday School class tracker',
				start_url: '/',
				display: 'standalone',
				background_color: '#ffffff',
				theme_color: '#0b1330'
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
