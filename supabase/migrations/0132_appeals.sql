-- ============================================================
-- 0132_appeals.sql - appeals against a ban or a moderation action
--
-- The terms (site/terms.html, "What happens if you break the rules") promise:
--   "you can appeal in Settings, then Account status. Appeals are reviewed
--    by a person."
-- Nothing implemented that. This adds:
--
--   public.appeals                one row per appeal
--   my_account_status()           + banned, banned_until, ban_reason, so a
--                                   banned person's own app can show them
--                                   (0124 hid banned_until from authenticated)
--   my_appealable_items()         what the signed-in person can appeal:
--                                   an active ban, their hidden videos and
--                                   comments, their content an admin deleted
--                                   (video, comment, story, live comment) and
--                                   their live streams an admin ended as
--                                   'banned'. Each with its latest appeal.
--   appeals RLS                   owner inserts (validated + rate limited by a
--                                   trigger) and reads their own rows. No
--                                   update or delete for users.
--   admin_v2_appeal_counts()      badge / tab counts
--   admin_v2_list_appeals(status, limit, offset)
--   admin_v2_decide_appeal(appeal, accept, note)
--                                 accept -> lifts the ban (admin_v2_set_ban),
--                                 unhides the video/comment (admin_v2_set_hidden),
--                                 or moves a banned live to 'ended'; deleted
--                                 content cannot be restored and is recorded as
--                                 such. Reject requires a note. Both write
--                                 admin_logs and send the user an in-app
--                                 notification (type 'system', payload kind
--                                 'appeal_decided', outcome accepted|rejected).
--
-- Works while banned: a ban (profiles.banned_until) is enforced only by the
-- feed, upload and go-live paths. Nothing here checks it, so a banned person
-- can read their status and items and submit an appeal.
--
-- Rate limits (trigger, so they hold for any client):
--   * at most 3 OPEN appeals per person
--   * one OPEN appeal per target (also a partial unique index)
--   * once an appeal for a target is decided, no new appeal for that target
--     unless it was actioned again after the decision (a new ban, a new hide)
--
-- Apply after 0131 on the Mumbai project. Safe to re-run. Not applied yet.
-- NOTE: 0128's own VERIFY counts exactly 17 admin_v2_* functions; after this
-- (and 0130) that one row reads MISSING SOME on a re-run of 0128. Expected.
-- ============================================================

begin;

-- ── 1. Table ────────────────────────────────────────────────────────────
create table if not exists public.appeals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  target_type text not null,
  target_id   uuid not null,
  reason      text not null,
  status      text not null default 'open',
  admin_note  text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references public.profiles (id) on delete set null
);

alter table public.appeals drop constraint if exists appeals_kind_check;
alter table public.appeals add constraint appeals_kind_check
  check (kind in ('ban', 'content'));

alter table public.appeals drop constraint if exists appeals_target_type_check;
alter table public.appeals add constraint appeals_target_type_check
  check (target_type in ('user', 'video', 'comment', 'story', 'live_comment', 'live_stream'));

alter table public.appeals drop constraint if exists appeals_kind_target_check;
alter table public.appeals add constraint appeals_kind_target_check
  check ((kind = 'ban') = (target_type = 'user'));

alter table public.appeals drop constraint if exists appeals_status_check;
alter table public.appeals add constraint appeals_status_check
  check (status in ('open', 'accepted', 'rejected'));

alter table public.appeals drop constraint if exists appeals_reason_length;
alter table public.appeals add constraint appeals_reason_length
  check (char_length(btrim(reason)) between 1 and 1000);

alter table public.appeals drop constraint if exists appeals_note_length;
alter table public.appeals add constraint appeals_note_length
  check (admin_note is null or char_length(admin_note) <= 1000);

alter table public.appeals drop constraint if exists appeals_decided_check;
alter table public.appeals add constraint appeals_decided_check
  check ((status = 'open') = (decided_at is null));

create index if not exists idx_appeals_user_created on public.appeals (user_id, created_at desc);
create index if not exists idx_appeals_status_created on public.appeals (status, created_at);
create index if not exists idx_appeals_target on public.appeals (target_type, target_id);
create unique index if not exists uq_appeals_one_open_per_target
  on public.appeals (user_id, target_type, target_id) where status = 'open';

alter table public.appeals enable row level security;

