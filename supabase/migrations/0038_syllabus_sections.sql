-- 0038_syllabus_sections.sql
--
-- A class syllabus (one per class per school year, 0015) held one block of
-- text and one list of links. A teacher who plans two songs, or a song and a
-- dance, needs one titled block each: a syllabus now has any number of
-- sections, each with a title, an optional rich text in a chosen language
-- (as 0035) and optional links.
--
-- * class_syllabus_sections: the sections, shown in `position` order.
-- * Access follows the parent syllabus's class: the admin and the class's
--   teachers read and change, enrolled students read, nobody else sees a row.
-- * move_syllabus_section(): swaps a section with its neighbour in one
--   statement, so two presses at once cannot leave two sections on the same
--   position.
-- * syllabus_sections_backfill(): every syllabus that has text or links gets
--   one section holding them, titled "Syllabus" in that syllabus's language.
--   Called once below; kept (service role only) so the database tests can
--   run the same copy.
--
-- class_syllabi.content_doc, content_language and links stay, no longer read
-- or written by the app, so the deployed code keeps working between
-- `db push` and the new deploy. Drop them in a later cleanup migration.
--
-- Deploy the new app right after `db push`: text or links the old deployed
-- app saves after this migration ran go to those old columns and never reach
-- a section.
--
-- Right after the push, syllabi whose old columns hold text or links but
-- that have no section (expected: 0 rows):
--
--   select s.id, s.class_id, s.school_year
--   from public.class_syllabi s
--   where (s.content_doc is not null or jsonb_array_length(s.links) > 0)
--     and not exists (
--       select 1 from public.class_syllabus_sections c where c.syllabus_id = s.id
--     );
--
-- After the deploy, syllabi the old app still edited in the window (their
-- class_syllabi.updated_at is later than their section's); copy those edits
-- into the section by hand:
--
--   select s.id, s.class_id, s.school_year, s.updated_at
--   from public.class_syllabi s
--   where exists (
--       select 1 from public.class_syllabus_sections c where c.syllabus_id = s.id
--     )
--     and s.updated_at > (
--       select max(c.updated_at)
--       from public.class_syllabus_sections c
--       where c.syllabus_id = s.id
--     );

create table public.class_syllabus_sections (
  id uuid primary key default gen_random_uuid(),
  syllabus_id uuid not null references public.class_syllabi (id) on delete cascade,
  position integer not null
    constraint class_syllabus_sections_position_positive check (position >= 1),
  title text not null
    constraint class_syllabus_sections_title_length
      check (title = btrim(title) and char_length(title) between 1 and 200),
  content_doc jsonb
    constraint class_syllabus_sections_content_doc_shape
      check (
        content_doc is null
        or (
          jsonb_typeof(content_doc) = 'object'
          -- Backstop only, as in 0035: the app refuses documents over 1 MB
          -- first. This is larger because jsonb's text form adds spaces.
          and octet_length(content_doc::text) <= 2000000
        )
      ),
  content_language text not null default 'en'
    constraint class_syllabus_sections_content_language_known
      check (content_language in ('bo', 'en', 'de')),
  links jsonb not null default '[]'::jsonb
    constraint class_syllabus_sections_links_shape
      check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 10),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.class_syllabus_sections is
  'The titled sections of a class syllabus (class_syllabi), shown in position order. Each has an optional rich text (editor document as JSON, checked by the app, never rendered as HTML) in a chosen language and up to 10 links. Edited by the class''s teachers or the admin; readable by the class''s enrolled students.';
comment on column public.class_syllabus_sections.position is
  'Order within the syllabus, lowest first. Not unique: ties fall back to created_at. Deleting a section leaves a gap.';

create index class_syllabus_sections_syllabus_position_idx
  on public.class_syllabus_sections (syllabus_id, position);

alter table public.class_syllabus_sections enable row level security;

create policy "class_syllabus_sections_select"
  on public.class_syllabus_sections for select
  using (
    exists (
      select 1
      from public.class_syllabi s
      where s.id = class_syllabus_sections.syllabus_id
        and (
          public.is_admin()
          or public.is_teacher_of_class(s.class_id)
          or public.is_enrolled_in_class(auth.uid(), s.class_id)
        )
    )
  );

create policy "class_syllabus_sections_insert_admin_or_teacher"
  on public.class_syllabus_sections for insert
  with check (
    exists (
      select 1
      from public.class_syllabi s
      where s.id = class_syllabus_sections.syllabus_id
        and (public.is_admin() or public.is_teacher_of_class(s.class_id))
    )
  );

create policy "class_syllabus_sections_update_admin_or_teacher"
  on public.class_syllabus_sections for update
  using (
    exists (
      select 1
      from public.class_syllabi s
      where s.id = class_syllabus_sections.syllabus_id
        and (public.is_admin() or public.is_teacher_of_class(s.class_id))
    )
  )
  with check (
    exists (
      select 1
      from public.class_syllabi s
      where s.id = class_syllabus_sections.syllabus_id
        and (public.is_admin() or public.is_teacher_of_class(s.class_id))
    )
  );

create policy "class_syllabus_sections_delete_admin_or_teacher"
  on public.class_syllabus_sections for delete
  using (
    exists (
      select 1
      from public.class_syllabi s
      where s.id = class_syllabus_sections.syllabus_id
        and (public.is_admin() or public.is_teacher_of_class(s.class_id))
    )
  );

-- A section can't be moved to another syllabus after it's created.
revoke update on public.class_syllabus_sections from authenticated;
grant update (position, title, content_doc, content_language, links, updated_at)
  on public.class_syllabus_sections to authenticated;
revoke all on public.class_syllabus_sections from anon;

-- ---------------------------------------------------------------------------
-- move_syllabus_section
-- ---------------------------------------------------------------------------

create function public.move_syllabus_section(
  p_section_id uuid,
  p_syllabus_id uuid,
  p_class_id uuid,
  p_direction text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_index integer;
  v_other integer;
  v_changed integer;
begin
  if p_direction is null or p_direction not in ('up', 'down') then
    return null;
  end if;

  if not exists (
    select 1 from public.class_syllabi s
    where s.id = p_syllabus_id and s.class_id = p_class_id
  ) then
    return null;
  end if;

  -- Locks the syllabus's sections: a second move waits for this one. Row
  -- level security applies (security invoker), so a caller who may not
  -- change the sections locks and sees none.
  select array_agg(x.id order by x.position, x.created_at, x.id)
  into v_ids
  from (
    select c.id, c.position, c.created_at
    from public.class_syllabus_sections c
    where c.syllabus_id = p_syllabus_id
    for update
  ) x;

  v_index := array_position(v_ids, p_section_id);
  if v_index is null then
    return null;
  end if;

  v_other := v_index + case p_direction when 'up' then -1 else 1 end;
  if v_other < 1 or v_other > cardinality(v_ids) then
    return 'unchanged';
  end if;

  v_ids[v_index] := v_ids[v_other];
  v_ids[v_other] := p_section_id;

  -- Renumbers 1..n in the new order, which also repairs ties and gaps.
  update public.class_syllabus_sections c
  set position = o.ord
  from unnest(v_ids) with ordinality as o (id, ord)
  where c.id = o.id and c.position is distinct from o.ord::integer;

  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return null;
  end if;
  return 'moved';
end;
$$;

comment on function public.move_syllabus_section(uuid, uuid, uuid, text) is
  'Moves a syllabus section one place ''up'' or ''down'' within its syllabus. Returns ''moved'', ''unchanged'' (already first / last), or null when the section, syllabus and class do not belong together or the caller may not change them (row level security applies).';

revoke all on function public.move_syllabus_section(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.move_syllabus_section(uuid, uuid, uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Existing text and links become the first section
-- ---------------------------------------------------------------------------

create function public.syllabus_sections_backfill()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- The titles are the app's `syllabus_heading` message in en / de / bo.
  insert into public.class_syllabus_sections
    (syllabus_id, position, title, content_doc, content_language, links,
     created_by, created_at, updated_at)
  select
    s.id,
    1,
    case s.content_language
      when 'de' then 'Lehrplan'
      when 'bo' then 'སློབ་ཚན་ཐོ་གཞུང་།'
      else 'Syllabus'
    end,
    s.content_doc,
    s.content_language,
    s.links,
    s.created_by,
    s.created_at,
    s.updated_at
  from public.class_syllabi s
  where (s.content_doc is not null or jsonb_array_length(s.links) > 0)
    -- Only a syllabus without sections: running it again copies nothing twice.
    and not exists (
      select 1 from public.class_syllabus_sections c where c.syllabus_id = s.id
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.syllabus_sections_backfill() is
  '0038: copies each syllabus''s own text and links (class_syllabi.content_doc / content_language / links) into one section, for syllabi that have text or links and no section yet. Returns how many sections it made. Service role only; ran once in the migration.';

revoke all on function public.syllabus_sections_backfill() from public, anon, authenticated;
grant execute on function public.syllabus_sections_backfill() to service_role;

select public.syllabus_sections_backfill();

comment on column public.class_syllabi.content_doc is
  'Deprecated by 0038 (class_syllabus_sections). Kept only until the next cleanup migration; the app no longer reads or writes it.';
comment on column public.class_syllabi.content_language is
  'Deprecated by 0038 (class_syllabus_sections). Kept only until the next cleanup migration; the app no longer reads or writes it.';
comment on column public.class_syllabi.links is
  'Deprecated by 0038 (class_syllabus_sections). Kept only until the next cleanup migration; the app no longer reads or writes it.';
