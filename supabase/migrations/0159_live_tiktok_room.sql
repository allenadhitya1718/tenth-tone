-- ============================================================
-- 0159 - TikTok-style audio live: 30 on stage, invite anyone you know,
--        host mutes a guest, top gifters (client round 4)
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0158.
-- Safe to re-run: columns "if not exists", functions re-created.
--
-- 1. Up to 30 people on stage: the host plus 29 guests (was 4, 0103).
--    Agora carries 30 audio publishers in one channel without trouble.
--
-- 2. The host can invite a specific person who is NOT in the room. 0103
--    only allowed inviting viewers (not_watching). Now the invitee may be
--    anyone the host is connected to, either way round (one follows the
--    other), who can see the stream (its privacy), with no block between
--    them. To keep invites from becoming spam:
--      - a stranger (no follow either way) is refused: 'not_connected';
--      - at most 30 invites per stream in any 10 minutes: 'invite_limit';
--      - the 60-second re-invite wait (too_soon) stays.
--    The invitee gets the existing 'live_invite' notification and push
--    (send-push maps it to "invites you to join their LIVE"); opening it
--    takes them into the room, where Join / Decline is shown.
--
-- 3. The host can mute a guest: live_guests.host_muted. The guest's app
--    watches the row (realtime) and turns its microphone off, and keeps it
--    off until the host unmutes. Agora cannot mute someone else's
--    microphone from the host's phone, so this is enforced by the app; the
--    host can still remove a guest who does not comply.
--
-- 4. Top gifters of a live, for the TikTok ranking: live_top_gifters().
--    SECURITY INVOKER, so the gift_transactions read policy (0104: anyone
--    who can see the stream) decides what is counted.
-- ============================================================

begin;

-- ── 1. 30 on stage ────────────────────────────────────────────────────
create or replace function public.live_guest_promote(p_live_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_guests constant integer := 29;           -- 0159: host + 29 = 30 on stage
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('live_guests:' || p_live_id::text, 0));

  select count(*) into v_count
    from public.live_guests
   where live_id = p_live_id and status = 'accepted' and user_id <> p_user_id;
  if v_count >= c_max_guests then
    raise exception 'stage_full';
  end if;

  update public.live_guests
     set status = 'accepted', host_muted = false, updated_at = now()
   where live_id = p_live_id and user_id = p_user_id;
end;
$$;
revoke all on function public.live_guest_promote(uuid, uuid) from public, anon, authenticated;


-- ── 3 (column first: promote above writes it) ─────────────────────────
alter table public.live_guests add column if not exists host_muted boolean not null default false;


