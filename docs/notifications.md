# Homework notifications (#92)

Students and parents can get a notification on their phone about homework. This page says what
is sent, how to switch it on for the hosted app, and how to check that it works.

Built and tested locally on **2026-10-06**. It is **not** switched on for `sherab.app` yet:
that needs the steps under "Setup" below, done by hand. What was and was not verified is listed
at the end.

## What is sent

| Notice   | When                                                       | Student | Parent |
| -------- | ---------------------------------------------------------- | ------- | ------ |
| New      | A teacher creates one-off homework                         | yes     | yes    |
| Due soon | Saturday morning, for open homework due in the next 7 days | yes     | yes    |
| Overdue  | Once, on the morning after the due date                    | no      | yes    |

- **Not for teachers or admins.** A teacher who is also an approved parent gets the parent
  notices.
- **Not for weekly homework when it repeats.** A weekly series gets no "New" notice; its
  homework shows up in the Saturday reminder.
- **One notice per person and kind.** A parent with several children, or several pieces of
  homework, gets one notice with a short list.
- **In the language of the phone.** Each phone gets the text in the language the app was shown
  in when it was last opened there.
- **Each notice goes out once.** Homework that is marked done gets no more notices.
- **Cost: none.** Notifications go through the browser makers' own services (Google, Apple,
  Mozilla, Microsoft), which are free.

## How people switch it on

Under **My Account** there is a **Notifications** card with one button. It appears for approved
students and approved parents, and only once the setup below is done.

- The setting belongs to the **device**. A phone notifies the account that is signed in on it,
  and stops at sign-out. If a child signs in on a parent's phone, the child gets the notices
  there until the parent signs in again.
- **iPhone and iPad:** notifications only work after Sherab was added to the Home Screen
  (Share, then "Add to Home Screen") and opened from there. The card says so.
- If notifications were blocked in the browser, the card says how to allow them again.

The parent and student guides under `/help` each have a step about this.

## Setup for the hosted app

Four values have to be set in Cloudflare and two in Supabase. Until then nothing is sent and the
card stays hidden, so the code can be deployed first.

### 1. Create the key pair

In the project folder:

```sh
node -e "import('web-push-neo').then(async (m) => console.log(await m.generateVAPIDKeys()))"
```

It prints a `publicKey` and a `privateKey`. Create them **once** and keep them: if the keys
change later, every phone has to switch notifications on again.

### 2. Create the shared secret

```sh
openssl rand -hex 32
```

This is the password the database uses when it asks the app to send.

### 3. Set the variables in Cloudflare

Cloudflare dashboard -> **Workers & Pages** -> `tib-class` -> **Settings** -> **Variables and
Secrets**, for Production:

| Name                | Value                        | Type   |
| ------------------- | ---------------------------- | ------ |
| `VAPID_PUBLIC_KEY`  | the `publicKey` from step 1  | Text   |
| `VAPID_PRIVATE_KEY` | the `privateKey` from step 1 | Secret |
| `VAPID_SUBJECT`     | `https://sherab.app`         | Text   |
| `PUSH_CRON_SECRET`  | the value from step 2        | Secret |

`VAPID_SUBJECT` tells the push services who is sending; a `mailto:` address works too. As far as
I know the variables only take effect with the next deployment; this was not checked.

Do not put the private key or the secret in the repository.

### 4. Push the migration, then deploy

```sh
npx supabase db push
```

This adds migration `0037_push_notifications.sql`. It only adds things, so the app that is
already deployed keeps working. Then push to `main` as usual.

After this the Notifications card appears and people can switch it on. Nothing is sent yet.

### 5. Switch the sending on

Supabase dashboard -> **SQL Editor**, with the secret from step 2:

```sql
select vault.create_secret('https://sherab.app/api/push/run', 'push_cron_url');
select vault.create_secret('PASTE-THE-SECRET-HERE', 'push_cron_secret');
```

From now on the database calls the app every 5 minutes between 07:00 and 08:55 UTC (08:00 to
09:55 in winter, 09:00 to 10:55 in summer, German time) and once whenever a teacher creates
homework.

### Switching it off again

```sql
delete from vault.secrets where name in ('push_cron_url', 'push_cron_secret');
```

Nothing is sent after that. To also hide the card, remove `VAPID_PUBLIC_KEY` in Cloudflare.

## Check that it works

Use two phones or browsers if you can: one signed in as a student, one as that student's parent.

1. **Switch on.** As the student, open My Account and press "Turn on notifications". Allow the
   browser's question. The card now says they are on. Do the same as the parent.
2. **New homework.** As a teacher, create one-off homework for that student's class. Both get
   "New homework" within about a minute. The parent's names the child.
