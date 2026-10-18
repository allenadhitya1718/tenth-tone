-- 0121 - like / follow loops no longer spam notifications; the remaining
-- write paths get a ceiling; account purge is scheduled
--
-- Security review 2026-10, round 2: F04 leftover, F22 leftover, account
-- deletion. Apply after 0120. Safe to re-run.
--
-- ============================================================
-- 1. F04 LEFTOVER - LIKE / UNLIKE AND FOLLOW / UNFOLLOW LOOPS
-- ============================================================
-- check_like_rate / check_follow_rate (0050) count the rows that EXIST now.
-- Like, unlike, like, unlike... never has more than one row, so it is never
-- limited, and every insert fires notify_on_like / notify_on_follow - a new
-- notification row and a push to the owner each time. comment_likes had no
-- rate trigger at all.
--
-- Now each notifier skips when the same (recipient, actor, type, target)
-- notification was already written in the last 24 hours. The like itself
-- still happens; only the repeat notification (and so the repeat push) does
-- not. Each function is its LATEST definition (notify_on_like and
-- notify_on_follow: 0027; notify_on_comment_like: 0072) with only the dedupe
-- added. Served by idx_notifs_user_created (0001).

create or replace function public.notify_on_like()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare owner_id uuid;
begin
  select user_id into owner_id from public.videos where id = new.video_id;
  if owner_id is null or owner_id = new.user_id then return new; end if;
  if not public.setting_bool(owner_id, 'notif_likes') then return new; end if;
  -- 0121: one notification per liker per video per day.
  if exists (select 1 from public.notifications n
              where n.user_id = owner_id
                and n.actor_id = new.user_id
                and n.type = 'like'
                and n.payload->>'video_id' = new.video_id::text
                and coalesce(n.payload->>'kind', '') <> 'comment_like'
                and n.created_at > now() - interval '24 hours') then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, type, payload)
  values (owner_id, new.user_id, 'like', jsonb_build_object('video_id', new.video_id));
  return new;
end; $fn$;

create or replace function public.notify_on_follow()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if not public.setting_bool(new.followed_id, 'notif_follows') then return new; end if;
  -- 0121: one follow notification per follower per day.
  if exists (select 1 from public.notifications n
              where n.user_id = new.followed_id
                and n.actor_id = new.follower_id
                and n.type = 'follow'
                and n.created_at > now() - interval '24 hours') then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, type, payload)
  values (new.followed_id, new.follower_id, 'follow', '{}'::jsonb);
  return new;
end; $fn$;

create or replace function public.notify_on_comment_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid; v_video uuid; v_text text;
begin
  select user_id, video_id, text into v_author, v_video, v_text
    from public.comments where id = new.comment_id;

  if v_author is null or v_author = new.user_id then
    return null;
  end if;

  -- 0121: one notification per liker per comment per day.
  if exists (select 1 from public.notifications n
              where n.user_id = v_author
                and n.actor_id = new.user_id
                and n.type = 'like'
                and n.payload->>'kind' = 'comment_like'
                and n.payload->>'comment_id' = new.comment_id::text
                and n.created_at > now() - interval '24 hours') then
    return null;
  end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  values (v_author, new.user_id, 'like',
          jsonb_build_object('kind', 'comment_like',
                             'comment_id', new.comment_id,
                             'video_id', v_video,
                             'excerpt', left(coalesce(v_text, ''), 60)));
  return null;
end; $$;


-- ============================================================
-- 2. RATE TRIGGERS ON THE REMAINING WRITE PATHS (F04 / F22)
-- ============================================================
-- Same shape as 0050. Generous: these catch scripts, not people.
--   comment_likes      500 / hour   (raises, like likes)
--   saves              500 / hour   (raises)
--   message_reactions  300 / hour   (raises)
--   video_engagement  1500 rows touched / hour - SILENTLY skipped instead of
--                      raising: it is written by track_engagement() on every
--                      scroll, and a watch that is not recorded is harmless,
--                      whereas an error would surface in the feed.
-- Server time on the counted columns (0115's stamp_server_time), so the
-- counts cannot be dodged by back-dating.

create or replace function public.check_comment_like_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.comment_likes
   where user_id = new.user_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 500, 'likes');
  return new;