revoke all on public.appeals from anon;
revoke update, delete, truncate on public.appeals from authenticated;
grant select, insert on public.appeals to authenticated;

drop policy if exists "appeals read own" on public.appeals;
create policy "appeals read own" on public.appeals
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "appeals insert own" on public.appeals;
create policy "appeals insert own" on public.appeals
  for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'open');


-- ── 2. When was this target actioned against this user? ────────────────
-- Null = there is nothing (any more) to appeal. Used by the insert trigger,
-- my_appealable_items() and the "decided already" rule.
create or replace function public.appeal_actioned_at(p_user uuid, p_type text, p_id uuid)
returns timestamptz
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_at timestamptz;
begin
  if p_type = 'user' then
    if p_id is distinct from p_user then return null; end if;
    if not exists (select 1 from public.profiles
                    where id = p_user and banned_until is not null and banned_until > now()) then
      return null;
    end if;
    select max(l.created_at) into v_at
      from public.admin_logs l
     where l.action = 'ban_user' and l.target_type = 'user' and l.target_id = p_user;
    -- A ban set without a log (old panel, SQL editor) counts as actioned at
    -- the epoch, so a decided appeal stays decided until a logged re-ban.
    return coalesce(v_at, 'epoch'::timestamptz);

  elsif p_type = 'video' then
    select coalesce(v.hidden_at, v.created_at) into v_at
      from public.videos v where v.id = p_id and v.user_id = p_user and v.is_hidden;
    if v_at is not null then return v_at; end if;

  elsif p_type = 'comment' then
    select coalesce(c.hidden_at, c.created_at) into v_at
      from public.comments c where c.id = p_id and c.user_id = p_user and c.is_hidden;
    if v_at is not null then return v_at; end if;

  elsif p_type = 'live_stream' then
    select coalesce(s.ended_at, s.started_at) into v_at
      from public.live_streams s where s.id = p_id and s.host_id = p_user and s.status = 'banned';
    return v_at;
  end if;

  -- Deleted by an admin (0128 admin_v2_delete_content logs the owner).
  if p_type in ('video', 'comment', 'story', 'live_comment') then
    select max(l.created_at) into v_at
      from public.admin_logs l
     where l.action = 'delete_' || p_type
       and l.target_type = p_type
       and l.target_id = p_id
       and l.payload ->> 'owner' = p_user::text;
  end if;
  return v_at;
end;
$fn$;
revoke all on function public.appeal_actioned_at(uuid, text, uuid) from public, anon, authenticated;


-- ── 3. Insert guard: validate, normalise, rate limit ───────────────────
create or replace function public.appeals_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actioned timestamptz;
  v_open     integer;
begin
  -- A request from the app always appeals for its own account (RLS checks it
  -- too). Service role / SQL editor inserts (no auth.uid()) keep user_id.
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  if new.user_id is null then raise exception 'not signed in' using errcode = '42501'; end if;

  new.status     := 'open';
  new.admin_note := null;
  new.decided_at := null;
  new.decided_by := null;
  new.created_at := now();
  new.reason     := btrim(coalesce(new.reason, ''));
  new.kind       := case when new.target_type = 'user' then 'ban' else 'content' end;

  if char_length(new.reason) < 1 then raise exception 'appeal_reason_required'; end if;
  if char_length(new.reason) > 1000 then raise exception 'appeal_reason_too_long'; end if;

  -- One at a time per person, so two quick taps cannot both pass the count.
  perform pg_advisory_xact_lock(hashtext('appeals:' || new.user_id::text));

  v_actioned := public.appeal_actioned_at(new.user_id, new.target_type, new.target_id);
  if v_actioned is null then raise exception 'appeal_not_eligible'; end if;

  if exists (select 1 from public.appeals a
              where a.user_id = new.user_id and a.target_type = new.target_type
                and a.target_id = new.target_id and a.status = 'open') then
    raise exception 'appeal_already_open';
  end if;

  if exists (select 1 from public.appeals a
              where a.user_id = new.user_id and a.target_type = new.target_type
                and a.target_id = new.target_id and a.status <> 'open'
                and a.decided_at >= v_actioned) then
    raise exception 'appeal_already_decided';
  end if;

  select count(*) into v_open from public.appeals a
   where a.user_id = new.user_id and a.status = 'open';
  if v_open >= 3 then raise exception 'appeal_limit_open'; end if;

  return new;
