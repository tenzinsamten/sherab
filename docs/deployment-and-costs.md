# Deployment and costs for Sherab

Where the app runs, how a new version gets there, what it costs, and what would change the cost.
This is the record of a discussion on **2026-10-06**. Nothing in it was decided or built; it
collects what the repository already says and adds the cost questions that came up.

The source is given next to each figure. Where something could not be confirmed, it says so.
Nothing here was checked in the Cloudflare or Supabase dashboards.

## In short

| What                     | Where                                   | Cost                |
| ------------------------ | --------------------------------------- | ------------------- |
| The app                  | Cloudflare Pages, project `tib-class`   | US$0                |
| Database, sign-in, files | Supabase, one hosted project, free plan | US$0                |
| Email to parents         | Resend, free plan                       | US$0                |
| Domain                   | `sherab.app` at Cloudflare Registrar    | yearly, see below   |
| **Total**                |                                         | **the domain only** |

There is no monthly fee. Supabase Pro (from US$25 a month) is not needed today. Its two real
benefits for this app would be daily backups and a project that never pauses.

## 1. How the app is deployed

### The app

- **Host:** Cloudflare Pages, project name `tib-class` (`wrangler.jsonc`). SvelteKit builds for
  it with `@sveltejs/adapter-cloudflare` into `.svelte-kit/cloudflare`.
- **Address:** `https://sherab.app`. The domain was bought at Cloudflare and connected to the
  Pages project in the dashboard (`docs/production-email.md`, step 2). `wrangler.jsonc` has no
  entry for it.
- **How a new version goes live:** by pushing to `main` on GitHub (`tenzinsamten/sherab`).
  Cloudflare builds and publishes it. The only place this is written down is an entry of
  2026-10-03 in `_bmad-output/manual-verification-issues.md`.
- **Not in the repository:** the build command, the Node version and the environment variables
  that Cloudflare uses are set in its dashboard. There is no `.github/` folder and no deploy
  script in `package.json`.

### The database

- **One hosted Supabase project** for production. There is no staging copy; that is a decision,
  not an omission (AD-6 in the architecture spine). Local development uses the Supabase stack
  on your own machine.
- **Database changes are pushed by hand** with `npx supabase db push`. This is separate from
  deploying the app, and the order matters: push the migration first, then deploy the code that
  needs it. `npx supabase migration list --linked` shows what the hosted database has.
