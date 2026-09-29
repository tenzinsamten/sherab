-- 0031_class_join_requests.sql
--
-- B12a (#67): an approved student asks to join another class with its class
-- code. The class's teacher (the admin as backup) approves or rejects; an
-- approval enrols the student the way enroll_student() (0016) does, so the
-- late-joiner trigger gives them the class's open homework.
--
-- * class_join_requests: one row per request. At most one pending request
--   per (student, class); a rejected one stays visible to the student until
--   they dismiss it or send a new request for that class. Clients only
--   read (RLS); every write goes through the functions below.
-- * request_class_join(code): approved students only. Unknown code and a
--   class the student is already in give the same refusal
--   (22023 join_code_invalid); a second pending request for the class is
--   23505 join_already_pending; at most 3 pending (22023 join_limit).
--   A pending request for a class the student has since been enrolled in
--   another way counts for nothing: it is left out of the cap and of both
--   lists (approving it just marks it approved).
-- * list_class_join_requests(): the pending queue for teachers (their
--   classes) and the admin (all), approved students only, flagged
--   own_child for the caller's own child.
-- * decide_class_join(id, decision): the class's teacher or the admin,
--   never for their own child (AD-4, as sick_leave_decisions in 0028).
-- * dismiss_class_join(id): the student hides their own rejected request.
-- * my_class_join_requests(): the student's pending and not-dismissed
--   rejected requests with the class name (students can't read classes
--   they are not in).
--
-- No existing table, column, policy or function changes.

-- ---------------------------------------------------------------------------
-- class_join_requests
-- ---------------------------------------------------------------------------

create table public.class_join_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  status text not null default 'pending'
    constraint class_join_requests_status_valid
      check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  dismissed_at timestamptz
);

comment on table public.class_join_requests is
  'B12a (#67): a student''s request to join another class by its code. Written only by request_class_join / decide_class_join / dismiss_class_join (security definer); clients read under RLS.';

comment on column public.class_join_requests.dismissed_at is
  'Set when the student dismisses a rejected request, or sends a new request for the same class; hides it from the dashboard.';

create unique index class_join_requests_one_pending
  on public.class_join_requests (student_id, class_id)
  where status = 'pending';

create index class_join_requests_class_id_idx on public.class_join_requests (class_id);
create index class_join_requests_student_status_idx
  on public.class_join_requests (student_id, status);

alter table public.class_join_requests enable row level security;

create policy "class_join_requests_select"
  on public.class_join_requests for select
  to authenticated
  using (
    student_id = auth.uid()
    or public.is_admin()
    or public.is_teacher_of_class(class_id)
  );

-- No INSERT / UPDATE / DELETE policy or grant: the functions write.
revoke all on public.class_join_requests from anon, authenticated;
grant select on public.class_join_requests to authenticated;

-- ---------------------------------------------------------------------------
-- request_class_join(code) -> class name
-- ---------------------------------------------------------------------------

create or replace function public.request_class_join(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_class_id uuid;
  v_class_name text;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.role = 'student' and p.status = 'approved'
  ) then
    raise exception 'only an approved student can ask to join a class'
      using errcode = '42501';
  end if;

  -- One request at a time per student, so the checks below and the insert
  -- can't race each other (the cap in particular).
  perform pg_advisory_xact_lock(hashtextextended('class_join_requests:' || v_uid::text, 0));

  select c.id, c.name into v_class_id, v_class_name
  from public.classes c
  where c.code = upper(btrim(coalesce(p_code, '')));

  -- An unknown code and a class the student is already in look the same.
  if v_class_id is null or public.is_enrolled_in_class(v_uid, v_class_id) then
    raise exception 'no class to join with this code'
      using errcode = '22023', hint = 'join_code_invalid';
  end if;

  if exists (
    select 1 from public.class_join_requests r
    where r.student_id = v_uid and r.class_id = v_class_id and r.status = 'pending'
  ) then
    raise exception 'a request for this class is already pending'
      using errcode = '23505', hint = 'join_already_pending';
  end if;

  -- The cap. Keep in step with MAX_PENDING_JOIN_REQUESTS in
  -- src/lib/server/class-join.ts (the {max} of student_join_error_limit).
  if (
    select count(*) from public.class_join_requests r
    where r.student_id = v_uid
      and r.status = 'pending'
      and not public.is_enrolled_in_class(v_uid, r.class_id)
  ) >= 3 then
    raise exception 'at most 3 class join requests can be pending'
      using errcode = '22023', hint = 'join_limit';
  end if;

  -- A new request replaces an earlier rejection for the same class.
  update public.class_join_requests r
  set dismissed_at = now()
  where r.student_id = v_uid
    and r.class_id = v_class_id
    and r.status = 'rejected'
    and r.dismissed_at is null;

  insert into public.class_join_requests (student_id, class_id)
  values (v_uid, v_class_id);

  return v_class_name;
end;
$$;

comment on function public.request_class_join(text) is
  'B12a (#67): the calling approved student (else 42501) asks to join the class with this code (case-insensitive, trimmed). Unknown code or already enrolled: 22023 hint join_code_invalid; already pending for that class: 23505 hint join_already_pending; 3 pending already: 22023 hint join_limit. Returns the class name.';

-- ---------------------------------------------------------------------------
-- list_class_join_requests(): the teacher / admin queue
-- ---------------------------------------------------------------------------

