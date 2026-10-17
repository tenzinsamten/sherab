/** How long a server-side Supabase call may take before it is aborted (CAP-2). */
export const SUPABASE_FETCH_TIMEOUT_MS = 8000;

/**
 * A `fetch` that aborts after `ms`, so a stalled Supabase call fails as an
 * ordinary error instead of holding the request (#104g: one load waited
 * 12.4 s). A caller's own signal (on `init` or on a `Request`) still aborts
 * it earlier. A timeout is logged with the URL so stalls show in the Worker
 * logs.
 *
 * Used by the request-scoped client only. The service-role client is left
 * without it: an aborted Admin write can still land on the server and leave
 * credentials half-applied. auth-js retries a timed-out token refresh with
 * backoff for up to 30 s, so a stalled refresh can still take that long;
 * this is accepted, because failing it sooner would sign the user out.
 */
export function fetchWithTimeout(ms = SUPABASE_FETCH_TIMEOUT_MS): typeof fetch {
	return (input, init) => {
		const timeout = AbortSignal.timeout(ms);
		const own = init?.signal ?? (input instanceof Request ? input.signal : undefined);
		const signal = own ? AbortSignal.any([own, timeout]) : timeout;
		return fetch(input, { ...init, signal }).catch((error: unknown) => {
			if (timeout.aborted) {
				const url = input instanceof Request ? input.url : String(input);
				console.warn(`supabase fetch timed out after ${ms} ms: ${url.split('?')[0]}`);
			}
			throw error;
		});
	};
}
