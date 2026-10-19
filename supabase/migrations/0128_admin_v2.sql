-- ============================================================
-- 0128 - admin panel v2 (web/admin-v2.html) for the Mumbai project
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply after 0125 (and after
-- whatever 0126/0127 exist). Safe to re-run: every function is dropped and
-- re-created, the constraint change is computed from what is there now.
-- Do NOT apply to the old project (qnzgxihlrwanywndcmpf): its admin panel
-- (web/admin.html) talks to that project directly and needs none of this.
--
-- Why a set of RPCs instead of table reads from the browser:
--   * 0124 took is_admin, banned_until, deactivated_at and
--     deletion_scheduled_at away from the authenticated role at COLUMN level.
--     RLS cannot give them back to admins, so the old panel's
--     select('... is_admin, banned_until ...') fails on Mumbai, and so would
--     an UPDATE ... RETURNING of those columns.
--   * live_streams, wallet_topups and story reports have no admin read path.
--   * every action writes admin_logs inside the same transaction, instead of
--     trusting the browser to send a second request.
--
-- Every function below is SECURITY DEFINER, refuses unless is_admin() is
-- true for auth.uid() (0002), is revoked from public/anon and granted to
-- authenticated only. No service-role key is ever needed in the browser.
--
-- Also: reports.target_type gains 'story' and 'live_comment' (extended from
-- whatever the constraint allows today, the 0104 way), so stories and live
-- chat lines can be reported and worked in the panel. Existing values keep
-- working; the app may keep reporting live chat as target_type 'user' with
-- the 'مباشر' context in the reason - the panel's "Live" filter covers both.
--
-- Functions (all prefixed admin_v2_ so nothing existing is replaced):
--   admin_v2_counts()                         dashboard + sidebar badges
--   admin_v2_list_users(search, status, limit, offset)
--   admin_v2_user_detail(user)
--   admin_v2_set_ban(user, until, reason)     until null = unban
--   admin_v2_set_admin(user, make)
--   admin_v2_set_verified(user, verified)
--   admin_v2_list_reports(status, type, limit, offset)
--   admin_v2_resolve_report(report, status, action, all_for_target)
--   admin_v2_set_hidden(type, id, hidden, reason)       video | comment
--   admin_v2_delete_content(type, id, reason)           video | comment | story | live_comment
--   admin_v2_list_videos(filter, search, limit, offset)
--   admin_v2_list_stories(filter, limit)
--   admin_v2_list_lives(status, limit)
--   admin_v2_live_comments(live, limit)
--   admin_v2_end_live(live, reason)
--   admin_v2_wallet_overview(days)            read-only
--   admin_v2_storage_overview()               Supabase Storage + R2 ledger
-- Existing functions the panel also calls: is_admin, admin_growth,
-- admin_pending_deletions, admin_cancel_deletion, admin_delete_user,
-- admin_moderation_recent. Tables it reads/updates directly under existing
-- admin policies: support_tickets, data_export_requests, admin_logs,
-- app_limits, comments (read).
-- ============================================================

begin;

-- ── 0. reports.target_type: + 'story', + 'live_comment' ─────────────────
do $$
declare
  v_def   text;
  v_name  text;
  v_types text[];
begin
  select c.conname, pg_get_constraintdef(c.oid) into v_name, v_def
    from pg_constraint c
   where c.conrelid = 'public.reports'::regclass
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%target_type%'
   limit 1;

  -- The list renders either as ARRAY['a'::text, ...] or as '{a,b}'::text[];
  -- read both, so a re-run never mistakes '{a,b}' for one value.
  select coalesce(array_agg(distinct t), '{}')
    into v_types
    from (select trim(both '" ' from unnest(
                   case when m[1] like '{%}' then string_to_array(trim(both '{}' from m[1]), ',')
                        else array[m[1]] end)) as t
            from regexp_matches(coalesce(v_def, ''), '''([^'']+)''', 'g') as m) s
   where t <> '';

  if 'story' = any (v_types) and 'live_comment' = any (v_types) then return; end if;

  if cardinality(v_types) = 0 then
    v_types := array['video', 'comment', 'user', 'live_stream'];
  end if;
  if not ('story' = any (v_types)) then v_types := v_types || array['story']; end if;
  if not ('live_comment' = any (v_types)) then v_types := v_types || array['live_comment']; end if;

  if v_name is not null then
    execute format('alter table public.reports drop constraint %I', v_name);
  end if;
  execute format(
    'alter table public.reports add constraint reports_target_type_check check (target_type in (%s))',
    (select string_agg(quote_literal(t), ', ' order by t) from unnest(v_types) as t));
end $$;


