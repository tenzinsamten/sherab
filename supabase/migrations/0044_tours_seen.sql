-- 0044_tours_seen.sql
--
-- #101: guided page tours for parents and teachers.
--
-- A short tour starts by itself the first time a parent or teacher opens a
-- key page. The account remembers which tours it has seen, so a tour starts
-- once per person, on any device.
--
-- * profiles.tours_seen: the ids of the tours this account has seen. Every
--   existing row starts empty, so existing accounts see each tour once too.
-- * mark_tour_seen(p_tour): adds one id to the caller's own row, once.
--   SECURITY DEFINER because profiles has no update-own policy; it touches
--   only tours_seen and only the row of auth.uid(). Which ids are tours is
--   the app's knowledge (src/lib/tours.ts); the database only bounds what a
--   caller can store: a short lower-case id, and at most 64 of them.
--
-- The before-update triggers on profiles keep passing: guard_profile_link_
-- columns (0024) looks at parent_id, guardian_email and role, none of which
-- change, and assign_team_on_approval (0043) fires only when the status
-- becomes 'approved'.
--
-- No row is deleted; existing rows only get the empty default.

alter table public.profiles
  add column tours_seen text[] not null default '{}';

comment on column public.profiles.tours_seen is
  '#101: ids of the guided page tours this account has seen (src/lib/tours.ts). Written only by mark_tour_seen().';

-- ---------------------------------------------------------------------------
-- mark_tour_seen(p_tour)
-- ---------------------------------------------------------------------------

create or replace function public.mark_tour_seen(p_tour text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_tour is null or p_tour !~ '^[a-z][a-z0-9-]{0,39}$' then
    raise exception 'not a tour id' using errcode = '22023';
  end if;

  update public.profiles
  set tours_seen = array_append(tours_seen, p_tour)
  where id = auth.uid()
    and not (p_tour = any (tours_seen))
    and cardinality(tours_seen) < 64;
end;
$$;

comment on function public.mark_tour_seen(text) is
  '#101: records that the caller has seen one guided page tour. Adds the id to the caller''s own profiles.tours_seen once; nothing else changes.';

revoke all on function public.mark_tour_seen(text) from public, anon;
grant execute on function public.mark_tour_seen(text) to authenticated, service_role;
