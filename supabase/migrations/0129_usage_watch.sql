-- ============================================================
-- 0129 - usage watcher: Cloudflare R2 and Agora have no spending cap
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply after 0128. Safe to
-- re-run: tables are create-if-not-exists, functions create-or-replace (the
-- admin ones dropped first), triggers and the cron job are replaced.
--
-- Neither R2 nor Agora lets us set a hard spending limit. Both bill a card
-- automatically once the free allowance is gone. This migration watches our
-- OWN data for the current calendar month (UTC), compares it with limits the
-- owner sets, and warns every admin in-app and by email when a limit gets
-- close: at 70%, 85%, 95% and 100%, and again every 24 h while at 85% or more.
--
-- ⚠ EVERY NUMBER HERE IS AN ESTIMATE FROM OUR OWN TABLES, NOT A BILL. ⚠
-- The real meters are the Cloudflare and Agora dashboards. What is measured
-- and how good it is:
--
--   r2_storage   GOOD. Sum of media_objects.size_bytes ('stored', plus
--                'pending' younger than 15 min), the same rule as
--                storage_used_bytes() but R2 only (no Supabase Storage).
--                Sizes are what R2 itself reported (HEAD on confirm). Misses
--                objects the ledger does not know: the OLD project shares the
--                bucket, and orphans of uploads never confirmed. Put that on
--                top with usage_limits.r2_storage_baseline_bytes.
--   r2_class_a   UPPER BOUND of our PUTs. +1 for every signed upload URL
--                (a media_objects insert) this month, counted by a trigger
--                into usage_counters, so deleting media later does not
--                lower it. Not counted: media-reconcile's LIST calls (at
--                most ~720 a month, and it is not deployed yet), anything
--                the old project does in the shared bucket.
--   r2_class_b   LOWER BOUND, server side only: +1 per upload confirm (the
--                HEAD media-upload does). The real Class B volume is viewers
--                fetching media through cdn.flyp-sa.com; cache misses there
--                are Class B reads and NOTHING in this database sees them.
--                Check Cloudflare -> R2 -> Metrics for the true number.
--   agora_minutes  ESTIMATE of participant-minutes (Agora bills every user
--                in a channel per minute; free 10,000 a month, audio and
--                video together). Sum of:
--                * calls: per call_members row, joined_at -> left_at (or now),
--                  each row capped at 6 h. Split audio / video by the root
--                  call's kind (a call switched to video counts as video for
--                  its whole length). The caller counts from dialling.
--                * live hosts: started_at -> ended_at (or now), capped 6 h
--                  (0126 ends a live at 6 h anyway). Lives are audio only.
--                * live audience: live_viewer_log (new here, filled by a
--                  trigger on live_viewers) join -> leave, capped at the
--                  live's end. Guests on stage are viewers too, so they are
--                  in here. A viewer who closes the app without leaving is
--                  counted until the live ends (over-count). Lives from before
--                  this migration have no log rows and are estimated as
--                  viewer_count_max x duration x 0.5.
--                * walkie: walkie_sessions (new here), one row per token the
--                  agora-token function signs for a 'walkie_' channel. Each
--                  token is treated as one hour in the channel; overlapping
--                  tokens of the same person in the same chat are merged.
--                  Upper bound: a session is counted to the end of its last
--                  token's hour.
--                Not counted: the old web app / old project if it uses the
--                same Agora App ID.
--
-- What it adds:
--   usage_limits          single row: the limits + extra alert emails
--   usage_counters        monthly counters (R2 ops)
--   usage_alert_state     per metric: last band, last sent (like 0059)
--   usage_alerts          the alert history the admin panel shows / acks
--   walkie_sessions       written by agora-token (service role)
--   live_viewer_log       written by a trigger on live_viewers
--   usage_snapshot()      the estimates (internal)
--   check_usage_alerts()  the hourly check (service role / cron only)
--   claim_usage_alert_email()  for the storage-alert Edge Function
--   admin_v2_usage_overview(), admin_v2_usage_open_alerts(),
--   admin_v2_set_usage_limits(...), admin_v2_ack_usage_alert(id)
--
-- Also fixes the storage alert email, which has never been able to send:
--   * send_storage_alert_email() (0060) resolved pg_net's schema from
--     pg_extension, i.e. called extensions.http_post(), which does not exist
--     (the bug 0090 fixed everywhere else). Now uses pg_net_schema().
--   * alert_config.function_url still pointed at the OLD project (0060's
--     literal). Repointed to Mumbai.
--   * The request now also carries the gateway apikey and x-reconcile-secret
--     from job_endpoints 'send-push' (which is known to work on Mumbai), and
--     the updated storage-alert function accepts that secret as well as
--     ALERT_SECRET. So email works without setting ALERT_SECRET.
--   * allenadhitya1718@gmail.com is in alert_config.extra_recipients and
--     usage_limits.alert_emails; both lists go to both kinds of alert.
--
-- Deploy order: apply this file, then
--   npx supabase functions deploy storage-alert --no-verify-jwt
--   npx supabase functions deploy agora-token
-- (agora-token only writes walkie_sessions once this table exists; before
-- that the insert fails quietly and the token is still issued).
-- ============================================================

begin;