3. **Press the notice.** It opens the homework page of the right role.
4. **Language.** Switch the app to German or Tibetan on one phone, open any page, and create
   another piece of homework. That phone's notice is in the new language.
5. **Overdue.** Create homework that was due yesterday. At the next morning run the parent gets
   "homework overdue"; the student gets nothing. The morning after, nothing comes again.
6. **Saturday.** On a Saturday morning both get one "Homework due soon" for what is due in the
   next 7 days.
7. **Sign out.** Sign the student out, create homework: that phone gets nothing.
8. **Shared phone.** Sign the parent in on the phone the student used. The parent's notices now
   arrive there.
9. **iPhone.** In Safari the card asks to add the app to the Home Screen. From the Home Screen
   app the button works.
10. **Switch off.** Press "Turn off notifications" and create homework: nothing arrives.

### If nothing arrives

1. **Did the database call the app?** In the SQL Editor:

   ```sql
   select id, status_code, timed_out, error_msg, created
   from net._http_response order by id desc limit 5;
   ```

   `202` means the app accepted the call. `401` means the secret in Vault and
   `PUSH_CRON_SECRET` in Cloudflare differ. No rows means the Vault secrets are missing, or
   the hour is outside the morning window. Supabase keeps these rows only for a few hours.

2. **Did the job run?**

   ```sql
   select status, return_message, start_time
   from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'send-homework-push')
   order by start_time desc limit 5;
   ```

3. **What did the app do?** Cloudflare -> Workers & Pages -> `tib-class` -> the latest
   deployment -> Functions logs. Lines starting with `push:` say what failed.
4. **Is the phone registered, and was the notice already sent?**

   ```sql
   select profile_id, locale, updated_at from push_subscriptions order by updated_at desc;
   select * from push_notification_log order by sent_at desc limit 10;
   ```

## Limits to know

- **Small batches.** Cloudflare's free plan allows 50 outgoing calls per request, so the app
  sends to at most 20 phones per call. The morning runs add up to about 480 phones; a "New"
  notice reaches about 180 phones. More than enough for one school.
- **A paused database sends nothing.** A free Supabase project pauses after 7 days without
  use. A missed Saturday reminder is not sent later. A missed overdue notice is sent at the
  next run, if that is within 7 days of the due date.
- **Phones that are off** get the notice when they come back, for up to 2 days.
- **Parents who never switch it on, or never add the app to an iPhone's Home Screen,** get
  nothing. There is no email fallback.
- **Students who join a class later** get the open homework but no "New" notice for it.

## How it is built

| Part                                  | Where                                             |
| ------------------------------------- | ------------------------------------------------- |
| Who is owed which notice, and the log | `supabase/migrations/0037_push_notifications.sql` |
| Text, sending, batches                | `src/lib/server/push.ts`                          |
| The endpoint the database calls       | `src/routes/api/push/run/+server.ts`              |
| Saving and removing a phone           | `src/routes/api/push/subscription/+server.ts`     |
| The browser side and the card         | `src/lib/push-client.ts`, `src/routes/account/`   |
| Showing the notice on the phone       | `static/push-sw.js`                               |

The library is `web-push-neo` (it runs on Cloudflare; the usual `web-push` package does not).
The app only posts to the push services of Google, Mozilla, Apple and Microsoft; any other
address in a subscription is refused.

To try it on your own machine, put the four values in `.env` and run `npm run dev`. The
"New" notice and the morning runs also need the two Vault secrets in the local database,
pointing at your machine's network address (for example `http://192.168.x.x:5173/api/push/run`).
`.env.production` needs them only for `npm run dev:hosted`.

## What was verified, and what was not

Verified on 2026-10-06, locally:

- The app's real sending code delivered notices through Mozilla's push service to a scripted
  receiver, which decrypted them: "New" to student (Tibetan) and parent (German), "Overdue" to
  the parent only, nothing on a repeated call, and the hand-over from the database to the app.
- The library produces standard-conforming messages inside Cloudflare's local runtime.
- 1029 unit tests, the type check and the build pass; the database rules have 13 tests.
- The card shows for a parent at phone width, and the service worker loads the push handler.

**Not verified:**

- A notification actually appearing on a real phone or in a real browser (Chrome, Safari,
  Firefox). The automated browser could not answer the permission question.
- An iPhone with the app on the Home Screen.
- Anything on `sherab.app`: the Cloudflare variables, the hosted database job, and whether a
  batch of 20 stays inside Cloudflare's free CPU limit.
- The Saturday reminder end to end (its rule is covered by tests; no Saturday was simulated
  against the running app).
- The Tibetan texts are a draft and have not been reviewed.
