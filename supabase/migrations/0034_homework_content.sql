-- 0034_homework_content.sql
--
-- Homework content, decided 2026-10-01:
--   #72 a required Content field replaces the optional plain-text description.
--   #73 the content is rich text (bold, italic, underline, headings, lists,
--       links) with no length limit a teacher can reach.
--   #74 the teacher picks the content's language, which selects the font of
--       the content and the title for every viewer.
--
-- content is the editor's document as JSON (a ProseMirror document: nodes
-- with type / attrs / content / marks). The app checks it against an
-- allow-list on save (src/lib/rich-text.ts) and draws it element by element,
-- so it is never inserted as HTML.
--
-- description (0013) is kept but no longer written or read by the app, so the
-- deployed code keeps working between `db push` and the new deploy. Drop it
-- in a later cleanup migration, together with reference_link.

alter table public.homework_assignments
  -- Nullable: homework created before this migration without a description
  -- has no content. The app requires it on create and on edit.
  add column content jsonb
    constraint homework_assignments_content_shape
      check (
        content is null
        or (
          jsonb_typeof(content) = 'object'
          -- Backstop only: the app refuses documents over 1 MB first. This is
          -- larger because jsonb's text form adds spaces.
          and octet_length(content::text) <= 2000000
        )
      ),
  add column content_language text not null default 'en'
    constraint homework_assignments_content_language_known
      check (content_language in ('bo', 'en', 'de'));

comment on column public.homework_assignments.content is
  'Rich-text homework content as an editor document (JSON). Checked by the app on save; never rendered as HTML.';
comment on column public.homework_assignments.content_language is
  'Language the title and content are written in (bo, en, de). Selects the font they are shown in.';
comment on column public.homework_assignments.description is
  'Deprecated by 0034 (content). Kept only until the next cleanup migration; the app no longer reads or writes it.';

-- Existing descriptions become content: one paragraph per line, an empty
-- line an empty paragraph.
update public.homework_assignments a
set content = jsonb_build_object(
  'type', 'doc',
  'content', (
    select jsonb_agg(
      case
        when t.line = '' then jsonb_build_object('type', 'paragraph')
        else jsonb_build_object(
          'type', 'paragraph',
          'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', t.line))
        )
      end
      order by t.ord
    )
    from regexp_split_to_table(btrim(a.description), '\r?\n') with ordinality as t(line, ord)
  )
)
where a.description is not null and btrim(a.description) <> '';

-- Existing homework written in Tibetan script (U+0F00-U+0FFF) is marked as
-- Tibetan; everything else keeps the default.
update public.homework_assignments
set content_language = 'bo'
where title ~ '[ༀ-࿿]' or coalesce(description, '') ~ '[ༀ-࿿]';

-- Same column-level restriction as 0005 / 0013: only the columns the edit
-- action writes are client-updatable.
grant update (content, content_language) on public.homework_assignments to authenticated;