end;
$fn$;
revoke all on function public.appeals_before_insert() from public, anon, authenticated;

drop trigger if exists tr_appeals_before_insert on public.appeals;
create trigger tr_appeals_before_insert
  before insert on public.appeals
  for each row execute function public.appeals_before_insert();


-- ── 4. Own status, now with the ban ────────────────────────────────────
-- 0034's keys unchanged; banned / banned_until / ban_reason added. Answers
-- only for auth.uid(), like before.
create or replace function public.my_account_status()
returns jsonb
language sql
security definer
stable
set search_path = public
as $fn$
  select jsonb_build_object(
    'deactivated',      (p.deactivated_at is not null),
    'deactivated_at',   p.deactivated_at,
    'deletion_scheduled_at', p.deletion_scheduled_at,
    'days_left', case
      when p.deletion_scheduled_at is null then null
      else greatest(0, ceil(extract(epoch from (p.deletion_scheduled_at - now())) / 86400))
    end,
    'banned',       (p.banned_until is not null and p.banned_until > now()),
    'banned_until', case when p.banned_until > now() then p.banned_until end,
    'ban_reason',   case when p.banned_until > now() then (
                      select nullif(btrim(l.payload ->> 'reason'), '')
                        from public.admin_logs l
                       where l.action = 'ban_user' and l.target_type = 'user' and l.target_id = p.id
                       order by l.created_at desc limit 1) end
  )
  from public.profiles p
  where p.id = auth.uid();
$fn$;
revoke all on function public.my_account_status() from public, anon;
grant execute on function public.my_account_status() to authenticated;


-- ── 5. What can I appeal? ──────────────────────────────────────────────
-- A jsonb array, newest first. Each item:
--   { kind, target_type, target_id, actioned_at, reason, preview, appeal }
-- preview: { text?, thumbnail?, deleted? }    appeal: latest appeal row or null
-- Covers the last 180 days of hides, deletions and ended lives.
create or replace function public.my_appealable_items()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_me    uuid := auth.uid();
  v_since timestamptz := now() - interval '180 days';
  v_items jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;

  with raw as (
    -- An active ban.
    select 'ban'::text as kind, 'user'::text as target_type, p.id as target_id,
           public.appeal_actioned_at(p.id, 'user', p.id) as actioned_at,
           (select nullif(btrim(l.payload ->> 'reason'), '') from public.admin_logs l
             where l.action = 'ban_user' and l.target_type = 'user' and l.target_id = p.id
             order by l.created_at desc limit 1) as reason,
           jsonb_build_object('until', p.banned_until) as preview
      from public.profiles p
     where p.id = v_me and p.banned_until is not null and p.banned_until > now()

    union all
    -- Hidden videos (by an admin or by the report threshold).
    select 'content', 'video', v.id, coalesce(v.hidden_at, v.created_at), v.hidden_reason,
           jsonb_build_object('text', left(coalesce(v.description, ''), 200), 'thumbnail', v.thumbnail)
      from public.videos v
     where v.user_id = v_me and v.is_hidden and coalesce(v.hidden_at, v.created_at) >= v_since

    union all
    select 'content', 'comment', c.id, coalesce(c.hidden_at, c.created_at), c.hidden_reason,
           jsonb_build_object('text', left(c.text, 200))
      from public.comments c
     where c.user_id = v_me and c.is_hidden and coalesce(c.hidden_at, c.created_at) >= v_since

    union all
    -- Live streams an admin ended (status 'banned').
    select 'content', 'live_stream', s.id, coalesce(s.ended_at, s.started_at),
           (select nullif(btrim(l.payload ->> 'reason'), '') from public.admin_logs l
             where l.action = 'end_live' and l.target_id = s.id
             order by l.created_at desc limit 1),
           jsonb_build_object('text', left(coalesce(s.title, ''), 200), 'thumbnail', s.thumbnail)
      from public.live_streams s
     where s.host_id = v_me and s.status = 'banned' and coalesce(s.ended_at, s.started_at) >= v_since

    union all
    -- Deleted by an admin: the row is gone, the log remains.
    select 'content', l.target_type, l.target_id, l.created_at,
           nullif(btrim(l.payload ->> 'reason'), ''),
           jsonb_build_object('deleted', true)
      from public.admin_logs l
     where l.action in ('delete_video', 'delete_comment', 'delete_story', 'delete_live_comment')
       and l.payload ->> 'owner' = v_me::text
       and l.created_at >= v_since
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', r.kind,
           'target_type', r.target_type,
           'target_id', r.target_id,
           'actioned_at', r.actioned_at,
           'reason', r.reason,
           'preview', r.preview,
           'appeal', (select jsonb_build_object('id', a.id, 'status', a.status, 'admin_note', a.admin_note,
                                                'created_at', a.created_at, 'decided_at', a.decided_at)
                        from public.appeals a
                       where a.user_id = v_me and a.target_type = r.target_type and a.target_id = r.target_id
                       order by a.created_at desc limit 1)
         ) order by (r.kind = 'ban') desc, r.actioned_at desc), '[]'::jsonb)
    into v_items
    from (select distinct on (target_type, target_id) * from raw
           where actioned_at is not null
           order by target_type, target_id, actioned_at desc) r;

  return v_items;
