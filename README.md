# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.17.0 create --template minimal --types ts --add prettier eslint vitest="usages:unit" sveltekit-adapter="adapter:cloudflare+cfTarget:pages" paraglide="languageTags:de,en,bo+demo:no" --no-download-check --install npm .
```

## Setup (local Supabase)

This app talks directly to a local Supabase project (see `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md`, AD-1/AD-6). One-time setup:

```sh
npm install
cp .env.example .env        # then fill in with `npx supabase status` output below
npm run supabase:start      # requires Docker running; applies supabase/migrations/*.sql
```

`supabase start` prints `API URL`, `anon key`, and `service_role key` — put those into `.env` as
`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

Other useful scripts: `npm run supabase:stop`, `npm run supabase:reset` (reapplies migrations from
scratch), `npm run supabase:types` (regenerates `src/lib/supabase/database.types.ts` from the real
schema).

**Bootstrapping the first admin** (Story 1-1's documented one-time step). There is no public sign-up
page for staff: since migration 0020 (issue #50) a new account's `admin`/`teacher` role is taken only
from `app_metadata`, which only the service role can set. An account created with no role is refused,
so Supabase Studio's _Authentication → Add user_ button does **not** work for this (it sends no role).

1. Create the account through the Auth Admin API with the service-role key. The two variables come
   from your `.env` (load it first, e.g. `set -a; source .env; set +a`), or use the `API URL` and
   `service_role key` values `npx supabase status` prints. For the hosted project, take the project
   URL and service-role key from the Supabase dashboard's project settings (API). The password ends
   up in your shell history, so change it after the first sign-in.

   ```sh
   curl -X POST "$PUBLIC_SUPABASE_URL/auth/v1/admin/users" \
     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"email":"the-admin@example.com","password":"a-strong-password","email_confirm":true,"app_metadata":{"role":"teacher"}}'
   ```

2. Run the promote SQL once by hand (Supabase Studio's SQL editor, or `psql` with the connection string
   `supabase status` prints):

   ```sql
   update public.profiles set role = 'admin' where id = (
     select id from auth.users where email = 'the-admin@example.com'
   );
   ```

   Running the promote SQL again on the same account is a no-op, not an error.

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