-- ── 1. Counts ───────────────────────────────────────────────────────────
drop function if exists public.admin_v2_counts();
create function public.admin_v2_counts()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  return jsonb_build_object(
    'users_total',        (select count(*) from public.profiles),
    'users_today',        (select count(*) from public.profiles where created_at >= date_trunc('day', now())),
    'videos_total',       (select count(*) from public.videos where is_draft = false),
    'videos_today',       (select count(*) from public.videos where is_draft = false and created_at >= date_trunc('day', now())),
    'open_reports',       (select count(*) from public.reports where status = 'pending'),
    'ai_flags_pending',   (select count(*) from public.reports where status = 'pending' and reporter_id is null),
    'reported_stories',   (select count(*) from public.reports where status = 'pending' and target_type = 'story'),
    'reported_live',      (select count(*) from public.reports
                            where status = 'pending'
                              and (target_type in ('live_stream', 'live_comment')
                                   or (target_type = 'user' and reason like '%مباشر%'))),
    'open_tickets',       (select count(*) from public.support_tickets where status in ('open', 'in_progress')),
    'pending_exports',    (select count(*) from public.data_export_requests where status = 'pending'),
    'pending_deletions',  (select count(*) from public.profiles where deletion_scheduled_at is not null),
    'banned_users',       (select count(*) from public.profiles where banned_until is not null and banned_until > now()),
    'live_now',           (select count(*) from public.live_streams where status = 'live'),
    'active_stories',     (select count(*) from public.stories where expires_at > now()),
    'pending_topups',     (select count(*) from public.wallet_topups where status = 'pending'),
    'location_sharers',   (select count(*) from public.user_locations
                            where sharing_enabled and updated_at > now() - interval '8 hours'),
    'scans_unavailable_24h', (select count(*) from public.moderation_events
                               where outcome = 'unavailable' and created_at > now() - interval '24 hours'),
    'content_blocked_24h',   (select count(*) from public.moderation_events
                               where outcome = 'block' and created_at > now() - interval '24 hours')
  );
end;
$fn$;


