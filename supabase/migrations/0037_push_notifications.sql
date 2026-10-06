-- 0037_push_notifications.sql
--
-- #92: homework push notifications for students and parents.
--
-- * push_subscriptions: one row per browser (its push endpoint), owned by
--   the account signed in there. No client reads or writes the table; the
--   two RPCs below are the only way in.
-- * push_notification_log: one row per (kind, instance, student,
--   recipient) that was sent. It is what makes every notice go out once.
--   service_role only.
-- * save_push_subscription() / delete_push_subscription(): the signed-in
--   student or approved parent registers this browser, or removes it.
--   Saving an endpoint another account holds moves it to the caller: a
--   shared phone notifies whoever is signed in.
-- * homework_push_targets(kind, instance): who is owed which notice --
--   'added' (one instance: its students and their parents), 'due_soon'
--   (open, due today to today + 6: students and parents) and 'overdue'
--   (open, due in the last 7 days: parents only). Open is the
--   homework_counts() rule (0025). Only recipients with a subscription and
--   no log row. service_role only.
-- * trigger_homework_push(): posts to the app's /api/push/run with a shared
--   secret, both read from Vault (push_cron_url, push_cron_secret). pg_cron
--   calls it every morning; the app calls it when homework is created.
--   Does nothing until both secrets exist, so local databases and a fresh
--   project stay silent.

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null
    constraint push_subscriptions_endpoint_key unique
    constraint push_subscriptions_endpoint_valid
      check (endpoint like 'https://%' and length(endpoint) <= 2048),
  p256dh text not null
    constraint push_subscriptions_p256dh_valid check (length(p256dh) between 1 and 200),
  auth text not null
    constraint push_subscriptions_auth_valid check (length(auth) between 1 and 200),
  locale text not null
    constraint push_subscriptions_locale_valid check (locale in ('en', 'de', 'bo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.push_subscriptions is
  '#92: one row per browser that receives homework push notifications, owned by the account signed in there. locale is that browser''s app language at the last save (a scheduled job has no cookie to read it from). Written only through save_push_subscription() / delete_push_subscription(); read only by the service role.';

create index push_subscriptions_profile_id_idx on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- push_notification_log
-- ---------------------------------------------------------------------------

create table public.push_notification_log (
  kind text not null
    constraint push_notification_log_kind_valid
      check (kind in ('added', 'due_soon', 'overdue')),
  instance_id uuid not null references public.homework_instances (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (kind, instance_id, student_id, recipient_id)
);

comment on table public.push_notification_log is
  '#92: a homework notice that was handed to the push service, per kind, instance, student and recipient (the student, or the student''s parent). homework_push_targets() leaves out what is logged here, so a notice is sent once however often the job runs. service_role only.';

create index push_notification_log_recipient_id_idx
  on public.push_notification_log (recipient_id);
create index push_notification_log_student_id_idx
  on public.push_notification_log (student_id);

alter table public.push_notification_log enable row level security;

revoke all on public.push_notification_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- save_push_subscription()
-- ---------------------------------------------------------------------------

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_locale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Students and approved parents only (a teacher who is also an approved
  -- parent counts as a parent).
  if not (
    public.is_parent()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'student'
        and p.status = 'approved'
    )
  ) then
    raise exception 'not allowed to receive homework notifications'
      using errcode = '42501';
  end if;

  -- An endpoint is one browser. Saving it again, from the same or another
  -- account, hands it to the caller with the keys and language sent now.
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, locale)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_locale)
  on conflict on constraint push_subscriptions_endpoint_key do update
    set profile_id = excluded.profile_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        locale = excluded.locale,
        updated_at = now();
end;
$$;

comment on function public.save_push_subscription(text, text, text, text) is
  '#92: registers the calling student''s or approved parent''s browser for homework notifications. An endpoint already saved (by anyone) moves to the caller.';

revoke all on function public.save_push_subscription(text, text, text, text)
  from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- delete_push_subscription()
-- ---------------------------------------------------------------------------

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s
  where s.endpoint = p_endpoint
    and s.profile_id = auth.uid();
$$;

comment on function public.delete_push_subscription(text) is
  '#92: removes the caller''s own subscription for this endpoint (switching notifications off, or signing out). Another account''s row is left alone.';

revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- homework_push_targets(kind, instance)
-- ---------------------------------------------------------------------------

