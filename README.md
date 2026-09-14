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

**Bootstrapping the first admin** (Story 1-1's documented one-time step): sign up normally at
`/signup`, then run this once by hand (`npx supabase db reset` output includes a `psql` connection
string, or use Supabase Studio's SQL editor at the URL `supabase start` prints):

```sql
update public.profiles set role = 'admin' where id = (
  select id from auth.users where email = 'the-signed-up-email@example.com'
);
```

Running it again on the same account is a no-op, not an error.

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
