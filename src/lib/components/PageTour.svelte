<script lang="ts">
	import { onDestroy } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import type { Driver } from 'driver.js';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { PORTAL_TARGET } from '$lib/components/shell/portal';
	import { tourFor, type Tour, type TourStep } from '$lib/tours';

	/**
	 * Runs the guided page tours (#101). Mounted once, in the signed-in layout.
	 *
	 * After every navigation it looks up the page's tour for the active role
	 * and starts it by itself when this account has not seen it. `start()` runs
	 * the page's tour again whether or not it was seen (Help, "Show me around
	 * this page").
	 *
	 * driver.js draws the spotlight; it is loaded only when a tour runs. A tour
	 * never changes the page: the highlighted control cannot be used while the
	 * tour is open.
	 */
	let {
		role,
		userId,
		seen,
		helpOpen = false
	}: {
		/** The active role. */
		role: string | null | undefined;
		userId: string;
		/** profiles.tours_seen as the layout last loaded it. */
		seen: readonly string[];
		/** The shell's Help sheet is open: no tour starts over it. */
		helpOpen?: boolean;
	} = $props();

	// The layout load does not run again on navigation for a single-role
	// login, so what was seen in this browser session is kept here too.
	// Plain variables: nothing is rendered from them.
	let seenHere: string[] = [];
	let seenOwner = '';

	function hasSeen(id: string): boolean {
		if (seenOwner !== userId) {
			seenOwner = userId;
			seenHere = [];
		}
		return seenHere.includes(id) || seen.includes(id);
	}

	/** Marked at the start: a closed tab or a navigation never brings a tour back. */
	function markSeen(id: string) {
		if (hasSeen(id)) return;
		seenHere.push(id);
		fetch('/api/tours/seen', {
			method: 'POST',
			// Still sent when the page is reloaded or closed right after the start.
			keepalive: true,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ tour: id })
		})
			.then((response) => {
				if (!response.ok) console.warn(`tours: marking ${id} seen failed (${response.status})`);
			})
			.catch((error: unknown) => console.warn(`tours: marking ${id} seen failed`, error));
	}

	let active: Driver | null = null;
	// Every navigation and every start gets a new number; work that waited
	// for something checks it is still the latest.
	let attempt = 0;

	function pageTour(): Tour | null {
		return tourFor(role, page.route.id, page.url.searchParams.get('tab'));
	}

	type Found = { step: TourStep; element: Element };

	/** The tour's steps whose control is on the page and shown. */
	function stepsOnPage(tour: Tour): Found[] {
		const found: Found[] = [];
		for (const step of tour.steps) {
			const element = [...document.querySelectorAll(`[data-tour="${step.target}"]`)].find(
				(candidate) => candidate.getClientRects().length > 0
			);
			if (element) found.push({ step, element });
		}
		return found;
	}

	const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	/**
	 * Resolves once the page's `data-ui="new"` root is marked hydrated, or
	 * after 3 s (a page without the mark), or when a newer attempt began.
	 */
	async function pageHydrated(mine: number) {
		for (let waited = 0; waited < 3000; waited += 50) {
			if (mine !== attempt) return;
			if (document.querySelector('main > [data-ui="new"]')?.hasAttribute('data-hydrated')) return;
			await wait(50);
		}
	}

	/** driver.js sets title and text as HTML. */
	function escapeHtml(text: string): string {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function stop() {
		attempt += 1;
		active?.destroy();
		active = null;
	}

	async function run(tour: Tour, mine: number): Promise<boolean> {
		if (stepsOnPage(tour).length === 0) return false;
		let driver: typeof import('driver.js').driver;
		try {
			[{ driver }] = await Promise.all([import('driver.js'), import('driver.js/dist/driver.css')]);
		} catch (error) {
			console.warn('tours: driver.js could not be loaded', error);
			return false;
		}
		if (mine !== attempt) return false;
		const found = stepsOnPage(tour);
		if (found.length === 0) return false;

		markSeen(tour.id);
		const total = found.length;
		let ownExpanded: string | null = null;
		const instance = driver({
			animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
			// Left only with Skip, Esc or the close button, never by a stray tap.
			overlayClickBehavior: () => {},
			disableActiveInteraction: true,
			stagePadding: 6,
			stageRadius: 4,
			popoverClass: 'sherab-tour',
			showProgress: true,
			showButtons: ['next', 'previous', 'close'],
			nextBtnText: m.tour_next(),
			prevBtnText: m.tour_back(),
			doneBtnText: m.tour_done(),
			steps: found.map(({ step, element }, index) => ({
				element,
				popover: {
					title: escapeHtml(step.title()),
					description: escapeHtml(step.body()),
					progressText: m.tour_progress({ current: num(index + 1), total: num(total) })
				}
			})),
			onPopoverRender: (popover, { driver: current }) => {
				popover.closeButton.setAttribute('aria-label', m.tour_close());
				popover.closeButton.title = m.tour_close();
				let skip = popover.footer.querySelector<HTMLButtonElement>('.sherab-tour-skip');
				if (!skip) {
					skip = document.createElement('button');
					skip.type = 'button';
					skip.className = 'driver-popover-footer-btn sherab-tour-skip';
					skip.textContent = m.tour_skip();
					skip.addEventListener('click', () => current.destroy());
					popover.footer.insertBefore(skip, popover.footerButtons);
				}
				// The last step ends with Done.
				skip.hidden = current.isLastStep();
			},
			// driver.js marks the highlighted control `aria-expanded="true"`
			// while its popover is open. On a control that has its own
			// aria-expanded (a student's skill row) that would read, and look,
			// as opened: keep the control's own value.
			onHighlightStarted: (element) => {
				ownExpanded = element?.getAttribute('aria-expanded') ?? null;
			},
			onHighlighted: (element) => {
				if (element && ownExpanded !== null) element.setAttribute('aria-expanded', ownExpanded);
			},
			onDestroyed: () => {
				if (active === instance) active = null;
			}
		});
		active = instance;
		instance.drive();
		return true;
	}

	/**
	 * Runs the page's tour from its first step, seen or not. False when the
	 * page has no tour or none of its controls is there.
	 */
	export async function start(): Promise<boolean> {
		const tour = pageTour();
		stop();
		if (!tour) return false;
		return run(tour, attempt);
	}

	async function autoStart(mine: number) {
		// Automated browsers (the e2e suite, the help screenshots) get no tour.
		if (navigator.webdriver) return;
		const tour = pageTour();
		if (!tour || hasSeen(tour.id)) return;

		// The page's controls have their final size and place once its root
		// is hydrated (every toured page marks its `data-ui="new"` root).
		await pageHydrated(mine);
		for (let tries = 0; tries < 8; tries += 1) {
			await wait(350);
			if (mine !== attempt) return;
			if (stepsOnPage(tour).length > 0) break;
		}
		if (mine !== attempt || hasSeen(tour.id)) return;
		// Not over Help, a dialog or a menu the person opened in the meantime:
		// the shell's and the pages' popups (sheets, dialogs, menus) are in the
		// portal root; a native or other dialog anywhere counts too.
		const popupOpen =
			document.querySelector(`${PORTAL_TARGET} [data-state="open"]`) !== null ||
			document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]') !== null;
		if (helpOpen || popupOpen) return;
		await run(tour, mine);
	}

	beforeNavigate(() => stop());
	afterNavigate(() => {
		stop();
		void autoStart(attempt);
	});

	// The highlight follows the control when the page scrolls inside a
	// scrolling container (driver.js itself only listens to the window).
	let following = 0;
	function follow() {
		if (following || !active) return;
		following = requestAnimationFrame(() => {
			following = 0;
			if (active?.isActive()) active.refresh();
		});
	}

	// A tour fills in and submits nothing: the highlighted control cannot be
	// clicked (driver.js), and no key reaches it or a field inside it. Tab
	// still moves on and Esc still ends the tour.
	function guard(event: Event) {
		if (!active?.isActive()) return;
		const element = active.getActiveElement();
		if (!element || !event.composedPath().includes(element)) return;
		if (event instanceof KeyboardEvent && (event.key === 'Tab' || event.key === 'Escape')) return;
		event.preventDefault();
		event.stopPropagation();
	}

	$effect(() => {
		window.addEventListener('scroll', follow, true);
		window.addEventListener('click', guard, true);
		window.addEventListener('keydown', guard, true);
		window.addEventListener('beforeinput', guard, true);
		window.addEventListener('paste', guard, true);
		return () => {
			window.removeEventListener('scroll', follow, true);
			window.removeEventListener('click', guard, true);
			window.removeEventListener('keydown', guard, true);
			window.removeEventListener('beforeinput', guard, true);
			window.removeEventListener('paste', guard, true);
		};
	});

	onDestroy(() => stop());