-- ── 2. Users ────────────────────────────────────────────────────────────
drop function if exists public.admin_v2_list_users(text, text, integer, integer);
create function public.admin_v2_list_users(
  p_search text    default null,
  p_status text    default 'all',
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, name text, handle text, email text, avatar_url text, verified boolean,
  is_admin boolean, banned_until timestamptz, deactivated_at timestamptz,
  deletion_scheduled_at timestamptz, followers_count integer, videos_count bigint,
  open_reports bigint, created_at timestamptz, last_sign_in_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public, auth
as $fn$
#variable_conflict use_column
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_uuid uuid;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  if v_term ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := v_term::uuid;
  end if;
  v_term := ltrim(v_term, '@');

  return query
  select p.id, p.name, p.handle, u.email::text, p.avatar_url, p.verified,
         p.is_admin, p.banned_until, p.deactivated_at, p.deletion_scheduled_at,
         p.followers_count,
         (select count(*) from public.videos v where v.user_id = p.id),
         (select count(*) from public.reports r
           where r.status = 'pending' and r.target_type = 'user' and r.target_id = p.id),
         p.created_at, u.last_sign_in_at
    from public.profiles p
    left join auth.users u on u.id = p.id
   where (v_term is null
          or (v_uuid is not null and p.id = v_uuid)
          or strpos(lower(coalesce(p.handle, '')), v_term) > 0
          or strpos(lower(coalesce(p.name, '')), v_term) > 0
          or strpos(lower(coalesce(u.email::text, '')), v_term) > 0)
     and case coalesce(p_status, 'all')
           when 'banned'      then p.banned_until is not null and p.banned_until > now()
           when 'admin'       then p.is_admin
           when 'deleting'    then p.deletion_scheduled_at is not null
           when 'deactivated' then p.deactivated_at is not null
           when 'active'      then (p.banned_until is null or p.banned_until <= now()) and p.deactivated_at is null
           else true
         end
   order by p.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$fn$;

drop function if exists public.admin_v2_user_detail(uuid);
create function public.admin_v2_user_detail(p_user uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, auth
as $fn$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  select jsonb_build_object(
    'profile', to_jsonb(p),
    'email', u.email,
    'phone', u.phone,
    'auth_created_at', u.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'wallet', (select to_jsonb(w) from public.wallets w where w.user_id = p.id),
    'location', (select jsonb_build_object('sharing_enabled', l.sharing_enabled,
                                           'visibility', l.visibility,
                                           'updated_at', l.updated_at)
                   from public.user_locations l where l.user_id = p.id),
    'counts', jsonb_build_object(
      'videos',          (select count(*) from public.videos x where x.user_id = p.id),
      'videos_hidden',   (select count(*) from public.videos x where x.user_id = p.id and x.is_hidden),
      'stories_active',  (select count(*) from public.stories s where s.user_id = p.id and s.expires_at > now()),
      'comments',        (select count(*) from public.comments c where c.user_id = p.id),
      'lives',           (select count(*) from public.live_streams ls where ls.host_id = p.id),
      'reports_filed',   (select count(*) from public.reports r where r.reporter_id = p.id),
      'tickets',         (select count(*) from public.support_tickets t where t.user_id = p.id)
    ),
    'recent_videos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', x.id, 'thumbnail', x.thumbnail, 'video_url', x.video_url,
               'description', x.description, 'is_hidden', x.is_hidden,
               'is_draft', x.is_draft, 'views_count', x.views_count,
               'created_at', x.created_at) order by x.created_at desc), '[]'::jsonb)
        from (select * from public.videos where user_id = p.id order by created_at desc limit 12) x),
    'active_stories', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'media_url', s.media_url, 'poster_url', s.poster_url,
               'media_kind', s.media_kind, 'caption', s.caption,
               'created_at', s.created_at, 'expires_at', s.expires_at) order by s.created_at desc), '[]'::jsonb)
        from public.stories s where s.user_id = p.id and s.expires_at > now()),
    'reports_against', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'target_type', r.target_type, 'target_id', r.target_id,
               'reason', r.reason, 'status', r.status, 'created_at', r.created_at)
               order by r.created_at desc), '[]'::jsonb)
        from (select r.* from public.reports r
               where (r.target_type = 'user'        and r.target_id = p.id)
                  or (r.target_type = 'video'       and r.target_id in (select id from public.videos where user_id = p.id))
                  or (r.target_type = 'comment'     and r.target_id in (select id from public.comments where user_id = p.id))
                  or (r.target_type = 'story'       and r.target_id in (select id from public.stories where user_id = p.id))
                  or (r.target_type = 'live_stream' and r.target_id in (select id from public.live_streams where host_id = p.id))
                  or (r.target_type = 'live_comment' and r.target_id in (select id from public.live_comments where user_id = p.id))
               order by r.created_at desc limit 30) r),
    'recent_logs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'action', al.action, 'created_at', al.created_at, 'payload', al.payload,
               'admin_handle', (select ap.handle from public.profiles ap where ap.id = al.admin_id))
               order by al.created_at desc), '[]'::jsonb)
        from (select * from public.admin_logs
               where target_type = 'user' and target_id = p.id
               order by created_at desc limit 20) al)
  )
  into v
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_user;

  return v;
end;
$fn$;

drop function if exists public.admin_v2_set_ban(uuid, timestamptz, text);
create function public.admin_v2_set_ban(p_user uuid, p_until timestamptz, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_ended integer := 0;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'you cannot ban your own account'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'no such user'; end if;

  update public.profiles
     set banned_until = case when p_until is null or p_until <= now() then null else p_until end
   where id = p_user;

  -- A banned host does not keep broadcasting.
  if p_until is not null and p_until > now() then
    update public.live_streams
       set status = 'banned', ended_at = coalesce(ended_at, now())
     where host_id = p_user and status = 'live';
    get diagnostics v_ended = row_count;
  end if;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(),
          case when p_until is null or p_until <= now() then 'unban_user' else 'ban_user' end,
          'user', p_user,
          jsonb_build_object('until', p_until, 'reason', p_reason, 'lives_ended', v_ended));
end;
$fn$;

drop function if exists public.admin_v2_set_admin(uuid, boolean);
create function public.admin_v2_set_admin(p_user uuid, p_make boolean)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_user = auth.uid() and not coalesce(p_make, false) then
    raise exception 'you cannot remove your own admin rights';
  end if;

  update public.profiles set is_admin = coalesce(p_make, false) where id = p_user;
  if not found then raise exception 'no such user'; end if;

  insert into public.admin_logs (admin_id, action, target_type, target_id)
  values (auth.uid(), case when p_make then 'grant_admin' else 'revoke_admin' end, 'user', p_user);
end;
$fn$;

drop function if exists public.admin_v2_set_verified(uuid, boolean);
create function public.admin_v2_set_verified(p_user uuid, p_verified boolean)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  update public.profiles set verified = coalesce(p_verified, false) where id = p_user;
  if not found then raise exception 'no such user'; end if;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'set_verified', 'user', p_user, jsonb_build_object('verified', p_verified));
end;
$fn$;