create or replace function public.homework_push_targets(
  p_kind text,
  p_instance_id uuid default null
)
returns table (
  recipient_id uuid,
  student_id uuid,
  student_name text,
  instance_id uuid,
  title text,
  class_name text,
  class_name_bo text,
  class_name_de text,
  due_date date
)
language sql
security definer
set search_path = ''
stable
as $$
  with today as (
    select (now() at time zone 'Europe/Berlin')::date as d
  ),
  progress as (
    select h.instance_id,
           h.student_id,
           bool_or(h.status = 'assigned') as assigned,
           bool_or(h.status in ('done', 'reviewed')) as finished
    from public.homework_status_history h
    where p_instance_id is null or h.instance_id = p_instance_id
    group by h.instance_id, h.student_id
  ),
  -- Open, as in homework_counts() (0025): assigned, not Done or Reviewed,
  -- not archived, student still enrolled. Then the window of the kind.
  open_items as (
    select p.instance_id, p.student_id, hi.assignment_id, hi.class_id, hi.due_date
    from progress p
    join public.homework_instances hi on hi.id = p.instance_id
    cross join today t
    where p.assigned
      and not p.finished
      and hi.archived_at is null
      and exists (
        select 1
        from public.class_enrollments e
        where e.student_id = p.student_id
          and e.class_id = hi.class_id
      )
      and case p_kind
            when 'added' then p_instance_id is not null
            when 'due_soon' then hi.due_date between t.d and t.d + 6
            when 'overdue' then hi.due_date between t.d - 7 and t.d - 1
            else false
          end
  ),
  recipients as (
    -- The student, except for Overdue (parents only).
    select o.instance_id, o.student_id, o.assignment_id, o.class_id, o.due_date,
           s.id as recipient_id, s.display_name as student_name
    from open_items o
    join public.profiles s on s.id = o.student_id
    where p_kind <> 'overdue'
      and s.role = 'student'
      and s.status = 'approved'
    union all
    -- The student's approved parent.
    select o.instance_id, o.student_id, o.assignment_id, o.class_id, o.due_date,
           pa.id as recipient_id, s.display_name as student_name
    from open_items o
    join public.profiles s on s.id = o.student_id
    join public.parents pa on pa.id = s.parent_id and pa.status = 'approved'
    where s.role = 'student'
      and s.status = 'approved'
  )
  select r.recipient_id,
         r.student_id,
         r.student_name,
         r.instance_id,
         a.title,
         c.name,
         c.name_bo,
         c.name_de,
         r.due_date
  from recipients r
  join public.homework_assignments a on a.id = r.assignment_id
  join public.classes c on c.id = r.class_id
  where exists (
      select 1
      from public.push_subscriptions ps
      where ps.profile_id = r.recipient_id
    )
    and not exists (
      select 1
      from public.push_notification_log l
      where l.kind = p_kind
        and l.instance_id = r.instance_id
        and l.student_id = r.student_id
        and l.recipient_id = r.recipient_id
    )
  order by r.recipient_id, r.due_date, a.title, r.student_id;
$$;

comment on function public.homework_push_targets(text, uuid) is
  '#92: the homework notices still owed, one row per recipient, student and instance. added = the given instance (students and their approved parents); due_soon = open homework due from today to today + 6 (students and parents); overdue = open homework due in the last 7 days (parents only). Today is Europe/Berlin. Leaves out recipients without a push subscription and notices already in push_notification_log. service_role only.';

revoke all on function public.homework_push_targets(text, uuid)
  from public, anon, authenticated;
grant execute on function public.homework_push_targets(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- trigger_homework_push(): the daily job, and the "added" hand-over
-- ---------------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_homework_push(
  p_kind text default null,
  p_instance_id uuid default null,
  p_depth integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  -- Vault holds the app's address and the shared secret. Neither belongs in
  -- a migration: they differ per project, and the secret must stay out of
  -- the repository. Read with dynamic SQL so a database without Vault
  -- still loads this function.
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;

  execute
    'select (select decrypted_secret from vault.decrypted_secrets where name = ''push_cron_url''),
            (select decrypted_secret from vault.decrypted_secrets where name = ''push_cron_secret'')'
    into v_url, v_secret;

  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;

  select net.http_post(
           url := v_url,
           headers := jsonb_build_object(
             'content-type', 'application/json',
             'authorization', 'Bearer ' || v_secret
           ),
           body := jsonb_build_object(
             'kind', p_kind,
             'instanceId', p_instance_id,
             'depth', p_depth
           )
         )
    into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.trigger_homework_push(text, uuid, integer) is
  '#92: asks the app to send homework notices (POST to the Vault secret push_cron_url, bearer push_cron_secret). No arguments = the scheduled run (Overdue, and Due soon on a Saturday). kind added + an instance = the notice for homework just created; the app calls again with depth + 1 while a batch leaves recipients over. Returns the pg_net request id, or NULL when a secret is missing (nothing is sent). The app logs what it sends, so a repeated call sends nothing twice. service_role / pg_cron only.';

revoke all on function public.trigger_homework_push(text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.trigger_homework_push(text, uuid, integer) to service_role;

-- Every 5 minutes from 07:00 to 08:55 UTC (08:00-09:55 in Berlin in
-- winter, 09:00-10:55 in summer), every day. One run sends a small batch:
-- Cloudflare's free plan allows 50 outgoing calls per request, so the
-- morning's notices go out over several runs and the log keeps each one to
-- once. A fixed name keeps re-runs of this migration idempotent (0005).
select cron.schedule(
  'send-homework-push',
  '*/5 7-8 * * *',
  $$select public.trigger_homework_push();$$
);
