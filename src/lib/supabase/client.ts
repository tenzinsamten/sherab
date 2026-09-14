import { createBrowserClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { Database } from './database.types';

/**
 * Typed Supabase client for use in the browser (component `<script>` blocks,
 * `+page.ts` universal load functions). Per AD-1, this is the only way the
 * client talks to the backend -- no hand-rolled REST/GraphQL layer.
 */
export function createSupabaseBrowserClient() {
	return createBrowserClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
}
