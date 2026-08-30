-- ============================================================
-- 0044_profile_required_fields.sql
--
-- An account showed up in "Featured creators" with no name at all — just a
-- coloured circle and a follower count.
--
-- The signup wizard does require a name, but nothing below it did, so any
-- account created by another route (the Supabase dashboard, a seeded row, an
-- older build) landed nameless and every screen faithfully rendered nothing.
--
-- The specific hole: handle_new_user built the name with
--
--   coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1), '')
--
-- and the client sends `name: name || ''`. coalesce only replaces NULL, never
-- an empty string, so '' sailed through every fallback and was stored.
-- ============================================================

-- ── Repair the trigger ───────────────────────────────────
-- nullif(trim(...), '') turns blank into NULL so coalesce can actually do its
-- job, and the chain now ends at a guaranteed non-empty value.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text;
  v_handle text;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    'مستخدم'
  );

  v_handle := coalesce(
    nullif(trim(new.raw_user_meta_data->>'handle'), ''),
    'user_' || substr(replace(new.id::text, '-', ''), 1, 8)
  );

  insert into public.profiles (id, name, handle)
  values (new.id, v_name, v_handle)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ── Repair the rows already stored ───────────────────────
-- Falls back to the handle, which is always present, rather than inventing
-- anything. These accounts are real; only their display name was lost.
update public.profiles
   set name = coalesce(nullif(trim(handle), ''), 'مستخدم')
 where name is null or trim(name) = '';

update public.profiles
   set handle = 'user_' || substr(replace(id::text, '-', ''), 1, 8)
 where handle is null or trim(handle) = '';

-- ── Stop it happening again ──────────────────────────────
-- Added after the backfill, or the constraint would refuse to validate
-- against the rows it is meant to protect.
alter table public.profiles
  drop constraint if exists profiles_name_not_blank;
alter table public.profiles
  add constraint profiles_name_not_blank
  check (name is not null and length(trim(name)) >= 1);

alter table public.profiles
  drop constraint if exists profiles_handle_not_blank;
alter table public.profiles
  add constraint profiles_handle_not_blank
  check (handle is not null and length(trim(handle)) >= 1);
