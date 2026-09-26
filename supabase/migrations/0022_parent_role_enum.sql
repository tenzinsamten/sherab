-- 0022_parent_role_enum.sql
--
-- Story 7-1: adds 'parent' to user_role, for a parent-only login
-- (profiles.role = 'parent'). It is only the login's primary role; parent
-- capability itself lives in an approved public.parents row (0023, AD-4).
--
-- Its own migration because Postgres can't use a new enum value inside the
-- transaction that added it, and each migration file is one transaction.

alter type public.user_role add value if not exists 'parent';
