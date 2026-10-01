-- 0035_syllabus_content.sql
--
-- #75 (2026-10-01): the class syllabus gets what homework got in 0034 (#72-#74):
-- rich text (bold, italic, underline, headings, lists, links) with no length
-- limit a teacher can reach, and a language that selects the font it is shown
-- in for every viewer.
--
-- content_doc is the editor's document as JSON, checked by the app on save
-- (src/lib/rich-text.ts) and drawn element by element, never as HTML. It is
-- optional, as the plain text was: a syllabus may be links only.
--
-- content (0015, plain text) is kept but no longer written or read by the
-- app, so the deployed code keeps working between `db push` and the new
-- deploy. Drop it in a later cleanup migration.

alter table public.class_syllabi
  add column content_doc jsonb
    constraint class_syllabi_content_doc_shape
      check (
        content_doc is null
        or (
          jsonb_typeof(content_doc) = 'object'
          -- Backstop only: the app refuses documents over 1 MB first. This is
          -- larger because jsonb's text form adds spaces.
          and octet_length(content_doc::text) <= 2000000
        )
      ),
  add column content_language text not null default 'en'
    constraint class_syllabi_content_language_known
      check (content_language in ('bo', 'en', 'de'));

comment on column public.class_syllabi.content_doc is
  'Rich-text syllabus as an editor document (JSON). Checked by the app on save; never rendered as HTML.';
comment on column public.class_syllabi.content_language is
  'Language the syllabus is written in (bo, en, de). Selects the font it is shown in.';
comment on column public.class_syllabi.content is
  'Deprecated by 0035 (content_doc). Kept only until the next cleanup migration; the app no longer reads or writes it.';

-- Existing plain text becomes the document: one paragraph per line, an empty
-- line an empty paragraph.
update public.class_syllabi s
set content_doc = jsonb_build_object(
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
    from regexp_split_to_table(btrim(s.content), '\r?\n') with ordinality as t(line, ord)
  )
)
where s.content is not null and btrim(s.content) <> '';

-- A syllabus written in Tibetan script (U+0F00-U+0FFF) is marked as Tibetan;
-- everything else keeps the default.
update public.class_syllabi
set content_language = 'bo'
where coalesce(content, '') ~ '[ༀ-࿿]';

-- Same column-level restriction as 0015: a syllabus can't be moved to
-- another class or year, only its text, language and links change.
grant update (content_doc, content_language) on public.class_syllabi to authenticated;
