-- 0048_badges_per_subject.sql
--
-- Badge detail CAP-2 / CAP-8 (story 2): badges are counted and awarded per
-- badge subject (the class's badge_subject, 0047), and teachers of the
-- student's classes can read them.
--
-- * Existing badge rows carry no subject and are discarded (one-time; the
--   app has no live badge history -- SPEC non-goals). Afterwards every row
--   has a subject and earned rows are never deleted again.
-- * recompute_student_badges keeps its signature, so the 0008 triggers on
--   attendance_records / homework_status_history keep working unchanged. It
--   now counts per subject: attendance = distinct present days (current mark,
--   attendance_current) in that subject's classes; homework = distinct Done
--   instances in that subject's classes. Classes without a subject count
--   toward nothing. A day present in a song and a dance class counts once
--   for dance; language and dance on the same day give one each.
-- * A class getting (or changing) its subject recomputes every student with
--   an enrollment, attendance or homework history in that class, so their
--   history counts from that moment. Badges of the old subject stay.
-- * RLS: teachers of any of the student's classes may read the rows.

delete from public.badges_earned;

alter table public.badges_earned
  add column badge_subject text not null
    constraint badges_earned_badge_subject_known
      check (badge_subject in ('language', 'dance', 'instrument'));

comment on column public.badges_earned.badge_subject is
  'Badge subject (language, dance, instrument) of the classes this badge was counted from (0047 classes.badge_subject). Song classes count as dance.';

alter table public.badges_earned
  drop constraint badges_earned_student_id_badge_type_milestone_key;

alter table public.badges_earned
  add constraint badges_earned_student_subject_type_milestone_key
    unique (student_id, badge_subject, badge_type, milestone);

-- ---------------------------------------------------------------------------
-- Recompute per subject (0045 body, split by classes.badge_subject)
-- ---------------------------------------------------------------------------

create or replace function public.recompute_student_badges(p_student_id uuid, p_badge_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  thresholds jsonb;
  subject_total record;
  threshold_value integer;
begin
  if p_badge_type not in ('attendance', 'homework') then
    return;
  end if;

  select value
  into thresholds
  from public.app_settings
  where key = 'badge_milestone_thresholds';

  if thresholds is null or jsonb_typeof(thresholds) <> 'array' or jsonb_array_length(thresholds) = 0
  then
    thresholds := '[1, 5, 10, 25, 50, 100]'::jsonb;
  end if;

  for subject_total in
    -- Distinct session days with a current present mark, per subject
    -- (#102: the latest mark per session; never raw row counts).
    select c.badge_subject as subject, count(distinct d.day)::integer as total
    from public.attendance_current a
    join public.class_sessions s on s.id = a.class_session_id
    join public.classes c on c.id = s.class_id
    join public.class_days d on d.id = s.class_day_id
    where p_badge_type = 'attendance'
      and a.student_id = p_student_id
      and a.present = true
      and c.badge_subject is not null
    group by c.badge_subject
    union all
    -- Distinct homework instances marked Done, per subject.
    select c.badge_subject, count(distinct h.instance_id)::integer
    from public.homework_status_history h
    join public.homework_instances i on i.id = h.instance_id
    join public.classes c on c.id = i.class_id
    where p_badge_type = 'homework'
      and h.student_id = p_student_id
      and h.status = 'done'
      and c.badge_subject is not null
    group by c.badge_subject
  loop
    for threshold_value in
      select (elem)::integer
      from jsonb_array_elements_text(thresholds) as elem
    loop
      if threshold_value <= coalesce(subject_total.total, 0) then
        insert into public.badges_earned (student_id, badge_subject, badge_type, milestone)
        values (p_student_id, subject_total.subject, p_badge_type, threshold_value)
        on conflict (student_id, badge_subject, badge_type, milestone) do nothing;
      end if;
    end loop;
  end loop;
end;
$$;

comment on function public.recompute_student_badges(uuid, text) is
  'Full recompute (never an incremental counter) of one student''s badge_type counts per badge subject and any newly-crossed milestone(s) (badge detail CAP-2). Attendance: distinct present days (attendance_current) in classes of that subject; homework: distinct Done instances in classes of that subject. Classes without a subject count toward nothing. SECURITY DEFINER so it can write badges_earned without any client write policy (AD-3). Called from trg_recompute_student_badges() and trg_recompute_badges_on_class_subject().';

-- ---------------------------------------------------------------------------
-- A class gets or changes its subject: recompute its students
-- ---------------------------------------------------------------------------

create or replace function public.trg_recompute_badges_on_class_subject()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
begin
  -- Outer block: a failure collecting the students never blocks the save.
  begin
    for v_student_id in
      select e.student_id from public.class_enrollments e where e.class_id = new.id
      union
      select a.student_id from public.attendance_records a where a.class_id = new.id
      union
      select h.student_id from public.homework_status_history h where h.class_id = new.id
    loop
      begin
        perform public.recompute_student_badges(v_student_id, 'attendance');
        perform public.recompute_student_badges(v_student_id, 'homework');
      exception when others then
        raise warning 'recompute_student_badges failed for student % (class % subject %): %',
          v_student_id, new.id, new.badge_subject, sqlerrm;
      end;
    end loop;
  exception when others then
    raise warning 'badge recompute for class % (subject %) failed: %',
      new.id, new.badge_subject, sqlerrm;
  end;
  return new;
end;
$$;

comment on function public.trg_recompute_badges_on_class_subject() is
  'AFTER UPDATE OF badge_subject trigger target on classes (badge detail story 2): recomputes both badge types for every student with an enrollment, attendance or homework history in the class, so history counts once the admin assigns or changes the subject. Each student''s recompute is wrapped in BEGIN...EXCEPTION, so a failure logs a warning and never blocks the class save.';

revoke all on function public.trg_recompute_badges_on_class_subject() from public, anon, authenticated;

create trigger classes_recompute_badges_on_subject
  after update of badge_subject on public.classes
  for each row
  when (new.badge_subject is not null and new.badge_subject is distinct from old.badge_subject)
  execute function public.trg_recompute_badges_on_class_subject();

-- ---------------------------------------------------------------------------
-- RLS: teachers of the student's classes may read (CAP-8)
-- ---------------------------------------------------------------------------

alter policy "badges_earned_select_admin_or_own"
  on public.badges_earned
  using (
    public.is_admin()
    or student_id = auth.uid()
    or public.is_parent_of(student_id)
    or public.is_teacher_of_student(student_id)
  );

-- ---------------------------------------------------------------------------
-- One-time recompute: classes that got a subject (0047) before this
-- migration keep their students' history counting.
-- ---------------------------------------------------------------------------

do $$
declare
  v_student_id uuid;
begin
  for v_student_id in
    select a.student_id
    from public.attendance_records a
    join public.classes c on c.id = a.class_id
    where c.badge_subject is not null
    union
    select h.student_id
    from public.homework_status_history h
    join public.homework_instances i on i.id = h.instance_id
    join public.classes c on c.id = i.class_id
    where c.badge_subject is not null
  loop
    perform public.recompute_student_badges(v_student_id, 'attendance');
    perform public.recompute_student_badges(v_student_id, 'homework');
  end loop;
end;
$$;
