-- ============================================================
-- 0049_blocking_fixes.sql
--
-- Blocking was enforced in twenty places but missed four, and every one of
-- the four is something a blocked person can do to the person who blocked
-- them. This is a safety feature, so a partial implementation is worse than
-- it looks: the person who blocked believes they are protected.
--
-- What already worked (checked, unchanged): the feed excludes blocked users,
-- as do live comments, mentions, location sharing, and the live-start alert.
--
-- What did not:
--   1. a blocked person could still COMMENT on your videos
--   2. a blocked person could still MESSAGE you in an existing conversation
--   3. a blocked person could still READ your videos directly
--   4. blocking left existing follows in place, both directions
--
-- A fifth gap is deliberately NOT fixed here — see the note at the bottom.
-- ============================================================


-- ── One helper, both directions ──────────────────────────
-- Blocking is symmetrical in effect: whichever way round it was done, the
-- two people should not reach each other. Every check below uses this, so
-- they cannot drift apart later.
create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = p_a and blocked_id = p_b)
        or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

revoke all on function public.is_blocked_between(uuid, uuid) from public;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated, anon;


-- ============================================================
-- 1. Commenting
--
-- may_comment_on() (0027) checked the video exists, comments are allowed,
-- and the owner's "who can comment" setting — but never looked at blocks.
-- So someone you had blocked could keep commenting on everything you posted.
-- ============================================================
create or replace function public.may_comment_on(p_video uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_owner uuid; v_allow boolean; v_rule text;
begin
  select user_id, allow_comments into v_owner, v_allow
    from public.videos where id = p_video;
  if v_owner is null then return false; end if;
  if not coalesce(v_allow, true) then return false; end if;
  if v_owner = p_actor then return true; end if;

  -- Added: a block stops this before any preference is considered.
  if public.is_blocked_between(v_owner, p_actor) then return false; end if;

  v_rule := public.setting_text(v_owner, 'who_can_comment');
  if v_rule = 'nobody' then return false; end if;
  if v_rule = 'following' then
    return exists (select 1 from public.follows
                    where follower_id = v_owner and followed_id = p_actor);
  end if;
  return true;
end;
$fn$;


-- ============================================================
-- 2. Messaging
--
-- can_message() (0027) does check blocks — but it was only ever called from
-- the app, in views.js, before opening a NEW conversation. The database
-- policy behind messages checked only membership:
--
--   with check (auth.uid() = from_user_id and public.is_chat_member(chat_id))
--
-- So a conversation that already existed before the block carried on
-- working, and a direct API call bypassed the app's check entirely. A UI
-- check is not enforcement.
--
-- Only direct messages are gated. Blocking someone should not silently
-- break a group both people are in — that is a different decision, and
-- taking it here would surprise everyone else in the group.
-- ============================================================
create or replace function public.may_message_in_chat(p_chat uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_type text; v_other uuid;
begin
  select type into v_type from public.chats where id = p_chat;
  if v_type is null then return false; end if;
  if v_type <> 'dm' then return true; end if;   -- groups are unaffected

  select user_id into v_other
    from public.chat_members
   where chat_id = p_chat and user_id <> p_actor
   limit 1;

  if v_other is null then return true; end if;  -- a chat with only you in it
  return not public.is_blocked_between(v_other, p_actor);
end;
$fn$;

revoke all on function public.may_message_in_chat(uuid, uuid) from public;
grant execute on function public.may_message_in_chat(uuid, uuid) to authenticated;

drop policy if exists "messages members insert" on public.messages;
create policy "messages members insert" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = from_user_id
    and public.is_chat_member(chat_id)
    and public.may_message_in_chat(chat_id, auth.uid())
  );


-- ============================================================
-- 3. Reading videos directly
--
-- can_see_posts_of() (0030) asked three questions — is it yours, is the
-- account public, do you follow them — and never asked about blocks. The
-- FEED filtered blocked creators out, so this looked fine in the app. But
-- the feed is not the only way in: a direct query on the videos table, or
-- opening a shared /v/<id> link, went straight past it.
--
-- So blocking hid someone from your feed while leaving all your posts
-- readable to them.
-- ============================================================
create or replace function public.can_see_posts_of(p_owner uuid, p_viewer uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select
    p_owner = p_viewer
    or (
      -- Added: neither direction of a block may see the other's posts.
      -- p_viewer is null for signed-out visitors, where no block can exist.
      (p_viewer is null or not public.is_blocked_between(p_owner, p_viewer))
      and (
        not coalesce((select is_private from public.profiles where id = p_owner), false)
        or exists (select 1 from public.follows
                    where follower_id = p_viewer and followed_id = p_owner)
      )
    );
$fn$;


-- ============================================================
-- 4. Existing follows survived a block
--
-- Nothing removed them, so after blocking someone: they still followed you,
-- they still counted in your follower total, they still appeared in your
-- followers list, and your posts could still reach them through any path
-- that trusted the follow rather than re-checking the block.
--
-- Every comparable app severs the relationship both ways on block.
-- ============================================================
create or replace function public.drop_follows_on_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and followed_id = new.blocked_id)
      or (follower_id = new.blocked_id and followed_id = new.blocker_id);

  -- A pending follow request is the same relationship waiting to happen.
  delete from public.follow_requests
   where (requester_id = new.blocker_id and target_id = new.blocked_id)
      or (requester_id = new.blocked_id and target_id = new.blocker_id);

  return null;
end;
$$;

drop trigger if exists tr_drop_follows_on_block on public.blocks;
create trigger tr_drop_follows_on_block
  after insert on public.blocks
  for each row execute function public.drop_follows_on_block();


-- ============================================================
-- NOT fixed here, on purpose: profile visibility
--
-- `profiles read public` is `using (true)` — every profile is readable by
-- anyone, signed in or not. So a blocked person can still open your profile
-- and see your name, photo, bio and counts. Instagram hides it entirely.
--
-- Left alone deliberately, because the profiles table is read everywhere a
-- name or avatar appears: group chat members, follower lists, comment
-- authors, admin screens. Restricting it needs each of those paths checked
-- first, or people start rendering as blanks in places that have nothing to
-- do with blocking.
--
-- It is a real gap and it should be closed — as its own change, with the
-- app tested against it, not bundled in with four unrelated fixes.
-- ============================================================
