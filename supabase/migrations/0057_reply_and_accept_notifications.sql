-- 0057 — two notifications a user expects and never received
--
-- Both reuse types the check constraint already allows ('comment', 'system'),
-- so this migration does not touch messages_type_check or
-- notifications_type_check. Nothing here is destructive: it replaces two
-- functions and adds rows only on events that previously produced none.
--
-- 1. REPLIES. comments.parent_id has existed since 0001, but
--    notify_on_comment only ever looked up the VIDEO's owner. Reply to
--    somebody's comment on a third party's video and they were never told —
--    the notification went to the video owner instead, who did not write the
--    comment being answered. Instagram notifies the person replied to, and so
--    does this.
--
-- 2. ACCEPTED FOLLOW REQUESTS. approve_follow_request deletes the request and
--    inserts the follow. The insert fires tr_notify_follow, which tells the
--    ACCOUNT OWNER that the requester now follows them — something they just
--    caused by tapping approve. The requester, the one actually waiting on an
--    answer, got nothing at all. Now they are told.

-- ── 1. Comment notifications: reply first, then the video owner ──
create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id      uuid;
  parent_author uuid;
begin
  select user_id into owner_id from public.videos where id = new.video_id;

  if new.parent_id is not null then
    select user_id into parent_author from public.comments where id = new.parent_id;
  end if;

  -- The person being replied to. `parent_id` in the payload is what lets the
  -- app word this as a reply rather than a plain comment.
  if parent_author is not null and parent_author <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (parent_author, new.user_id, 'comment',
            jsonb_build_object('video_id', new.video_id,
                               'comment_id', new.id,
                               'parent_id', new.parent_id,
                               'text', left(new.text, 80)));
  end if;

  -- The video's owner — unless they wrote the comment, or they are the person
  -- already notified above. `is distinct from` rather than `<>` because
  -- parent_author is null for a top-level comment and `<>` would yield null,
  -- silently skipping the owner's notification on every ordinary comment.
  if owner_id is not null
     and owner_id <> new.user_id
     and owner_id is distinct from parent_author then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (owner_id, new.user_id, 'comment',
            jsonb_build_object('video_id', new.video_id,
                               'comment_id', new.id,
                               'text', left(new.text, 80)));
  end if;

  return new;
end;
$$;

-- The trigger itself is unchanged; restated so this file is self-contained.
drop trigger if exists tr_notify_comment on public.comments;
create trigger tr_notify_comment after insert on public.comments
  for each row execute function public.notify_on_comment();

-- ── 2. Tell the requester their follow request was accepted ──
create or replace function public.approve_follow_request(p_requester uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not signed in'; end if;

  delete from public.follow_requests
   where requester_id = p_requester and target_id = v_me;

  if not found then raise exception 'no such request'; end if;

  insert into public.follows (follower_id, followed_id)
  values (p_requester, v_me)
  on conflict do nothing;

  -- 'system' with a kind, matching how location permits are already reported,
  -- so notifications_type_check needs no change.
  insert into public.notifications (user_id, actor_id, type, payload)
  values (p_requester, v_me, 'system',
          jsonb_build_object('kind', 'follow_accepted'));
end;
$fn$;

grant execute on function public.approve_follow_request(uuid) to authenticated;