-- ── 3. Reports ──────────────────────────────────────────────────────────
-- p_type: null/'all', one target_type, or 'live' (live_stream + live_comment +
-- user reports filed from inside a live, which carry 'مباشر' in the reason).
drop function if exists public.admin_v2_list_reports(text, text, integer, integer);
create function public.admin_v2_list_reports(
  p_status text    default 'pending',
  p_type   text    default null,
  p_limit  integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid, target_type text, target_id uuid, reason text, status text,
  action_taken text, created_at timestamptz, resolved_at timestamptz,
  reporter_id uuid, reporter_handle text, reporter_name text,
  is_ai boolean, same_target_pending bigint, target jsonb
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
  select r.id, r.target_type, r.target_id, r.reason, r.status, r.action_taken,
         r.created_at, r.resolved_at, r.reporter_id, rp.handle, rp.name,
         (r.reporter_id is null),
         (select count(*) from public.reports r2
           where r2.status = 'pending' and r2.target_type = r.target_type and r2.target_id = r.target_id),
         case r.target_type
           when 'video' then (
             select jsonb_build_object('exists', true, 'owner_id', v.user_id, 'owner_handle', o.handle,
                      'owner_name', o.name, 'description', v.description, 'thumbnail', v.thumbnail,
                      'video_url', v.video_url, 'is_hidden', v.is_hidden, 'hidden_reason', v.hidden_reason,
                      'created_at', v.created_at)
               from public.videos v left join public.profiles o on o.id = v.user_id
              where v.id = r.target_id)
           when 'comment' then (
             select jsonb_build_object('exists', true, 'owner_id', c.user_id, 'owner_handle', o.handle,
                      'owner_name', o.name, 'text', c.text, 'video_id', c.video_id,
                      'is_hidden', c.is_hidden, 'hidden_reason', c.hidden_reason, 'created_at', c.created_at)
               from public.comments c left join public.profiles o on o.id = c.user_id
              where c.id = r.target_id)
           when 'user' then (
             select jsonb_build_object('exists', true, 'owner_id', o.id, 'owner_handle', o.handle,
                      'owner_name', o.name, 'avatar_url', o.avatar_url, 'banned_until', o.banned_until,
                      'is_admin', o.is_admin)
               from public.profiles o where o.id = r.target_id)
           when 'live_stream' then (
             select jsonb_build_object('exists', true, 'owner_id', ls.host_id, 'owner_handle', o.handle,
                      'owner_name', o.name, 'title', ls.title, 'thumbnail', ls.thumbnail,
                      'status', ls.status, 'started_at', ls.started_at, 'ended_at', ls.ended_at)
               from public.live_streams ls left join public.profiles o on o.id = ls.host_id
              where ls.id = r.target_id)
           when 'story' then (
             select jsonb_build_object('exists', true, 'owner_id', s.user_id, 'owner_handle', o.handle,
                      'owner_name', o.name, 'media_url', s.media_url, 'poster_url', s.poster_url,
                      'media_kind', s.media_kind, 'caption', s.caption,
                      'created_at', s.created_at, 'expires_at', s.expires_at)
               from public.stories s left join public.profiles o on o.id = s.user_id
              where s.id = r.target_id)
           when 'live_comment' then (
             select jsonb_build_object('exists', true, 'owner_id', lc.user_id, 'owner_handle', o.handle,
                      'owner_name', o.name, 'text', lc.text, 'live_stream_id', lc.live_stream_id,
                      'created_at', lc.created_at)
               from public.live_comments lc left join public.profiles o on o.id = lc.user_id
              where lc.id = r.target_id)
         end
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
   where (p_status is null or p_status = 'all' or r.status = p_status)
     and (p_type is null or p_type in ('', 'all')
          or (p_type = 'live' and (r.target_type in ('live_stream', 'live_comment')
                                   or (r.target_type = 'user' and r.reason like '%مباشر%')))
          or (p_type = 'ai' and r.reporter_id is null)
          or r.target_type = p_type)
   order by r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 300))
  offset greatest(0, coalesce(p_offset, 0));
end;
$fn$;