-- ── 1. Limits ───────────────────────────────────────────────────────────
-- Defaults are about 80% of the free allowances, except storage (see below):
--   Cloudflare R2 free: 10 GB-month storage, 1M Class A, 10M Class B a month
--   Agora free: 10,000 participant-minutes a month
-- Storage defaults to 50 GB, as asked: R2 storage is cheap ($0.015 per
-- GB-month over 10 GB, so 50 GB is about $0.60 a month); the ops are where a
-- runaway bill would come from. Set 8 GB to be warned before it costs a cent.
create table if not exists public.usage_limits (
  id                            smallint primary key default 1 check (id = 1),
  r2_storage_bytes_limit        bigint not null default 53687091200 check (r2_storage_bytes_limit > 0),  -- 50 GiB
  -- Bytes in the bucket this database does not know about (the old project's
  -- library, orphans). Added to the measured figure.
  r2_storage_baseline_bytes     bigint not null default 0 check (r2_storage_baseline_bytes >= 0),
  r2_class_a_ops_monthly_limit  bigint not null default 800000 check (r2_class_a_ops_monthly_limit > 0),
  r2_class_b_ops_monthly_limit  bigint not null default 8000000 check (r2_class_b_ops_monthly_limit > 0),
  agora_minutes_monthly_limit   bigint not null default 8000 check (agora_minutes_monthly_limit > 0),
  -- On top of every admin account's address and alert_config.extra_recipients.
  alert_emails                  text[] not null default array['allenadhitya1718@gmail.com']::text[],
  updated_at                    timestamptz not null default now(),
  updated_by                    uuid references public.profiles (id) on delete set null
);

insert into public.usage_limits (id) values (1) on conflict (id) do nothing;

-- A re-run puts the owner's address back if it is missing.
update public.usage_limits
   set alert_emails = alert_emails || array['allenadhitya1718@gmail.com']::text[]
 where id = 1 and not ('allenadhitya1718@gmail.com' = any (alert_emails));

-- ── 2. Counters, state, history, logs ───────────────────────────────────
create table if not exists public.usage_counters (
  month      date not null,
  metric     text not null,
  value      bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (month, metric)
);

create table if not exists public.usage_alert_state (
  metric       text primary key,
  last_band    smallint not null default 0,
  last_sent_at timestamptz,
  last_pct     numeric,
  checked_at   timestamptz
);

create table if not exists public.usage_alerts (
  id              bigint generated always as identity primary key,
  metric          text not null,
  pct             numeric not null,
  value           numeric not null,
  limit_value     numeric not null,
  -- 1: 70%+  2: 85%+  3: 95%+  4: 100%+
  band            smallint not null,
  month           date not null,
  detail          jsonb,
  email_pending   boolean not null default true,
  emailed_at      timestamptz,
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles (id) on delete set null
);
create index if not exists idx_usage_alerts_created on public.usage_alerts (created_at desc);
create index if not exists idx_usage_alerts_open on public.usage_alerts (metric, created_at desc) where acknowledged_at is null;
create index if not exists idx_usage_alerts_email on public.usage_alerts (created_at) where email_pending;

-- One row per walkie token signed (agora-token, service role). Nothing else
-- records walkie use: presence rides realtime and nothing is stored (0106).
create table if not exists public.walkie_sessions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  chat_id    uuid not null,
  role       text not null default 'audience' check (role in ('audience', 'host')),
  issued_at  timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour'
);
create index if not exists idx_walkie_sessions_issued on public.walkie_sessions (issued_at);

-- live_viewers keeps only who is watching NOW (rows are deleted on leave and
-- when the live ends), so listening time cannot be read from it afterwards.
-- No foreign key to live_streams: the history outlives a deleted live.
create table if not exists public.live_viewer_log (
  id        bigint generated always as identity primary key,
  live_id   uuid not null,
  user_id   uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  left_at   timestamptz
);
create index if not exists idx_live_viewer_log_joined on public.live_viewer_log (joined_at);
create index if not exists idx_live_viewer_log_live on public.live_viewer_log (live_id);
create index if not exists idx_live_viewer_log_open on public.live_viewer_log (live_id, user_id) where left_at is null;

-- The usage queries filter by these times.
create index if not exists idx_call_members_joined_at on public.call_members (joined_at);
create index if not exists idx_live_streams_started_at on public.live_streams (started_at);

-- RLS on with NO policies: no client reads or writes any of these. Admins
-- read through the admin_v2_* functions; writers are definer functions,
-- triggers and the service role.
alter table public.usage_limits      enable row level security;
alter table public.usage_counters    enable row level security;
alter table public.usage_alert_state enable row level security;
alter table public.usage_alerts      enable row level security;
alter table public.walkie_sessions   enable row level security;
alter table public.live_viewer_log   enable row level security;

revoke all on public.usage_limits, public.usage_counters, public.usage_alert_state,
              public.usage_alerts, public.walkie_sessions, public.live_viewer_log
  from anon, authenticated;

-- ── 3. Small helpers ────────────────────────────────────────────────────
-- The billing month, in UTC whatever the session time zone.
create or replace function public.usage_month()
returns date
language sql
stable
as $$ select date_trunc('month', now() at time zone 'utc')::date $$;

create or replace function public.usage_band(p_pct numeric)
returns smallint
language sql
immutable
as $$
  select (case when p_pct >= 100 then 4
               when p_pct >= 95  then 3
               when p_pct >= 85  then 2
               when p_pct >= 70  then 1
               else 0 end)::smallint
$$;

-- ── 4. Counting R2 operations as they happen ────────────────────────────
-- INSERT on media_objects = a signed PUT URL handed out (Class A).
-- pending -> stored / rejected = media-upload's HEAD on confirm (Class B).
-- Never allowed to fail an upload.
create or replace function public.usage_count_media_ops()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_metric text;
begin
  if tg_op = 'INSERT' then
    v_metric := 'r2_class_a';
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('stored', 'rejected') then
    v_metric := 'r2_class_b';
  else
    return null;
  end if;
  begin
    insert into public.usage_counters (month, metric, value)
    values (public.usage_month(), v_metric, 1)
    on conflict (month, metric)
      do update set value = public.usage_counters.value + 1, updated_at = now();
  exception when others then
    null;
  end;
  return null;
