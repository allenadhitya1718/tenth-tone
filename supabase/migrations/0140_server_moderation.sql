-- 0140 - moderation enforced by the server (F11 completed)
--
-- Security review 2026-10, finding F11. Apply after 0139. Safe to re-run.
-- Deploy the updated moderate-content function (it gains a server-side
-- "screen this stored row" mode) -- see the end of this file.
--
-- ============================================================
-- WHAT CHANGES
-- ============================================================
-- Before: the app asked moderate-content before writing a video/comment. A
-- modified client could simply skip the call.
--
-- Now the DATABASE enforces it, for every client:
--   1. A new video, story or comment written by an ordinary user (role
--      authenticated/anon, not an admin) is stored HIDDEN with
--      hidden_reason = 'pending_review'. The author still sees it (RLS: own
--      rows); nobody else does, and feeds/lists already filter is_hidden.
--      A draft is not public, so it is screened when it is PUBLISHED
--      (is_draft true -> false).
--   2. An AFTER INSERT trigger records a row in content_screening and calls
--      moderate-content through pg_net with the row's screening id and the
--      shared job secret. The function screens the stored text (+ poster
--      image) with Gemini under the SAME per-user limits as before
--      (edge_rate_take 'moderate_content', 150/hour, 1000/day) and calls
--      screening_finish():
--         allow       -> row released
--         review      -> row released + admin queue entry (reports)
--         block       -> row STAYS hidden ('moderation_block') + queue entry
--         unavailable -> row stays hidden, retried by the sweeper
--   3. Failure policy: screening_sweep() runs every minute. A row still
--      unscreened after screening_config.timeout_minutes (default 5) is
--      RELEASED ("ok by timeout", so the app never blocks users when Gemini
--      is down) and an admin queue entry + moderation_events 'unavailable'
--      row is written so a human looks at it.
--   4. Edits: changing a published video's description/media, or a story's
--      caption, is re-screened in place (not hidden first); a block hides it.
--   5. Comment and mention notifications (which carry an 80 character
--      snippet) are held back while a comment/video is pending and sent when
--      it is released.
--
-- Not touched: existing rows (nothing is back-filled or hidden by this
-- migration), private surfaces (messages, groups), live titles/covers and
-- profile text/avatars (still client-screened; see SECURITY_AUDIT.md).
-- Kill switch: update public.screening_config set enabled = false;  (new rows
-- are no longer hidden and the sweeper releases everything pending.)

begin;

-- ── configuration ───────────────────────────────────────────────────────
create table if not exists public.screening_config (
  id              boolean primary key default true check (id),
  enabled         boolean not null default true,
  timeout_minutes integer not null default 5 check (timeout_minutes between 1 and 120),
  max_attempts    integer not null default 3 check (max_attempts between 1 and 10),
  sweep_batch     integer not null default 100 check (sweep_batch between 1 and 1000),
  updated_at      timestamptz not null default now()
);
insert into public.screening_config (id) values (true) on conflict (id) do nothing;
alter table public.screening_config enable row level security;
revoke all on public.screening_config from public, anon, authenticated;

create or replace function public.screening_enabled()
returns boolean
language sql
security definer
stable
set search_path = public
as $$ select coalesce((select enabled from public.screening_config where id), true) $$;
revoke all on function public.screening_enabled() from public, anon;
grant execute on function public.screening_enabled() to authenticated, service_role;

-- ── the ledger of screenings ────────────────────────────────────────────
create table if not exists public.content_screening (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('video', 'story', 'comment')),
  target_id       uuid not null,
  user_id         uuid,
  status          text not null default 'pending'
                  check (status in ('pending', 'ok', 'review', 'blocked', 'unavailable', 'released_timeout', 'skipped')),
  rescreen        boolean not null default false,   -- an edit of visible content (nothing was hidden first)
  reason          text,
  attempts        integer not null default 0,
  last_attempt_at timestamptz,
  event_id        uuid,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);
create index if not exists idx_content_screening_open
  on public.content_screening (created_at) where status in ('pending', 'unavailable');
create index if not exists idx_content_screening_target
  on public.content_screening (kind, target_id);
alter table public.content_screening enable row level security;
revoke all on public.content_screening from public, anon, authenticated;

-- ── stories get the same moderation columns videos and comments have ───
alter table public.stories add column if not exists is_hidden     boolean not null default false;
alter table public.stories add column if not exists hidden_at     timestamptz;
alter table public.stories add column if not exists hidden_reason text;