-- Resolves one report, or (default) every pending report on the same target.
-- Dismissing undoes an AUTOMATIC hide (hidden_reason 'auto:...', 0012/0014)
-- of a video or comment; a hide an admin made by hand is left alone.
drop function if exists public.admin_v2_resolve_report(uuid, text, text, boolean);
create function public.admin_v2_resolve_report(
  p_report         uuid,
  p_status         text,
  p_action         text    default null,
  p_all_for_target boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r public.reports%rowtype;
  n integer;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_status not in ('resolved', 'dismissed', 'reviewed') then raise exception 'bad status'; end if;

  select * into r from public.reports where id = p_report;
  if not found then raise exception 'no such report'; end if;

  update public.reports
     set status = p_status, action_taken = p_action,
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_report
      or (coalesce(p_all_for_target, true)
          and status = 'pending'
          and target_type = r.target_type and target_id = r.target_id);
  get diagnostics n = row_count;

  if p_status = 'dismissed' then
    if r.target_type = 'video' then
      update public.videos set is_hidden = false, hidden_at = null, hidden_reason = null
       where id = r.target_id and is_hidden and coalesce(hidden_reason, '') like 'auto:%';
    elsif r.target_type = 'comment' then
      update public.comments set is_hidden = false, hidden_at = null, hidden_reason = null
       where id = r.target_id and is_hidden and coalesce(hidden_reason, '') like 'auto:%';
    end if;
  end if;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'resolve_report', 'report', p_report,
          jsonb_build_object('status', p_status, 'action', p_action, 'rows', n,
                             'target_type', r.target_type, 'target_id', r.target_id));
  return n;
end;
$fn$;


-- ── 4. Content actions ──────────────────────────────────────────────────
drop function if exists public.admin_v2_set_hidden(text, uuid, boolean, text);
create function public.admin_v2_set_hidden(p_type text, p_id uuid, p_hidden boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  if p_type = 'video' then
    update public.videos
       set is_hidden = coalesce(p_hidden, true),
           hidden_at = case when p_hidden then now() else null end,
           hidden_reason = case when p_hidden then 'admin: ' || coalesce(nullif(trim(p_reason), ''), 'moderation') else null end
     where id = p_id;
  elsif p_type = 'comment' then
    update public.comments
       set is_hidden = coalesce(p_hidden, true),
           hidden_at = case when p_hidden then now() else null end,
           hidden_reason = case when p_hidden then 'admin: ' || coalesce(nullif(trim(p_reason), ''), 'moderation') else null end
     where id = p_id;
  else
    raise exception 'only videos and comments can be hidden; delete stories and live comments instead';
  end if;
  if not found then raise exception 'not found'; end if;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), case when p_hidden then 'hide_content' else 'unhide_content' end,
          p_type, p_id, jsonb_build_object('reason', p_reason));
end;
$fn$;

-- Deleting a video queues its files in media_delete_queue (0102/0110), the
-- same way a deleted story's files already are (trg_queue_story_media). The
-- queue processor keeps any file something else still references.
drop function if exists public.admin_v2_delete_content(text, uuid, text);
create function public.admin_v2_delete_content(p_type text, p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_urls  text[];
  v_owner uuid;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  if p_type = 'video' then
    select array[video_url, thumbnail], user_id into v_urls, v_owner from public.videos where id = p_id;
    if not found then raise exception 'not found'; end if;
    delete from public.videos where id = p_id;
    insert into public.media_delete_queue (url, source)
    select distinct u, 'admin_video' from unnest(v_urls) as u where u is not null and u <> ''
    on conflict (url) do nothing;
  elsif p_type = 'comment' then
    delete from public.comments where id = p_id returning user_id into v_owner;
  elsif p_type = 'story' then
    delete from public.stories where id = p_id returning user_id into v_owner;
  elsif p_type = 'live_comment' then
    delete from public.live_comments where id = p_id returning user_id into v_owner;
  else
    raise exception 'unsupported type %', p_type;
  end if;
  if v_owner is null then raise exception 'not found'; end if;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'delete_' || p_type, p_type, p_id,
          jsonb_build_object('reason', p_reason, 'owner', v_owner));
end;
$fn$;


