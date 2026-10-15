-- 0047_class_badge_subject.sql
--
-- Badge detail CAP-1: each class carries a badge subject, so badges can be
-- counted per subject (CAP-2). Song classes count as dance (one shared count).
--
-- Nullable on purpose: existing classes stay unset until the admin assigns a
-- subject, and other writers (teacher schedule edits, tests, seed) keep
-- working. The app requires a subject when the admin creates or edits a
-- class. No backfill: a subject is never guessed from the class name.

alter table public.classes
  add column badge_subject text
    constraint classes_badge_subject_known
      check (badge_subject in ('language', 'dance', 'instrument'));

comment on column public.classes.badge_subject is
  'Badge subject the class counts toward (language, dance, instrument; song classes use dance). NULL until the admin assigns one.';