drop policy if exists "stories read visible" on public.stories;
create policy "stories read visible" on public.stories
  for select to authenticated using (
    expires_at > now()
    and is_hidden = false
    and public.can_view_story(user_id, audience, (select auth.uid()))
  );

-- ── dispatch: one pg_net call to moderate-content ───────────────────────
create or replace function public.screening_dispatch(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_schema text := public.pg_net_schema();
  v_ep     public.job_endpoints%rowtype;
  v_url    text;
begin
  if v_schema is null then return 'pg_net not enabled'; end if;
  select * into v_ep from public.job_endpoints where name = 'send-push';
  if not found or coalesce(v_ep.url, '') not like '%/send-push' then return 'no endpoint'; end if;
  if not (v_ep.headers ? 'x-reconcile-secret') then return 'no secret'; end if;
  v_url := replace(v_ep.url, '/send-push', '/moderate-content');

  update public.content_screening
     set attempts = attempts + 1, last_attempt_at = now()
   where id = p_id;

  -- 30 s: the function may spend up to ~20 s on Gemini with an image.
  execute format('select %I.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)', v_schema)
    using v_url, jsonb_build_object('screening_id', p_id),
          v_ep.headers || jsonb_build_object('Content-Type', 'application/json');
  return 'queued';
exception when others then
  return 'dispatch failed: ' || sqlerrm;   -- the sweeper's timeout is the safety net
end;
$fn$;
revoke all on function public.screening_dispatch(uuid) from public, anon, authenticated;

create or replace function public.screening_open(p_kind text, p_target uuid, p_user uuid, p_rescreen boolean)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_id uuid;
begin
  insert into public.content_screening (kind, target_id, user_id, rescreen)
  values (p_kind, p_target, p_user, coalesce(p_rescreen, false))
  returning id into v_id;
  perform public.screening_dispatch(v_id);
exception when others then
  -- Screening bookkeeping must never fail the post itself.
  raise warning 'screening_open failed: %', sqlerrm;
end;
$fn$;
revoke all on function public.screening_open(text, uuid, uuid, boolean) from public, anon, authenticated;

-- ── notifications held while pending, emitted on release ───────────────
create or replace function public.emit_comment_notifications(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c             public.comments%rowtype;
  owner_id      uuid;
  parent_author uuid;
begin
  select * into c from public.comments where id = p_id;
  if not found then return; end if;
  select user_id into owner_id from public.videos where id = c.video_id;
  if c.parent_id is not null then
    select user_id into parent_author from public.comments where id = c.parent_id;
  end if;
  if parent_author is not null and parent_author <> c.user_id then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (parent_author, c.user_id, 'comment',
            jsonb_build_object('video_id', c.video_id, 'comment_id', c.id,
                               'parent_id', c.parent_id, 'text', left(c.text, 80)));
  end if;
  if owner_id is not null and owner_id <> c.user_id and owner_id is distinct from parent_author then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (owner_id, c.user_id, 'comment',
            jsonb_build_object('video_id', c.video_id, 'comment_id', c.id, 'text', left(c.text, 80)));
  end if;
end;
$fn$;
revoke all on function public.emit_comment_notifications(uuid) from public, anon, authenticated;

create or replace function public.emit_comment_mentions(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c         public.comments%rowtype;
  v_handles text[];
  v_owner   uuid;
  r         record;
begin
  select * into c from public.comments where id = p_id;
  if not found then return; end if;
  v_handles := public.extract_handles(c.text);
  if array_length(v_handles, 1) is null then return; end if;
  select user_id into v_owner from public.videos where id = c.video_id;
  for r in
    select p.id from public.profiles p
     where lower(p.handle) = any (v_handles) and p.id is distinct from v_owner
  loop
    if public.may_tag(r.id, c.user_id) then
      insert into public.notifications (user_id, actor_id, type, payload)
      values (r.id, c.user_id, 'mention',
              jsonb_build_object('video_id', c.video_id, 'comment_id', c.id,
                                 'text', left(coalesce(c.text, ''), 80)));
    end if;
  end loop;
end;
$fn$;
revoke all on function public.emit_comment_mentions(uuid) from public, anon, authenticated;

create or replace function public.emit_video_mentions(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v         public.videos%rowtype;
  v_handles text[];
  r         record;
begin
  select * into v from public.videos where id = p_id;
  if not found then return; end if;
  v_handles := public.extract_handles(v.description);
  if array_length(v_handles, 1) is not null then
    for r in select p.id from public.profiles p where lower(p.handle) = any (v_handles) loop
      if public.may_tag(r.id, v.user_id) then
        insert into public.notifications (user_id, actor_id, type, payload)
        values (r.id, v.user_id, 'mention',
                jsonb_build_object('video_id', v.id, 'text', left(coalesce(v.description, ''), 80)));
      end if;
    end loop;
  end if;
  -- Tag notifications were skipped while the video was hidden.
  for r in select user_id from public.video_tags where video_id = v.id loop
    if public.may_tag_in_post(r.user_id, v.user_id) then
      perform public.notify_video_tag(v.id, r.user_id);
    end if;
  end loop;
end;
$fn$;
revoke all on function public.emit_video_mentions(uuid) from public, anon, authenticated;

-- The three existing triggers now stand aside while the row is pending.
create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(new.is_hidden, false) then return new; end if;
  perform public.emit_comment_notifications(new.id);
  return new;
end;
$fn$;

create or replace function public.notify_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(new.is_hidden, false) then return new; end if;
  perform public.emit_comment_mentions(new.id);
  return new;
end;
$fn$;

create or replace function public.notify_video_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_handles text[];
  v_old     text[] := array[]::text[];
  r         record;
begin
  -- A new video that is pending review notifies on release (emit_video_mentions).
  if tg_op = 'INSERT' and coalesce(new.is_hidden, false) then return new; end if;

  v_handles := public.extract_handles(new.description);
  if array_length(v_handles, 1) is null then return new; end if;
  if tg_op = 'UPDATE' then
    v_old := public.extract_handles(old.description);
  end if;
  for r in
    select p.id from public.profiles p
     where lower(p.handle) = any (v_handles) and not (lower(p.handle) = any (v_old))
  loop
    if public.may_tag(r.id, new.user_id) then
      insert into public.notifications (user_id, actor_id, type, payload)
      values (r.id, new.user_id, 'mention',
              jsonb_build_object('video_id', new.id, 'text', left(coalesce(new.description, ''), 80)));
    end if;
  end loop;
  return new;
end;
$fn$;

-- ── release / hide ──────────────────────────────────────────────────────
create or replace function public.screening_release_target(p_kind text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare n integer := 0;
begin
  if p_kind = 'video' then
    update public.videos set is_hidden = false, hidden_at = null, hidden_reason = null
     where id = p_id and is_hidden and hidden_reason = 'pending_review';
    get diagnostics n = row_count;
    if n > 0 then perform public.emit_video_mentions(p_id); end if;
  elsif p_kind = 'comment' then
    update public.comments set is_hidden = false, hidden_at = null, hidden_reason = null
     where id = p_id and is_hidden and hidden_reason = 'pending_review';
    get diagnostics n = row_count;
    if n > 0 then
      perform public.emit_comment_notifications(p_id);
      perform public.emit_comment_mentions(p_id);
    end if;
  elsif p_kind = 'story' then
    update public.stories set is_hidden = false, hidden_at = null, hidden_reason = null
     where id = p_id and is_hidden and hidden_reason = 'pending_review';
    get diagnostics n = row_count;
  end if;
  return n > 0;
end;
$fn$;
revoke all on function public.screening_release_target(text, uuid) from public, anon, authenticated;

create or replace function public.screening_hide_target(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_kind = 'video' then
    update public.videos set is_hidden = true, hidden_at = coalesce(hidden_at, now()), hidden_reason = 'moderation_block'
     where id = p_id and (not is_hidden or hidden_reason = 'pending_review');
  elsif p_kind = 'comment' then
    update public.comments set is_hidden = true, hidden_at = coalesce(hidden_at, now()), hidden_reason = 'moderation_block'
     where id = p_id and (not is_hidden or hidden_reason = 'pending_review');
  elsif p_kind = 'story' then
    update public.stories set is_hidden = true, hidden_at = coalesce(hidden_at, now()), hidden_reason = 'moderation_block'
     where id = p_id and (not is_hidden or hidden_reason = 'pending_review');
  end if;
end;
$fn$;
revoke all on function public.screening_hide_target(text, uuid) from public, anon, authenticated;

create or replace function public.screening_queue_report(p_kind text, p_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare v_report uuid;
begin
  if exists (select 1 from public.reports
              where target_type = p_kind and target_id = p_id and reporter_id is null and status = 'pending') then
    return null;
  end if;
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (null, p_kind, p_id, p_reason)
  returning id into v_report;
  return v_report;
end;
$fn$;
revoke all on function public.screening_queue_report(text, uuid, text) from public, anon, authenticated;

-- ── what the Edge Function reads ────────────────────────────────────────
create or replace function public.screening_get(p_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  s public.content_screening%rowtype;
  v_text text; v_user uuid; v_images jsonb := '[]'::jsonb;
  vd public.videos%rowtype; cm public.comments%rowtype; st public.stories%rowtype;
begin
  select * into s from public.content_screening where id = p_id;
  if not found then return null; end if;

  if s.kind = 'video' then
    select * into vd from public.videos where id = s.target_id;
    if found then
      v_text := vd.description; v_user := vd.user_id;
      if coalesce(vd.thumbnail, '') <> '' then v_images := jsonb_build_array(vd.thumbnail); end if;
    end if;
  elsif s.kind = 'comment' then
    select * into cm from public.comments where id = s.target_id;
    if found then v_text := cm.text; v_user := cm.user_id; end if;
  elsif s.kind = 'story' then
    select * into st from public.stories where id = s.target_id;
    if found then
      v_text := st.caption; v_user := st.user_id;
      if coalesce(st.poster_url, '') <> '' then v_images := jsonb_build_array(st.poster_url);
      elsif st.media_kind = 'image' and coalesce(st.media_url, '') <> '' then v_images := jsonb_build_array(st.media_url);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'target_id', s.target_id, 'status', s.status, 'rescreen', s.rescreen,
    'user_id', coalesce(v_user, s.user_id), 'text', coalesce(v_text, ''), 'image_urls', v_images,
    'target_found', v_user is not null);
end;
$fn$;
revoke all on function public.screening_get(uuid) from public, anon, authenticated;
grant execute on function public.screening_get(uuid) to service_role;

-- ── the verdict ─────────────────────────────────────────────────────────
create or replace function public.screening_finish(
  p_id uuid, p_outcome text, p_event_id uuid default null, p_reason text default null,
  p_category text default null, p_score numeric default null
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  s public.content_screening%rowtype;
  v_status text;
  v_report uuid;
  v_text   text;
begin
  select * into s from public.content_screening where id = p_id for update;
  if not found then return 'not_found'; end if;
  if s.status not in ('pending', 'unavailable') then return 'already_' || s.status; end if;

  if p_outcome = 'unavailable' then
    update public.content_screening set status = 'unavailable', reason = p_reason,
           event_id = coalesce(p_event_id, event_id)
     where id = p_id;
    return 'unavailable';
  end if;

  if p_outcome in ('allow', 'skipped') then
    v_status := case when p_outcome = 'allow' then 'ok' else 'skipped' end;
    perform public.screening_release_target(s.kind, s.target_id);

  elsif p_outcome = 'review' then
    v_status := 'review';
    perform public.screening_release_target(s.kind, s.target_id);
    v_text := 'فحص تلقائي: قد يحتوي على '
              || coalesce(public.moderation_category_ar(p_category), 'محتوى مخالف')
              || ' (درجة ' || coalesce(round(p_score, 2)::text, '-') || ')';
    v_report := public.screening_queue_report(s.kind, s.target_id, v_text);

  elsif p_outcome = 'block' then
    v_status := 'blocked';
    perform public.screening_hide_target(s.kind, s.target_id);
    v_text := 'فحص تلقائي (محجوب): ' || coalesce(public.moderation_category_ar(p_category), 'محتوى مخالف')
              || ' (درجة ' || coalesce(round(p_score, 2)::text, '-') || ')';
    v_report := public.screening_queue_report(s.kind, s.target_id, v_text);
  else
    return 'bad_outcome';
  end if;

  update public.content_screening
     set status = v_status, reason = p_reason, event_id = p_event_id, decided_at = now()
   where id = p_id;

  if p_event_id is not null then
    update public.moderation_events
       set target_type = s.kind, target_id = s.target_id, report_id = coalesce(v_report, report_id)
     where id = p_event_id;
  end if;
  return v_status;
end;
$fn$;
revoke all on function public.screening_finish(uuid, text, uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.screening_finish(uuid, text, uuid, text, text, numeric) to service_role;

-- ── the sweeper: retries, then the failure policy ──────────────────────
create or replace function public.screening_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  cfg   public.screening_config%rowtype;
  s     public.content_screening%rowtype;
  v_ev  uuid;
  n_release integer := 0; n_retry integer := 0; n_timeout integer := 0;
begin
  select * into cfg from public.screening_config where id;
  if not found then cfg.enabled := true; cfg.timeout_minutes := 5; cfg.max_attempts := 3; cfg.sweep_batch := 100; end if;

  for s in
    select * from public.content_screening
     where status in ('pending', 'unavailable')
     order by created_at
     limit cfg.sweep_batch
     for update skip locked
  loop
    if not cfg.enabled then
      -- Kill switch: nothing waits for a screener that is switched off.
      perform public.screening_release_target(s.kind, s.target_id);
      update public.content_screening set status = 'skipped', reason = 'screening_disabled', decided_at = now() where id = s.id;
      n_release := n_release + 1;

    elsif s.created_at < now() - make_interval(mins => cfg.timeout_minutes) then
      -- Failure policy: released ("ok by timeout") and put in front of a human.
      perform public.screening_release_target(s.kind, s.target_id);
      v_ev := public.moderation_log_event(s.user_id, s.kind, 'unavailable', '{}'::jsonb, null, null, false);
      update public.moderation_events set target_type = s.kind, target_id = s.target_id where id = v_ev;
      perform public.screening_queue_report(s.kind, s.target_id,
        'فحص تلقائي: تعذّر فحص هذا المحتوى آليًا — يحتاج مراجعة بشرية');
      update public.content_screening
         set status = 'released_timeout', reason = coalesce(reason, 'timeout'), event_id = v_ev, decided_at = now()
       where id = s.id;
      n_timeout := n_timeout + 1;

    elsif s.attempts < cfg.max_attempts
          and coalesce(s.last_attempt_at, s.created_at) < now() - interval '75 seconds' then
      perform public.screening_dispatch(s.id);
      n_retry := n_retry + 1;
    end if;
  end loop;

  if n_timeout > 0 or n_release > 0 then
    insert into public.admin_logs (action, target_type, payload)
    values ('screening_released_unscreened', 'system',
            jsonb_build_object('timeout', n_timeout, 'kill_switch', n_release));
  end if;
  return jsonb_build_object('released_by_timeout', n_timeout, 'released_kill_switch', n_release, 'retried', n_retry);
end;
$fn$;
revoke all on function public.screening_sweep() from public, anon, authenticated;
grant execute on function public.screening_sweep() to service_role;

-- ── the gate triggers (BEFORE, SECURITY INVOKER: current_user is the caller) ─
-- Named so they sort AFTER tr_guard_video_columns, which resets is_hidden for
-- app roles; ours then sets it.
create or replace function public.tr_screen_video_before()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then return new; end if;
  if not public.screening_enabled() then return new; end if;

  if tg_op = 'INSERT' then
    if not coalesce(new.is_draft, false) then
      new.is_hidden := true; new.hidden_at := now(); new.hidden_reason := 'pending_review';
    end if;
  elsif coalesce(old.is_draft, false) and not coalesce(new.is_draft, false) and not coalesce(old.is_hidden, false) then
    new.is_hidden := true; new.hidden_at := now(); new.hidden_reason := 'pending_review';
  end if;
  return new;
end;
$fn$;
revoke all on function public.tr_screen_video_before() from public, anon, authenticated;

drop trigger if exists tr_screen_video_before on public.videos;
create trigger tr_screen_video_before
  before insert or update on public.videos
  for each row execute function public.tr_screen_video_before();

create or replace function public.tr_screen_video_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(new.is_hidden, false) and new.hidden_reason = 'pending_review'
     and (tg_op = 'INSERT' or old.hidden_reason is distinct from 'pending_review') then
    perform public.screening_open('video', new.id, new.user_id, false);
  elsif tg_op = 'UPDATE' and not coalesce(new.is_draft, false) and not coalesce(new.is_hidden, false)
        and public.screening_enabled()
        and (new.description is distinct from old.description
             or new.video_url is distinct from old.video_url
             or new.thumbnail is distinct from old.thumbnail) then
    perform public.screening_open('video', new.id, new.user_id, true);
  end if;
  return null;
end;
$fn$;
revoke all on function public.tr_screen_video_after() from public, anon, authenticated;

drop trigger if exists tr_screen_video_after on public.videos;
create trigger tr_screen_video_after
  after insert or update on public.videos
  for each row execute function public.tr_screen_video_after();

-- comments
create or replace function public.tr_screen_comment_before()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then return new; end if;
  if not public.screening_enabled() then return new; end if;
  new.is_hidden := true; new.hidden_at := now(); new.hidden_reason := 'pending_review';
  return new;
end;
$fn$;
revoke all on function public.tr_screen_comment_before() from public, anon, authenticated;

drop trigger if exists trg_screen_comment_before on public.comments;
create trigger trg_screen_comment_before
  before insert on public.comments
  for each row execute function public.tr_screen_comment_before();

create or replace function public.tr_screen_comment_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(new.is_hidden, false) and new.hidden_reason = 'pending_review' then
    perform public.screening_open('comment', new.id, new.user_id, false);
  end if;
  return null;
end;
$fn$;
revoke all on function public.tr_screen_comment_after() from public, anon, authenticated;

drop trigger if exists trg_screen_comment_after on public.comments;
create trigger trg_screen_comment_after
  after insert on public.comments
  for each row execute function public.tr_screen_comment_after();

-- stories (also guards the new columns, like guard_video_columns)
create or replace function public.tr_screen_story_before()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then return new; end if;

  if tg_op = 'INSERT' then
    if public.screening_enabled() then
      new.is_hidden := true; new.hidden_at := now(); new.hidden_reason := 'pending_review';
    else
      new.is_hidden := false; new.hidden_at := null; new.hidden_reason := null;
    end if;
  else
    new.is_hidden := old.is_hidden; new.hidden_at := old.hidden_at; new.hidden_reason := old.hidden_reason;
  end if;
  return new;
end;
$fn$;
revoke all on function public.tr_screen_story_before() from public, anon, authenticated;

drop trigger if exists tr_screen_story_before on public.stories;
create trigger tr_screen_story_before
  before insert or update on public.stories
  for each row execute function public.tr_screen_story_before();

create or replace function public.tr_screen_story_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' and coalesce(new.is_hidden, false) and new.hidden_reason = 'pending_review' then
    perform public.screening_open('story', new.id, new.user_id, false);
  elsif tg_op = 'UPDATE' and not coalesce(new.is_hidden, false) and public.screening_enabled()
        and new.caption is distinct from old.caption then
    perform public.screening_open('story', new.id, new.user_id, true);
  end if;
  return null;
end;
$fn$;
revoke all on function public.tr_screen_story_after() from public, anon, authenticated;

drop trigger if exists tr_screen_story_after on public.stories;
create trigger tr_screen_story_after
  after insert or update on public.stories
  for each row execute function public.tr_screen_story_after();

commit;

-- ── schedule: every minute ──────────────────────────────────────────────
do $sched$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled - screening_sweep NOT scheduled';
    return;
  end if;
  perform cron.unschedule('content-screening-sweep')
   where exists (select 1 from cron.job where jobname = 'content-screening-sweep');
  perform cron.schedule('content-screening-sweep', '* * * * *', $job$ select public.screening_sweep(); $job$);
end;
$sched$;

-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'screening tables locked down' as check,
       case when not has_table_privilege('authenticated', 'public.content_screening', 'select')
             and not has_table_privilege('anon', 'public.screening_config', 'select')
            then 'OK' else 'EXPOSED' end as result
union all select 'finish/get are service_role only',
       case when not has_function_privilege('authenticated', 'public.screening_finish(uuid,text,uuid,text,text,numeric)', 'execute')
             and has_function_privilege('service_role', 'public.screening_finish(uuid,text,uuid,text,text,numeric)', 'execute')
             and not has_function_privilege('authenticated', 'public.screening_get(uuid)', 'execute')
            then 'OK' else 'WRONG' end
union all select 'gate triggers installed',
       case when (select count(*) from pg_trigger where not tgisinternal
                    and tgname in ('tr_screen_video_before','tr_screen_video_after','trg_screen_comment_before',
                                   'trg_screen_comment_after','tr_screen_story_before','tr_screen_story_after')) = 6
            then 'OK' else 'MISSING' end
union all select 'video gate sorts after the column guard',
       case when 'tr_screen_video_before' > 'tr_guard_video_columns' then 'OK' else 'WRONG ORDER' end
union all select 'nothing existing was hidden by this migration',
       case when not exists (select 1 from public.videos where hidden_reason = 'pending_review')
             and not exists (select 1 from public.comments where hidden_reason = 'pending_review')
             and not exists (select 1 from public.stories where is_hidden)
            then 'OK' else 'EXISTING ROWS HIDDEN' end
union all select 'sweeper scheduled',
       case when exists (select 1 from cron.job where jobname = 'content-screening-sweep' and active)
            then 'OK' else 'NOT SCHEDULED' end
union all select 'stories policy hides moderated stories',
       case when exists (select 1 from pg_policies where tablename = 'stories' and policyname = 'stories read visible'
                           and qual like '%is_hidden%') then 'OK' else 'MISSING' end;
