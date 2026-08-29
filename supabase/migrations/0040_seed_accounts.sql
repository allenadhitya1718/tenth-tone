-- =============================================================
-- 0040  Branded seed accounts
--
-- profiles.id references auth.users(id), so a seed account needs a login
-- row before it can have a profile.
--
-- This is deliberately plain SQL rather than a function. An earlier version
-- wrapped it in a security definer function guarded by is_admin(), which
-- fails in the SQL editor: there is no JWT there, so auth.uid() is null and
-- is_admin() returns false. The editor already runs with full rights, so
-- the guard added nothing and blocked the only place it is used.
--
-- No auth.identities row is created on purpose. These accounts cannot be
-- signed into, which is what we want: they hold seeded content and nobody
-- should be able to take one over. Deleting one still cascades normally.
--
-- The on_auth_user_created trigger from 0001 builds each profile from the
-- metadata below, so name and handle come out right with no second insert.
--
-- Safe to run more than once: an existing handle is skipped.
-- =============================================================

do $seed$
declare
  a record;
  v_id uuid;
begin
  for a in
    select * from (values
      ('travel@flyp-sa.com', 'flyp_travel', 'Flyp Travel', 'مقاطع سفر ومناظر من حول العالم'),
      ('food@flyp-sa.com',   'flyp_food',   'Flyp Food',   'أكل الشارع والمطبخ، دقيقة واحدة في كل مرة'),
      ('city@flyp-sa.com',   'flyp_city',   'Flyp City',   'المدينة بعد الغروب'),
      ('active@flyp-sa.com', 'flyp_active', 'Flyp Active', 'رياضة وحركة ولياقة'),
      ('calm@flyp-sa.com',   'flyp_calm',   'Flyp Calm',   'مقاطع هادئة تريح البال')
    ) as t(email, handle, name, bio)
  loop
    -- Skip anything already created, so re-running is harmless.
    if exists (select 1 from public.profiles where handle = a.handle) then
      continue;
    end if;

    v_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_id, 'authenticated', 'authenticated', lower(a.email),
      -- A random secret nobody holds. With no identities row these accounts
      -- cannot sign in at all; this simply avoids a null column.
      crypt(gen_random_uuid()::text, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', a.name, 'handle', a.handle),
      now(), now()
    );

    -- The trigger has created the profile by now; fill in the rest.
    update public.profiles
       set bio = a.bio, name = a.name, handle = a.handle
     where id = v_id;
  end loop;
end
$seed$;


-- ── Admins may upload on another account's behalf ─────────────
-- The existing policy ties every upload to a folder named after the
-- uploader, which is right for real people but makes seeding impossible:
-- a seed account cannot sign in, so nothing could ever be uploaded for it.
-- This adds an admin-only path and leaves the ordinary rule untouched.
drop policy if exists "videos admin write" on storage.objects;
create policy "videos admin write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos' and public.is_admin());

drop policy if exists "avatars admin write" on storage.objects;
create policy "avatars admin write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_admin());

-- Needed to replace a seed clip later without deleting the row first.
drop policy if exists "videos admin update" on storage.objects;
create policy "videos admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'videos' and public.is_admin());


-- ── Result ────────────────────────────────────────────────────
select handle, name, id
  from public.profiles
 where handle like 'flyp\_%'
 order by handle;
