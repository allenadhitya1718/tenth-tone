-- ============================================================
-- 0022_user_private.sql
-- Gender and country.
--
-- These deliberately do NOT go on public.profiles. That table's read policy
-- is `for select to authenticated, anon using (true)` - literally everyone,
-- signed in or not, can read every column of it. Personal details belong in
-- their own table, readable only by the owner (and admins, for moderation).
--
-- NOTE: date of birth is intentionally not stored here. An age gate is still
-- required by both app stores before launch - it will need its own home.
--
-- Apply in the Supabase SQL editor AFTER 0001..0021.
-- ============================================================

create table if not exists public.user_private (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  gender      text check (gender in ('male', 'female', 'other', 'undisclosed')),
  country     text,          -- ISO 3166-1 alpha-2, e.g. 'SA'
  updated_at  timestamptz not null default now()
);

alter table public.user_private enable row level security;

drop policy if exists "user_private own" on public.user_private;
create policy "user_private own" on public.user_private
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_private admin read" on public.user_private;
create policy "user_private admin read" on public.user_private
  for select to authenticated
  using (public.is_admin());

create or replace function public.touch_user_private()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_touch_user_private on public.user_private;
create trigger tr_touch_user_private
  before insert or update on public.user_private
  for each row execute function public.touch_user_private();
