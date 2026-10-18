-- ============================================================
-- 0108_personal_feed.sql
--
-- For You becomes personal: an interest profile per viewer, a mixed page
-- (personal / trending / following / exploration), a "test batch" for new
-- videos, and no re-showing of what the viewer already watched.
--
-- fetch_fyp_feed keeps EXACTLY the signature and return columns of 0084
--   (p_limit, p_offset, p_user_id, p_max_per_creator)
--   -> id .. user_verified, saves_count, liked, saved, following
-- so the web app (web/js/db.js) and the RN app (mobile/src/api/videos.ts)
-- keep working unchanged. Every visibility rule of 0084 is kept; blocks are
-- now checked in BOTH directions (as can_see_posts_of does since 0049).
--
-- ── Who is "the viewer" ────────────────────────────────────────────────
-- auth.uid(). p_user_id is client-supplied, so it is only trusted when
-- there is no end-user JWT at all (service_role / SQL editor), which is
-- what makes the check queries at the bottom of this file work. Before,
-- any caller could pass someone else's id and get THEIR personalised feed
-- including private accounts that person follows; that is closed.
--
-- ============================================================
-- SCORING (every number below is a named constant at the top of the
-- function / refresh function - tune there)
-- ============================================================
--
-- 1. INTEREST PROFILE  (computed on the fly per request, ~1-5 ms)
--    Signals from the last 30 days (c_profile_days), newest 1000 watch rows
--    at most, each multiplied by a time decay  0.5 ^ (age_days / 7).
--
--      watch row (video_engagement)
--        quick skip (1 pass, < 2 s watched)         -0.5   c_w_skip
--        otherwise  1.0 * completion (0..1)          c_w_complete
--                 + 0.75 * min(replays, 3)           c_w_rewatch
--      like                                          +2.0   c_w_like
--      comment (once per video)                      +3.0   c_w_comment
--      save                                          +3.0   c_w_save
--      "interested"                                  +2.0   c_w_interested
--      "not interested"                              -4.0   c_w_not_interested
--      follow (creator only, 90 d, half-life 28 d)   +2.0   c_w_follow
--    (No per-user share or profile-visit rows exist in the schema, so those
--     signals cannot be used; shares still count globally via shares_count.)
--
--    A video's summed weight is credited to its creator, its sound and its
--    hashtags (each tag gets weight / sqrt(#tags)). Per dimension the sums
--    are normalised to [-1, 1] by the largest positive sum (floor 2.0, so a
--    single faint signal does not become a full-strength interest). Kept:
--    top 40 creators, 20 sounds, 25 tags. The viewer's own videos are not
--    part of the profile.
--
--    interest(v) = 1.0 * a_creator + 0.7 * a_tags + 0.5 * a_sound
--      a_tags = clamp(sum(tag weights) / sqrt(#matching tags), -1, 1)
--
-- 2. PER-VIDEO TERMS
--    f    freshness   = exp(-age_hours / 72)        (replaces the old
--                       +1000 <24 h / +500 <72 h step with a smooth decay)
--    pop  popularity  = min(ln(1 + 3L + 5C + 7S + 4Saves + Views) / 10, 1.5)
--                       (the old weights, log-scaled)
--    q    quality     = video_feed_stats.quality, Bayesian-smoothed so a
--                       video with no viewers is exactly 1.0 (see 4.)
--    trend            = video_feed_stats.trend_score / 5
--    j    jitter      = stable hash(video, session seed) in [0,1)
--    pen              = 0.25 * (videos of this creator already served in
--                       this session)  - spreads creators across pages
--    fail             = -1.0 when the video failed its test batch
--
-- 3. POOL SCORES  (each pool is ranked by its own score)
--    personal   3.0*I + 0.8*(q-1) + 0.6*f + 0.3*pop + 0.4*j - pen + fail
--               member when I >= 0.15
--    trending   trend + 0.5*pop*f + 0.3*max(I,0) + 1.5*min(I,0) + 0.3*j - pen + fail
--               member when it has 48 h velocity or is < 7 days old
--    following  1.5*f + 0.5*(q-1) + 0.3*pop + 0.5*I + 0.3*j - pen
--               member when the viewer follows the creator, < 14 days old
--    explore    [in test: 2 + (1 - viewers/30)] + [graduated: 0.5]
--               + 0.6*f + 1.0*j - 0.5*max(I,0) + 1.5*min(I,0) - pen
--               member when in test, graduated or evergreen (q >= 1.1)
--    fresh      1.0*f + 0.5*(q-1) + 0.3*pop + 1.0*I + 0.5*j - pen + fail
--               member when < 7 days old (only used without history)
--
--    MIX - weighted round robin ("stride scheduling"): the n-th item of a
--    pool with share s gets slot key (n - 0.5) / s; the page is the lowest
--    keys. Any prefix of the list therefore holds the pools in proportion,
--    and an empty pool simply hands its slots to the others.
--      with history (>= 3 positive interests):
--        personal 0.60  trending 0.20  following 0.10  explore 0.10
--      new / anonymous viewer:
--        trending 0.40  fresh 0.30  explore 0.15  following 0.10
--        (+ personal 0.15 once there is any positive interest)
--    Then: filler (anything else unseen, by personal score), then - only if
--    the pool has run dry - videos already watched in the last 7 days.
--    Per-creator cap p_max_per_creator (default 3) as before: per page for
--    signed-in viewers, over the whole list for anonymous ones (= 0084).
--
-- 4. COLD START / TEST BATCH  (video_feed_stats, refreshed every 10 min)
--    A video < 72 h old with < 30 distinct engaged viewers (c_test_viewers)
--    is "in test": it gets top priority in the explore pool, least-exposed
--    first, so every signed-in viewer's page carries ~2 test videos until
--    each has 30 viewers. After that:
--      quality >= 1.15  graduated  -> explore boost, and its velocity feeds
--                                     trending
--      quality <  0.70  failed     -> leaves explore/trending/fresh, -1.0
--                                     everywhere else
--    quality = clamp(0.45*cr/0.35 + 0.30*lr/0.06 + 0.15*rr/0.10
--                    + 0.10*(1-sr)/0.70, 0.2, 3.0), each rate smoothed with
--    10 pseudo-viewers at the prior:  cr completion rate, lr like rate,
--    rr rewatch rate, sr quick-skip rate.  Average video = 1.0.
--    trend_score = sqrt(quality) * ln(1 + viewers48h + 3*completes48h
--                  + 4*likes48h + 6*comments48h + 5*saves48h)
--
-- ============================================================
-- SEEN HISTORY AND PAGINATION
-- ============================================================
-- Signed-in viewer: a "feed session" per user (feed_sessions) and the ids
-- served on every page of it (feed_session_pages).
--   * p_offset = 0 starts a new session (new seed, served list cleared) -
--     unless page 0 was built < 2 minutes ago with the same p_limit, in
--     which case that exact page is returned again (retries, remounts).
--   * p_offset > 0: if that offset was already served in this session with
--     the same p_limit, the same ids come back (idempotent refetch);
--     otherwise a new page is built EXCLUDING every id served on any other
--     page of the session. So no duplicates within a session, whatever
--     order pages are requested in, and the interest profile adapts between
--     pages (what you liked on page 1 shapes page 2).
--   * Videos watched in the last 7 days are excluded from the pools; they
--     come back only as last-resort backfill when nothing unseen is left.
--   * Per-user advisory lock: two concurrent page requests are serialised.
--   * Cached pages are re-checked against all visibility rules when served.
-- Anonymous viewer: no state can be kept, so the order is deterministic
-- (seed and clock fixed per hour) and p_offset slices it, like before.
-- Rare boundary duplicates remain possible when counters/stats change
-- between two page loads - same as the 0084 behaviour.
--
-- ============================================================
-- NEW OBJECTS
-- ============================================================
--   tables   video_feed_stats       per-video aggregates (cron)
--            feed_sessions          one row per signed-in user
--            feed_session_pages     ids served per page of the session
--   column   video_hashtags.created_at  (+ trigger, backfilled) so "recent
--            videos for a tag" is one index range scan
--   functions refresh_video_feed_stats(), purge_feed_sessions()
--   cron     refresh-video-feed-stats  */10 * * * *
--            purge-feed-sessions       55 3 * * *
--   indexes  see section 2
--
-- fetch_fyp_feed becomes plpgsql VOLATILE (it writes the session). Both
-- apps call it with supabase.rpc(), i.e. POST, so this is transparent.
-- ============================================================

begin;

-- ============================================================
-- 1. Tables
-- ============================================================

create table if not exists public.video_feed_stats (
  video_id       uuid not null references public.videos (id) on delete cascade,
  viewers        integer not null default 0,   -- distinct signed-in viewers with an engagement row
  completes      integer not null default 0,
  rewatchers     integer not null default 0,
  skips          integer not null default 0,
  viewers_48h    integer not null default 0,
  completes_48h  integer not null default 0,
  likes_48h      integer not null default 0,
  comments_48h   integer not null default 0,
  saves_48h      integer not null default 0,
  quality        real    not null default 1.0,
  trend_score    real    not null default 0,
  updated_at     timestamptz not null default now(),
  constraint video_feed_stats_pkey primary key (video_id)
);

create table if not exists public.feed_sessions (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  started_at   timestamptz not null default now(),
  seed         bigint not null default 0,
  last_seen_at timestamptz not null default now(),
  constraint feed_sessions_pkey primary key (user_id)
);

create table if not exists public.feed_session_pages (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  page_offset integer not null,
  page_limit  integer not null,
  video_ids   uuid[]  not null default '{}',
  created_at  timestamptz not null default now(),
  constraint feed_session_pages_pkey primary key (user_id, page_offset)
);

-- Internal: only the security definer functions below touch these.
alter table public.video_feed_stats   enable row level security;
alter table public.feed_sessions      enable row level security;
alter table public.feed_session_pages enable row level security;
revoke all on public.video_feed_stats   from anon, authenticated;
revoke all on public.feed_sessions      from anon, authenticated;
revoke all on public.feed_session_pages from anon, authenticated;

-- ── video_hashtags.created_at = the video's post time ──
alter table public.video_hashtags
  add column if not exists created_at timestamptz not null default now();

create or replace function public.video_hashtags_set_created_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select v.created_at into new.created_at from public.videos v where v.id = new.video_id;
  new.created_at := coalesce(new.created_at, now());
  return new;
end;
$$;

drop trigger if exists tr_video_hashtags_created_at on public.video_hashtags;
create trigger tr_video_hashtags_created_at
  before insert on public.video_hashtags
  for each row execute function public.video_hashtags_set_created_at();

update public.video_hashtags vh
   set created_at = v.created_at
  from public.videos v
 where v.id = vh.video_id
   and vh.created_at is distinct from v.created_at;


-- ============================================================
-- 2. Indexes
-- ============================================================

-- profile (newest watch rows) + 7-day seen check
create index if not exists idx_video_engagement_user_recent
  on public.video_engagement (user_id, last_watched_at desc);
-- per-video aggregation in refresh_video_feed_stats
create index if not exists idx_video_engagement_video
  on public.video_engagement (video_id);
create index if not exists idx_video_engagement_last_watched
  on public.video_engagement (last_watched_at);
-- personal candidates: newest videos of a tag / of a sound
create index if not exists idx_video_hashtags_tag_recent
  on public.video_hashtags (tag, created_at desc);
create index if not exists idx_videos_sound_recent
  on public.videos (sound_id, created_at desc)
  where is_draft = false and sound_id is not null;
-- 48 h velocity windows
create index if not exists idx_likes_created    on public.likes    (created_at);
create index if not exists idx_saves_created    on public.saves    (created_at);
create index if not exists idx_comments_created on public.comments (created_at);
-- trending / evergreen pools
create index if not exists idx_video_feed_stats_trend
  on public.video_feed_stats (trend_score desc) where trend_score > 0;
create index if not exists idx_video_feed_stats_quality
  on public.video_feed_stats (quality desc);
-- session cleanup
create index if not exists idx_feed_session_pages_created
  on public.feed_session_pages (created_at);


-- ============================================================
-- 3. refresh_video_feed_stats  (cron, every 10 minutes)
-- ============================================================
create or replace function public.refresh_video_feed_stats()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c_k     constant double precision := 10;    -- prior strength, in pseudo-viewers
  c_p_cr  constant double precision := 0.35;  -- prior completion rate
  c_p_lr  constant double precision := 0.06;  -- prior like rate
  c_p_rr  constant double precision := 0.10;  -- prior rewatch rate
  c_p_sr  constant double precision := 0.30;  -- prior quick-skip rate
  c_skip_ms constant integer := 2000;
  v_run   timestamptz := clock_timestamp();
  v_n     integer := 0;
begin
  -- Never two runs at once (a slow run must not pile up behind cron).
  if not pg_try_advisory_xact_lock(hashtextextended('refresh_video_feed_stats', 0)) then
    return 0;
  end if;

  with active as (
    select v.id from public.videos v
     where v.is_draft = false and v.created_at >= now() - interval '60 days'
    union
    select e.video_id from public.video_engagement e
     where e.last_watched_at >= now() - interval '7 days'
    union
    select l.video_id from public.likes l
     where l.created_at >= now() - interval '48 hours'
  ),
  eng as (
    select e.video_id,
           count(*) as viewers,
           count(*) filter (where e.watch_count >= 2
                               or (e.max_completion_pct >= 0.9 and e.total_watch_ms >= c_skip_ms)) as completes,
           count(*) filter (where e.watch_count >= 2) as rewatchers,
           count(*) filter (where e.watch_count <= 1 and e.total_watch_ms < c_skip_ms) as skips,
           count(*) filter (where e.last_watched_at >= now() - interval '48 hours') as viewers_48h,
           count(*) filter (where e.last_watched_at >= now() - interval '48 hours'
                              and (e.watch_count >= 2
                                   or (e.max_completion_pct >= 0.9 and e.total_watch_ms >= c_skip_ms))) as completes_48h
      from public.video_engagement e
      join active a on a.id = e.video_id
     group by e.video_id
  ),
  lk as (select l.video_id, count(*) as n from public.likes l
          where l.created_at >= now() - interval '48 hours' group by l.video_id),
  sv as (select s.video_id, count(*) as n from public.saves s
          where s.created_at >= now() - interval '48 hours' group by s.video_id),
  cm as (select c.video_id, count(*) as n from public.comments c
          where c.created_at >= now() - interval '48 hours' group by c.video_id),
  calc as (
    select a.id as video_id,
           coalesce(eg.viewers, 0)::double precision       as viewers,
           coalesce(eg.completes, 0)::double precision     as completes,
           coalesce(eg.rewatchers, 0)::double precision    as rewatchers,
           coalesce(eg.skips, 0)::double precision         as skips,
           coalesce(eg.viewers_48h, 0)::double precision   as viewers_48h,
           coalesce(eg.completes_48h, 0)::double precision as completes_48h,
           coalesce(lk.n, 0)::double precision             as likes_48h,
           coalesce(cm.n, 0)::double precision             as comments_48h,
           coalesce(sv.n, 0)::double precision             as saves_48h,
           greatest(v.likes_count, 0)::double precision    as likes_total,
           greatest(v.views_count, 0)::double precision    as views_total
      from active a
      join public.videos v on v.id = a.id
      left join eng eg on eg.video_id = a.id
      left join lk on lk.video_id = a.id
      left join sv on sv.video_id = a.id
      left join cm on cm.video_id = a.id
  ),
  q as (
    select c.*,
           greatest(0.2, least(3.0,
               0.45 * ((c.completes   + c_k * c_p_cr) / (c.viewers + c_k)) / c_p_cr
             + 0.30 * ((c.likes_total + c_k * c_p_lr) / (greatest(c.viewers, c.views_total) + c_k)) / c_p_lr
             + 0.15 * ((c.rewatchers  + c_k * c_p_rr) / (c.viewers + c_k)) / c_p_rr
             + 0.10 * (1 - (c.skips   + c_k * c_p_sr) / (c.viewers + c_k)) / (1 - c_p_sr)
           )) as quality
      from calc c
  )
  insert into public.video_feed_stats as st (
    video_id, viewers, completes, rewatchers, skips,
    viewers_48h, completes_48h, likes_48h, comments_48h, saves_48h,
    quality, trend_score, updated_at)
  select q.video_id, q.viewers::int, q.completes::int, q.rewatchers::int, q.skips::int,
         q.viewers_48h::int, q.completes_48h::int, q.likes_48h::int, q.comments_48h::int, q.saves_48h::int,
         q.quality,
         sqrt(q.quality) * ln(1 + q.viewers_48h + 3 * q.completes_48h + 4 * q.likes_48h
                                + 6 * q.comments_48h + 5 * q.saves_48h),
         v_run
    from q
  on conflict on constraint video_feed_stats_pkey do update set
    viewers       = excluded.viewers,
    completes     = excluded.completes,
    rewatchers    = excluded.rewatchers,
    skips         = excluded.skips,
    viewers_48h   = excluded.viewers_48h,
    completes_48h = excluded.completes_48h,
    likes_48h     = excluded.likes_48h,
    comments_48h  = excluded.comments_48h,
    saves_48h     = excluded.saves_48h,
    quality       = excluded.quality,
    trend_score   = excluded.trend_score,
    updated_at    = excluded.updated_at;

  get diagnostics v_n = row_count;

  -- Videos that left the active set keep their quality (evergreen explore)
  -- but have no velocity any more.
  update public.video_feed_stats st
     set viewers_48h = 0, completes_48h = 0, likes_48h = 0, comments_48h = 0,
         saves_48h = 0, trend_score = 0, updated_at = v_run
   where st.updated_at < v_run
     and st.trend_score > 0;

  return v_n;
end;
$fn$;

revoke all on function public.refresh_video_feed_stats() from public, anon, authenticated;
grant execute on function public.refresh_video_feed_stats() to service_role;


-- ============================================================
-- 4. purge_feed_sessions  (cron, nightly)
-- ============================================================
create or replace function public.purge_feed_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n integer := 0;
begin
  delete from public.feed_session_pages pg where pg.created_at < now() - interval '2 days';
  get diagnostics v_n = row_count;
  delete from public.feed_sessions s where s.last_seen_at < now() - interval '30 days';
  return v_n;
end;
$fn$;

revoke all on function public.purge_feed_sessions() from public, anon, authenticated;
grant execute on function public.purge_feed_sessions() to service_role;


-- ============================================================
-- 5. fetch_fyp_feed
-- ============================================================
-- Same name, parameters, defaults and return columns as 0084, so CREATE OR
-- REPLACE is enough (language and volatility may change in place).
create or replace function public.fetch_fyp_feed(
  p_limit            integer default 20,
  p_offset           integer default 0,
  p_user_id          uuid    default null,
  p_max_per_creator  integer default 3
)
returns table (
  id uuid, user_id uuid, description text, music text, sound_id uuid,
  video_url text, thumbnail text, privacy text,
  likes_count integer, comments_count integer, shares_count integer,
  views_count integer, created_at timestamptz,
  user_name text, user_handle text, user_avatar_url text, user_verified boolean,
  saves_count integer, liked boolean, saved boolean, following boolean
)
language plpgsql
volatile
security definer
set search_path = public
as $fn$
#variable_conflict use_column
declare
  -- ── interest profile ──
  c_profile_days      constant integer          := 30;
  c_max_watch_rows    constant integer          := 1000;
  c_half_life_days    constant double precision := 7;
  c_skip_ms           constant integer          := 2000;
  c_w_complete        constant double precision := 1.0;
  c_w_rewatch         constant double precision := 0.75;
  c_w_like            constant double precision := 2.0;
  c_w_comment         constant double precision := 3.0;
  c_w_save            constant double precision := 3.0;
  c_w_follow          constant double precision := 2.0;
  c_w_interested      constant double precision := 2.0;
  c_w_skip            constant double precision := -0.5;
  c_w_not_interested  constant double precision := -4.0;
  c_norm_floor        constant double precision := 2.0;
  c_ia_creator        constant double precision := 1.0;
  c_ia_tag            constant double precision := 0.7;
  c_ia_sound          constant double precision := 0.5;
  c_min_interest      constant double precision := 0.15;
  c_history_min       constant integer          := 3;
  -- ── pools ──
  c_seen_days         constant integer          := 7;
  c_test_viewers      constant integer          := 30;
  c_test_hours        constant double precision := 72;
  c_fresh_tau_h       constant double precision := 72;
  c_page0_reuse       constant interval         := interval '2 minutes';

  v_sh_p  double precision;   -- personal share
  v_sh_t  double precision;   -- trending
  v_sh_f  double precision;   -- following
  v_sh_e  double precision;   -- explore / test batch
  v_sh_r  double precision;   -- fresh (no-history viewers)

  v_viewer   uuid;
  v_role     text;
  v_limit    integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_cap      integer := greatest(coalesce(p_max_per_creator, 3), 1);
  v_now      timestamptz := now();
  v_ref      timestamptz;     -- clock used for scoring
  v_seed     bigint;
  v_started  timestamptz;
  v_ids      uuid[];
  v_served   uuid[] := '{}';
  v_c_ids    uuid[] := '{}';  v_c_w double precision[] := '{}';
  v_s_ids    uuid[] := '{}';  v_s_w double precision[] := '{}';
  v_t_tags   text[] := '{}';  v_t_w double precision[] := '{}';
  v_ni_creators uuid[] := '{}';
  v_positive integer := 0;
begin
  -- ── 1. Viewer ──────────────────────────────────────────────
  v_viewer := auth.uid();
  if v_viewer is null then
    v_role := coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role');
    -- No end-user JWT (service_role, SQL editor): trust p_user_id.
    if v_role is null or v_role not in ('anon', 'authenticated') then
      v_viewer := p_user_id;
    end if;
  end if;
  if v_viewer is not null
     and not exists (select 1 from public.profiles pr where pr.id = v_viewer) then
    v_viewer := null;
  end if;

  -- ── 2. Session / page cache ───────────────────────────────
  if v_viewer is null then
    v_ref  := date_trunc('hour', v_now);
    v_seed := extract(epoch from v_ref)::bigint;
  else
    v_ref := v_now;
    perform pg_advisory_xact_lock(hashtextextended('fyp:' || v_viewer::text, 0));

    select s.started_at, s.seed into v_started, v_seed
      from public.feed_sessions s where s.user_id = v_viewer;

    if v_started is not null then
      select pg.video_ids into v_ids
        from public.feed_session_pages pg
       where pg.user_id = v_viewer
         and pg.page_offset = v_offset
         and pg.page_limit = v_limit
         and (v_offset > 0 or pg.created_at > v_now - c_page0_reuse);
    end if;

    if v_ids is null and (v_offset = 0 or v_started is null) then
      -- new session
      v_seed := floor(random() * 4503599627370496)::bigint;
      insert into public.feed_sessions as s (user_id, started_at, seed, last_seen_at)
      values (v_viewer, v_now, v_seed, v_now)
      on conflict on constraint feed_sessions_pkey do update
        set started_at = excluded.started_at, seed = excluded.seed, last_seen_at = excluded.last_seen_at;
      delete from public.feed_session_pages pg where pg.user_id = v_viewer;
    else
      update public.feed_sessions s set last_seen_at = v_now where s.user_id = v_viewer;
    end if;

    if v_ids is null then
      select coalesce(array_agg(distinct x.vid), '{}') into v_served
        from public.feed_session_pages pg
        cross join lateral unnest(pg.video_ids) as x(vid)
       where pg.user_id = v_viewer and pg.page_offset <> v_offset;
    end if;
  end if;

  -- ── 3. Build the page (unless served from the cache) ──────
  if v_ids is null then

    if v_viewer is not null then
      -- 3a. interest profile
      with ev as (
        select w.video_id, w.ts, w.w from (
          select e.video_id,
                 e.last_watched_at as ts,
                 case when e.watch_count <= 1 and e.total_watch_ms < c_skip_ms then c_w_skip
                      else c_w_complete * least(greatest(e.max_completion_pct::double precision, 0), 1)
                         + c_w_rewatch  * least(greatest(e.watch_count - 1, 0), 3)
                 end as w
            from public.video_engagement e
           where e.user_id = v_viewer
             and e.last_watched_at >= v_now - make_interval(days => c_profile_days)
           order by e.last_watched_at desc
           limit c_max_watch_rows
        ) w
        union all
        select l.video_id, l.created_at, c_w_like
          from public.likes l
         where l.user_id = v_viewer and l.created_at >= v_now - make_interval(days => c_profile_days)
        union all
        select s.video_id, s.created_at, c_w_save
          from public.saves s
         where s.user_id = v_viewer and s.created_at >= v_now - make_interval(days => c_profile_days)
        union all
        select c.video_id, max(c.created_at), c_w_comment
          from public.comments c
         where c.user_id = v_viewer and c.created_at >= v_now - make_interval(days => c_profile_days)
         group by c.video_id
        union all
        select f.video_id, f.created_at,
               case when f.feedback = 'interested' then c_w_interested else c_w_not_interested end
          from public.video_feedback f
         where f.user_id = v_viewer and f.created_at >= v_now - interval '90 days'
      ),
      vw as (
        select ev.video_id,
               sum(ev.w * exp(-0.6931471805599453
                              * greatest(extract(epoch from (v_now - ev.ts)), 0) / 86400.0
                              / c_half_life_days)) as w
          from ev
         group by ev.video_id
      ),
      vm as (
        select vw.video_id, vw.w, v.user_id as creator_id, v.sound_id as snd
          from vw join public.videos v on v.id = vw.video_id
         where v.user_id <> v_viewer
      ),
      aff as (
        select 'c'::text as dim, vm.creator_id::text as item, vm.w as a_raw from vm
        union all
        select 'c', f.followed_id::text,
               c_w_follow * exp(-0.6931471805599453
                                * greatest(extract(epoch from (v_now - f.created_at)), 0) / 86400.0
                                / (c_half_life_days * 4))
          from public.follows f
         where f.follower_id = v_viewer and f.created_at >= v_now - interval '90 days'
        union all
        select 's', vm.snd::text, vm.w from vm where vm.snd is not null
        union all
        select 't', vh.tag, vm.w / sqrt(nt.n)
          from vm
          join public.video_hashtags vh on vh.video_id = vm.video_id
          cross join lateral (select count(*)::double precision as n
                                from public.video_hashtags x where x.video_id = vm.video_id) nt
      ),
      agg as (
        select aff.dim, aff.item, sum(aff.a_raw) as a_raw
          from aff group by aff.dim, aff.item
        having sum(aff.a_raw) <> 0
      ),
      normed as (
        select agg.dim, agg.item,
               greatest(-1.0, least(1.0,
                 agg.a_raw / greatest(coalesce(max(agg.a_raw) filter (where agg.a_raw > 0)
                                                 over (partition by agg.dim), 0), c_norm_floor))) as a,
               row_number() over (partition by agg.dim order by abs(agg.a_raw) desc, agg.item) as rn
          from agg
      )
      select
        coalesce(array_agg(case when n.dim = 'c' then n.item::uuid end order by n.a desc, n.item) filter (where n.dim = 'c'), '{}'),
        coalesce(array_agg(n.a                                          order by n.a desc, n.item) filter (where n.dim = 'c'), '{}'),
        coalesce(array_agg(case when n.dim = 's' then n.item::uuid end order by n.a desc, n.item) filter (where n.dim = 's'), '{}'),
        coalesce(array_agg(n.a                                          order by n.a desc, n.item) filter (where n.dim = 's'), '{}'),
        coalesce(array_agg(n.item                                       order by n.a desc, n.item) filter (where n.dim = 't'), '{}'),
        coalesce(array_agg(n.a                                          order by n.a desc, n.item) filter (where n.dim = 't'), '{}'),
        count(*) filter (where n.a >= c_min_interest)
      into v_c_ids, v_c_w, v_s_ids, v_s_w, v_t_tags, v_t_w, v_positive
      from normed n
      where n.rn <= case n.dim when 'c' then 40 when 's' then 20 else 25 end;

      -- 2+ "not interested" on one creator hides that creator (as 0013).
      select coalesce(array_agg(t.creator_id), '{}') into v_ni_creators
        from (select v.user_id as creator_id
                from public.video_feedback f
                join public.videos v on v.id = f.video_id
               where f.user_id = v_viewer and f.feedback = 'not_interested'
               group by v.user_id
              having count(*) >= 2) t;
    end if;

    -- 3b. the mix
    if v_positive >= c_history_min then
      v_sh_p := 0.60; v_sh_t := 0.20; v_sh_f := 0.10; v_sh_e := 0.10; v_sh_r := 0;
    else
      v_sh_p := case when v_positive > 0 then 0.15 else 0 end;
      v_sh_t := 0.40; v_sh_f := 0.10; v_sh_e := 0.15; v_sh_r := 0.30;
    end if;

    -- 3c. candidates -> scores -> slots -> page
    with
    pc as (select u.cid as creator_id, u.w from unnest(v_c_ids, v_c_w) as u(cid, w)),
    ps as (select u.sid as snd, u.w from unnest(v_s_ids, v_s_w) as u(sid, w)),
    pt as (select u.tag, u.w from unnest(v_t_tags, v_t_w) as u(tag, w)),
    fol as (
      select f.followed_id from public.follows f
       where v_viewer is not null and f.follower_id = v_viewer
    ),
    served as (select distinct u.vid from unnest(v_served) as u(vid)),
    served_creators as (
      select v.user_id as creator_id, count(*)::double precision as n
        from served s join public.videos v on v.id = s.vid
       group by v.user_id
    ),
    cand as (
      -- personal: favourite creators
      select x.id from (select * from pc where pc.w >= c_min_interest) pcx
      cross join lateral (
        select v.id from public.videos v
         where v.user_id = pcx.creator_id and v.is_draft = false and v.privacy = 'public'
         order by v.created_at desc limit 8) x
      union
      -- personal: favourite sounds
      select x.id from (select * from ps where ps.w >= c_min_interest) psx
      cross join lateral (
        select v.id from public.videos v
         where v.sound_id = psx.snd and v.is_draft = false and v.privacy = 'public'
         order by v.created_at desc limit 15) x
      union
      -- personal: favourite hashtags
      select x.video_id from (select * from pt where pt.w >= c_min_interest) ptx
      cross join lateral (
        select vh.video_id from public.video_hashtags vh
         where vh.tag = ptx.tag
         order by vh.created_at desc limit 25) x
      union
      -- following: last 14 days of up to 500 followed creators
      select x.id from (
        select f.followed_id from public.follows f
         where v_viewer is not null and f.follower_id = v_viewer
         order by f.created_at desc limit 500) fo
      cross join lateral (
        select v.id from public.videos v
         where v.user_id = fo.followed_id and v.is_draft = false and v.privacy = 'public'
           and v.created_at >= v_ref - interval '14 days'
         order by v.created_at desc limit 4) x
      union
      -- trending (stats)
      (select st.video_id from public.video_feed_stats st
        where st.trend_score > 0 order by st.trend_score desc limit 300)
      union
      -- recent popular (works even before the first stats refresh)
      (select v.id from public.videos v
        where v.is_draft = false and v.privacy = 'public'
          and v.created_at >= v_ref - interval '7 days'
        order by (v.likes_count * 3 + v.comments_count * 5 + v.shares_count * 7
                  + coalesce(v.saves_count, 0) * 4 + v.views_count) desc, v.created_at desc
        limit 150)
      union
      -- fresh / test batch
      (select v.id from public.videos v
        where v.is_draft = false and v.privacy = 'public'
        order by v.created_at desc limit 300)
      union
      -- evergreen: proven good, any age
      (select st.video_id from public.video_feed_stats st
        where st.quality >= 1.1 and st.viewers >= c_test_viewers
        order by st.quality desc limit 200)
    ),
    elig as (
      select v.id, v.user_id as creator_id, v.sound_id as snd,
             v.likes_count as l_n, v.comments_count as c_n, v.shares_count as sh_n,
             v.views_count as vw_n, coalesce(v.saves_count, 0) as sv_n,
             (fo.followed_id is not null) as is_following,
             coalesce(st.viewers, 0) as viewers,
             coalesce(st.quality, 1.0)::double precision as q,
             coalesce(st.trend_score, 0)::double precision as trend,
             greatest(extract(epoch from (v_ref - v.created_at)) / 3600.0, 0)::double precision as age_h
        from (select distinct c.id from cand c) c
        join public.videos v   on v.id = c.id
        join public.profiles p on p.id = v.user_id
        left join fol fo on fo.followed_id = v.user_id
        left join public.video_feed_stats st on st.video_id = v.id
        left join served sd on sd.vid = v.id
       where sd.vid is null
         -- visibility: every rule of 0084, blocks both ways
         and v.is_draft = false
         and v.privacy = 'public'
         and coalesce(v.is_hidden, false) = false
         and coalesce(v.is_archived, false) = false
         and p.deactivated_at is null
         and (p.banned_until is null or p.banned_until <= v_now)
         and (not coalesce(p.is_private, false)
              or v.user_id = v_viewer
              or fo.followed_id is not null)
         and (v_viewer is null or (
                  not exists (select 1 from public.blocks b
                               where b.blocker_id = v_viewer and b.blocked_id = v.user_id)
              and not exists (select 1 from public.blocks b
                               where b.blocker_id = v.user_id and b.blocked_id = v_viewer)
              and not exists (select 1 from public.muted_users m
                               where m.user_id = v_viewer and m.muted_id = v.user_id)
              and not exists (select 1 from public.video_feedback nf
                               where nf.user_id = v_viewer and nf.video_id = v.id
                                 and nf.feedback = 'not_interested')
              and not (v.user_id = any (v_ni_creators))))
    ),
    feat as (
      select e.*,
             coalesce(pc.w, 0) as a_c,
             coalesce(ps.w, 0) as a_s,
             coalesce((select case when count(*) = 0 then 0
                                   else greatest(-1.0, least(1.0, sum(pt.w) / sqrt(count(*)))) end
                         from public.video_hashtags vh
                         join pt on pt.tag = vh.tag
                        where vh.video_id = e.id), 0) as a_t,
             (v_viewer is not null and exists (
                select 1 from public.video_engagement ve
                 where ve.user_id = v_viewer and ve.video_id = e.id
                   and ve.last_watched_at >= v_now - make_interval(days => c_seen_days))) as seen,
             coalesce(sc.n, 0) as served_n,
             ((hashtextextended(e.id::text, v_seed) & 1048575)::double precision / 1048576.0) as j,
             exp(-e.age_h / c_fresh_tau_h) as f,
             least(ln(1 + greatest(3 * e.l_n + 5 * e.c_n + 7 * e.sh_n + 4 * e.sv_n + e.vw_n, 0)::double precision)
                   / 10.0, 1.5) as pop
        from elig e
        left join pc on pc.creator_id = e.creator_id
        left join ps on ps.snd = e.snd
        left join served_creators sc on sc.creator_id = e.creator_id
    ),
    flags as (
      select ft.*,
             (c_ia_creator * ft.a_c + c_ia_tag * ft.a_t + c_ia_sound * ft.a_s) as interest,
             (ft.age_h < c_test_hours and ft.viewers < c_test_viewers) as in_test,
             (ft.viewers >= c_test_viewers and ft.q < 0.7)  as failed,
             (ft.viewers >= c_test_viewers and ft.q >= 1.15) as graduated,
             0.25 * ft.served_n as pen
        from feat ft
    ),
    pts as (
      select r.*,
             3.0 * r.interest + 0.8 * (r.q - 1) + 0.6 * r.f + 0.3 * r.pop + 0.4 * r.j
               - r.pen - case when r.failed then 1.0 else 0 end                         as s_p,
             r.trend / 5.0 + 0.5 * r.pop * r.f
               + 0.3 * greatest(r.interest, 0) + 1.5 * least(r.interest, 0)
               + 0.3 * r.j - r.pen - case when r.failed then 1.0 else 0 end             as s_t,
             1.5 * r.f + 0.5 * (r.q - 1) + 0.3 * r.pop + 0.5 * r.interest
               + 0.3 * r.j - r.pen                                                      as s_f,
             case when r.in_test then 2.0 + (1.0 - r.viewers::double precision / c_test_viewers) else 0 end
               + case when r.graduated then 0.5 else 0 end
               + 0.6 * r.f + 1.0 * r.j
               - 0.5 * greatest(r.interest, 0) + 1.5 * least(r.interest, 0) - r.pen    as s_e,
             1.0 * r.f + 0.5 * (r.q - 1) + 0.3 * r.pop + 1.0 * r.interest
               + 0.5 * r.j - r.pen - case when r.failed then 1.0 else 0 end             as s_r
        from flags r
    ),
    slots as (
      select r.id, ((row_number() over (order by r.s_p desc, r.id) - 0.5) / v_sh_p)::double precision as k
        from pts r
       where v_sh_p > 0 and not r.seen and r.interest >= c_min_interest
      union all
      select r.id, ((row_number() over (order by r.s_t desc, r.id) - 0.5) / v_sh_t)::double precision
        from pts r
       where v_sh_t > 0 and not r.seen and not r.failed and (r.trend > 0 or r.age_h < 168)
      union all
      select r.id, ((row_number() over (order by r.s_f desc, r.id) - 0.5) / v_sh_f)::double precision
        from pts r
       where v_sh_f > 0 and not r.seen and r.is_following and r.age_h < 336
      union all
      select r.id, ((row_number() over (order by r.s_e desc, r.id) - 0.5) / v_sh_e)::double precision
        from pts r
       where v_sh_e > 0 and not r.seen and not r.failed
         and (r.in_test or r.graduated or (r.q >= 1.1 and r.viewers >= c_test_viewers))
      union all
      select r.id, ((row_number() over (order by r.s_r desc, r.id) - 0.5) / v_sh_r)::double precision
        from pts r
       where v_sh_r > 0 and not r.seen and not r.failed and r.age_h < 168
      union all
      -- filler: anything unseen, after every pool
      select r.id, (1e6 + row_number() over (order by r.s_p desc, r.id))::double precision
        from pts r
       where not r.seen
      union all
      -- backfill: already watched in the last 7 days, only once all else is gone
      select r.id, (2e6 + row_number() over (order by r.s_p desc, r.id))::double precision
        from pts r
       where r.seen
    ),
    keyed as (
      select sl.id, min(sl.k) as k from slots sl group by sl.id
    ),
    capped as (
      select kd.id, kd.k,
             row_number() over (partition by p.creator_id order by kd.k, kd.id) as crn
        from keyed kd join pts p on p.id = kd.id
    )
    select coalesce(array_agg(pg.id order by pg.k, pg.id), '{}') into v_ids
      from (select c.id, c.k from capped c
             where c.crn <= v_cap
             order by c.k, c.id
            offset (case when v_viewer is null then v_offset else 0 end)
             limit v_limit) pg;

    if v_viewer is not null then
      insert into public.feed_session_pages as pg (user_id, page_offset, page_limit, video_ids, created_at)
      values (v_viewer, v_offset, v_limit, v_ids, v_now)
      on conflict on constraint feed_session_pages_pkey do update
        set page_limit = excluded.page_limit,
            video_ids  = excluded.video_ids,
            created_at = excluded.created_at;
    end if;
  end if;

  -- ── 4. Rows, in page order, visibility re-checked ─────────
  -- liked / saved / following are for auth.uid() only (see 0084).
  return query
  select v.id, v.user_id, v.description, v.music, v.sound_id, v.video_url, v.thumbnail, v.privacy,
         v.likes_count, v.comments_count, v.shares_count, v.views_count, v.created_at,
         p.name, p.handle, p.avatar_url, p.verified,
         coalesce(v.saves_count, 0),
         (auth.uid() is not null and exists (
            select 1 from public.likes l
             where l.user_id = auth.uid() and l.video_id = v.id)),
         (auth.uid() is not null and exists (
            select 1 from public.saves s
             where s.user_id = auth.uid() and s.video_id = v.id)),
         (auth.uid() is not null and exists (
            select 1 from public.follows f
             where f.follower_id = auth.uid() and f.followed_id = v.user_id))
    from unnest(coalesce(v_ids, '{}'::uuid[])) with ordinality as u(vid, ord)
    join public.videos v   on v.id = u.vid
    join public.profiles p on p.id = v.user_id
   where v.is_draft = false
     and v.privacy = 'public'
     and coalesce(v.is_hidden, false) = false
     and coalesce(v.is_archived, false) = false
     and p.deactivated_at is null
     and (p.banned_until is null or p.banned_until <= v_now)
     and (not coalesce(p.is_private, false)
          or v.user_id = v_viewer
          or (v_viewer is not null and exists (
                select 1 from public.follows f2
                 where f2.follower_id = v_viewer and f2.followed_id = v.user_id)))
     and (v_viewer is null or (
              not exists (select 1 from public.blocks b
                           where b.blocker_id = v_viewer and b.blocked_id = v.user_id)
          and not exists (select 1 from public.blocks b
                           where b.blocker_id = v.user_id and b.blocked_id = v_viewer)
          and not exists (select 1 from public.muted_users m
                           where m.user_id = v_viewer and m.muted_id = v.user_id)
          and not exists (select 1 from public.video_feedback nf
                           where nf.user_id = v_viewer and nf.video_id = v.id
                             and nf.feedback = 'not_interested')))
   order by u.ord;
end;
$fn$;

grant execute on function public.fetch_fyp_feed(integer, integer, uuid, integer) to authenticated, anon;


-- ============================================================
-- 6. Backfill + schedules
-- ============================================================
select public.refresh_video_feed_stats();

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled - functions created, nothing scheduled. '
                 'Run select public.refresh_video_feed_stats(); periodically.';
    return;
  end if;
  begin perform cron.unschedule('refresh-video-feed-stats'); exception when others then null; end;
  begin perform cron.unschedule('purge-feed-sessions');      exception when others then null; end;
  perform cron.schedule('refresh-video-feed-stats', '*/10 * * * *',
                        'select public.refresh_video_feed_stats()');
  perform cron.schedule('purge-feed-sessions', '55 3 * * *',
                        'select public.purge_feed_sessions()');
end $$;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- CHECKS (run by hand in the SQL editor; not part of the migration)
-- ============================================================
--
-- -- Signature and return shape are unchanged (expect one row, 21 columns):
-- select pg_get_function_identity_arguments(p.oid) as args,
--        pg_get_function_result(p.oid)             as result,
--        p.provolatile, p.prosecdef, p.proconfig
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'fetch_fyp_feed';
--
-- -- Stats are populated; distribution of quality / test batch:
-- select count(*)                                      as rows,
--        count(*) filter (where trend_score > 0)       as trending,
--        count(*) filter (where viewers < 30)          as under_test_threshold,
--        round(avg(quality)::numeric, 3)               as avg_quality,
--        max(updated_at)                               as last_refresh
--   from public.video_feed_stats;
--
-- -- Anonymous feed (SQL editor has no JWT; pass null):
-- select id, user_handle, created_at, likes_count
--   from public.fetch_fyp_feed(20, 0, null);
--
-- -- A real user's feed: page 0 then page 1 must not overlap
-- -- (replace the uuid; the SQL editor has no JWT, so p_user_id is trusted):
-- with p0 as (select id from public.fetch_fyp_feed(20, 0,  '00000000-0000-0000-0000-000000000000')),
--      p1 as (select id from public.fetch_fyp_feed(20, 20, '00000000-0000-0000-0000-000000000000'))
-- select (select count(*) from p0) as page0,
--        (select count(*) from p1) as page1,
--        (select count(*) from p0 join p1 using (id)) as duplicates;   -- expect 0
--
-- -- Timing (target < 100 ms for 20 rows). Run twice; the second call of
-- -- the same offset is a cache hit, so use a fresh offset to time a build:
-- explain (analyze, buffers, timing)
-- select * from public.fetch_fyp_feed(20, 0, '00000000-0000-0000-0000-000000000000');
-- -- The function body is opaque to EXPLAIN; to see the inner plans:
-- --   load 'auto_explain';
-- --   set auto_explain.log_min_duration = 0;
-- --   set auto_explain.log_nested_statements = on;
-- --   set auto_explain.log_analyze = on;
-- -- then run the select above and read the Postgres log.
--
-- -- Cron jobs (only where pg_cron is enabled):
-- select jobname, schedule, active from cron.job
--  where jobname in ('refresh-video-feed-stats', 'purge-feed-sessions');
--
-- -- Session state for one user:
-- select s.started_at, s.last_seen_at, pg.page_offset, cardinality(pg.video_ids)
--   from public.feed_sessions s
--   left join public.feed_session_pages pg on pg.user_id = s.user_id
--  where s.user_id = '00000000-0000-0000-0000-000000000000'
--  order by pg.page_offset;