-- ── 2. Invite a specific person ───────────────────────────────────────
create or replace function public.invite_to_live(p_live_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_stream  public.live_streams%rowtype;
  v_row     public.live_guests%rowtype;
  v_exists  boolean;
  v_recent  integer;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;

  select * into v_stream from public.live_streams where id = p_live_id;
  if not found then raise exception 'live_not_found'; end if;
  if v_stream.host_id <> v_me then raise exception 'not_host'; end if;
  if v_stream.status <> 'live' then raise exception 'live_not_live'; end if;
  if p_user_id is null or p_user_id = v_me then raise exception 'host_is_you'; end if;
  if public.is_blocked_between(v_me, p_user_id) then raise exception 'blocked'; end if;

  select * into v_row from public.live_guests
   where live_id = p_live_id and user_id = p_user_id
   for update;
  v_exists := found;

  if v_exists then
    if v_row.status in ('invited', 'accepted') then
      return v_row.status;                       -- already invited / on stage
    elsif v_row.status = 'requested' then
      -- They asked, the host is asking back: that is an approval.
      perform public.live_guest_promote(p_live_id, p_user_id);
      perform public.live_guest_notify(p_user_id, v_me, 'live_guest_approved', p_live_id);
      return 'accepted';
    elsif v_row.updated_at > now() - interval '60 seconds' then
      raise exception 'too_soon';                -- 'left' / 'removed' a moment ago
    end if;
  end if;

  -- 0159: someone in the room, or someone the host knows (a follow either
  -- way). Strangers cannot be invited.
  if not exists (select 1 from public.live_viewers
                  where live_id = p_live_id and user_id = p_user_id)
     and not exists (select 1 from public.follows f
                      where (f.follower_id = v_me and f.followed_id = p_user_id)
                         or (f.follower_id = p_user_id and f.followed_id = v_me)) then
    raise exception 'not_connected';
  end if;

  -- The invitee must be able to open the stream: a friends-only live is for
  -- mutual follows (0123).
  if v_stream.privacy = 'friends'
     and not (exists (select 1 from public.follows f
                       where f.follower_id = p_user_id and f.followed_id = v_me)
              and exists (select 1 from public.follows f
                           where f.follower_id = v_me and f.followed_id = p_user_id)) then
    raise exception 'cannot_see_live';
  elsif v_stream.privacy not in ('public', 'friends') then
    raise exception 'cannot_see_live';
  end if;

  -- At most 30 invites per stream in any 10 minutes.
  perform pg_advisory_xact_lock(hashtextextended('live_invites:' || p_live_id::text, 0));
  select count(*) into v_recent
    from public.live_guests
   where live_id = p_live_id and status = 'invited' and updated_at > now() - interval '10 minutes';
  if v_recent >= 30 then raise exception 'invite_limit'; end if;

  if v_exists then
    update public.live_guests
       set status = 'invited', host_muted = false, updated_at = now()
     where live_id = p_live_id and user_id = p_user_id;
  else
    insert into public.live_guests (live_id, user_id, status)
    values (p_live_id, p_user_id, 'invited');
  end if;

  perform public.live_guest_notify(p_user_id, v_me, 'live_invite', p_live_id);
  return 'invited';
end;
$$;
revoke all on function public.invite_to_live(uuid, uuid) from public, anon;
grant execute on function public.invite_to_live(uuid, uuid) to authenticated;


-- ── 3. Host mutes / unmutes a guest ───────────────────────────────────
create or replace function public.set_live_guest_muted(p_live_id uuid, p_user_id uuid, p_muted boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_host uuid;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  select host_id into v_host from public.live_streams where id = p_live_id;
  if v_host is null then raise exception 'live_not_found'; end if;
  if v_host <> v_me then raise exception 'not_host'; end if;

  update public.live_guests
     set host_muted = coalesce(p_muted, false), updated_at = now()
   where live_id = p_live_id and user_id = p_user_id and status = 'accepted';
  if not found then raise exception 'not_on_stage'; end if;
  return coalesce(p_muted, false);
end;
$$;
revoke all on function public.set_live_guest_muted(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_live_guest_muted(uuid, uuid, boolean) to authenticated;


-- ── 4. Top gifters of a live ──────────────────────────────────────────
drop function if exists public.live_top_gifters(uuid, integer);
create function public.live_top_gifters(p_live_id uuid, p_limit integer default 20)
returns table (user_id uuid, name text, handle text, avatar_url text, coins bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t.from_user_id, p.name, p.handle, p.avatar_url, sum(t.amount)::bigint as coins
    from public.gift_transactions t
    join public.profiles p on p.id = t.from_user_id
   where t.live_stream_id = p_live_id
   group by t.from_user_id, p.name, p.handle, p.avatar_url
   order by coins desc, min(t.created_at)
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
revoke all on function public.live_top_gifters(uuid, integer) from public, anon;
grant execute on function public.live_top_gifters(uuid, integer) to authenticated;

commit;


-- ── Checks (SELECT only) ──
select 'stage cap 29 guests' as check,
       case when pg_get_functiondef('public.live_guest_promote(uuid,uuid)'::regprocedure) like '%:= 29;%' then 'OK' else 'MISSING' end as result
union all
select 'invite allows connected people',
       case when pg_get_functiondef('public.invite_to_live(uuid,uuid)'::regprocedure) like '%not_connected%' then 'OK' else 'MISSING' end
union all
select 'host_muted column',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'live_guests' and column_name = 'host_muted') then 'OK' else 'MISSING' end
union all
select 'new functions not callable by anon',
       case when not has_function_privilege('anon', 'public.set_live_guest_muted(uuid,uuid,boolean)', 'execute')
             and not has_function_privilege('anon', 'public.live_top_gifters(uuid,integer)', 'execute') then 'OK' else 'EXPOSED' end;