end;
$fn$;

drop trigger if exists tr_usage_count_media_ops on public.media_objects;
create trigger tr_usage_count_media_ops
  after insert or update of status on public.media_objects
  for each row execute function public.usage_count_media_ops();

-- First install: start this month's counters from what the ledger still
-- shows (rows deleted since then are missed, so this month reads low).
insert into public.usage_counters (month, metric, value)
select public.usage_month(), 'r2_class_a', count(*)
  from public.media_objects
 where created_at >= public.usage_month()::timestamp at time zone 'utc'
on conflict (month, metric) do nothing;

insert into public.usage_counters (month, metric, value)
select public.usage_month(), 'r2_class_b', count(*)
  from public.media_objects
 where confirmed_at >= public.usage_month()::timestamp at time zone 'utc'
on conflict (month, metric) do nothing;

-- ── 5. Logging live listening time ──────────────────────────────────────
-- join_live_stream inserts (ON CONFLICT DO NOTHING, so a repeat join fires
-- nothing); leave_live_stream and the end-of-live trigger delete.
create or replace function public.usage_log_live_viewer()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.live_viewer_log (live_id, user_id, joined_at)
      values (new.live_id, new.user_id, coalesce(new.joined_at, now()));
    else
      update public.live_viewer_log
         set left_at = now()
       where live_id = old.live_id and user_id = old.user_id and left_at is null;
    end if;
  exception when others then
    null;   -- a usage log must never stop anybody joining or leaving a live
  end;
  return null;
end;
$fn$;

drop trigger if exists tr_usage_log_live_viewer on public.live_viewers;
create trigger tr_usage_log_live_viewer
  after insert or delete on public.live_viewers
  for each row execute function public.usage_log_live_viewer();

-- Whoever is watching right now gets an open row.
insert into public.live_viewer_log (live_id, user_id, joined_at)
select v.live_id, v.user_id, v.joined_at
  from public.live_viewers v
 where not exists (select 1 from public.live_viewer_log l
                    where l.live_id = v.live_id and l.user_id = v.user_id and l.left_at is null);

-- ── 6. The estimates ────────────────────────────────────────────────────
-- Returns { month, computed_at, metrics: { <metric>: { value, limit, pct,
-- band, unit, accuracy, breakdown } } }. Internal: called by the check and
-- by the admin overview, never by a client directly.
create or replace function public.usage_snapshot()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_month      date := public.usage_month();
  v_start      timestamptz := public.usage_month()::timestamp at time zone 'utc';
  v_now        timestamptz := now();
  v_cap        interval := interval '6 hours';
  v_lim        public.usage_limits%rowtype;
  v_r2_bytes   bigint;
  v_r2_objects bigint;
  v_a          bigint;
  v_b          bigint;
  v_call_audio numeric;
  v_call_video numeric;
  v_live_host  numeric;
  v_live_log   numeric;
  v_live_est   numeric;
  v_walkie     numeric;
  v_walkie_tok bigint;
  v_agora      numeric;
  v_storage    numeric;
