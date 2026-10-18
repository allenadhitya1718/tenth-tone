-- 0103 - guests on a live stream (client note 6)
--
-- The client asked that the host of a live can bring someone else "on stage",
-- the way Instagram and TikTok lives work. Lives are audio-only (note 4), so a
-- guest is a second (third, ...) voice in the same Agora channel.
--
-- Until now there was no way to do it at all: the web app only knew the host
-- and audience roles, and agora-token gave the publisher role to the stream
-- owner and nobody else. A guest needs three things:
--
--   1. A record of who is on stage: public.live_guests, one row per person per
--      stream, primary key (live_id, user_id). Status is one of
--        requested  a viewer asked to speak
--        invited    the host asked a viewer to speak
--        accepted   on stage: may publish audio (agora-token checks this)
--        removed    the host took them off stage, or turned a request down
--        left       they left, withdrew their request or declined an invite,
--                   or the stream ended
--
--   2. Rules for who may move a row where. They live in SECURITY DEFINER RPCs,
--      never in table policies, because each transition depends on WHO is
--      asking (host or viewer), the row's current state, the stream being
--      live, blocks, and the cap on guests. A client never writes the table:
--
--        request_to_join_live(live)        viewer   -> requested
--        invite_to_live(live, user)        host     -> invited  (or accepted,
--                                                      if they had requested)
--        respond_live_invite(live, accept) invitee  invited -> accepted | left
--        approve_live_guest(live, user)    host     requested -> accepted
--        remove_live_guest(live, user)     host     any open state -> removed
--        leave_live_stage(live)            the guest any open state -> left
--
--      Each returns the row's new status as text. Errors are raised with a
--      short machine-readable message the app can switch on:
--        not_signed_in, live_not_found, live_not_live, not_host, host_is_you,
--        blocked, not_watching, stage_full, removed_by_host, too_soon,
--        no_invitation, no_request, not_on_stage
--
--      At most 4 guests may be 'accepted' at once (plus the host). An advisory
--      lock per stream makes the cap hold under concurrent accepts.
--
--      invite_to_live requires the invitee to be WATCHING (a live_viewers row,
--      written by join_live_stream, 0048). That stops a host using invites to
--      spam people who are not in the room. The app must therefore keep
--      calling join_live_stream when a viewer opens a stream, as the web app
--      does.
--
--      A row that was left or removed can be re-requested / re-invited, but not
--      within 60 seconds of its last change (too_soon), so two people cannot
--      ping-pong each other's notifications. A viewer the host REMOVED cannot
--      request again for that stream; the host can still invite them back.
--
--   3. Notifications for the other party. These reuse type 'system' with a
--      payload `kind`, exactly as 0057 did for follow_accepted and 0093 for
--      incoming_call, so notifications_type_check needs no change:
--        live_join_request    to the host, actor = the viewer
--        live_invite          to the viewer, actor = the host
--        live_guest_accepted  to the host, actor = the guest (accepted invite)
--        live_guest_approved  to the guest, actor = the host (request approved)
--        live_guest_removed   to the guest, actor = the host (was on stage)
--      payload always carries live_id and stream_id (the same id; send-push's
--      'live' case reads either) and the stream title.
--      Declining, withdrawing and leaving do NOT notify: the other side sees
--      the change instantly through realtime on live_guests, and a lingering
--      "X left the stage" notification after the stream has no use.
--      NOTE: send-push composes nothing for these kinds yet, so they appear in
--      the in-app notification list but do not reach the lock screen until a
--      case is added there.
--
-- Reading: anyone who can see the stream (the live_streams read policy,
-- including its privacy rules) can read its live_guests rows, because every
-- viewer has to see who is on stage. You can always read your own rows. No
-- insert / update / delete policy exists for clients, and the table privileges
-- are revoked as well, so the RPCs are the only way in.
--
-- When a stream stops being live, every open row (requested, invited,
-- accepted) becomes 'left', mirroring clear_live_viewers_on_end (0048).
--
-- KNOWN LIMIT: a guest who is removed keeps whatever Agora token they already
-- hold until it expires (agora-token issues one-hour tokens). A well-behaved
-- app switches to the audience role as soon as its row leaves 'accepted'
-- (it watches live_guests through realtime). Forcing a misbehaving client off
-- the channel needs Agora's server-side kicking-rule API, which is not wired
-- up; a removed guest cannot get a NEW publisher token.
--
-- Depends on: 0001 (live_streams, notifications), 0004 (privacy, follows,
-- blocks), 0048 (live_viewers), 0049 (is_blocked_between). Pairs with the
-- agora-token change that grants the publisher role to accepted guests.
-- Safe to re-run.