-- ── 5. Videos, stories ──────────────────────────────────────────────────
drop function if exists public.admin_v2_list_videos(text, text, integer, integer);
create function public.admin_v2_list_videos(
  p_filter text    default 'all',
  p_search text    default null,
  p_limit  integer default 60,
  p_offset integer default 0
)
returns table (
  id uuid, user_id uuid, owner_handle text, owner_name text, description text,
  thumbnail text, video_url text, privacy text, is_draft boolean, is_hidden boolean,
  hidden_reason text, views_count integer, likes_count integer, comments_count integer,
  pending_reports bigint, created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $fn$
#variable_conflict use_column
declare v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  return query
  select * from (
    select v.id, v.user_id, o.handle, o.name, v.description, v.thumbnail, v.video_url,
           v.privacy, v.is_draft, v.is_hidden, v.hidden_reason,
           v.views_count, v.likes_count, v.comments_count,
           (select count(*) from public.reports r
             where r.status = 'pending' and r.target_type = 'video' and r.target_id = v.id) as pending_reports,
           v.created_at
      from public.videos v
      left join public.profiles o on o.id = v.user_id
     where (v_term is null
            or strpos(lower(coalesce(v.description, '')), v_term) > 0
            or strpos(lower(coalesce(o.handle, '')), ltrim(v_term, '@')) > 0)
       and case coalesce(p_filter, 'all')
             when 'published' then v.is_draft = false and v.is_hidden = false
             when 'hidden'    then v.is_hidden
             when 'draft'     then v.is_draft
             else true
           end
  ) x
  where coalesce(p_filter, 'all') <> 'reported' or x.pending_reports > 0
  order by x.created_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$fn$;

drop function if exists public.admin_v2_list_stories(text, integer);
create function public.admin_v2_list_stories(p_filter text default 'active', p_limit integer default 100)
returns table (
  id uuid, user_id uuid, owner_handle text, owner_name text, media_url text,
  poster_url text, media_kind text, caption text, audience text,
  created_at timestamptz, expires_at timestamptz, view_count bigint, pending_reports bigint
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
  select * from (
    select s.id, s.user_id, o.handle, o.name, s.media_url, s.poster_url, s.media_kind,
           s.caption, s.audience, s.created_at, s.expires_at,
           (select count(*) from public.story_views sv where sv.story_id = s.id) as view_count,
           (select count(*) from public.reports r
             where r.status = 'pending' and r.target_type = 'story' and r.target_id = s.id) as pending_reports
      from public.stories s
      left join public.profiles o on o.id = s.user_id
     where coalesce(p_filter, 'active') <> 'active' or s.expires_at > now()
  ) x
  where coalesce(p_filter, 'active') <> 'reported' or x.pending_reports > 0
  order by x.pending_reports desc, x.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 300));
end;
$fn$;


-- ── 6. Live streams ─────────────────────────────────────────────────────
drop function if exists public.admin_v2_list_lives(text, integer);
create function public.admin_v2_list_lives(p_status text default 'live', p_limit integer default 100)
returns table (
  id uuid, host_id uuid, host_handle text, host_name text, host_avatar text,
  title text, thumbnail text, status text, privacy text, viewer_count integer,
  viewer_count_max integer, started_at timestamptz, ended_at timestamptz,
  guests bigint, comments bigint, gift_coins bigint, pending_reports bigint
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
  select ls.id, ls.host_id, o.handle, o.name, o.avatar_url, ls.title, ls.thumbnail,
         ls.status, ls.privacy, ls.viewer_count, ls.viewer_count_max, ls.started_at, ls.ended_at,
         (select count(*) from public.live_guests g where g.live_id = ls.id and g.status = 'accepted'),
         (select count(*) from public.live_comments c where c.live_stream_id = ls.id),
         (select coalesce(sum(gt.amount), 0)::bigint from public.gift_transactions gt where gt.live_stream_id = ls.id),
         (select count(*) from public.reports r
           where r.status = 'pending'
             and ((r.target_type = 'live_stream' and r.target_id = ls.id)
                  or (r.target_type = 'live_comment'
                      and r.target_id in (select c2.id from public.live_comments c2 where c2.live_stream_id = ls.id))))
    from public.live_streams ls
    left join public.profiles o on o.id = ls.host_id
   where p_status is null or p_status = 'all' or ls.status = p_status
   order by ls.started_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 300));
end;
$fn$;

