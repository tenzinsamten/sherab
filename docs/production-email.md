# Production email for Sherab (issue #84)

How to make the confirmation and password-reset emails reach real parents. Everything here is
done by hand in three dashboards (Cloudflare, the email provider, Supabase). Nothing in the code
has to change.

All prices and limits were checked on **2026-10-05**. The source is given next to each one. Where
a number could not be confirmed on the provider's own page, it says so.

## Recommendation in short

| What           | Choice                                               | Cost                                                    |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Domain         | a `.org` name bought at Cloudflare Registrar         | about US$8.50 the first year, about US$11.20 after that |
| Email provider | Resend, free plan                                    | US$0 (3,000 emails a month, 100 a day)                  |
| Supabase       | stays on the free plan; custom SMTP is allowed there | US$0                                                    |
| **Total**      |                                                      | **about US$9-11 a year (roughly 8-10 EUR)**             |

There is no monthly fee. The only thing that costs money is the domain, and a domain is needed
because no email provider will send to arbitrary people from an address you do not own.

Why these:

- **Cloudflare Registrar**: the app is already on Cloudflare, so the domain, its DNS records and
  the app end up in one dashboard, and Resend can add its DNS records there with one button.
- **`.org`**: fits a school or association and Cloudflare sells it. Cloudflare does **not** sell
  `.de` (see the alternatives).
- **Resend**: simplest setup of the providers compared, and a ready-made Supabase guide.

One limit to know before choosing: Resend's free plan stops at **100 emails a day**. Every
registration is one email, every "forgot password" is one, every re-sent confirmation is one. If
you expect more than about 80 parents to register on the same day (a kick-off Sunday), either
spread the invitation over two days or use Brevo (300 a day) instead.

### Alternatives and why not

Domain:

| Option                               | Price                                                                                      | Why not the first choice                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.com` at Cloudflare                 | US$10.46 a year, same every year                                                           | Fine too. Slightly less fitting for a school; good names are mostly taken.                                                                           |
| `.de` at INWX (German registrar)     | 4.71 EUR first year, 3.60 EUR a year after, **net** (plus 19 % VAT: about 5.60 / 4.30 EUR) | Cheapest. But Cloudflare cannot sell it, so you buy it elsewhere and then point its nameservers to Cloudflare: one extra account and one extra step. |
| `.school`, `.education` (Cloudflare) | about US$28 a year                                                                         | Three times the price for no practical gain.                                                                                                         |

Email provider:

| Provider                 | Free allowance                                                      | Why not the first choice                                                                                                         |
| ------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Resend** (recommended) | 3,000 a month, 100 a day, 3 domains                                 | -                                                                                                                                |
| Brevo                    | 300 a day (not confirmed on Brevo's own page, see below)            | Good second choice if 100 a day is too few. A marketing product with a busier dashboard; free-plan details could not be checked. |
| Amazon SES               | no lasting free tier; US$0.10 per 1,000 emails (a few cents a year) | Needs an AWS account, a credit card, and a request to leave the "sandbox" before it sends to strangers. Too much setup for this. |
| Cloudflare Email Service | 3,000 a month, but only on the Workers Paid plan (US$5 a month)     | Costs money, and its documentation shows no SMTP login that Supabase could use.                                                  |

Sources for the tables:

- Cloudflare prices: <https://cfdomainpricing.com/> (data dated 2026-10-04). This is a
  third-party list of Cloudflare's prices. Cloudflare shows its own prices only inside the
  dashboard when you search for a name, so **the price you see at checkout is the one that
  counts**. A second third-party list from May 2026 showed `.org` at US$7.50 / US$10.13, so the
  `.org` price has moved this year.
- Cloudflare does not list `.de`: <https://www.cloudflare.com/tld-policies/>
- INWX `.de`: <https://www.inwx.de/de/domain/pricelist> (net prices; the INWX `.de` page itself
  advertises "5,02 EUR", so check the amount at checkout).
- Resend: <https://resend.com/pricing> and
  <https://resend.com/docs/knowledge-base/resend-sending-limits>
- Brevo: the pricing and help pages could not be opened by the tool used for this check. "300
  emails a day" comes from third-party reviews only. Check <https://www.brevo.com/pricing/>
  yourself before relying on it.
- Amazon SES: <https://aws.amazon.com/ses/pricing/>
- Cloudflare Email Service: <https://developers.cloudflare.com/email-service/platform/pricing/>

### What Supabase gives you without this setup

From <https://supabase.com/docs/guides/auth/auth-smtp> and
<https://supabase.com/docs/guides/auth/rate-limits>:

- The built-in sender delivers **only to the email addresses of your Supabase organisation's
  team members**. A parent's address is refused.
- It sends **2 emails an hour** for the whole project, with no delivery guarantee. Supabase calls
  it "non-production".
- Custom SMTP is available on the free plan. Supabase's own note on free-plan email templates
  says so directly:
  <https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier>
- Right after you switch on custom SMTP the limit becomes **30 emails an hour**, and you can
  raise it yourself.
- Separately, the same person can only be sent a new confirmation or reset email once every
  **60 seconds**.

## Before you start: three decisions

1. **The domain name.** Below it is written as `sherab.app`. Replace it everywhere.
2. **Does the app move to the domain?** Recommended: yes, so parents see
   `https://sherab.app` in the email link and in the browser instead of a `pages.dev`
   address. Do it **before** parents install the app on their phones: an app installed from the
   old address stays tied to the old address, and everybody has to sign in again on the new one.