- **Three settings connect the app to Supabase:** `PUBLIC_SUPABASE_URL`,
  `PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Locally the hosted values are in
  `.env.production`, which Git ignores. `npm run build` and `npm run dev:hosted` use that file.
- **Careful with `npm run dev:hosted`:** it runs the app on your machine against the real
  hosted data.

### Email

Confirmation and password-reset mails go through Resend, from `no-reply@sherab.app`. The setup
is done in the Supabase dashboard, not in the code. See `docs/production-email.md`.

### Notifications

Homework notifications to phones (#92) add no cost: they go through the browser makers' free
push services. They need four variables in Cloudflare and two secrets in Supabase. See
`docs/notifications.md`.

### Known gaps

- Nothing checks that the hosted database has every migration before a deploy (issue 5 in the
  issue log, still open).
- The Cloudflare build settings are not written down anywhere in the repository.

## 2. What it costs today

| Item                | Plan | Cost         | What the free plan allows                                                |
| ------------------- | ---- | ------------ | ------------------------------------------------------------------------ |
| Cloudflare Pages    | Free | US$0         | unlimited traffic, 500 builds a month, 100,000 server requests a day     |
| Supabase            | Free | US$0         | 500 MB database, 1 GB files, 50,000 active users a month, 5 GB downloads |
| Resend              | Free | US$0         | 3,000 emails a month, 100 a day                                          |
| Domain `sherab.app` | -    | not recorded | -                                                                        |

- **The domain price is not in the repository.** The email guide priced `.org` (about US$8.50
  the first year, about US$11.20 after) and `.com` (US$10.46 a year), but not `.app`. The
  Cloudflare invoice has the real figure.
- **Expected use:** about 100-150 accounts and 5-10 MB of new data a year. That is far below
  every limit in the table. The architecture notes conclude US$0 a month for as long as the app
  serves one school.

Two limits are worth knowing:

- **Resend sends at most 100 emails a day.** If more than about 80 parents register on the same
  day, spread the invitation over two days. The email guide names Brevo as the alternative.
- **Supabase pauses a free project after 7 days without activity.** This costs nothing, but
  someone has to restore it in the dashboard. Scheduled jobs do not run while it is paused; the
  app's jobs are written to catch up afterwards (AD-6).

Sources: Cloudflare Pages limits from the architecture notes (checked September 2026). Supabase
figures from <https://supabase.com/pricing> (read 2026-10-06). Resend figures from
`docs/production-email.md` (checked 2026-10-05).

## 3. What Supabase Pro would add

|                         | Free (today)                  | Pro                                               |
| ----------------------- | ----------------------------- | ------------------------------------------------- |
| Price                   | US$0                          | from US$25 a month, includes US$10 compute credit |
| Backups                 | none                          | daily, kept 7 days                                |
| Pausing                 | after 1 week without activity | never                                             |
| Database                | 500 MB                        | 8 GB, then US$0.125 per GB                        |
| Active users a month    | 50,000                        | 100,000, then US$0.00325 each                     |
| Downloads (egress)      | 5 GB                          | 250 GB, then US$0.09 per GB                       |
| File storage            | 1 GB                          | 100 GB, then US$0.0213 per GB                     |
| API and database logs   | kept 1 day                    | kept 7 days                                       |
| Support                 | community                     | email                                             |
| Custom SMTP (own email) | included                      | included                                          |

Source: <https://supabase.com/pricing> (read 2026-10-06).

What this means for Sherab:

- **Backups are the real gap.** The database holds children's attendance, homework and parent
  accounts, and on the free plan nothing backs it up. Pro is the simplest fix. A regular
  database dump (`supabase db dump` or `pg_dump`) kept somewhere safe covers the same risk for
  free. No such dump is set up today.
- **No pausing** matters over school holidays, when a week without use is likely.
- **Longer logs** help when a problem has to be traced a few days later.
- **The larger limits change nothing** at the size of one school.
- **The bill stays at the base price** unless the spend cap is switched off. It is on by
  default.

**Recommendation:** stay on the free plan and set up a regular database dump. Move to Pro when
losing a day of data, or a pause during the holidays, would be a real problem for the school.

## 4. If file upload is added

The app has no file upload today. This section records what it would mean for the cost.

### What the free plan allows

- 1 GB of stored files in total and 5 GB of downloads a month.
- At most 50 MB per file. This figure is from memory and was **not re-checked**.

### How much space different uses would need

Assumed: about 100 students and 40 school weeks a year. These are estimates, not measurements.

| Use                                                        | Per year            | Fits in 1 GB?             |
| ---------------------------------------------------------- | ------------------- | ------------------------- |
| Teachers attach documents (PDF, worksheets, about 0.5 MB)  | about 0.1-0.25 GB   | yes, for about four years |
| Students upload one homework photo a week, as taken (4 MB) | about 16 GB         | no, full within a month   |
| The same, made smaller in the browser first (about 300 KB) | about 1.2 GB        | for most of one year      |
| Sound or video recordings                                  | several GB, quickly | no                        |

### Documents only

This is the case discussed. The outcome:

- **It stays free.** Even 500 documents a year need about 0.25 GB.
- **Supabase Storage is the simpler place** for them. It can use the same access rules as the
  database (a teacher's class, a student's own class), and no second service is needed.
- **Set a size limit and a list of allowed file types.** For example 5 MB per file, PDF and
  perhaps Word documents. Without this, a phone will offer camera photos and large scans as
  "files", and the space fills as in the photo rows above.

### Points to settle if it is built

- **Backups.** Supabase's backups cover the database, not stored files. This is **not
  confirmed**; check it before relying on either answer. For worksheets a teacher still has on
  their own computer, the risk is small.
- **Deletion requests.** If students upload, a parent's request to delete a child's data must
  also delete that child's files. If only teachers upload, this mostly does not arise.
- **Photos, sound or video later.** Then either make images smaller before upload and delete
  files after a set time, or move to Pro. Cloudflare R2 is an alternative: 10 GB free and no
  charge for downloads (from memory, **not re-checked**). With R2 the access checks would have
  to be written in the app's server code instead of using the database rules.