drop function if exists public.admin_v2_live_comments(uuid, integer);
create function public.admin_v2_live_comments(p_live uuid, p_limit integer default 200)
returns table (id uuid, user_id uuid, handle text, name text, body text, created_at timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $fn$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  return query
  select c.id, c.user_id, o.handle, o.name, c.text, c.created_at
    from public.live_comments c
    left join public.profiles o on o.id = c.user_id
   where c.live_stream_id = p_live
   order by c.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$fn$;

-- 'banned' rather than 'ended': guard_live_stream (0117) stops the host from
-- moving it back to 'live', and "live read" (0119) hides banned streams.
drop function if exists public.admin_v2_end_live(uuid, text);
create function public.admin_v2_end_live(p_live uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_host uuid;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  update public.live_streams
     set status = 'banned', ended_at = coalesce(ended_at, now())
   where id = p_live
  returning host_id into v_host;
  if v_host is null then raise exception 'not found'; end if;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'end_live', 'live_stream', p_live,
          jsonb_build_object('reason', p_reason, 'host', v_host));
end;
$fn$;


-- ── 7. Wallet and gifts (read-only) ─────────────────────────────────────
-- There is no refunds table in this schema (verify-purchase refuses refunded
-- purchases before crediting; refunds AFTER crediting are not received yet).
-- "flagged" therefore means: top-ups still pending after an hour, rejected
-- top-ups, and coin credits in the ledger with no store receipt behind them
-- (admin adjustments, or the self_topup hole 0112 closed).
drop function if exists public.admin_v2_wallet_overview(integer);
create function public.admin_v2_wallet_overview(p_days integer default 30)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  return jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 30), 365)),
    'coins_in_wallets',     (select coalesce(sum(balance), 0) from public.wallets),
    'wallets_with_balance', (select count(*) from public.wallets where balance > 0),
    'topups_by_status', (
      select coalesce(jsonb_object_agg(s.status, jsonb_build_object('count', s.n, 'coins', s.c)), '{}'::jsonb)
        from (select status, count(*) as n, coalesce(sum(coins), 0) as c
                from public.wallet_topups where created_at >= v_since group by status) s),
    'topups_by_package', (
      select coalesce(jsonb_agg(jsonb_build_object('product_id', s.product_id, 'platform', s.platform,
                                                   'count', s.n, 'coins', s.c) order by s.n desc), '[]'::jsonb)
        from (select coalesce(t.product_id, cp.product_id, '?') as product_id, t.platform,
                     count(*) as n, coalesce(sum(t.coins), 0) as c
                from public.wallet_topups t
                left join public.coin_packages cp on cp.id = t.package_id
               where t.created_at >= v_since and t.status = 'credited'
               group by 1, 2) s),
    'gifts', (select jsonb_build_object('count', count(*), 'coins', coalesce(sum(amount), 0))
                from public.gift_transactions where created_at >= v_since),
    'gifts_by_type', (
      select coalesce(jsonb_agg(jsonb_build_object('gift_id', s.gift_id, 'emoji', g.emoji, 'name', g.name,
                                                   'name_en', g.name_en, 'count', s.n, 'coins', s.c)
                                order by s.c desc), '[]'::jsonb)
        from (select gift_id, count(*) as n, coalesce(sum(amount), 0) as c
                from public.gift_transactions where created_at >= v_since group by gift_id) s
        left join public.gifts g on g.id = s.gift_id),
    'top_receivers', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', s.uid, 'handle', p.handle, 'name', p.name,
                                                   'gifts', s.n, 'coins', s.c) order by s.c desc), '[]'::jsonb)
        from (select to_user_id as uid, count(*) as n, sum(amount) as c
                from public.gift_transactions where created_at >= v_since
               group by to_user_id order by sum(amount) desc limit 10) s
        left join public.profiles p on p.id = s.uid),
    'top_senders', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', s.uid, 'handle', p.handle, 'name', p.name,
                                                   'gifts', s.n, 'coins', s.c) order by s.c desc), '[]'::jsonb)
        from (select from_user_id as uid, count(*) as n, sum(amount) as c
                from public.gift_transactions where created_at >= v_since
               group by from_user_id order by sum(amount) desc limit 10) s
        left join public.profiles p on p.id = s.uid),
    'top_balances', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', w.user_id, 'handle', p.handle, 'name', p.name,
                                                   'balance', w.balance, 'updated_at', w.updated_at)
                                order by w.balance desc), '[]'::jsonb)
        from (select * from public.wallets order by balance desc limit 10) w
        left join public.profiles p on p.id = w.user_id),
    'recent_topups', (
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'user_id', t.user_id, 'handle', p.handle,
                                                   'platform', t.platform, 'product_id', t.product_id,
                                                   'status', t.status, 'coins', t.coins,
                                                   'environment', t.environment,
                                                   'store_transaction_id', t.store_transaction_id,
                                                   'created_at', t.created_at, 'credited_at', t.credited_at)
                                order by t.created_at desc), '[]'::jsonb)
        from (select * from public.wallet_topups order by created_at desc limit 50) t
        left join public.profiles p on p.id = t.user_id),
    'flagged_topups', (
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'user_id', t.user_id, 'handle', p.handle,
                                                   'platform', t.platform, 'product_id', t.product_id,
                                                   'status', t.status, 'coins', t.coins,
                                                   'environment', t.environment,
                                                   'store_transaction_id', t.store_transaction_id,
                                                   'created_at', t.created_at,
                                                   'flag', case when t.status = 'rejected' then 'rejected'
                                                                else 'pending_over_1h' end)
                                order by t.created_at desc), '[]'::jsonb)
        from (select * from public.wallet_topups
               where status = 'rejected'
                  or (status = 'pending' and created_at < now() - interval '1 hour')
               order by created_at desc limit 100) t
        left join public.profiles p on p.id = t.user_id),
    'unbacked_credits', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'user_id', x.user_id, 'handle', p.handle,
                                                   'amount', x.amount, 'description', x.description,
                                                   'created_at', x.created_at)
                                order by x.created_at desc), '[]'::jsonb)
        from (select wt.* from public.wallet_transactions wt
               where wt.type = 'topup'
                 and (wt.reference is null
                      or not exists (select 1 from public.wallet_topups t where t.id = wt.reference))
               order by wt.created_at desc limit 100) x
        left join public.profiles p on p.id = x.user_id),
    'recent_gifts', (
      select coalesce(jsonb_agg(jsonb_build_object('id', gt.id, 'gift_id', gt.gift_id, 'emoji', g.emoji,
                                                   'amount', gt.amount, 'live_stream_id', gt.live_stream_id,
                                                   'from_handle', pf.handle, 'to_handle', pt.handle,
                                                   'created_at', gt.created_at)
                                order by gt.created_at desc), '[]'::jsonb)
        from (select * from public.gift_transactions order by created_at desc limit 50) gt
        left join public.gifts g on g.id = gt.gift_id
        left join public.profiles pf on pf.id = gt.from_user_id
        left join public.profiles pt on pt.id = gt.to_user_id)
  );
