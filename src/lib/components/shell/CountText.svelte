<script lang="ts">
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';

	/** #60: what a screen reader hears after a nav label with a count ("3 pending"). */
	let { count }: { count: number } = $props();
</script>

<span class="sr-only">, {m.requests_pending_count({ count: num(count) })}</span>