end;
$fn$;
revoke all on function public.my_appealable_items() from public, anon;
grant execute on function public.my_appealable_items() to authenticated;


-- ── 6. Admin: counts, list, decide ─────────────────────────────────────
drop function if exists public.admin_v2_appeal_counts();
create function public.admin_v2_appeal_counts()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  return jsonb_build_object(
    'open',     (select count(*) from public.appeals where status = 'open'),
    'accepted', (select count(*) from public.appeals where status = 'accepted'),
    'rejected', (select count(*) from public.appeals where status = 'rejected'),
    'oldest_open_at', (select min(created_at) from public.appeals where status = 'open')
  );
end;
$fn$;

-- The target as it is NOW, for the detail drawer.
create or replace function public.appeal_target_snapshot(p_user uuid, p_type text, p_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v jsonb;
begin
  if p_type = 'user' then
    select jsonb_build_object('exists', true, 'banned_until', p.banned_until,
             'still_actioned', (p.banned_until is not null and p.banned_until > now()),
             'ban_reason', (select l.payload ->> 'reason' from public.admin_logs l
                             where l.action = 'ban_user' and l.target_id = p.id
                             order by l.created_at desc limit 1),
             'banned_at', (select max(l.created_at) from public.admin_logs l
                            where l.action = 'ban_user' and l.target_id = p.id))
      into v from public.profiles p where p.id = p_id;
  elsif p_type = 'video' then
    select jsonb_build_object('exists', true, 'still_actioned', x.is_hidden,
             'description', x.description, 'thumbnail', x.thumbnail, 'video_url', x.video_url,
             'hidden_at', x.hidden_at, 'hidden_reason', x.hidden_reason, 'created_at', x.created_at)
      into v from public.videos x where x.id = p_id;
  elsif p_type = 'comment' then
    select jsonb_build_object('exists', true, 'still_actioned', x.is_hidden,
             'text', x.text, 'video_id', x.video_id,
             'hidden_at', x.hidden_at, 'hidden_reason', x.hidden_reason, 'created_at', x.created_at)
      into v from public.comments x where x.id = p_id;
  elsif p_type = 'live_stream' then
    select jsonb_build_object('exists', true, 'still_actioned', (x.status = 'banned'),
             'title', x.title, 'thumbnail', x.thumbnail, 'status', x.status,
             'started_at', x.started_at, 'ended_at', x.ended_at)
      into v from public.live_streams x where x.id = p_id;
  elsif p_type = 'story' then
    select jsonb_build_object('exists', true, 'still_actioned', false,
             'media_url', x.media_url, 'poster_url', x.poster_url, 'caption', x.caption)
      into v from public.stories x where x.id = p_id;
  elsif p_type = 'live_comment' then
    select jsonb_build_object('exists', true, 'still_actioned', false, 'text', x.text)
      into v from public.live_comments x where x.id = p_id;
  end if;

  if v is null then
    -- Deleted: what the deletion log says.
    select jsonb_build_object('exists', false, 'still_actioned', true, 'deleted', true,
             'deleted_at', l.created_at, 'delete_reason', l.payload ->> 'reason')
      into v
      from public.admin_logs l
     where l.action = 'delete_' || p_type and l.target_id = p_id
     order by l.created_at desc limit 1;
  end if;
  return coalesce(v, jsonb_build_object('exists', false, 'still_actioned', false));
end;
$fn$;
revoke all on function public.appeal_target_snapshot(uuid, text, uuid) from public, anon, authenticated;

drop function if exists public.admin_v2_list_appeals(text, integer, integer);
create function public.admin_v2_list_appeals(
  p_status text    default 'open',
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, user_id uuid, user_handle text, user_name text, user_avatar_url text,
  user_banned_until timestamptz, user_appeals_total bigint,
  kind text, target_type text, target_id uuid, reason text, status text, admin_note text,
  created_at timestamptz, decided_at timestamptz, decided_by uuid, decided_by_handle text,
  target jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $fn$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  return query
  select a.id, a.user_id, u.handle, u.name, u.avatar_url, u.banned_until,
         (select count(*) from public.appeals a2 where a2.user_id = a.user_id),
         a.kind, a.target_type, a.target_id, a.reason, a.status, a.admin_note,
         a.created_at, a.decided_at, a.decided_by, d.handle,
         public.appeal_target_snapshot(a.user_id, a.target_type, a.target_id)
    from public.appeals a
    left join public.profiles u on u.id = a.user_id
    left join public.profiles d on d.id = a.decided_by
   where coalesce(p_status, 'all') = 'all' or a.status = p_status
   -- The open queue is worked oldest first; decided tabs show the latest.
   order by case when p_status = 'open' then extract(epoch from a.created_at) else -extract(epoch from coalesce(a.decided_at, a.created_at)) end
   limit greatest(1, least(coalesce(p_limit, 50), 200))
   offset greatest(0, coalesce(p_offset, 0));
end;
$fn$;

drop function if exists public.admin_v2_decide_appeal(uuid, boolean, text);
create function public.admin_v2_decide_appeal(p_appeal uuid, p_accept boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  a          public.appeals%rowtype;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_outcome  text := case when p_accept then 'accepted' else 'rejected' end;
  v_restored text := 'none';
  v_title    text;
  v_body     text;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_accept is null then raise exception 'accept must be true or false'; end if;
  if not p_accept and v_note is null then raise exception 'a note is required to reject an appeal'; end if;
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'note too long (max 1000)'; end if;

  select * into a from public.appeals where id = p_appeal for update;
  if not found then raise exception 'not found'; end if;
  if a.status <> 'open' then raise exception 'appeal already decided'; end if;

  if p_accept then
    if a.target_type = 'user' then
      if exists (select 1 from public.profiles where id = a.user_id and banned_until > now()) then
        perform public.admin_v2_set_ban(a.user_id, null, 'appeal accepted' || coalesce(': ' || v_note, ''));
        v_restored := 'unbanned';
      end if;
    elsif a.target_type = 'video' then
      if exists (select 1 from public.videos where id = a.target_id and is_hidden) then
        perform public.admin_v2_set_hidden('video', a.target_id, false, 'appeal accepted');
        v_restored := 'unhidden';
      elsif not exists (select 1 from public.videos where id = a.target_id) then
        v_restored := 'deleted_cannot_restore';
      end if;
    elsif a.target_type = 'comment' then
      if exists (select 1 from public.comments where id = a.target_id and is_hidden) then
        perform public.admin_v2_set_hidden('comment', a.target_id, false, 'appeal accepted');
        v_restored := 'unhidden';
      elsif not exists (select 1 from public.comments where id = a.target_id) then
        v_restored := 'deleted_cannot_restore';
      end if;
    elsif a.target_type = 'live_stream' then
      -- A live cannot be re-opened; 'ended' puts it back in the host's
      -- history (and lifts the 'banned' mark the "live read" policy hides).
      update public.live_streams set status = 'ended', ended_at = coalesce(ended_at, now())
       where id = a.target_id and status = 'banned';
      if found then
        v_restored := 'live_unbanned';
        insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
        values (auth.uid(), 'unban_live', 'live_stream', a.target_id,
                jsonb_build_object('reason', 'appeal accepted', 'appeal', a.id));
      end if;
    else
      -- story / live_comment: only ever deleted, nothing to bring back.
      v_restored := 'deleted_cannot_restore';
    end if;
  end if;

  update public.appeals
     set status = v_outcome, admin_note = v_note, decided_at = now(), decided_by = auth.uid()
   where id = a.id;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'appeal_' || v_outcome, 'appeal', a.id,
          jsonb_build_object('user', a.user_id, 'kind', a.kind, 'target_type', a.target_type,
                             'target_id', a.target_id, 'note', v_note, 'restored', v_restored));

  -- In-app notice. Title Arabic, body English, like payout_notify (0130):
  -- the app's generic system row shows "title — body" for a kind it does not
  -- render itself yet.
  if p_accept then
    v_title := 'تم قبول اعتراضك';
    v_body  := case a.kind when 'ban' then 'Your appeal was accepted. Your account is no longer suspended.'
                           else 'Your appeal was accepted.' end;
  else
    v_title := 'تم رفض اعتراضك';
    v_body  := 'Your appeal was reviewed and the decision stands.';
  end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  values (a.user_id, null, 'system',
          jsonb_build_object('kind', 'appeal_decided', 'outcome', v_outcome,
                             'appeal_id', a.id, 'appeal_kind', a.kind,
                             'target_type', a.target_type, 'target_id', a.target_id,
                             'restored', v_restored, 'note', v_note,
                             'title', v_title, 'body', v_body));

  return jsonb_build_object('id', a.id, 'status', v_outcome, 'restored', v_restored);
end;
$fn$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_v2_appeal_counts()',
    'public.admin_v2_list_appeals(text, integer, integer)',
    'public.admin_v2_decide_appeal(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'appeals table with RLS' as check,
       case when exists (select 1 from pg_class
                          where oid = 'public.appeals'::regclass and relrowsecurity)
            then 'OK' else 'MISSING' end as result
union all
select 'appeals: owner read + insert policies only',
       case when (select count(*) from pg_policy where polrelid = 'public.appeals'::regclass) = 2
             and exists (select 1 from pg_policy where polrelid = 'public.appeals'::regclass and polname = 'appeals read own')
             and exists (select 1 from pg_policy where polrelid = 'public.appeals'::regclass and polname = 'appeals insert own')
            then 'OK' else 'CHECK' end
union all
select 'appeals: users cannot update or delete',
       case when not has_table_privilege('authenticated', 'public.appeals', 'update')
             and not has_table_privilege('authenticated', 'public.appeals', 'delete')
             and not has_table_privilege('anon', 'public.appeals', 'select')
            then 'OK' else 'EXPOSED' end
union all
select 'appeals insert trigger',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.appeals'::regclass and tgname = 'tr_appeals_before_insert'
                            and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'one open appeal per target (unique index)',
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public' and indexname = 'uq_appeals_one_open_per_target')
            then 'OK' else 'MISSING' end
union all
select 'my_account_status reports bans',
       case when pg_get_functiondef('public.my_account_status()'::regprocedure) like '%banned_until%'
            then 'OK' else 'OLD VERSION' end
union all
select 'user RPCs callable by authenticated, not anon',
       case when has_function_privilege('authenticated', 'public.my_appealable_items()', 'execute')
             and has_function_privilege('authenticated', 'public.my_account_status()', 'execute')
             and not has_function_privilege('anon', 'public.my_appealable_items()', 'execute')
            then 'OK' else 'CHECK' end
union all
select 'helpers not callable from the API',
       case when not has_function_privilege('authenticated', 'public.appeal_actioned_at(uuid, text, uuid)', 'execute')
             and not has_function_privilege('authenticated', 'public.appeal_target_snapshot(uuid, text, uuid)', 'execute')
            then 'OK' else 'EXPOSED' end
union all
select 'admin appeal RPCs: SECURITY DEFINER, check is_admin(), not anon',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('admin_v2_appeal_counts', 'admin_v2_list_appeals', 'admin_v2_decide_appeal')
                     and p.prosecdef
                     and pg_get_functiondef(p.oid) like '%is_admin()%'
                     and not has_function_privilege('anon', p.oid, 'execute')) = 3
            then 'OK' else 'CHECK' end
order by 1;

-- Behavioural test (through the API):
--   as a banned user B:   rpc('my_account_status') -> banned true, banned_until set
--                         rpc('my_appealable_items') -> [{kind:'ban', ...}]
--                         insert appeals {target_type:'user', target_id:B, reason:'...'} -> ok
--                         same insert again -> error appeal_already_open
--   as an ordinary user:  insert appeals for someone else's video -> appeal_not_eligible
--                         rpc('admin_v2_list_appeals') -> 42501 not permitted
--   as an admin:          rpc('admin_v2_decide_appeal', {p_appeal, p_accept:true}) ->
--                         B unbanned, admin_logs rows unban_user + appeal_accepted,
--                         B gets a notifications row kind 'appeal_decided'.
