/**
 * Mobile-first redesign (story 3): the utility sets the migrated pages share
 * for their page frame, headings, cards and text links, so every page looks
 * the same without page-scoped `<style>` (the scoped reset beats it inside a
 * `data-ui="new"` root). Tailwind reads the class names from this file
 * (`@source` in tailwind.css).
 */
export const ui = {
	/**
	 * A migrated page's root. The shell's `<main>` still pads 2rem for the iX
	 * pages; a phone page takes 1rem of it back for a 16px gutter.
	 */
	page: '-mx-4 flex min-w-0 flex-col gap-4 pt-3 pb-8 md:mx-auto md:max-w-5xl md:gap-6 md:pt-6',
	header: 'flex flex-wrap items-end justify-between gap-3',
	kicker: 'mb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase',
	heading: 'text-2xl leading-tight font-bold wrap-break-word',
	subtitle: 'mt-2 max-w-prose text-muted-foreground',
	/** A section card (iX's `.card`). */
	card: 'min-w-0 rounded-lg border border-border bg-card p-4 text-card-foreground md:p-6',
	cardTitle: 'mb-3 text-lg leading-snug font-bold',
	/** Small uppercase label (iX's `.section-label`). */
	label: 'text-xs font-bold tracking-wide text-muted-foreground uppercase',
	/** A big number (iX's `.stat-tile-value`). */
	stat: 'text-3xl font-bold tabular-nums',
	muted: 'text-muted-foreground',
	error: 'text-sm text-destructive',
	/** An inline text link. */
	link: 'text-primary underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
	/** A whole-card link (#56). */
	tileLink:
		'block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
	/** A list with a divider between rows. */
	rows: 'divide-y divide-border',
	/** Touch-sized button (CAP-3: ≥44×44px). */
	touch: 'h-auto min-h-11 px-4 text-base whitespace-normal'
} as const;
