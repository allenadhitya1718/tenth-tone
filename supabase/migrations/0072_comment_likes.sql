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