begin
  select * into v_lim from public.usage_limits where id = 1;

  -- R2 storage: the ledger, as storage_used_bytes() counts it, R2 only.
  select coalesce(sum(size_bytes), 0), count(*)
    into v_r2_bytes, v_r2_objects
    from public.media_objects
   where status = 'stored'
      or (status = 'pending' and created_at > v_now - interval '15 minutes');
  v_storage := v_r2_bytes + coalesce(v_lim.r2_storage_baseline_bytes, 0);

  -- R2 operations this month.
  select coalesce(max(value) filter (where metric = 'r2_class_a'), 0),
         coalesce(max(value) filter (where metric = 'r2_class_b'), 0)
    into v_a, v_b
    from public.usage_counters
   where month = v_month;

  -- Calls: every membership's time in the channel inside this month.
  select coalesce(sum(t.m) filter (where t.k <> 'video'), 0),
         coalesce(sum(t.m) filter (where t.k = 'video'), 0)
    into v_call_audio, v_call_video
    from (
      select coalesce(c.kind, 'audio') as k,
             greatest(0, extract(epoch from (
               least(coalesce(cm.left_at, v_now), cm.joined_at + v_cap, v_now)
               - greatest(cm.joined_at, v_start))) / 60.0) as m
        from public.call_members cm
        left join public.calls c on c.id = cm.root_id
       where cm.joined_at is not null
         and cm.joined_at > v_start - v_cap
    ) t;

  -- Lives: the host, the logged audience, and an estimate for lives that
  -- have no log rows (from before this migration).
  with ls as (
    select l.id, l.viewer_count_max,
           greatest(l.started_at, v_start) as s,
           least(coalesce(l.ended_at, v_now), l.started_at + v_cap, v_now) as e
      from public.live_streams l
     where l.started_at > v_start - v_cap
  ),
  logged as (
    select greatest(0, extract(epoch from (
             least(coalesce(g.left_at, v_now), g.joined_at + v_cap, coalesce(ls.e, v_now))
             - greatest(g.joined_at, v_start))) / 60.0) as m
      from public.live_viewer_log g
      left join ls on ls.id = g.live_id
     where g.joined_at > v_start - v_cap
  )
  select coalesce((select sum(greatest(0, extract(epoch from (ls.e - ls.s)) / 60.0)) from ls), 0),
         coalesce((select sum(m) from logged), 0),
         coalesce((select sum(greatest(0, extract(epoch from (ls.e - ls.s)) / 60.0)
                              * coalesce(ls.viewer_count_max, 0) * 0.5)
                     from ls
                    where not exists (select 1 from public.live_viewer_log g where g.live_id = ls.id)), 0)
    into v_live_host, v_live_log, v_live_est;

  -- Walkie: one hour per token, overlapping tokens of one person in one chat
  -- merged into a single stretch (gaps and islands).
  select coalesce(sum(extract(epoch from (t.mx - t.mn)) / 60.0), 0)
    into v_walkie
    from (
      select min(g.s) as mn, max(g.e) as mx
        from (
          select o.user_id, o.chat_id, o.s, o.e,
                 sum(case when o.prev_e is null or o.s > o.prev_e then 1 else 0 end)
                   over (partition by o.user_id, o.chat_id order by o.s, o.e
                         rows between unbounded preceding and current row) as grp
            from (
              select w.user_id, w.chat_id, w.s, w.e,
                     max(w.e) over (partition by w.user_id, w.chat_id order by w.s, w.e
                                    rows between unbounded preceding and 1 preceding) as prev_e
                from (
                  select user_id, chat_id,
                         greatest(issued_at, v_start) as s,
                         least(expires_at, v_now) as e
                    from public.walkie_sessions
                   where expires_at > v_start and issued_at <= v_now
                ) w
            ) o
        ) g
       group by g.user_id, g.chat_id, g.grp
    ) t;

  select count(*) into v_walkie_tok
    from public.walkie_sessions where issued_at >= v_start;

  v_agora := v_call_audio + v_call_video + v_live_host + v_live_log + v_live_est + v_walkie;

  return jsonb_build_object(
    'month',       v_month,
    'computed_at', v_now,
    'metrics', jsonb_build_object(
      'r2_storage', jsonb_build_object(
        'value', v_storage,
        'limit', v_lim.r2_storage_bytes_limit,
        'unit', 'bytes',
        'accuracy', 'measured',
        'breakdown', jsonb_build_object('ledger_bytes', v_r2_bytes, 'objects', v_r2_objects,
                                        'baseline_bytes', coalesce(v_lim.r2_storage_baseline_bytes, 0))),
      'r2_class_a', jsonb_build_object(
        'value', v_a,
        'limit', v_lim.r2_class_a_ops_monthly_limit,
        'unit', 'ops',
        'accuracy', 'upper_bound',
        'breakdown', jsonb_build_object('signed_uploads', v_a)),
      'r2_class_b', jsonb_build_object(
        'value', v_b,
        'limit', v_lim.r2_class_b_ops_monthly_limit,
        'unit', 'ops',
        'accuracy', 'lower_bound',
        'breakdown', jsonb_build_object('upload_confirm_heads', v_b, 'viewer_reads', null)),
      'agora_minutes', jsonb_build_object(
        'value', round(v_agora),
        'limit', v_lim.agora_minutes_monthly_limit,
        'unit', 'minutes',
        'accuracy', 'estimate',
        'breakdown', jsonb_build_object(
          'calls_audio',          round(v_call_audio),
          'calls_video',          round(v_call_video),
          'live_hosts',           round(v_live_host),
          'live_audience',        round(v_live_log),
          'live_audience_guess',  round(v_live_est),
          'walkie',               round(v_walkie),
          'walkie_tokens',        v_walkie_tok))
    )
  );
  -- pct and band are added by usage_with_pct() below.
end;
$fn$;

