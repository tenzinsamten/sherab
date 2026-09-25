-- 0016_class_enrollments.sql
--
-- #42: a student can belong to several classes. Until now profiles.class_id
-- (0002) was both "the class they registered into" and "the class they are
-- in". class_enrollments is now the source of truth for membership of
-- approved students; profiles.class_id keeps only its registration meaning
-- (join / check_registration_available / the pending-registration unique
-- index / profiles_update_registration_review / /requests stay unchanged).
--
-- A teacher of a class (or an admin) adds an existing approved student to
-- that class and can remove them again, but never from their last class.
-- Streak and team stay one per student.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.class_enrollments (
  student_id uuid not null references public.profiles (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  enrolled_by uuid references public.profiles (id) on delete set null,
  enrolled_at timestamptz not null default now(),
  primary key (student_id, class_id)
);

create index class_enrollments_class_id_idx on public.class_enrollments (class_id);

comment on table public.class_enrollments is
  'Which classes an approved student belongs to (#42). Written by the approval trigger and the enroll_student / unenroll_student functions only -- no client INSERT/UPDATE/DELETE policy.';

-- Every approved student is in the class they registered into. Runs before
-- the late-joiner trigger below exists, so the backfill assigns no homework.
insert into public.class_enrollments (student_id, class_id, enrolled_at)
select p.id, p.class_id, coalesce(p.reviewed_at, now())
from public.profiles p
where p.role = 'student'
  and p.status = 'approved'
  and p.class_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER: callable from RLS policies on profiles and
-- elsewhere without recursive RLS evaluation, like is_teacher_of_class)
-- ---------------------------------------------------------------------------

create or replace function public.is_enrolled_in_class(p_student uuid, p_class uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.class_enrollments e
    where e.student_id = p_student
      and e.class_id = p_class
  );
$$;

comment on function public.is_enrolled_in_class(uuid, uuid) is
  'True if the student is enrolled in the class (#42). Replaces the inline "profiles.class_id = X and approved" checks.';

create or replace function public.is_teacher_of_student(p_student uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.class_enrollments e
    join public.class_teachers ct on ct.class_id = e.class_id
    where e.student_id = p_student
      and ct.teacher_id = auth.uid()
  );
$$;

comment on function public.is_teacher_of_student(uuid) is
  'True if the calling JWT teaches any class the student is enrolled in (#42).';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.class_enrollments enable row level security;

create policy "class_enrollments_select"
  on public.class_enrollments for select
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or student_id = auth.uid()
  );

grant select on public.class_enrollments to authenticated;

-- ---------------------------------------------------------------------------
-- Approval enrolls the student into the class they registered into.
-- ---------------------------------------------------------------------------

create or replace function public.enroll_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.class_enrollments (student_id, class_id, enrolled_by)
  values (new.id, new.class_id, new.reviewed_by)
  on conflict do nothing;
  return null;
end;
$$;

create trigger profiles_enroll_on_approval
  after update of status on public.profiles
  for each row
  when (
    new.role = 'student'
    and new.status = 'approved'
    and old.status is distinct from 'approved'
    and new.class_id is not null
  )
  execute function public.enroll_on_approval();

-- ---------------------------------------------------------------------------
-- Late joiners (0013), now per enrollment: approval (through the trigger
-- above) and being added to another class both give the student every open
-- (not archived, not past due) instance of that class's whole-class
-- assignments.
-- ---------------------------------------------------------------------------

drop trigger profiles_assign_open_homework on public.profiles;

create or replace function public.assign_open_homework_to_new_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.homework_status_history (
    instance_id, student_id, class_id, status, recorded_by
  )
  select i.id, new.student_id, i.class_id, 'assigned', null
  from public.homework_instances i
  join public.homework_assignments a on a.id = i.assignment_id
  where i.class_id = new.class_id
    and a.whole_class
    and i.archived_at is null
    and i.due_date >= current_date
    -- history is append-only with no unique key, so guard against a
    -- re-enrollment adding a second 'assigned' row.
    and not exists (
      select 1
      from public.homework_status_history h
      where h.instance_id = i.id
        and h.student_id = new.student_id
        and h.status = 'assigned'
    );

  return null;
end;
$$;

create trigger class_enrollments_assign_open_homework
  after insert on public.class_enrollments
  for each row
  execute function public.assign_open_homework_to_new_student();

