-- =============================================================
-- FLYP -- run this WHOLE file once in the Supabase SQL editor.
--
-- Two migrations, combined so it is a single paste:
--   0071  your email address is your public display name
--   0072  likes on comments (the table the new heart needs)
--
-- Both are safe to run more than once.
--
-- The editor shows only the LAST result, so the checks inside each
-- migration scroll past. One combined check runs at the very end --
-- that is the one you will see. Every row should read OK.
-- =============================================================


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



-- 0072 — likes on comments
--
-- Both test passes raised it independently: there is no way to like a comment.
-- Not a broken control - no control. comments.likes_count has existed since
-- 0001 and is selected by both comment queries in db.js, so every comment has
-- always reported a like count of 0 that nothing on earth could raise. The
-- heart and the count were eventually removed from the UI because they did
-- nothing, which was the right call for a button that could not work and the
-- wrong outcome for the app: it is a core interaction on every comparable
-- product, and the cheapest signal a reader can give.
--
-- Deliberately modelled on public.likes (0001) and bump_video_likes (0003)
-- rather than inventing a second shape for the same idea.

create table if not exists public.comment_likes (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  comment_id uuid not null references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);

-- Reading a comment's likers is by comment; the PK is by user. Without this
-- the count query behind every comment row is a scan.
create index if not exists idx_comment_likes_comment on public.comment_likes (comment_id);


-- ── Keep comments.likes_count true ──
-- greatest(x - 1, 0) mirrors 0003: a counter that can go negative is worse
-- than one that is briefly stale.
create or replace function public.bump_comment_likes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    update public.comments set likes_count = likes_count + 1 where id = new.comment_id;
  elsif (tg_op = 'DELETE') then
    update public.comments set likes_count = greatest(likes_count - 1, 0) where id = old.comment_id;
  end if;
  return null;
end; $$;

drop trigger if exists tr_comment_likes_count on public.comment_likes;
create trigger tr_comment_likes_count after insert or delete on public.comment_likes
  for each row execute function public.bump_comment_likes();


-- ── Tell the comment's author ──
-- Reuses type 'like', which the 0001 constraint already allows, so this needs
-- no constraint change. The payload carries kind = 'comment_like' so the
-- notifications screen can word it as a comment rather than a video, and the
-- video id so tapping it can open the right comments sheet.
--
-- No notification for liking your own comment: every product suppresses that,
-- and without it the first thing a new user sees is themselves.
create or replace function public.notify_on_comment_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid; v_video uuid; v_text text;
begin
  select user_id, video_id, text into v_author, v_video, v_text
    from public.comments where id = new.comment_id;

  if v_author is null or v_author = new.user_id then
    return null;
  end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  values (v_author, new.user_id, 'like',
          jsonb_build_object('kind', 'comment_like',
                             'comment_id', new.comment_id,
                             'video_id', v_video,
                             'excerpt', left(coalesce(v_text, ''), 60)));
  return null;
end; $$;

drop trigger if exists tr_notify_comment_like on public.comment_likes;
create trigger tr_notify_comment_like after insert on public.comment_likes
  for each row execute function public.notify_on_comment_like();


-- ── RLS ──
alter table public.comment_likes enable row level security;

-- Same shape as "likes read public" (0001): counts are public, and the client
-- needs to read the row to know whether YOU liked it. Nothing private is
-- exposed that the comment itself does not already expose.
drop policy if exists "comment likes read" on public.comment_likes;
create policy "comment likes read" on public.comment_likes
  for select to authenticated, anon using (true);

-- Your own row only, on both sides of the check - without `with check` a
-- caller could insert a like attributed to someone else.
drop policy if exists "comment likes write own" on public.comment_likes;
create policy "comment likes write own" on public.comment_likes
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ── Repair counts, in case any rows predate the trigger ──
update public.comments c
   set likes_count = coalesce(x.n, 0)
  from (select comment_id, count(*)::int as n from public.comment_likes group by comment_id) x
 where x.comment_id = c.id
   and c.likes_count is distinct from x.n;


-- ── Verify ──
select 'comment_likes table' as check,
       case when to_regclass('public.comment_likes') is not null then 'OK' else 'MISSING' end as result
union all
select 'count trigger',
       case when exists (select 1 from pg_trigger where tgname = 'tr_comment_likes_count')
            then 'OK' else 'MISSING' end
union all
select 'author notification trigger',
       case when exists (select 1 from pg_trigger where tgname = 'tr_notify_comment_like')
            then 'OK' else 'MISSING' end
union all
select 'RLS enabled',
       case when (select relrowsecurity from pg_class where oid = 'public.comment_likes'::regclass)
            then 'OK' else 'OFF — anyone could write' end
union all
select 'write policy checks BOTH sides',
       case when (select count(*) from pg_policy
                   where polrelid = 'public.comment_likes'::regclass
                     and polname = 'comment likes write own'
                     and polqual is not null and polwithcheck is not null) = 1
            then 'OK' else 'MISSING with check' end
order by 1;

-- After running: like a comment from one account, confirm the count rises and
-- the author gets a notification; like your OWN comment and confirm no
-- notification arrives. Then unlike and confirm the count falls, not below 0.


-- =============================================================
-- COMBINED CHECK — this is the result the editor will show you.
-- Every row should say OK.
-- =============================================================
select '0071 · trigger no longer reads your email' as check,
       case when pg_get_functiondef('public.handle_new_user()'::regprocedure)
                 not like '%split_part(coalesce(new.email%'
            then 'OK' else 'STILL PRESENT' end as result
union all
select '0071 · accounts whose name IS their email (for you to review)',
       (select count(*)::text
          from public.profiles p
          join auth.users u on u.id = p.id
         where u.email is not null
           and p.name = split_part(u.email, '@', 1))
union all
select '0072 · comment_likes table',
       case when to_regclass('public.comment_likes') is not null then 'OK' else 'MISSING' end
union all
select '0072 · like counter trigger',
       case when exists (select 1 from pg_trigger where tgname = 'tr_comment_likes_count')
            then 'OK' else 'MISSING' end
union all
select '0072 · author notification trigger',
       case when exists (select 1 from pg_trigger where tgname = 'tr_notify_comment_like')
            then 'OK' else 'MISSING' end
union all
select '0072 · RLS on',
       case when (select relrowsecurity from pg_class where oid = 'public.comment_likes'::regclass)
            then 'OK' else 'OFF — anyone could write' end
order by 1;