-- Adds pct and band to every metric of a snapshot.
create or replace function public.usage_with_pct(p_snap jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(p_snap, '{metrics}', coalesce((
    select jsonb_object_agg(k, m || jsonb_build_object(
             'pct',  x.pct,
             'band', public.usage_band(x.pct)))
      from jsonb_each(p_snap->'metrics') as e(k, m)
      cross join lateral (
        select case when coalesce((m->>'limit')::numeric, 0) <= 0 then 0
                    else round(((m->>'value')::numeric / (m->>'limit')::numeric) * 100, 1) end as pct
      ) x), '{}'::jsonb))
$$;

-- ── 7. Who gets the email ───────────────────────────────────────────────
-- Admin accounts, alert_config.extra_recipients (0060) and
-- usage_limits.alert_emails, lower-cased, each once. Reads auth.users, so
-- service role only.
create or replace function public.alert_recipients()
returns text[]
language sql
security definer
stable
set search_path = public, auth
as $$
  select coalesce(array_agg(distinct e order by e), '{}')
    from (
      select lower(trim(u.email)) as e
        from auth.users u join public.profiles p on p.id = u.id
       where p.is_admin and u.email is not null
      union
      select lower(trim(x)) from public.alert_config c, unnest(c.extra_recipients) x where c.id = 1
      union
      select lower(trim(x)) from public.usage_limits l, unnest(l.alert_emails) x where l.id = 1
    ) t
   where e is not null and e <> '';
$$;

-- ── 8. Reaching the storage-alert Edge Function ─────────────────────────
-- alert_config must exist (0060); make sure the row does.
insert into public.alert_config (id) values (1) on conflict (id) do nothing;

-- 0060 left the OLD project's URL here.
update public.alert_config
   set function_url = 'https://vfkwipvinmnybilcrdzr.supabase.co/functions/v1/storage-alert'
 where id = 1
   and (function_url is null or function_url = '' or function_url like '%qnzgxihlrwanywndcmpf%');

update public.alert_config
   set extra_recipients = extra_recipients || array['allenadhitya1718@gmail.com']::text[]
 where id = 1 and not ('allenadhitya1718@gmail.com' = any (extra_recipients));

-- One POST to storage-alert. URL from alert_config (or derived from the
-- send-push endpoint). Headers: the gateway apikey and x-reconcile-secret
-- that send-push already uses successfully, plus x-alert-secret when
-- alert_config has a real one. storage-alert accepts either secret.
create or replace function public.post_alert_mail(p_body jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_schema  text := public.pg_net_schema();
  v_cfg     public.alert_config%rowtype;
  v_ep      public.job_endpoints%rowtype;
  v_url     text;
  v_headers jsonb := '{}'::jsonb;
begin
  if v_schema is null then
    return 'pg_net not enabled - email skipped, in-app alert unaffected';
  end if;

  select * into v_cfg from public.alert_config where id = 1;
  select * into v_ep from public.job_endpoints where name = 'send-push';

  v_url := case
    when coalesce(v_cfg.function_url, '') like 'https://vfkwipvinmnybilcrdzr.supabase.co/%' then v_cfg.function_url
    when coalesce(v_ep.url, '') like '%/send-push' then replace(v_ep.url, '/send-push', '/storage-alert')
  end;
  if v_url is null then
    return 'no storage-alert URL (alert_config / job_endpoints send-push) - email skipped';
  end if;

  if v_ep.headers is not null then
    v_headers := v_ep.headers;
  end if;
  if coalesce(v_cfg.shared_secret, '') <> '' and v_cfg.shared_secret not like 'CHANGE-ME%' then
    v_headers := v_headers || jsonb_build_object('x-alert-secret', v_cfg.shared_secret);
  end if;
  if not (v_headers ? 'x-alert-secret' or v_headers ? 'x-reconcile-secret') then
    return 'no shared secret (alert_config.shared_secret or send-push headers) - email skipped';
  end if;
  v_headers := v_headers || jsonb_build_object('Content-Type', 'application/json');

  execute format('select %I.http_post(url := $1, body := $2, headers := $3)', v_schema)
    using v_url, coalesce(p_body, '{}'::jsonb), v_headers;

  return 'queued';
end;
$fn$;

-- The storage alert's mailer (0060), on the working path. Same name, same
-- signature, so check_storage_alert() picks it up unchanged.
create or replace function public.send_storage_alert_email()
returns text
language sql
security definer
set search_path = public
as $$ select public.post_alert_mail('{}'::jsonb) $$;

create or replace function public.send_usage_alert_email()
returns text
language sql
security definer
set search_path = public
as $$ select public.post_alert_mail(jsonb_build_object('kind', 'usage_alert')) $$;

-- Storage alert recipients now include usage_limits.alert_emails too.
create or replace function public.claim_storage_alert_email()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_payload jsonb;
begin
  update public.storage_alert_state
     set email_pending = false
   where id = 1 and email_pending
  returning email_payload into v_payload;

  if v_payload is null then
    return null;
  end if;

  return v_payload || jsonb_build_object('recipients', to_jsonb(public.alert_recipients()));
end;
$fn$;

-- Hands every pending usage alert to the mailer and clears the flag in the
-- same statement, so two overlapping runs cannot both send. Alerts older
-- than 48 h that never went out (mail was not set up) are dropped, not sent
-- as a stale pile.
create or replace function public.claim_usage_alert_email()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_alerts jsonb;
begin
  update public.usage_alerts
     set email_pending = false
   where email_pending and created_at < now() - interval '48 hours';

  with c as (
    update public.usage_alerts
       set email_pending = false, emailed_at = now()
     where email_pending
    returning id, metric, pct, value, limit_value, band, month, detail, created_at
  )
  select jsonb_agg(to_jsonb(c) order by c.pct desc) into v_alerts from c;

  if v_alerts is null then
    return null;
  end if;

  return jsonb_build_object('alerts', v_alerts, 'recipients', to_jsonb(public.alert_recipients()));
end;
$fn$;

-- ── 9. The hourly check ─────────────────────────────────────────────────
-- Per metric, like check_storage_alert (0059): speaks when the band rises,
-- and again every 24 h while at 85% or more. Falling under 70% resets, so a
-- later climb warns again (that is also what happens at the start of each
-- month for the monthly metrics).
create or replace function public.check_usage_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_snap   jsonb := public.usage_with_pct(public.usage_snapshot());
  v_rec    record;
  v_m      jsonb;
  v_pct    numeric;
  v_band   smallint;
  v_value  numeric;
  v_limit  numeric;
  v_state  public.usage_alert_state%rowtype;
  v_sent   jsonb := '[]'::jsonb;
  v_admins integer := 0;
  v_mail   text := 'not attempted';
begin
  for v_rec in select key, value from jsonb_each(v_snap->'metrics') loop
    v_m     := v_rec.value;
    v_limit := nullif((v_m->>'limit')::numeric, 0);
    continue when v_limit is null;
    v_value := (v_m->>'value')::numeric;
    v_pct   := (v_m->>'pct')::numeric;
    v_band  := (v_m->>'band')::smallint;

    insert into public.usage_alert_state (metric) values (v_rec.key) on conflict (metric) do nothing;
    select * into v_state from public.usage_alert_state where metric = v_rec.key for update;

    if v_band = 0 then
      update public.usage_alert_state
         set last_band = 0, last_sent_at = null, last_pct = v_pct, checked_at = now()
       where metric = v_rec.key;
      continue;
    end if;

    if not (v_band > v_state.last_band
            or (v_band >= 2 and (v_state.last_sent_at is null
                                 or v_state.last_sent_at < now() - interval '24 hours'))) then
      -- Quiet, but remember a drop, so climbing back up is announced.
      update public.usage_alert_state
         set last_band = least(last_band, v_band), last_pct = v_pct, checked_at = now()
       where metric = v_rec.key;
      continue;
    end if;

    insert into public.usage_alerts (metric, pct, value, limit_value, band, month, detail)
    values (v_rec.key, v_pct, v_value, v_limit, v_band, (v_snap->>'month')::date,
            jsonb_build_object('unit', v_m->>'unit', 'accuracy', v_m->>'accuracy',
                               'breakdown', v_m->'breakdown'));

    -- actor_id is the admin themselves: not nullable, and nobody caused this
    -- (as storage_alert, 0059). send-push shows nothing for this kind; the
    -- row is for the in-app list.
    insert into public.notifications (user_id, actor_id, type, payload)
    select p.id, p.id, 'system',
           jsonb_build_object('kind', 'usage_alert', 'metric', v_rec.key, 'pct', v_pct,
                              'value', v_value, 'limit', v_limit, 'band', v_band,
                              'unit', v_m->>'unit')
      from public.profiles p
     where p.is_admin;
    get diagnostics v_admins = row_count;

    update public.usage_alert_state
       set last_band = v_band, last_sent_at = now(), last_pct = v_pct, checked_at = now()
     where metric = v_rec.key;

    v_sent := v_sent || jsonb_build_array(jsonb_build_object(
      'metric', v_rec.key, 'pct', v_pct, 'band', v_band, 'admins_notified', v_admins));
  end loop;

  -- Mail on top of the in-app alert, never instead of it.
  if jsonb_array_length(v_sent) > 0 then
    begin
      v_mail := public.send_usage_alert_email();
    exception when others then
      v_mail := 'failed: ' || sqlerrm;
    end;
  end if;

  -- Housekeeping: the logs only matter for the current month.
  delete from public.walkie_sessions where issued_at < now() - interval '100 days';
  delete from public.live_viewer_log where joined_at < now() - interval '100 days';

  return jsonb_build_object('alerts', v_sent, 'email', v_mail, 'metrics', v_snap->'metrics');
end;
$fn$;

-- ── 10. Admin panel ─────────────────────────────────────────────────────
drop function if exists public.admin_v2_usage_overview();
create function public.admin_v2_usage_overview()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_snap jsonb;
  v_cfg  public.alert_config%rowtype;
  v_cron boolean := null;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  v_snap := public.usage_with_pct(public.usage_snapshot());
  select * into v_cfg from public.alert_config where id = 1;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      execute $q$select exists (select 1 from cron.job where jobname = 'usage-alert-check' and active)$q$
         into v_cron;
    exception when others then
      v_cron := null;
    end;
  end if;

  return v_snap || jsonb_build_object(
    'limits', (select to_jsonb(l) from public.usage_limits l where l.id = 1),
    'state',  (select coalesce(jsonb_object_agg(s.metric, to_jsonb(s) - 'metric'), '{}'::jsonb)
                 from public.usage_alert_state s),
    'alerts', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
                 from (select a.id, a.metric, a.pct, a.value, a.limit_value, a.band, a.month,
                              a.created_at, a.emailed_at, a.email_pending,
                              a.acknowledged_at, p.handle as acknowledged_by_handle
                         from public.usage_alerts a
                         left join public.profiles p on p.id = a.acknowledged_by
                        order by a.created_at desc
                        limit 100) x),
    'health', jsonb_build_object(
      'pg_net',          public.pg_net_schema() is not null,
      'cron_job',        v_cron,
      'mail_url_ok',     coalesce(v_cfg.function_url, '') like 'https://vfkwipvinmnybilcrdzr.supabase.co/%'
                         or exists (select 1 from public.job_endpoints where name = 'send-push'),
      'mail_secret_ok',  (coalesce(v_cfg.shared_secret, '') <> '' and v_cfg.shared_secret not like 'CHANGE-ME%')
                         or exists (select 1 from public.job_endpoints
                                     where name = 'send-push' and headers ? 'x-reconcile-secret'),
      'admins',          (select count(*) from public.profiles where is_admin),
      'emails_pending',  (select count(*) from public.usage_alerts where email_pending))
  );
end;
$fn$;

-- What the banner needs, cheap enough to ask on every page: the newest
-- unacknowledged alert (70%+) of each metric.
drop function if exists public.admin_v2_usage_open_alerts();
create function public.admin_v2_usage_open_alerts()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.pct desc), '[]'::jsonb)
      from (select distinct on (metric) id, metric, pct, value, limit_value, band, month, created_at
              from public.usage_alerts
             where acknowledged_at is null and pct >= 70
             order by metric, created_at desc) x
  );