3. **Sender name and address.** Suggested: name `Sherab`, address `no-reply@sherab.app`.
   Nobody can answer to that address unless you also set up a mailbox or forwarding (see "What
   this does not cover").

## Steps

### 1. Buy the domain

1. Sign in to the Cloudflare dashboard (the account the app is deployed from).
2. Go to **Domain Registration -> Register Domains**, search for the name, and buy it for one
   year. Auto-renew is on by default; leave it on.
3. The domain now appears in the account as a "zone" with Cloudflare's DNS. You cannot move its
   nameservers elsewhere while it is registered at Cloudflare; that is fine for this setup.

Source: <https://developers.cloudflare.com/registrar/get-started/register-domain/>

If you choose `.de` instead: buy it at INWX, then in Cloudflare choose **Add a domain**, pick the
Free plan, and enter the two Cloudflare nameservers it shows you at INWX. Wait until Cloudflare
says the domain is active before going on.

### 2. Put the app on the domain (recommended)

The app is a Cloudflare Pages project (`wrangler.jsonc`, project name `tib-class`).

1. Cloudflare dashboard -> **Workers & Pages** -> the `tib-class` project -> **Custom domains**
   -> **Set up a domain**.
2. Enter `sherab.app` (or a subdomain such as `app.sherab.app`) and continue. Cloudflare
   creates the DNS record itself because the domain is in the same account.
3. Wait until the status says active, then open `https://sherab.app` and check that the
   sign-in page loads.

The old `https://<project>.pages.dev` address keeps working. That is harmless, but from now on
give people only the new address.

Source: <https://developers.cloudflare.com/pages/configuration/custom-domains/>

If you skip this step, the app stays on its `pages.dev` address. Email still works; use the
`pages.dev` address wherever step 6 says `https://sherab.app`.

### 3. Create the Resend account and verify the domain

1. Create a free account at <https://resend.com>.
2. **Domains -> Add Domain**. Enter `sherab.app`. For the region choose **Ireland
   (eu-west-1)**, since the recipients are in Germany.
3. Resend now shows the DNS records it needs. The easy way: press **Sign in to Cloudflare** and
   let Resend add them. The manual way: in Cloudflare open the domain -> **DNS -> Records** and
   add each one. **Copy the values from Resend's screen**; the ones below show the kind of record
   to expect, the exact text differs per account and region.

   | Type | Name                | Content (example)                                   | Purpose                               |
   | ---- | ------------------- | --------------------------------------------------- | ------------------------------------- |
   | MX   | `send`              | `feedback-smtp.<region>.amazonses.com`, priority 10 | return path for bounces               |
   | TXT  | `send`              | `v=spf1 include:amazonses.com ~all`                 | SPF: who may send for you             |
   | TXT  | `resend._domainkey` | `p=...` (a long key)                                | DKIM: the signature on each email     |
   | TXT  | `_dmarc`            | `v=DMARC1; p=none;`                                 | DMARC: optional for Resend, do add it |

   Notes for Cloudflare: these are all "DNS only" records (no orange cloud; MX and TXT records
   cannot be proxied anyway). In the Name field type only the short name (`send`), Cloudflare
   adds the domain. The `_dmarc` record is not part of Resend's verification, but Gmail and
   others treat mail from a domain without it with more suspicion.

4. Back in Resend press **Verify**. It usually turns green within minutes; it can take a few
   hours.

Until the domain is verified Resend only lets you send test mails to your own address, so do not
go on before it is green.

Sources: <https://resend.com/docs/knowledge-base/cloudflare>,
<https://resend.com/docs/dashboard/domains/dmarc>,
<https://resend.com/docs/dashboard/domains/regions>,
<https://resend.com/docs/knowledge-base/403-error-resend-dev-domain>

### 4. Create the SMTP credential

In Resend: **API Keys -> Create API Key**. Name it `supabase-auth`, permission **Sending
access**, restricted to `sherab.app`. Copy the key now; it is shown only once.

This key is the SMTP password. Do not put it in the repository, in `.env` files or in Cloudflare.
It goes into Supabase only (next step). If it is ever lost or leaked, delete it in Resend and
create a new one.

### 5. Enter the SMTP details in Supabase

Supabase dashboard -> the production project -> **Authentication -> Emails -> SMTP Settings**
(direct link: `https://supabase.com/dashboard/project/_/auth/smtp`). Switch on **Enable custom
SMTP** and enter:

| Field        | Value                   |
| ------------ | ----------------------- |
| Sender email | `no-reply@sherab.app`   |
| Sender name  | `Sherab`                |
| Host         | `smtp.resend.com`       |
| Port         | `465`                   |
| Username     | `resend`                |
| Password     | the API key from step 4 |

Save. The sender address must be on the domain you verified, otherwise Resend rejects the mail.

Source: <https://resend.com/docs/send-with-supabase-smtp>

(If you use Brevo instead: host `smtp-relay.brevo.com`, port `587`, and the SMTP login and SMTP
key from Brevo's "SMTP & API" page, not the API key. Source:
<https://developers.brevo.com/docs/smtp-integration>)

### 6. Set the Site URL and Redirect URLs in Supabase

Supabase dashboard -> **Authentication -> URL Configuration**
(`https://supabase.com/dashboard/project/_/auth/url-configuration`).

- **Site URL**: `https://sherab.app` (no slash at the end).
- **Redirect URLs**, add:
  - `https://sherab.app/**`

  That one pattern covers the two addresses the app really asks for:
  `https://sherab.app/auth/confirm?flow=signup` (registration and the re-sent confirmation)
  and `https://sherab.app/auth/confirm` (forgot password).

  If the `pages.dev` address should keep working for sign-up as well, also add
  `https://<project>.pages.dev/**`.

Why this matters for this app: the app builds the link target from the address the visitor is
on at that moment (`url.origin` in `src/routes/(auth)/register/+page.server.ts:69`,
`src/routes/(auth)/login/+page.server.ts:41` and `src/lib/server/password-reset.ts:36`). Supabase
only accepts a target that is on this list. A target that is not on the list is not used, and the
link goes to the Site URL instead, where the app does not finish the confirmation.

While you are in the dashboard, check under **Authentication -> Sign In / Providers -> Email**
that **Confirm email** is switched on. The app is built for that (`enable_confirmations = true`
in `supabase/config.toml:230`).

Source: <https://supabase.com/docs/guides/auth/redirect-urls>

### 7. Change the two email templates so the link works on any device

This step is small but important. Do not skip it.

Supabase's default emails contain a link that only works **in the same browser on the same
device** where the parent filled in the form (Supabase calls this the PKCE flow; source:
<https://supabase.com/docs/guides/auth/sessions/pkce-flow>). A parent who registers on a laptop
and opens the email on a phone would land on "link expired". The app already has the other,
device-independent way built in (`src/routes/auth/confirm/+server.ts:28` and `:40`); the email
only has to use it.

Supabase dashboard -> **Authentication -> Emails -> Templates**
(`https://supabase.com/dashboard/project/_/auth/templates`). Editing is possible on the free plan
once custom SMTP is on (step 5).

- **Confirm signup**: replace `{{ .ConfirmationURL }}` in the link with

  ```text
  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
  ```

- **Reset password**: replace `{{ .ConfirmationURL }}` in the link with

  ```text
  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery
  ```

Leave the rest of the template as it is for now. These links use the Site URL from step 6, so
the Site URL must be the address where the app really runs.

Source: <https://supabase.com/docs/guides/auth/server-side/email-based-auth-with-pkce-flow-for-ssr>
(the app's own route ignores the `next` part shown there for sign-up, so it is left out).

This link form has unit tests in the repo but has never been clicked in a real email, because
local development uses the default templates. The test checklist below covers it.

### 8. Raise the email rate limit

Supabase dashboard -> **Authentication -> Rate Limits**
(`https://supabase.com/dashboard/project/_/auth/rate-limits`).

- **Rate limit for sending emails**: it is 30 an hour after step 5. Set it to **100** an hour.
  More is pointless on Resend's free plan (100 a day).
- Leave the others as they are.

Locally the limit is 1,000 an hour and the wait between two mails to the same person is 1 second
(`supabase/config.toml:203` and `:234`). Production is stricter: 60 seconds between two mails to
the same person. So in production a parent who registers and immediately tries to sign in does
not get a second mail; that is expected.

### 9. Changes in the repo and in Cloudflare environment variables

**None are required.**

- No address is hard-coded anywhere in `src/`. The email links follow the address the visitor
  uses (see step 6).
- The app's installable-app manifest uses `start_url: '/'` (`vite.config.ts:55`), which follows
  the domain automatically.
- The three variables the app uses (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`) point to Supabase, not to the app's own address. They stay as they
  are. The SMTP password is **not** a variable of the app.
- `wrangler.jsonc` needs no entry for the domain; a Pages custom domain is set in the dashboard
  (step 2).

Optional tidy-ups, not needed for production:

- `supabase/config.toml:162` lists only `http://127.0.0.1:5173` as a local redirect address. If
  the dev server is opened as `http://localhost:5173`, or the preview on port 4173 is used, local
  email links fall back to the site URL. Adding those addresses would only affect local work.
- The email templates could be kept in the repo (`supabase/templates/*.html` plus
  `[auth.email.template.*]` in `supabase/config.toml`, the commented block from line 251) so that
  local mail in Mailpit (`http://127.0.0.1:54324`) looks and behaves like production. Today
  neither exists; the dashboard is the only place the production templates live.
- `README.md` has no section on deployment or production settings. A pointer to this file would
  help.

## Test checklist

Use an email address that is **not** a member of the Supabase organisation and not on your own
domain, for example a private Gmail address. Test on the production address.

1. **Register.** Open `https://sherab.app/register` and register a parent with the outside
   address. The page should say that a confirmation email was sent.
2. **The mail arrives** within a minute, from `Sherab <no-reply@sherab.app>`. Note whether it
   is in the inbox or in spam.
3. **The link.** It should start with `https://sherab.app/auth/confirm?token_hash=`. Open it
   **on a different device** than the one you registered on (register on the laptop, open on the
   phone). You should land signed in on `/parent`, which shows the account as waiting for
   approval.
4. **Re-send from sign-in.** Register a second outside address, do not open the mail, wait at
   least one minute, then try to sign in with that address and password. The page should say a
   new confirmation link was sent; a second mail should arrive and its link should work.
5. **Forgot password.** On the sign-in page choose forgot password and enter the first address.
   The mail arrives; its link opens `/reset-password`; set a new password; sign out and sign in
   with the new one. Opening the same link a second time should end on the forgot-password page
   with the "expired" message.
6. **SPF, DKIM, DMARC.** In Gmail open one of the mails, press the three dots at the top right of
   the message, choose **Show original**. The table at the top should show `SPF: PASS`,
   `DKIM: PASS` with domain `sherab.app`, and `DMARC: PASS`.
7. **Spam placement.** If the mail was in spam, mark it "not spam" once and send another. A
   brand-new domain can land in spam for the first few mails even when all three checks pass.
   Try a second mailbox type too (GMX or Web.de are common in Germany, and Outlook).
8. **Clean up.** Delete the test accounts (Supabase dashboard -> Authentication -> Users).

### If a mail does not arrive

Go through these in order:

1. **Resend -> Emails.** Is the mail listed?
   - Listed as _delivered_: it reached the mailbox provider. Look in spam.
   - Listed as _bounced_ or _complained_: open it, the reason is shown.
   - Not listed at all: Supabase never handed it over. Go on to 2.
2. **Supabase -> Logs -> Auth** (`https://supabase.com/dashboard/project/_/logs/auth-logs`).
   Search for the time of the attempt. Typical lines:
   - a rate-limit message ("email rate limit exceeded", or the 60-second wait): wait, or see
     step 8;
   - an SMTP error (wrong password, sender not allowed): recheck step 5; the sender address must
     be on the verified domain and the API key must still exist;
   - "email address not authorized": custom SMTP is not switched on or was not saved.
3. **Cloudflare -> Workers & Pages -> `tib-class` -> the latest deployment -> Functions logs.**
   The app does not show email errors to the visitor on purpose (so nobody can find out which
   addresses have accounts); it writes them here as `requestPasswordReset failed` and
   `login: confirmation resend failed`.
4. **The link arrives but ends on an error.** "Link expired" on forgot password, or the sign-in
   page with a confirmation error after registering: check that step 7 was done for both
   templates, and that the Site URL in step 6 is exactly the address the app runs on. Links are
   valid for one hour and work once.
5. **Resend -> Domains.** Is the domain still shown as verified?

## What this does not cover

- **The emails are still Supabase's standard English texts** ("Confirm your signup", "Reset
  Password"). Nothing in the repo changes them, locally or in production. Customising means
  editing subject and HTML of the two templates in the dashboard (step 7 shows where). The
  simplest version is one mail with German and English text one below the other. A mail in the
  language the parent chose (German, English or Tibetan) is possible, but needs a small code
  change first: the registration would have to store the chosen language with the account so the
  template can read it. Tibetan text in an email is shown with whatever font the parent's device
  has; the app's own Tibetan font does not travel with the mail.
- **Replies.** `no-reply@sherab.app` has no mailbox. If parents should be able to answer,
  Cloudflare offers free forwarding of addresses on your domain to an existing mailbox (Email
  Routing, in the domain's **Email** section). Not checked for this guide.
- **Link scanners.** Some mail systems (mostly company mailboxes) open every link in a mail
  before the person does, which uses up the one-time link. If a parent reports "link expired" on
  the first click, the fix is the re-send from the sign-in page (checklist item 4). A lasting fix
  would be a confirmation page with a button, which is a code change.
- **Other emails.** Teachers and admins get no sign-up mail (their accounts are created by an
  admin), and students have no real email address at all. Forgot-password works for teachers,
  admins and parents through the same setup. The app sends no other email.
- **Local development** is unchanged: local mail still goes to Mailpit at
  `http://127.0.0.1:54324` and never leaves the computer.