-- ---------------------------------------------------------------------------
-- Enroll / unenroll (teacher of the class or admin)
-- ---------------------------------------------------------------------------

create or replace function public.enroll_student(p_class_id uuid, p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_teacher_of_class(p_class_id)) then
    raise exception 'not allowed to enroll students in class %', p_class_id
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_student_id and role = 'student' and status = 'approved'
  ) then
    raise exception 'student % is not an approved student', p_student_id
      using errcode = 'P0002';
  end if;

  insert into public.class_enrollments (student_id, class_id, enrolled_by)
  values (p_student_id, p_class_id, auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.unenroll_student(p_class_id uuid, p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_teacher_of_class(p_class_id)) then
    raise exception 'not allowed to remove students from class %', p_class_id
      using errcode = '42501';
  end if;
  if not public.is_enrolled_in_class(p_student_id, p_class_id) then
    raise exception 'student % is not in class %', p_student_id, p_class_id
      using errcode = 'P0002';
  end if;
  if (select count(*) from public.class_enrollments where student_id = p_student_id) <= 1 then
    raise exception 'class % is the only class of student %', p_class_id, p_student_id
      using errcode = '23514';
  end if;

  -- Their homework history stays; the app hides open homework from a class
  -- the student is no longer in (#42).
  delete from public.class_enrollments
  where student_id = p_student_id and class_id = p_class_id;
end;
$$;

-- Approved students who could be added to the class: everyone not already
-- in it, with the classes they are in now. Teachers can't otherwise see
-- students of other classes (profiles RLS), hence SECURITY DEFINER with its
-- own check.
create or replace function public.list_enrollable_students(p_class_id uuid)
returns table (id uuid, display_name text, email text, class_names text)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not (public.is_admin() or public.is_teacher_of_class(p_class_id)) then
    raise exception 'not allowed to list students for class %', p_class_id
      using errcode = '42501';
  end if;

  return query
  select
    p.id,
    coalesce(p.display_name, p.registration_name),
    p.email,
    coalesce(string_agg(c.name, ', ' order by c.name), '')
  from public.profiles p
  left join public.class_enrollments e on e.student_id = p.id
  left join public.classes c on c.id = e.class_id
  where p.role = 'student'
    and p.status = 'approved'
    and not public.is_enrolled_in_class(p.id, p_class_id)
  group by p.id, p.display_name, p.registration_name, p.email
  order by coalesce(p.display_name, p.registration_name);
end;
$$;

revoke all on function public.enroll_student(uuid, uuid) from public, anon;
revoke all on function public.unenroll_student(uuid, uuid) from public, anon;
revoke all on function public.list_enrollable_students(uuid) from public, anon;
grant execute on function public.enroll_student(uuid, uuid) to authenticated;
grant execute on function public.unenroll_student(uuid, uuid) to authenticated;
grant execute on function public.list_enrollable_students(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Existing checks move from profiles.class_id to enrollments
-- ---------------------------------------------------------------------------

-- Teachers see a student's profile if the student registered into one of
-- their classes (requests queue, 0002) or is enrolled in one of them.
drop policy "profiles_select_admin_or_teacher_of_student_class" on public.profiles;
create policy "profiles_select_admin_or_teacher_of_student_class"
  on public.profiles for select
  using (
    role = 'student'
    and (
      (class_id is not null and (public.is_admin() or public.is_teacher_of_class(class_id)))
      or public.is_teacher_of_student(id)
    )
  );

drop policy "skill_status_history_insert_admin_or_assigned_teacher" on public.skill_status_history;
create policy "skill_status_history_insert_admin_or_assigned_teacher"
  on public.skill_status_history for insert
  with check (
    recorded_by = auth.uid()
    and (
      public.is_admin()
      or (
        public.is_teacher_of_class(class_id)
        and public.is_enrolled_in_class(student_id, skill_status_history.class_id)
      )
    )
  );

drop policy "attendance_records_insert_admin_or_assigned_teacher" on public.attendance_records;
create policy "attendance_records_insert_admin_or_assigned_teacher"
  on public.attendance_records for insert
  with check (
    recorded_by = auth.uid()
    and (
      public.is_admin()
      or (
        public.is_teacher_of_class(class_id)
        and public.is_enrolled_in_class(student_id, attendance_records.class_id)
      )
    )
  );

drop policy "homework_status_history_insert_admin_teacher_or_self_done" on public.homework_status_history;
create policy "homework_status_history_insert_admin_teacher_or_self_done"
  on public.homework_status_history for insert
  with check (
    recorded_by = auth.uid()
    -- The submitted class_id must be the REAL class_id of the referenced
    -- instance -- without this, a teacher legitimately assigned to class A
    -- could submit class_id=A (passing is_teacher_of_class(A) below)
    -- alongside an instance_id/student_id that actually belong to class B,
    -- and write history for a class they don't teach. This subquery is
    -- itself gated by homework_instances' own SELECT policy: it only ever
    -- returns a row (and so only ever matches) when the caller can
    -- legitimately see that instance (admin, its real assigned teacher, or
    -- a targeted student), so a mismatched/foreign instance_id resolves to
    -- no visible row and the check fails closed.
    and exists (
      select 1
      from public.homework_instances hi
      where hi.id = homework_status_history.instance_id
        and hi.class_id = homework_status_history.class_id
    )
    and (
      -- The initial 'assigned' row: inserted only by the teacher/admin at
      -- assignment-creation time, and only against an approved student of
      -- this same class (Boundaries: reuse of the exact 0003 exists()
      -- pattern) -- an untargeted student therefore has no assigned row to
      -- ever self-mark against (I/O matrix: "Untargeted student attempts
      -- Done -> RLS rejects the insert").
      (
        status = 'assigned'
        and (
          public.is_admin()
          or (
            public.is_teacher_of_class(class_id)
            and public.is_enrolled_in_class(student_id, homework_status_history.class_id)
          )
        )
      )
      or (
        status in ('done', 'reviewed')
        -- Requires a prior 'assigned' row for this exact (instance_id,
        -- student_id) pair to already exist (Code Map) -- this is what
        -- stops an untargeted student's self-mark attempt even though they
        -- might otherwise satisfy every other clause below.
        and exists (
          select 1
          from public.homework_status_history existing
          where existing.instance_id = homework_status_history.instance_id
            and existing.student_id = homework_status_history.student_id
            and existing.status = 'assigned'
        )
        -- 'reviewed' additionally requires a prior 'done' row -- Intent's
        -- workflow ("a teacher separately marks Reviewed after confirming
        -- in class") only makes sense once the student has actually been
        -- marked Done; 'done' itself has no such extra requirement beyond
        -- the 'assigned' check above.
        and (
          status <> 'reviewed'
          or exists (
            select 1
            from public.homework_status_history existing_done
            where existing_done.instance_id = homework_status_history.instance_id
              and existing_done.student_id = homework_status_history.student_id
              and existing_done.status = 'done'
          )
        )
        and (
          public.is_admin()
          or public.is_teacher_of_class(class_id)
          -- A student may only self-mark their own row, and only to
          -- 'done' -- 'reviewed' is exclusively a teacher/admin action
          -- (Intent: "a teacher separately marks Reviewed after confirming
          -- in class").
          or (status = 'done' and student_id = auth.uid())
        )
      )
    )
  );

drop policy "classes_select_own_student" on public.classes;
create policy "classes_select_own_student"
  on public.classes for select
  using (public.is_enrolled_in_class(auth.uid(), id));

drop policy "class_syllabi_select" on public.class_syllabi;
create policy "class_syllabi_select"
  on public.class_syllabi for select
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or public.is_enrolled_in_class(auth.uid(), class_id)
  );

-- A teacher sees the streak of any student in one of their classes, not only
-- the class that last recomputed it (student_streaks.class_id).
drop policy "student_streaks_select_admin_teacher_or_own" on public.student_streaks;
create policy "student_streaks_select_admin_teacher_or_own"
  on public.student_streaks for select
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or public.is_teacher_of_student(student_id)
    or student_id = auth.uid()
  );

-- Recurring homework (0005): new periods go to the class's enrolled students.
create or replace function public.generate_recurring_homework_instances()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_row record;
  period date;
  period_iterations integer;
  new_instance_id uuid;
  instances_created integer := 0;
  -- Safety backstop, not a UX decision (review finding #4): caps how many
  -- weekly periods a single run will backfill for one assignment (~2 years).
  -- An assignment with more of a catch-up gap than this just continues
  -- catching up on the next scheduled run -- this only prevents an
  -- unbounded synchronous burst (e.g. from a start date far in the past)
  -- from ballooning or failing one whole cron invocation for every
  -- assignment.
  max_period_iterations constant integer := 104;
begin
  -- "for every homework_assignments row with recurrence_rule IS NOT NULL,
  -- not paused, not past ends_on" (Code Map). ends_on is checked per-period
  -- in the inner loop below (a series can have some already-valid periods
  -- before ends_on and none after -- excluding the whole assignment row
  -- here would also wrongly skip those earlier, still-legitimate periods on
  -- a re-run after a backfill gap).
  for assignment_row in
    select id, class_id, recurrence_start_date, due_offset_days, ends_on
    from public.homework_assignments
    where recurrence_rule is not null
      and paused_at is null
      and recurrence_start_date is not null
      and due_offset_days is not null
  loop
    period := assignment_row.recurrence_start_date;
    period_iterations := 0;

    -- Walks every weekly period from the series' start up through today,
    -- not just "the current one" -- this is deliberate catch-up behavior:
    -- if the generator hasn't run in a while (e.g. the Supabase free-tier
    -- project auto-paused after 7 days idle, AD-6, or a local dev instance
    -- was simply off), a later run still backfills every missed period
    -- rather than silently skipping straight to "now" and losing a week's
    -- assignment, up to max_period_iterations (review finding #4).
    -- UNIQUE(assignment_id, period_start) (AD-8, Story 3-1) plus the ON
    -- CONFLICT DO NOTHING below make every iteration idempotent regardless
    -- of how many times this function runs, and race-safe against a
    -- concurrent invocation racing the same check (review finding #3: a
    -- plain "if not exists(...) then insert" here would be a check-then-act
    -- race whose losing insert raises an uncaught unique-violation that
    -- rolls back this entire function call, including every other
    -- assignment already processed in this run).
    while period <= current_date
      and (assignment_row.ends_on is null or period <= assignment_row.ends_on)
      and period_iterations < max_period_iterations
    loop
      insert into public.homework_instances (assignment_id, class_id, period_start, due_date)
      values (
        assignment_row.id,
        assignment_row.class_id,
        period,
        period + assignment_row.due_offset_days
      )
      on conflict (assignment_id, period_start) do nothing
      returning id into new_instance_id;

      if new_instance_id is not null then
        -- Fresh 'assigned' rows for the then-current approved roster (Code
        -- Map) -- reuses the exact role='student' and status='approved'
        -- pattern 0003/0004 already established for writes, read anew on
        -- every single generation run rather than snapshotted once at
        -- series-creation time, so a student approved after the series
        -- started still gets targeted by every future period.
        -- recorded_by is NULL -- there is no acting user for a time-based,
        -- system-generated row (unlike Story 3-1's teacher-initiated
        -- 'assigned' rows, which always set recorded_by to the creating
        -- teacher).
        insert into public.homework_status_history (
          instance_id, student_id, class_id, status, recorded_by
        )
        select
          new_instance_id,
          e.student_id,
          assignment_row.class_id,
          'assigned',
          null
        from public.class_enrollments e
        join public.profiles p on p.id = e.student_id
        where e.class_id = assignment_row.class_id
          and p.role = 'student'
          and p.status = 'approved';

        instances_created := instances_created + 1;
      end if;

      period := period + 7;
      period_iterations := period_iterations + 1;
    end loop;
  end loop;

  return instances_created;
end;
$$;

-- Streaks (0007): a week counts as a session week if any of the student's
-- classes met, so a second class doesn't turn the first one's holidays into
-- misses or vice versa.
create or replace function public.recompute_student_streak(p_student_id uuid, p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  grace_weeks integer;
  attendance_weeks date[];
  homework_weeks date[];
  class_session_weeks date[];
  qualifying_weeks date[];
  earliest_class_week date;
  cursor_week date;
  gap_count integer := 0;
  computed_streak integer := 0;
  computed_last_qualifying date := null;
  iterations integer := 0;
  max_weeks_back constant integer := 2600; -- ~50 years of weeks; safety backstop only, generous since the cost of raising it is free
begin
  select (value ->> 'weeks')::integer
  into grace_weeks
  from public.app_settings
  where key = 'streak_grace_weeks';

  -- Clamped to >= 0 -- a misconfigured negative value here must never make
  -- gap_count's first real miss (gap_count = 1 > grace_weeks) exit the walk
  -- more eagerly than an ordinary grace = 0 would (i.e. never worse than "no
  -- grace at all"), so every stored streak stays a legitimate consecutive
  -- run even under bad app_settings input.
  grace_weeks := greatest(coalesce(grace_weeks, 2), 0);

  -- Distinct (student_id, session_date) present=true rows -> their week
  -- buckets. The inner "distinct session_date" collapses a duplicate mark
  -- for the same date before bucketing (Always boundary: never raw row
  -- counts).
  select coalesce(array_agg(distinct date_trunc('week', ar.session_date)::date), array[]::date[])
  into attendance_weeks
  from (
    select distinct session_date
    from public.attendance_records
    where student_id = p_student_id and present = true
  ) ar;

  -- Distinct (student_id, instance_id) done pairs -> their instance's
  -- period_start week bucket. The inner distinct collapses a duplicate
  -- self+teacher done mark for the same instance before this ever reaches
  -- the join (Always boundary).
  select coalesce(array_agg(distinct date_trunc('week', hi.period_start)::date), array[]::date[])
  into homework_weeks
  from (
    select distinct hsh.instance_id
    from public.homework_status_history hsh
    where hsh.student_id = p_student_id and hsh.status = 'done'
  ) done_pairs
  join public.homework_instances hi on hi.id = done_pairs.instance_id;

  select array(
    select unnest(attendance_weeks)
    intersect
    select unnest(homework_weeks)
  )
  into qualifying_weeks;

  -- Any attendance_records row for any of the student's classes (#42: the
  -- firing class plus every class they are enrolled in), any student, any
  -- present value -- a teacher only marks attendance when a session
  -- actually happened, so a week with no session in any of their classes
  -- is a holiday.
  select coalesce(array_agg(distinct date_trunc('week', session_date)::date), array[]::date[])
  into class_session_weeks
  from public.attendance_records
  where class_id = p_class_id
     or class_id in (
       select e.class_id from public.class_enrollments e where e.student_id = p_student_id
     );

  select min(w) into earliest_class_week from unnest(class_session_weeks) as w;

  if array_length(qualifying_weeks, 1) is not null then
    -- UTC-pinned (Consistency Conventions: all timestamps UTC), not the
    -- session's/connection's local `current_date`, so "today's week" is
    -- computed identically regardless of the calling role/session's
    -- timezone setting.
    cursor_week := date_trunc('week', (now() at time zone 'utc')::date)::date;

    loop
      iterations := iterations + 1;
      exit when iterations > max_weeks_back;
      exit when earliest_class_week is not null and cursor_week < earliest_class_week;

      if cursor_week = any (class_session_weeks) then
        if cursor_week = any (qualifying_weeks) then
          computed_streak := computed_streak + 1;
          gap_count := 0;
          if computed_last_qualifying is null then
            computed_last_qualifying := cursor_week;
          end if;
        else
          gap_count := gap_count + 1;
          exit when gap_count > grace_weeks;
        end if;
      end if;
      -- else: class-wide holiday week -- excluded from grace consumption
      -- entirely, no effect on gap_count or computed_streak.

      cursor_week := cursor_week - 7;
    end loop;
  end if;

  insert into public.student_streaks (student_id, class_id, current_streak, last_qualifying_week, updated_at)
  values (p_student_id, p_class_id, computed_streak, computed_last_qualifying, now())
  on conflict (student_id) do update
    set class_id = excluded.class_id,
        current_streak = excluded.current_streak,
        last_qualifying_week = excluded.last_qualifying_week,
        updated_at = now();
end;
$$;

-- Class delete guard (0011): blocked while anyone is enrolled or a
-- registration into the class is still pending.
create or replace function public.prevent_delete_class_with_students()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.class_enrollments where class_id = old.id
  ) or exists (
    select 1 from public.profiles
    where class_id = old.id
      and role = 'student'
      and status = 'pending'
  ) then
    raise exception 'class % still has enrolled or pending students', old.id
      using errcode = '23503';
  end if;
  return old;
end;
$$;