end;
$fn$;

-- null leaves a value as it is.
drop function if exists public.admin_v2_set_usage_limits(bigint, bigint, bigint, bigint, bigint, text[]);
create function public.admin_v2_set_usage_limits(
  p_r2_storage_bytes          bigint default null,
  p_r2_storage_baseline_bytes bigint default null,
  p_r2_class_a_ops            bigint default null,
  p_r2_class_b_ops            bigint default null,
  p_agora_minutes             bigint default null,
  p_alert_emails              text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old    jsonb;
  v_new    jsonb;
  v_emails text[];
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  if coalesce(p_r2_storage_bytes, 1) <= 0 or coalesce(p_r2_class_a_ops, 1) <= 0
     or coalesce(p_r2_class_b_ops, 1) <= 0 or coalesce(p_agora_minutes, 1) <= 0
     or coalesce(p_r2_storage_baseline_bytes, 0) < 0 then
    raise exception 'limits must be positive numbers' using errcode = '22023';
  end if;

  if p_alert_emails is not null then
    select coalesce(array_agg(distinct e order by e), '{}')
      into v_emails
      from (select lower(trim(x)) as e from unnest(p_alert_emails) x) t
     where e <> '';
    if cardinality(v_emails) > 10 then
      raise exception 'at most 10 alert emails' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_emails) e
                where e !~ '^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$' or length(e) > 254) then
      raise exception 'invalid email address' using errcode = '22023';
    end if;
  end if;

  insert into public.usage_limits (id) values (1) on conflict (id) do nothing;
  select to_jsonb(l) into v_old from public.usage_limits l where id = 1;

  update public.usage_limits
     set r2_storage_bytes_limit       = coalesce(p_r2_storage_bytes, r2_storage_bytes_limit),
         r2_storage_baseline_bytes    = coalesce(p_r2_storage_baseline_bytes, r2_storage_baseline_bytes),
         r2_class_a_ops_monthly_limit = coalesce(p_r2_class_a_ops, r2_class_a_ops_monthly_limit),
         r2_class_b_ops_monthly_limit = coalesce(p_r2_class_b_ops, r2_class_b_ops_monthly_limit),
         agora_minutes_monthly_limit  = coalesce(p_agora_minutes, agora_minutes_monthly_limit),
         alert_emails                 = coalesce(v_emails, alert_emails),
         updated_at                   = now(),
         updated_by                   = auth.uid()
   where id = 1
  returning to_jsonb(usage_limits.*) into v_new;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'set_usage_limits', 'usage_limits', null,
          jsonb_build_object('before', v_old - 'updated_at' - 'updated_by',
                             'after',  v_new - 'updated_at' - 'updated_by'));

  return v_new;
