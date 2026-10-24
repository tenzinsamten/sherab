<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';

	export const badgeVariants = tv({
		base: 'min-h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! group/badge inline-flex w-fit max-w-full shrink-0 items-center justify-center text-left wrap-break-word focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none',
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground [a]:hover:bg-primary-strong',
				secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
				destructive:
					'bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20',
				outline: 'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
				ghost: 'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
				link: 'text-primary underline-offset-4 hover:underline',
				// Sherab: iX's pill colours (warning, success, alarm, info), solid and outlined.
				warning: 'bg-warning text-foreground',
				success: 'bg-success text-primary-foreground',
				alarm: 'bg-destructive text-primary-foreground',
				info: 'bg-primary/10 text-primary-strong',
				'success-outline': 'border-success text-success',
				'alarm-outline': 'border-destructive text-destructive',
				'warning-outline': 'border-warning text-foreground'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAnchorAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		href,
		class: className,
		variant = 'default',
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		variant?: BadgeVariant;
	} = $props();
</script>

<svelte:element
	this={href ? 'a' : 'span'}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
