-- 0071 — stop the email address becoming a public display name
--
-- Raised as a suspicion by the Arabic test pass: the display name shown on the
-- profile and on every comment was `allenadhitya1718`, while the handle was
-- `user_d6aceb49`. That is the local part of the account's email address, in
-- public, on a real account.
--
-- ── It is not a guess ──
-- handle_new_user() has picked the name this way since 0001, and 0044 - which
-- rewrote the function for a different reason - kept it:
--
--   v_name := coalesce(
--     nullif(trim(new.raw_user_meta_data->>'name'), ''),
--     nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),   <-- here
--     'مستخدم'
--   );
--
-- The signup wizard does send a name, so the fallback only fires for accounts
-- created another way - the Supabase dashboard, a seeded row, an older build.
-- Those are exactly the accounts nobody is watching, and one of them is a
-- live account today.
--
-- 0044 is also inconsistent with itself. Its repair pass for already-blank
-- names does NOT use the email:
--
--   update public.profiles set name = coalesce(nullif(trim(handle), ''), 'مستخدم')
--
-- It uses the handle. The trigger should have done the same and did not.
--
-- ── Why the email is the wrong fallback ──
-- An email address is not a display name and was never offered as one. Pairing
-- it with a visible handle hands anyone the account's likely email, which is
-- half of a credential and the whole of a spam target. The handle is derived
-- from the user id, contains nothing the person did not already publish, and
-- is guaranteed present.

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
  -- Unchanged from 0044.
  v_handle := coalesce(
    nullif(trim(new.raw_user_meta_data->>'handle'), ''),
    'user_' || substr(replace(new.id::text, '-', ''), 1, 8)
  );

  -- The email step is gone. Falls back to the handle, matching what 0044's own
  -- repair pass already did, and only then to a generic word.
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    v_handle,
    'مستخدم'
  );

  insert into public.profiles (id, name, handle)
  values (new.id, v_name, v_handle)
  on conflict (id) do nothing;

  return new;
end;
$$;


-- ── Accounts already carrying an email-derived name ──
-- Deliberately NOT rewritten automatically. A display name is the person's own,
-- some of these people may have since chosen a name that merely resembles their
-- email, and silently renaming a live account is worse than the leak it fixes.
--
-- This reports them instead. Run the UPDATE underneath only for rows you have
-- looked at and decided about.
--
--   update public.profiles p
--      set name = p.handle
--     from auth.users u
--    where u.id = p.id
--      and p.name = split_part(u.email, '@', 1)
--      and p.id = '<the specific id>';   -- one at a time, on purpose


-- ── Verify ──
select 'trigger no longer reads the email' as check,
       case when pg_get_functiondef('public.handle_new_user()'::regprocedure)
                 not like '%split_part(coalesce(new.email%'
            then 'OK' else 'STILL PRESENT' end as result
union all
select 'trigger still falls back to the handle',
       case when pg_get_functiondef('public.handle_new_user()'::regprocedure)
                 like '%v_handle,%'
            then 'OK' else 'MISSING' end
union all
select 'existing profiles whose name IS their email local part',
       (select count(*)::text
          from public.profiles p
          join auth.users u on u.id = p.id
         where u.email is not null
           and p.name = split_part(u.email, '@', 1))
order by 1;