</script>

<style>
	/* driver.js popover in the Sherab theme (src/lib/ui/tailwind.css tokens). */
	:global(.driver-popover.sherab-tour) {
		--driver-popover-font-family: inherit;
		max-width: min(20rem, calc(100vw - 1.5rem));
		min-width: min(15rem, calc(100vw - 1.5rem));
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background-color: var(--popover);
		color: var(--popover-foreground);
		font-family: inherit;
	}
	:global(.sherab-tour .driver-popover-title) {
		/* #127: clear of the 44px close button, which sits at the popover's
		   edge, outside this 1rem padding. */
		padding-inline-end: calc(2.75rem - 1rem);
		font-size: 1rem;
		line-height: 1.35;
	}
	:global(.sherab-tour .driver-popover-description) {
		font-size: 0.875rem;
		line-height: 1.5;
	}
	:global(.sherab-tour .driver-popover-progress-text) {
		color: var(--muted-foreground);
		font-size: 0.875rem;
	}
	:global(.sherab-tour .driver-popover-footer) {
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	/* #127: every tour control is a 44px target (the tour opens by itself on
	   a phone). */
	:global(.sherab-tour .driver-popover-close-btn) {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		color: var(--muted-foreground);
		font-size: 1.375rem;
	}
	:global(.sherab-tour .driver-popover-close-btn:hover),
	:global(.sherab-tour .driver-popover-close-btn:focus-visible) {
		color: var(--popover-foreground);
	}
	:global(.sherab-tour .driver-popover-footer-btn) {
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding: 0.5rem 1rem;
		border: 1px solid var(--primary);
		border-radius: var(--radius);
		background-color: transparent;
		color: var(--primary);
		font-size: 0.875rem;
		line-height: 1.4;
		text-shadow: none;
	}
	:global(.sherab-tour .driver-popover-footer-btn:hover) {
		background-color: var(--accent);
	}
	:global(.sherab-tour .driver-popover-next-btn) {
		background-color: var(--primary);
		color: var(--primary-foreground);
	}
	:global(.sherab-tour .driver-popover-next-btn:hover) {
		background-color: color-mix(in oklab, var(--primary) 80%, transparent);
	}
	:global(.sherab-tour .sherab-tour-skip) {
		border-color: transparent;
	}
	:global(.sherab-tour .sherab-tour-skip[hidden]) {
		display: none;
	}
	:global(.sherab-tour button:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	:global(.sherab-tour .driver-popover-arrow) {
		border-color: var(--popover);
	}
	:global(.sherab-tour .driver-popover-arrow-side-left) {
		border-block-color: transparent;
		border-right-color: transparent;
	}
	:global(.sherab-tour .driver-popover-arrow-side-right) {
		border-block-color: transparent;
		border-left-color: transparent;
	}
	:global(.sherab-tour .driver-popover-arrow-side-top) {
		border-inline-color: transparent;
		border-bottom-color: transparent;
	}
	:global(.sherab-tour .driver-popover-arrow-side-bottom) {
		border-inline-color: transparent;
		border-top-color: transparent;
	}
</style>
