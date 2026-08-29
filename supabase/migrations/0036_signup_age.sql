-- ============================================================
-- 0036_signup_age.sql
--
-- The rebuilt signup asks for a birthday, which 0022 deliberately left
-- homeless. It lives in user_private (owner-only reads), and it is what the
-- age rules hang off:
--
--   * under 13  - may not have an account at all (both stores require this)
--   * under 18  - may not enable location sharing
--
-- The location rule is enforced by a trigger, not by the app, so it holds
-- for anyone talking to the API directly.
--
-- Apply in the Supabase SQL editor AFTER 0001..0035.
-- ============================================================

alter table public.user_private
  add column if not exists birth_date date;


-- ── A birthday is written once ──
-- If it could be edited freely, a 15-year-old would become 18 the moment the
-- location toggle refused them. Support can still correct genuine mistakes
-- with the service role, which bypasses triggers' auth context but not this
-- guard - so the guard allows service_role explicitly.
create or replace function public.guard_birth_date()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'UPDATE'
     and old.birth_date is not null
     and new.birth_date is distinct from old.birth_date
     and current_setting('request.jwt.claims', true)::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'birth date cannot be changed';
  end if;

  -- The app refuses under-13 signups; this makes the refusal real.
  if new.birth_date is not null
     and new.birth_date > (current_date - interval '13 years') then
    raise exception 'minimum age is 13';
  end if;

  -- A birthday in the future or before 1900 is a typo, not a person.
  if new.birth_date is not null
     and (new.birth_date > current_date or new.birth_date < date '1900-01-01') then
    raise exception 'invalid birth date';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_guard_birth_date on public.user_private;
create trigger trg_guard_birth_date
  before insert or update on public.user_private
  for each row execute function public.guard_birth_date();


-- ── Is this person an adult? ──
-- security definer because user_private is owner-only, but the location
-- trigger needs the answer for whoever is writing.
create or replace function public.is_adult(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select coalesce(
    (select birth_date <= (current_date - interval '18 years')
       from public.user_private
      where user_id = p_user),
    false   -- no birthday recorded = not proven adult
  );
$fn$;

grant execute on function public.is_adult(uuid) to authenticated;


-- ── Location sharing is 18+ ──
create or replace function public.enforce_location_age()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(new.sharing_enabled, false) = true
     and not public.is_adult(new.user_id) then
    raise exception 'location sharing requires 18+';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_enforce_location_age on public.user_locations;
create trigger trg_enforce_location_age
  before insert or update on public.user_locations
  for each row execute function public.enforce_location_age();
