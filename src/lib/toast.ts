import { toast } from 'svelte-sonner';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * App-wide feedback: every action error and short confirmation is a toast
 * (Sonner, mounted once in the root layout; mobile-first story 10 replaced
 * iX's toast behind the same signature).
 */
export function showToast(type: ToastType, message: string) {
	toast[type](message);
}
