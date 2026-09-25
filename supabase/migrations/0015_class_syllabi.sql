-- 0015_class_syllabi.sql
--
-- #37 (decided 2026-09-25): a class has one syllabus per school year instead
-- of the single syllabus 0014 put on classes. A school year runs September to
-- August and is stored as its starting year (2025 = 2025/26); the app uses the
-- same rule in src/lib/school-year.ts.
--
-- classes.syllabus / syllabus_links and set_class_syllabus() (0014) stay for
-- now so a running deploy keeps working between `db push` and the new code
-- going live. Drop them in a later cleanup migration.

create table public.class_syllabi (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  school_year integer not null
    constraint class_syllabi_school_year_range check (school_year between 2000 and 2100),
  content text
    constraint class_syllabi_content_length check (char_length(content) <= 5000),
  links jsonb not null default '[]'::jsonb
    constraint class_syllabi_links_shape
      check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 10),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_syllabi_one_per_year unique (class_id, school_year)
);

comment on table public.class_syllabi is
  'One syllabus per class per school year (school_year = starting year, 2025 = 2025/26). Edited by the class''s teacher or the admin; readable by the class''s approved students.';

create index class_syllabi_class_id_idx on public.class_syllabi (class_id);

alter table public.class_syllabi enable row level security;

create policy "class_syllabi_select"
  on public.class_syllabi for select
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'student'
        and p.status = 'approved'
        and p.class_id = class_syllabi.class_id
    )
  );

create policy "class_syllabi_insert_admin_or_teacher"
  on public.class_syllabi for insert
  with check (public.is_admin() or public.is_teacher_of_class(class_id));

create policy "class_syllabi_update_admin_or_teacher"
  on public.class_syllabi for update
  using (public.is_admin() or public.is_teacher_of_class(class_id))
  with check (public.is_admin() or public.is_teacher_of_class(class_id));

create policy "class_syllabi_delete_admin_or_teacher"
  on public.class_syllabi for delete
  using (public.is_admin() or public.is_teacher_of_class(class_id));

-- A syllabus can't be moved to another class or year after it's created.
revoke update on public.class_syllabi from authenticated;
grant update (content, links, updated_at) on public.class_syllabi to authenticated;

-- Carry over the single syllabus from 0014 as the current school year's.
insert into public.class_syllabi (class_id, school_year, content, links, created_by)
select
  c.id,
  case
    when extract(month from current_date) >= 9 then extract(year from current_date)::integer
    else extract(year from current_date)::integer - 1
  end,
  c.syllabus,
  c.syllabus_links,
  null
from public.classes c
where c.syllabus is not null or jsonb_array_length(c.syllabus_links) > 0;

comment on column public.classes.syllabus is
  'Deprecated by 0015 (class_syllabi). Kept only until the next cleanup migration.';
comment on column public.classes.syllabus_links is
  'Deprecated by 0015 (class_syllabi). Kept only until the next cleanup migration.';
comment on function public.set_class_syllabus(uuid, text, jsonb) is
  'Deprecated by 0015 (class_syllabi). Kept only until the next cleanup migration.';