create or replace function public.list_class_join_requests()
returns table (
  request_id uuid,
  student_id uuid,
  student_name text,
  current_classes text,
  class_id uuid,
  class_name text,
  requested_at timestamptz,
  own_child boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'teacher')
  ) then
    raise exception 'not allowed to list class join requests'
      using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.student_id,
    coalesce(s.display_name, s.registration_name),
    coalesce((
      select string_agg(ec.name, ', ' order by ec.name)
      from public.class_enrollments e
      join public.classes ec on ec.id = e.class_id
      where e.student_id = r.student_id
    ), ''),
    r.class_id,
    c.name,
    r.requested_at,
    public.is_parent_of(r.student_id)
  from public.class_join_requests r
  join public.profiles s on s.id = r.student_id
  join public.classes c on c.id = r.class_id
  where r.status = 'pending'
    and s.role = 'student'
    and s.status = 'approved'
    and not public.is_enrolled_in_class(r.student_id, r.class_id)
    and (public.is_admin() or public.is_teacher_of_class(r.class_id))
  order by r.requested_at, r.id;
end;
$$;

comment on function public.list_class_join_requests() is
  'B12a (#67): pending class join requests the caller may see: the admin all, a teacher those for classes they teach (anyone else 42501); approved students only, and not for a class the student is already in. own_child = the caller is the student''s parent (then they can''t decide).';

-- ---------------------------------------------------------------------------
-- decide_class_join(id, 'approved' | 'rejected')
-- ---------------------------------------------------------------------------

create or replace function public.decide_class_join(p_request_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.class_join_requests%rowtype;
begin
  select * into v_request
  from public.class_join_requests r
  where r.id = p_request_id
  for update;

  -- Not found looks the same as not allowed. Never for one's own child,
  -- the admin included (AD-4, the sick_leave_decisions rule in 0028).
  if v_request.id is null
     or not (
       (public.is_admin() or public.is_teacher_of_class(v_request.class_id))
       and not public.is_parent_of(v_request.student_id)
     ) then
    raise exception 'not allowed to decide this class join request'
      using errcode = '42501';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'this class join request is no longer pending'
      using errcode = '22023', hint = 'join_not_pending';
  end if;

  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'the decision must be approved or rejected'
      using errcode = '22023', hint = 'join_decision_invalid';
  end if;

  if p_decision = 'approved' then
    -- The body of enroll_student() (0016): an approved student only, and
    -- idempotent (already enrolled another way: just marked approved). The
    -- insert fires the late-joiner homework trigger.
    if not exists (
      select 1 from public.profiles p
      where p.id = v_request.student_id and p.role = 'student' and p.status = 'approved'
    ) then
      raise exception 'student % is not an approved student', v_request.student_id
        using errcode = '22023', hint = 'join_student_not_approved';
    end if;

    insert into public.class_enrollments (student_id, class_id, enrolled_by)
    values (v_request.student_id, v_request.class_id, auth.uid())
    on conflict do nothing;
  end if;

  update public.class_join_requests r
  set status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where r.id = v_request.id;
end;
$$;

comment on function public.decide_class_join(uuid, text) is
  'B12a (#67): the admin or a teacher of the class, never the student''s parent (else 42501), approves or rejects a pending request (else 22023 hint join_not_pending; decision not approved / rejected: join_decision_invalid). Approval enrols the student as enroll_student() does (not an approved student: 22023 hint join_student_not_approved).';

-- ---------------------------------------------------------------------------
-- dismiss_class_join(id): the student hides their rejected request
-- ---------------------------------------------------------------------------

create or replace function public.dismiss_class_join(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.class_join_requests%rowtype;
begin
  select * into v_request
  from public.class_join_requests r
  where r.id = p_request_id
  for update;

  if v_request.id is null or v_request.student_id is distinct from auth.uid() then
    raise exception 'not allowed to dismiss this class join request'
      using errcode = '42501';
  end if;

  if v_request.status <> 'rejected' then
    raise exception 'only a rejected class join request can be dismissed'
      using errcode = '22023', hint = 'join_not_rejected';
  end if;

  update public.class_join_requests r
  set dismissed_at = coalesce(r.dismissed_at, now())
  where r.id = v_request.id;
end;
$$;

comment on function public.dismiss_class_join(uuid) is
  'B12a (#67): the student dismisses their own rejected request (else 42501, or 22023 hint join_not_rejected). Idempotent.';

-- ---------------------------------------------------------------------------
-- my_class_join_requests(): the student's dashboard list
-- ---------------------------------------------------------------------------

create or replace function public.my_class_join_requests()
returns table (
  id uuid,
  class_id uuid,
  class_name text,
  status text,
  requested_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'student'
  ) then
    raise exception 'only a student has class join requests'
      using errcode = '42501';
  end if;

  return query
  select r.id, r.class_id, c.name, r.status, r.requested_at, r.reviewed_at
  from public.class_join_requests r
  join public.classes c on c.id = r.class_id
  where r.student_id = auth.uid()
    and (
      (r.status = 'pending' and not public.is_enrolled_in_class(r.student_id, r.class_id))
      or (r.status = 'rejected' and r.dismissed_at is null)
    )
  order by r.requested_at desc, r.id;
end;
$$;

comment on function public.my_class_join_requests() is
  'B12a (#67): the calling student''s pending requests (not for a class they are already in) and rejected ones not yet dismissed, newest first, with the class name (students can''t read a class they are not in). Anyone else 42501.';

revoke all on function public.request_class_join(text) from public, anon;
revoke all on function public.list_class_join_requests() from public, anon;
revoke all on function public.decide_class_join(uuid, text) from public, anon;
revoke all on function public.dismiss_class_join(uuid) from public, anon;
revoke all on function public.my_class_join_requests() from public, anon;
grant execute on function public.request_class_join(text) to authenticated;
grant execute on function public.list_class_join_requests() to authenticated;
grant execute on function public.decide_class_join(uuid, text) to authenticated;
grant execute on function public.dismiss_class_join(uuid) to authenticated;
grant execute on function public.my_class_join_requests() to authenticated;
