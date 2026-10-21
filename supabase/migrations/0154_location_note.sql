-- 0154 - A note with your shared location (owner request)
--
-- On the friends map, someone sharing their location can add a short note
-- ("At the beach, come join!") shown as a bubble on their pin, like
-- Instagram's map notes. It lives on the same user_locations row, so exactly
-- the people who can see the location (the "locations read" policy, 0105)
-- can see the note, and no one else.
--
--   user_locations.note     1-80 characters, or null
--   user_locations.note_at  when it was set; the app hides notes older than
--                           24 hours
--
-- set_location_note(text): only while sharing; empty clears; runs the same
-- word filter as comments (abuse_match, 0135), since friends (or everyone,
-- for public sharing) read it. The app cannot write the two columns directly
-- (a trigger refuses it), so the filter cannot be skipped. Turning sharing
-- off clears the note along with the coordinates (clear_location_when_off,
-- 0032, restated with the note added).
--
-- Needs 0032, 0105, 0135. Safe to re-run.

begin;

alter table public.user_locations add column if not exists note text;
alter table public.user_locations add column if not exists note_at timestamptz;

alter table public.user_locations drop constraint if exists user_locations_note_check;
alter table public.user_locations
  add constraint user_locations_note_check
  check (note is null or char_length(note) between 1 and 80);

-- 0032's trigger function, plus the note.
create or replace function public.clear_location_when_off()
returns trigger
language plpgsql
as $fn$
begin
  if coalesce(new.sharing_enabled, false) = false or new.visibility = 'none' then
    new.lat := null;
    new.lng := null;
    new.accuracy := null;
    new.note := null;
    new.note_at := null;
  end if;
  return new;
end;
$fn$;

-- Only set_location_note writes the note. SECURITY INVOKER: current_user is
-- the role that issued the write; the function below runs as its owner.
create or replace function public.guard_location_note()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user in ('authenticated', 'anon')
     and (new.note is distinct from (case when tg_op = 'UPDATE' then old.note end)
          or new.note_at is distinct from (case when tg_op = 'UPDATE' then old.note_at end)) then
    -- Clearing (the stop-sharing trigger above runs first and nulls them) is fine.
    if new.note is null and new.note_at is null then
      return new;
    end if;
    raise exception 'location notes are set through set_location_note'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;
revoke all on function public.guard_location_note() from public, anon, authenticated;

-- Runs after the clearing trigger (triggers fire in name order).
drop trigger if exists trg_zz_guard_location_note on public.user_locations;
create trigger trg_zz_guard_location_note
  before insert or update on public.user_locations
  for each row execute function public.guard_location_note();

create or replace function public.set_location_note(p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 80 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;
  if v_note is not null and public.abuse_match(v_note) is not null then
    raise exception 'note_blocked' using errcode = '23514';
  end if;
  update public.user_locations
     set note = v_note,
         note_at = case when v_note is null then null else now() end
   where user_id = auth.uid()
     and sharing_enabled
     and visibility <> 'none';
  if not found and v_note is not null then
    raise exception 'not_sharing' using errcode = '22023';
  end if;
end;
$fn$;
revoke all on function public.set_location_note(text) from public, anon;
grant execute on function public.set_location_note(text) to authenticated;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'note columns exist' as check,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'user_locations'
                     and column_name in ('note', 'note_at')) = 2
            then 'OK' else 'MISSING' end as result
union all
select 'stopping sharing clears the note',
       case when pg_get_functiondef('public.clear_location_when_off()'::regprocedure) like '%new.note := null%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'notes cannot be written around the filter',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.user_locations'::regclass
                            and tgname = 'trg_zz_guard_location_note' and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'set_location_note callable by the app only',
       case when has_function_privilege('authenticated', 'public.set_location_note(text)', 'execute')
             and not has_function_privilege('anon', 'public.set_location_note(text)', 'execute')
            then 'OK' else 'WRONG' end
order by 1;
