-- 0012_class_names_unique.sql
--
-- Class names are unique, the same way team names are (0010): decided
-- 2026-09-25 after three classes called "Yaks" could be created. Uniqueness
-- ignores case and surrounding whitespace ("Yaks" = " yaks "). The class code
-- stays the join key students type; the name just can't repeat.
--
-- Fails if duplicates already exist: rename or delete them first.

create unique index classes_name_unique_idx on public.classes (lower(btrim(name)));

comment on table public.classes is
  'A class is identified by its generated unique code; its name is unique too (case-insensitive, trimmed).';