end;
$$;

create or replace function public.check_save_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.saves
   where user_id = new.user_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 500, 'saves');
  return new;
end;
$$;

create or replace function public.check_reaction_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.message_reactions
   where user_id = new.user_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 300, 'reactions');
  return new;
end;
$$;

create or replace function public.check_engagement_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.video_engagement
   where user_id = new.user_id
     and last_watched_at > now() - interval '1 hour';
  if n >= 1500 then
    return null;   -- skip quietly; see above
  end if;
  return new;
end;
$$;

revoke all on function public.check_comment_like_rate() from public, anon, authenticated;
revoke all on function public.check_save_rate()         from public, anon, authenticated;
revoke all on function public.check_reaction_rate()     from public, anon, authenticated;
revoke all on function public.check_engagement_rate()   from public, anon, authenticated;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('comment_likes',     'trg_comment_like_rate', 'check_comment_like_rate', 'created_at'),
      ('saves',             'trg_save_rate',         'check_save_rate',         'created_at'),
      ('message_reactions', 'trg_reaction_rate',     'check_reaction_rate',     'created_at'),
      ('video_engagement',  'trg_engagement_rate',   'check_engagement_rate',   'last_watched_at')
    ) as t(tbl, trg, fn, col)
  loop
    if to_regclass('public.' || r.tbl) is null then
      raise notice '0121: public.% not found, skipped', r.tbl;
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', r.trg, r.tbl);
    execute format('create trigger %I before insert on public.%I for each row execute function public.%I()',
                   r.trg, r.tbl, r.fn);
    if exists (select 1 from pg_attribute a
                where a.attrelid = to_regclass('public.' || r.tbl)
                  and a.attname = r.col and not a.attisdropped) then
      execute format('drop trigger if exists trg_00_server_time on public.%I', r.tbl);
      execute format(
        'create trigger trg_00_server_time before insert or update on public.%I '
        'for each row execute function public.stamp_server_time(%L)', r.tbl, r.col);
    end if;
  end loop;
end $$;


-- ============================================================
-- 3. ACCOUNT DELETION IS ACTUALLY PURGED
-- ============================================================
-- schedule_account_deletion() (0034) only marks the account; the auth user is
-- removed by purge_scheduled_deletions() (latest 0073), run daily by the
-- pg_cron job 'purge-scheduled-deletions' that 0034/0051 register. On a
-- project where pg_cron was enabled after those ran, the job does not exist.
-- Registered here if (and only if) pg_cron is present and the job is missing.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice '0121: pg_cron is not enabled - enable it (Database -> Extensions) and re-run, or account deletions are never completed';
    return;
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-scheduled-deletions') then
    perform cron.schedule('purge-scheduled-deletions', '30 3 * * *',
                          'select public.purge_scheduled_deletions()');
    raise notice '0121: scheduled purge-scheduled-deletions (03:30 daily)';
  end if;
end $$;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'like notifications deduplicated' as check,
       case when pg_get_functiondef('public.notify_on_like()'::regprocedure) like '%0121%'
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'follow notifications deduplicated',
       case when pg_get_functiondef('public.notify_on_follow()'::regprocedure) like '%0121%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'comment-like notifications deduplicated',
       case when pg_get_functiondef('public.notify_on_comment_like()'::regprocedure) like '%0121%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'rate trigger ' || t.tgname,
       'OK'
  from pg_trigger t
 where t.tgname in ('trg_comment_like_rate', 'trg_save_rate', 'trg_reaction_rate', 'trg_engagement_rate')
   and not t.tgisinternal
order by 1;

-- pg_cron job (run separately; errors if pg_cron is not enabled):
--   select jobname, schedule, command, active from cron.job
--    where jobname = 'purge-scheduled-deletions';
