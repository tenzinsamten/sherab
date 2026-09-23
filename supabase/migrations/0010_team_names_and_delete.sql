-- 0010_team_names_and_delete.sql
--
-- Team names are the only thing the leaderboard and the approval
-- team-picker show, so two teams called the same thing are
-- indistinguishable. Uniqueness ignores case and surrounding whitespace
-- ("Snow Lions" = " snow lions "). Class names stay non-unique on purpose
-- (classes are told apart by their code).
--
-- Fails if duplicates already exist: rename or delete them first.

create unique index teams_name_unique_idx on public.teams (lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- Admins may delete a team, but only an empty one. profiles.team_id is
-- `on delete set null`, yet enforce_team_id_set_once() rejects any change to
-- an already-set team_id, so deleting a team that still has students raises
-- 42501 and nothing is removed. That is intended: a student's team is fixed
-- once approved, and the app checks for members first to show a clear message.
-- ---------------------------------------------------------------------------

create policy "teams_delete_admin"
  on public.teams for delete
  using (public.is_admin());