end;
$fn$;

-- Acknowledging an alert also acknowledges the older open ones of the same
-- metric. null acknowledges everything open.
drop function if exists public.admin_v2_ack_usage_alert(bigint);
create function public.admin_v2_ack_usage_alert(p_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_metric text;
  v_at     timestamptz;
  v_n      integer;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  if p_id is null then
    update public.usage_alerts
       set acknowledged_at = now(), acknowledged_by = auth.uid()
     where acknowledged_at is null;
  else
    select metric, created_at into v_metric, v_at from public.usage_alerts where id = p_id;
    if not found then raise exception 'no such alert' using errcode = 'P0002'; end if;
    update public.usage_alerts
       set acknowledged_at = now(), acknowledged_by = auth.uid()
     where acknowledged_at is null and metric = v_metric and created_at <= v_at;
  end if;
  get diagnostics v_n = row_count;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'ack_usage_alert', 'usage_alert', null,
          jsonb_build_object('alert_id', p_id, 'metric', v_metric, 'acknowledged', v_n));

  return v_n;
end;
$fn$;

-- ── 11. Privileges ──────────────────────────────────────────────────────
-- Internal: nobody but the owner (cron, triggers, other definer functions).
revoke all on function public.usage_count_media_ops()       from public, anon, authenticated;
revoke all on function public.usage_log_live_viewer()       from public, anon, authenticated;
revoke all on function public.usage_snapshot()              from public, anon, authenticated;
revoke all on function public.usage_with_pct(jsonb)         from public, anon, authenticated;
revoke all on function public.alert_recipients()            from public, anon, authenticated;
revoke all on function public.post_alert_mail(jsonb)        from public, anon, authenticated;
revoke all on function public.send_storage_alert_email()    from public, anon, authenticated;
revoke all on function public.send_usage_alert_email()      from public, anon, authenticated;
revoke all on function public.check_usage_alerts()          from public, anon, authenticated;
revoke all on function public.claim_storage_alert_email()   from public, anon, authenticated;
revoke all on function public.claim_usage_alert_email()     from public, anon, authenticated;

-- The storage-alert Edge Function (service role) claims; the check may also
-- be run by hand with the service key.
grant execute on function public.claim_storage_alert_email() to service_role;
grant execute on function public.claim_usage_alert_email()   to service_role;
grant execute on function public.check_usage_alerts()        to service_role;

-- Admin panel: signed-in users, refused inside unless is_admin().
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_v2_usage_overview', 'admin_v2_usage_open_alerts',
                         'admin_v2_set_usage_limits', 'admin_v2_ack_usage_alert')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;

-- ── 12. Schedule: hourly at :17 ─────────────────────────────────────────
-- Clear of media-reconcile (:07) and play-voided-purchases (:41).
do $sched$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled - NOTHING HAS BEEN SCHEDULED. Enable it (Database -> Extensions) and run this file again.';
    return;
  end if;

  perform cron.unschedule('usage-alert-check')
   where exists (select 1 from cron.job where jobname = 'usage-alert-check');

  perform cron.schedule(
    'usage-alert-check',
    '17 * * * *',
    $job$ select public.check_usage_alerts(); $job$
  );
end;
$sched$;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'usage tables exist' as check,
       case when to_regclass('public.usage_limits') is not null
             and to_regclass('public.usage_counters') is not null
             and to_regclass('public.usage_alert_state') is not null
             and to_regclass('public.usage_alerts') is not null
             and to_regclass('public.walkie_sessions') is not null
             and to_regclass('public.live_viewer_log') is not null
            then 'OK' else 'MISSING' end as result
