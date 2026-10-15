-- 0049_badge_progress.sql
--
-- Badge detail CAP-6 / CAP-8 (story 3): a student's progress toward the next
-- attendance and homework badge, per badge subject.
--
-- * Subjects = the distinct badge_subject of the student's enrolled classes
--   (classes without a subject are left out). Both tracks are returned for
--   each subject, even at 0.
-- * Totals are exactly recompute_student_badges' per-subject counts (0048):
--   attendance = distinct present days (attendance_current) in that subject's
--   classes; homework = distinct Done instances in that subject's classes.
-- * next_milestone = the smallest app_settings.badge_milestone_thresholds
--   value (same fallback list as the recompute) greater than the total, or
--   NULL once the top milestone is reached.
-- * Readable by the student, their linked parents, teachers of the student's
--   classes and admin; anyone else gets no rows.

create or replace function public.badge_progress(p_student_id uuid)
returns table (subject text, badge_type text, total integer, next_milestone integer)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  thresholds jsonb;
begin
  if not (
    public.is_admin()
    or p_student_id = auth.uid()
    or public.is_parent_of(p_student_id)
    or public.is_teacher_of_student(p_student_id)
  ) then
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

  return query
  with subjects as (
    select distinct c.badge_subject as subject
    from public.class_enrollments e
    join public.classes c on c.id = e.class_id
    where e.student_id = p_student_id
      and c.badge_subject is not null
  ),
  tracks as (
    select s.subject, t.badge_type
    from subjects s
    cross join (values ('attendance'), ('homework')) as t(badge_type)
  ),
  attendance_totals as (
    -- Same query as recompute_student_badges (0048), attendance branch.
    select c.badge_subject as subject, count(distinct d.day)::integer as total
    from public.attendance_current a
    join public.class_sessions s on s.id = a.class_session_id
    join public.classes c on c.id = s.class_id
    join public.class_days d on d.id = s.class_day_id
    where a.student_id = p_student_id
      and a.present = true
      and c.badge_subject is not null
    group by c.badge_subject
  ),
  homework_totals as (
    -- Same query as recompute_student_badges (0048), homework branch.
    select c.badge_subject as subject, count(distinct h.instance_id)::integer as total
    from public.homework_status_history h
    join public.homework_instances i on i.id = h.instance_id
    join public.classes c on c.id = i.class_id
    where h.student_id = p_student_id
      and h.status = 'done'
      and c.badge_subject is not null
    group by c.badge_subject
  ),
  totals as (
    select tr.subject,
           tr.badge_type,
           coalesce(
             case tr.badge_type
               when 'attendance' then att.total
               else hwt.total
             end,
             0
           ) as total
    from tracks tr
    left join attendance_totals att on att.subject = tr.subject
    left join homework_totals hwt on hwt.subject = tr.subject
  )
  select t.subject,
         t.badge_type,
         t.total,
         (
           select min((elem)::integer)
           from jsonb_array_elements_text(thresholds) as elem
           where (elem)::integer > t.total
         ) as next_milestone
  from totals t
  order by array_position(array['language', 'dance', 'instrument'], t.subject),
           t.badge_type;
end;
$$;

comment on function public.badge_progress(uuid) is
  'Badge detail CAP-6: per badge subject of the student''s enrolled classes, both tracks (attendance, homework) with the same total recompute_student_badges counts (0048) and the next milestone from app_settings.badge_milestone_thresholds (NULL after the top one). Returns no rows unless the caller is admin, the student, a linked parent or a teacher of the student.';

revoke all on function public.badge_progress(uuid) from public, anon;
grant execute on function public.badge_progress(uuid) to authenticated;
