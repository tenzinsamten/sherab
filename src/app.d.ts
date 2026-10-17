// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
/// <reference types="vite-plugin-pwa/info" />
/// <reference types="vite-plugin-pwa/client" />
import type { Session, SupabaseClient, UserAppMetadata, UserMetadata } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';

declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		/** The claim-backed user `safeGetSession` returns (from `sub`, `email`, metadata). */
		interface SessionUser {
			id: string;
			email?: string;
			app_metadata: UserAppMetadata;
			user_metadata: UserMetadata;
		}

		// interface Error {}
		interface Locals {
			supabase: SupabaseClient<Database>;
			/**
			 * The cookie session and the user its access token was verified
			 * for, locally against the signing key (CAP-1). `user` holds only
			 * what the token's claims carry.
			 */
			safeGetSession: () => Promise<
				{ session: Session; user: App.SessionUser } | { session: null; user: null }
			>;
		}
		interface PageData {
			session?: Session | null;
			/**
			 * The root layout's profile read (CAP-3): only these columns, so a
			 * consumer that needs another one fails `npm run check`. Keep in
			 * step with LAYOUT_PROFILE_COLUMNS in src/routes/+layout.server.ts.
			 */
			profile?: Pick<
				Database['public']['Tables']['profiles']['Row'],
				'id' | 'role' | 'status' | 'display_name' | 'email' | 'email_confirmed_at' | 'tours_seen'
			> | null;
			pendingRequestsCount?: number;
		}
		// interface PageState {}
	}
}

export {};