union all select 'usage tables have RLS and no client grants',
       case when (select bool_and(relrowsecurity) from pg_class
                   where oid in ('public.usage_limits'::regclass, 'public.usage_counters'::regclass,
                                 'public.usage_alert_state'::regclass, 'public.usage_alerts'::regclass,
                                 'public.walkie_sessions'::regclass, 'public.live_viewer_log'::regclass))
             and not has_table_privilege('authenticated', 'public.usage_alerts', 'select')
             and not has_table_privilege('anon', 'public.usage_limits', 'select')
             and not has_table_privilege('authenticated', 'public.walkie_sessions', 'insert')
            then 'OK' else 'EXPOSED' end
union all select 'limits row has the owner address',
       case when exists (select 1 from public.usage_limits
                          where id = 1 and 'allenadhitya1718@gmail.com' = any (alert_emails))
            then 'OK' else 'MISSING' end
union all select 'alert_config extra_recipients has the owner address',
       case when exists (select 1 from public.alert_config
                          where id = 1 and 'allenadhitya1718@gmail.com' = any (extra_recipients))
            then 'OK' else 'MISSING' end
union all select 'alert mail URL points at Mumbai',
       case when exists (select 1 from public.alert_config
                          where id = 1 and function_url like 'https://vfkwipvinmnybilcrdzr.supabase.co/%')
            then 'OK' else 'CHECK alert_config.function_url' end
union all select 'alert mail has a secret',
       case when exists (select 1 from public.alert_config
                          where id = 1 and coalesce(shared_secret, '') <> '' and shared_secret not like 'CHANGE-ME%')
             or exists (select 1 from public.job_endpoints
                         where name = 'send-push' and headers ? 'x-reconcile-secret')
            then 'OK' else 'NONE - email cannot be sent (in-app still works)' end
union all select 'pg_net available',
       case when public.pg_net_schema() is not null then 'OK' else 'MISSING - no email' end
union all select 'check_usage_alerts service-role only',
       case when not has_function_privilege('authenticated', 'public.check_usage_alerts()', 'execute')
             and not has_function_privilege('anon', 'public.check_usage_alerts()', 'execute')
             and has_function_privilege('service_role', 'public.check_usage_alerts()', 'execute')
            then 'OK' else 'EXPOSED' end
union all select 'mail helpers not callable by clients',
       case when not has_function_privilege('authenticated', 'public.claim_usage_alert_email()', 'execute')
             and not has_function_privilege('authenticated', 'public.alert_recipients()', 'execute')
             and not has_function_privilege('authenticated', 'public.post_alert_mail(jsonb)', 'execute')
             and not has_function_privilege('authenticated', 'public.usage_snapshot()', 'execute')
             and not has_function_privilege('authenticated', 'public.send_storage_alert_email()', 'execute')
            then 'OK' else 'EXPOSED' end
union all select 'send_storage_alert_email uses pg_net_schema()',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'send_storage_alert_email'
                            and p.prosrc like '%post_alert_mail%')
            then 'OK' else 'OLD VERSION' end
union all select 'usage admin RPCs: definer, is_admin(), not anon',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('admin_v2_usage_overview', 'admin_v2_usage_open_alerts',
                                       'admin_v2_set_usage_limits', 'admin_v2_ack_usage_alert')
                     and p.prosecdef
                     and pg_get_functiondef(p.oid) like '%is_admin()%'
                     and not has_function_privilege('anon', p.oid, 'execute')
                     and has_function_privilege('authenticated', p.oid, 'execute')) = 4
            then 'OK' else 'CHECK' end
union all select 'triggers installed',
       case when exists (select 1 from pg_trigger where tgname = 'tr_usage_count_media_ops'
                          and tgrelid = 'public.media_objects'::regclass)
             and exists (select 1 from pg_trigger where tgname = 'tr_usage_log_live_viewer'
                          and tgrelid = 'public.live_viewers'::regclass)
            then 'OK' else 'MISSING' end
union all select 'snapshot computes',
       case when public.usage_with_pct(public.usage_snapshot()) -> 'metrics' ? 'agora_minutes'
            then 'OK' else 'BROKEN' end
union all select 'at least one admin account exists',
       case when exists (select 1 from public.profiles where is_admin)
            then 'OK' else 'NONE - nobody gets the in-app alert' end
order by 1;

-- Current estimates (value / limit / pct per metric):
--   select key as metric, value->>'value' as value, value->>'limit' as "limit",
--          value->>'pct' as pct, value->>'accuracy' as accuracy, value->'breakdown' as breakdown
--     from jsonb_each(public.usage_with_pct(public.usage_snapshot())->'metrics');
--
-- Where pg_cron is enabled:
--   select jobname, schedule, active from cron.job where jobname = 'usage-alert-check';
--
-- Run the check now (SQL editor runs as the owner):
--   select public.check_usage_alerts();
--
-- End-to-end test (in-app + email), then put it back:
--   update public.usage_limits set agora_minutes_monthly_limit = 1 where id = 1;
--   select public.check_usage_alerts();   -- expect alerts:[agora_minutes ...], email:'queued'
--   select id, status_code, content::text from net._http_response order by id desc limit 3;
--   update public.usage_limits set agora_minutes_monthly_limit = 8000 where id = 1;
--   delete from public.usage_alert_state where metric = 'agora_minutes';
--
-- NOTE: 0128's own verify query counts admin_v2_* functions and expects 17;
-- after this migration there are 21, so re-running 0128's check says
-- 'MISSING SOME'. That is expected.
