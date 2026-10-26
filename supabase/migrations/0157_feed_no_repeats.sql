-- ============================================================
-- 0157_feed_no_repeats.sql   (Mumbai, vfkwipvinmnybilcrdzr)
--
-- For You, Instagram-style repeats: a video the viewer has watched stays out
-- of their feed for 30 days (was 7, 0108 c_seen_days). Watched videos still
-- come back as last-resort backfill when nothing unseen is left, so a young
-- app with few videos never shows an empty feed; that backfill now shows the
-- LEAST recently watched first, so repeats rotate instead of the same top
-- video returning each time.
--
-- fetch_fyp_feed is re-created from the live (0108) definition with only:
--   c_seen_days 7 -> 30; the per-row "seen" flag becomes seen_at (last watch
--   time in the window) with seen = seen_at is not null; backfill ordered by
--   seen_at asc, then score. Signature, return columns, grants, sessions,
--   visibility and scoring are unchanged. video_engagement is never purged
--   and (user_id, last_watched_at desc) is indexed (0108), so 30 days is cheap.
--
-- Safe to re-run (create or replace).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fetch_fyp_feed(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_user_id uuid DEFAULT NULL::uuid, p_max_per_creator integer DEFAULT 3)
 RETURNS TABLE(id uuid, user_id uuid, description text, music text, sound_id uuid, video_url text, thumbnail text, privacy text, likes_count integer, comments_count integer, shares_count integer, views_count integer, created_at timestamp with time zone, user_name text, user_handle text, user_avatar_url text, user_verified boolean, saves_count integer, liked boolean, saved boolean, following boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  c_seen_days         constant integer          := 30;  -- 0157: was 7
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
             -- 0157: when the viewer last watched it (null = not in the window)
             (select max(ve.last_watched_at) from public.video_engagement ve
               where v_viewer is not null and ve.user_id = v_viewer and ve.video_id = e.id
                 and ve.last_watched_at >= v_now - make_interval(days => c_seen_days)) as seen_at,
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
             (ft.seen_at is not null) as seen,
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
      -- backfill: already watched in the last c_seen_days, only once all else
      -- is gone; least recently watched first so repeats rotate (0157)
      select r.id, (2e6 + row_number() over (order by r.seen_at asc, r.s_p desc, r.id))::double precision
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
$function$;


-- Checks (SELECT only)
-- Expect: true, true
select position('c_seen_days         constant integer          := 30' in d) > 0 as seen_30_days,
       position('order by r.seen_at asc' in d) > 0 as backfill_rotates
  from (select pg_get_functiondef('public.fetch_fyp_feed(integer,integer,uuid,integer)'::regprocedure) d) x;