end;
$fn$;


-- ── 8. Storage ──────────────────────────────────────────────────────────
-- 0037's admin_storage_overview only sees Supabase Storage; media now lives
-- on Cloudflare R2 and is measured in media_objects (0062).
drop function if exists public.admin_v2_storage_overview();
create function public.admin_v2_storage_overview()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, storage
as $fn$
declare
  v_used  bigint;
  v_limit bigint;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  v_used := public.storage_used_bytes();
  select global_max_bytes into v_limit from public.app_limits where id = 1;

  return jsonb_build_object(
    'used_bytes',  v_used,
    'limit_bytes', v_limit,
    'pct_used',    case when coalesce(v_limit, 0) = 0 then 0
                        else round((v_used::numeric / v_limit) * 100, 1) end,
    'supabase_buckets', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', b.bucket_id, 'files', b.n, 'bytes', b.bytes)
                                order by b.bytes desc), '[]'::jsonb)
        from (select bucket_id, count(*) as n,
                     coalesce(sum((metadata->>'size')::bigint), 0) as bytes
                from storage.objects group by bucket_id) b),
    'r2_buckets', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', b.bucket, 'files', b.n, 'bytes', b.bytes)
                                order by b.bytes desc), '[]'::jsonb)
        from (select bucket, count(*) as n, coalesce(sum(size_bytes), 0) as bytes
                from public.media_objects where status = 'stored' group by bucket) b),
    'r2_pending', (select count(*) from public.media_objects where status = 'pending'),
    'delete_queue', (
      select coalesce(jsonb_object_agg(q.status, q.n), '{}'::jsonb)
        from (select status, count(*) as n from public.media_delete_queue group by status) q),
    'limits', (select to_jsonb(l) from public.app_limits l where l.id = 1),
    'alert',  (select to_jsonb(s) - 'email_payload' from public.storage_alert_state s where s.id = 1)
  );
end;
$fn$;


-- ── 9. Grants ───────────────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'admin\_v2\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'admin_v2 functions present (17)' as check,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname like 'admin\_v2\_%') = 17
            then 'OK' else 'MISSING SOME' end as result
union all
select 'every admin_v2 function is SECURITY DEFINER and checks is_admin()',
       case when not exists (
              select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like 'admin\_v2\_%'
                 and (not p.prosecdef or pg_get_functiondef(p.oid) not like '%is_admin()%'))
            then 'OK' else 'CHECK' end
union all
select 'no admin_v2 function callable by anon',
       case when not exists (
              select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like 'admin\_v2\_%'
                 and has_function_privilege('anon', p.oid, 'execute'))
            then 'OK' else 'EXPOSED' end
union all
select 'reports accept story and live_comment',
       case when exists (select 1 from pg_constraint
                          where conrelid = 'public.reports'::regclass and contype = 'c'
                            and pg_get_constraintdef(oid) like '%''story''%'
                            and pg_get_constraintdef(oid) like '%''live_comment''%'
                            and pg_get_constraintdef(oid) like '%''live_stream''%')
            then 'OK' else 'MISSING' end
union all
select 'at least one admin account exists',
       case when exists (select 1 from public.profiles where is_admin)
            then 'OK' else 'NONE - run the UPDATE in the deploy notes' end
order by 1;

-- Behavioural test, signed in as a NON-admin through the API:
--   rpc('admin_v2_counts')  -> error 42501 'not permitted'
-- and as an admin:
--   rpc('admin_v2_counts')  -> a JSON object of counts