begin;

-- ── 1. The table ────────────────────────────────────────────────────────

create table if not exists public.live_guests (
  live_id    uuid not null references public.live_streams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     text not null
             check (status in ('requested', 'invited', 'accepted', 'removed', 'left')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (live_id, user_id)
);

-- "My pending invites" looks a person up across streams.
create index if not exists idx_live_guests_user on public.live_guests (user_id);

alter table public.live_guests enable row level security;
-- Every column in the realtime payload, so a screen filtering on live_id sees
-- updates (invited -> accepted -> removed), not only inserts.
alter table public.live_guests replica identity full;

-- Clients read; they never write. RLS without a write policy already refuses,
-- this makes it explicit at the privilege level too.
revoke insert, update, delete, truncate on public.live_guests from anon, authenticated;
grant select on public.live_guests to authenticated;

drop policy if exists "live guests read" on public.live_guests;
create policy "live guests read" on public.live_guests
  for select to authenticated
  using (
    user_id = (select auth.uid())
    -- Runs under the caller's own live_streams read policy, so the stream's
    -- privacy (and banned status) decides who sees its stage.
    or exists (select 1 from public.live_streams ls where ls.id = live_guests.live_id)
  );

-- ── 2. Internal helpers (not callable by clients) ───────────────────────

-- Writes one notification. SECURITY DEFINER callers only: granting this to
-- authenticated would let anyone forge a notification to anyone (see 0074).
create or replace function public.live_guest_notify(
  p_user uuid, p_actor uuid, p_kind text, p_live_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if p_user is null or p_user = p_actor then return; end if;
  select left(coalesce(title, ''), 60) into v_title
    from public.live_streams where id = p_live_id;
  insert into public.notifications (user_id, actor_id, type, payload)
  values (p_user, p_actor, 'system',
          jsonb_build_object('kind', p_kind,
                             'live_id', p_live_id,
                             'stream_id', p_live_id,
                             'title', coalesce(v_title, '')));
end;
$$;
revoke all on function public.live_guest_notify(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Puts a person on stage, enforcing the cap. The advisory lock serialises
-- every accept on the same stream, so two accepts at once cannot both see
-- three guests and make five.
create or replace function public.live_guest_promote(p_live_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_guests constant integer := 4;
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
     set status = 'accepted', updated_at = now()
   where live_id = p_live_id and user_id = p_user_id;
end;
$$;
revoke all on function public.live_guest_promote(uuid, uuid) from public, anon, authenticated;

-- ── 3. Viewer: ask to join ──────────────────────────────────────────────

create or replace function public.request_to_join_live(p_live_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_stream public.live_streams%rowtype;
  v_row    public.live_guests%rowtype;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;

  select * into v_stream from public.live_streams where id = p_live_id;
  -- Same visibility as the "live read" policy (0004): a stream you could not
  -- see is reported as not found, not as forbidden.
  if not found
     or v_stream.status = 'banned'
     or not (v_stream.host_id = v_me
             or v_stream.privacy = 'public'
             or (v_stream.privacy = 'friends'
                 and exists (select 1 from public.follows f
                              where f.follower_id = v_me
                                and f.followed_id = v_stream.host_id))) then
    raise exception 'live_not_found';
  end if;
  if v_stream.status <> 'live' then raise exception 'live_not_live'; end if;
  if v_stream.host_id = v_me then raise exception 'host_is_you'; end if;
  if public.is_blocked_between(v_stream.host_id, v_me) then raise exception 'blocked'; end if;

  select * into v_row from public.live_guests
   where live_id = p_live_id and user_id = v_me
   for update;

  if found then
    if v_row.status in ('requested', 'accepted') then
      return v_row.status;                       -- nothing to do
    elsif v_row.status = 'invited' then
      -- Both sides want it: asking to join while invited is accepting.
      perform public.live_guest_promote(p_live_id, v_me);
      perform public.live_guest_notify(v_stream.host_id, v_me, 'live_guest_accepted', p_live_id);
      return 'accepted';
    elsif v_row.status = 'removed' then
      raise exception 'removed_by_host';
    elsif v_row.updated_at > now() - interval '60 seconds' then
      raise exception 'too_soon';                -- 'left', changed a moment ago
    end if;

    update public.live_guests
       set status = 'requested', updated_at = now()
     where live_id = p_live_id and user_id = v_me;
  else
    insert into public.live_guests (live_id, user_id, status)
    values (p_live_id, v_me, 'requested');
  end if;

  perform public.live_guest_notify(v_stream.host_id, v_me, 'live_join_request', p_live_id);
  return 'requested';
end;
$$;
revoke all on function public.request_to_join_live(uuid) from public, anon;
grant execute on function public.request_to_join_live(uuid) to authenticated;

-- ── 4. Host: invite a viewer ────────────────────────────────────────────

create or replace function public.invite_to_live(p_live_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_stream public.live_streams%rowtype;
  v_row    public.live_guests%rowtype;
  v_exists boolean;
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

  -- Only people actually in the room can be invited (see header).
  if not exists (select 1 from public.live_viewers
                  where live_id = p_live_id and user_id = p_user_id) then
    raise exception 'not_watching';
  end if;

  if v_exists then
    update public.live_guests
       set status = 'invited', updated_at = now()
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

-- ── 5. Invitee: accept or decline ───────────────────────────────────────

create or replace function public.respond_live_invite(p_live_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_stream public.live_streams%rowtype;
  v_row    public.live_guests%rowtype;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;

  select * into v_row from public.live_guests
   where live_id = p_live_id and user_id = v_me
   for update;
  if v_row.status is distinct from 'invited' then
    -- Accepting twice is harmless: report where things stand.
    if v_row.status = 'accepted' and coalesce(p_accept, false) then
      return 'accepted';
    end if;
    raise exception 'no_invitation';
  end if;

  if not coalesce(p_accept, false) then
    update public.live_guests
       set status = 'left', updated_at = now()
     where live_id = p_live_id and user_id = v_me;
    return 'left';                               -- declined; no notification
  end if;

  select * into v_stream from public.live_streams where id = p_live_id;
  if not found then raise exception 'live_not_found'; end if;
  if v_stream.status <> 'live' then raise exception 'live_not_live'; end if;
  if public.is_blocked_between(v_stream.host_id, v_me) then raise exception 'blocked'; end if;

  perform public.live_guest_promote(p_live_id, v_me);
  perform public.live_guest_notify(v_stream.host_id, v_me, 'live_guest_accepted', p_live_id);
  return 'accepted';
end;
$$;
revoke all on function public.respond_live_invite(uuid, boolean) from public, anon;
grant execute on function public.respond_live_invite(uuid, boolean) to authenticated;

-- ── 6. Host: approve a request ──────────────────────────────────────────

create or replace function public.approve_live_guest(p_live_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_stream public.live_streams%rowtype;
  v_row    public.live_guests%rowtype;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;

  select * into v_stream from public.live_streams where id = p_live_id;
  if not found then raise exception 'live_not_found'; end if;
  if v_stream.host_id <> v_me then raise exception 'not_host'; end if;
  if v_stream.status <> 'live' then raise exception 'live_not_live'; end if;

  select * into v_row from public.live_guests
   where live_id = p_live_id and user_id = p_user_id
   for update;
  if found and v_row.status = 'accepted' then return 'accepted'; end if;
  if not found or v_row.status <> 'requested' then raise exception 'no_request'; end if;

  -- A block made after the request was sent still counts.
  if public.is_blocked_between(v_me, p_user_id) then raise exception 'blocked'; end if;

  perform public.live_guest_promote(p_live_id, p_user_id);
  perform public.live_guest_notify(p_user_id, v_me, 'live_guest_approved', p_live_id);
  return 'accepted';
end;
$$;
revoke all on function public.approve_live_guest(uuid, uuid) from public, anon;
grant execute on function public.approve_live_guest(uuid, uuid) to authenticated;

-- ── 7. Host: remove a guest, cancel an invite, or turn down a request ──
-- Allowed whether or not the stream is still live: taking someone OFF stage
-- must never be refused.

create or replace function public.remove_live_guest(p_live_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_host   uuid;
  v_status text;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;

  select host_id into v_host from public.live_streams where id = p_live_id;
  if v_host is null then raise exception 'live_not_found'; end if;
  if v_host <> v_me then raise exception 'not_host'; end if;

  select status into v_status from public.live_guests
   where live_id = p_live_id and user_id = p_user_id
   for update;
  if v_status is null then raise exception 'not_on_stage'; end if;
  if v_status in ('removed', 'left') then return v_status; end if;

  update public.live_guests
     set status = 'removed', updated_at = now()
   where live_id = p_live_id and user_id = p_user_id;

  -- Only someone who was actually on stage is told; a declined request or a
  -- withdrawn invite is visible through realtime and needs no notification.
  if v_status = 'accepted' then
    perform public.live_guest_notify(p_user_id, v_me, 'live_guest_removed', p_live_id);
  end if;
  return 'removed';
end;
$$;
revoke all on function public.remove_live_guest(uuid, uuid) from public, anon;
grant execute on function public.remove_live_guest(uuid, uuid) to authenticated;

-- ── 8. Guest: leave the stage, withdraw a request, or decline an invite ─

create or replace function public.leave_live_stage(p_live_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_status text;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;

  select status into v_status from public.live_guests
   where live_id = p_live_id and user_id = v_me
   for update;
  if v_status is null then raise exception 'not_on_stage'; end if;
  if v_status in ('removed', 'left') then return v_status; end if;

  update public.live_guests
     set status = 'left', updated_at = now()
   where live_id = p_live_id and user_id = v_me;
  return 'left';
end;
$$;
revoke all on function public.leave_live_stage(uuid) from public, anon;
grant execute on function public.leave_live_stage(uuid) to authenticated;

-- ── 9. A stream that ends empties its stage ─────────────────────────────

create or replace function public.close_live_guests_on_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'live' and old.status = 'live' then
    update public.live_guests
       set status = 'left', updated_at = now()
     where live_id = new.id
       and status in ('requested', 'invited', 'accepted');
  end if;
  return null;
end;
$$;
revoke all on function public.close_live_guests_on_end() from public, anon, authenticated;

drop trigger if exists tr_close_live_guests_on_end on public.live_streams;
create trigger tr_close_live_guests_on_end
  after update of status on public.live_streams
  for each row execute function public.close_live_guests_on_end();

-- ── 10. Realtime: everyone in the room watches the stage ────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime'
                        and schemaname = 'public' and tablename = 'live_guests') then
    execute 'alter publication supabase_realtime add table public.live_guests';
  end if;
end $$;

commit;

-- ── Verification ─────────────────────────────────────────────────────────
-- Run after applying. Every row should read OK.
select 'live_guests table' as check,
       case when to_regclass('public.live_guests') is not null then 'OK' else 'MISSING' end as result
union all select 'rls enabled',
       case when (select relrowsecurity from pg_class where oid = 'public.live_guests'::regclass)
            then 'OK' else 'MISSING' end
union all select 'six RPCs',
       case when to_regprocedure('public.request_to_join_live(uuid)') is not null
             and to_regprocedure('public.invite_to_live(uuid,uuid)') is not null
             and to_regprocedure('public.respond_live_invite(uuid,boolean)') is not null
             and to_regprocedure('public.approve_live_guest(uuid,uuid)') is not null
             and to_regprocedure('public.remove_live_guest(uuid,uuid)') is not null
             and to_regprocedure('public.leave_live_stage(uuid)') is not null
            then 'OK' else 'MISSING' end
union all select 'notify helper not client-callable',
       case when not has_function_privilege('authenticated',
                   'public.live_guest_notify(uuid,uuid,text,uuid)', 'execute')
            then 'OK' else 'EXPOSED' end
union all select 'realtime',
       case when exists (select 1 from pg_publication_tables
                          where pubname = 'supabase_realtime' and tablename = 'live_guests')
            then 'OK' else 'MISSING (no supabase_realtime publication?)' end;
