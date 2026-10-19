-- ============================================================
-- 0136_sound_use_count.sql
--
-- DISCOVER-04 (test run 2026-10-19): a sound page said "2 videos" and the
-- profile's Audio tab "Used 2 times" while exactly one video used the sound.
--
-- Root cause: TWO triggers on public.videos maintain sounds.usage_count.
--   tr_sound_usage       (0008, bump_sound_usage)  +1 on insert, -1 on delete,
--                                                    move on sound_id change
--   tr_sync_sound_usage  (0023, sync_sound_usage)  the same again
-- 0023 meant to replace 0008's trigger but never dropped it, so every video
-- posted since counted twice (and every delete subtracted twice, clamped at
-- 0). The client does not touch usage_count (mobile/src/api/sounds.ts only
-- inserts the sound row with the column's default 0).
-- Both triggers also counted drafts, hidden, archived and non-public videos,
-- which the sound page does not show.
--
-- Fix: one trigger. Instead of +1/-1 bookkeeping it RECOUNTS the affected
-- sound(s) from videos, so it cannot drift again. It counts a video while it
-- is published, not hidden, not archived and public: the same rule hashtags
-- use (0086), i.e. what a person can actually watch. It fires when any of
-- those columns or sound_id change. Then every sound is recounted once.
--
-- Safe to re-run.
-- ============================================================

-- The rule, in one place.
create or replace function public.sound_usage_recount(p_sound uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sounds s
     set usage_count = (
       select count(*) from public.videos v
        where v.sound_id = s.id
          and coalesce(v.is_draft, false) = false
          and coalesce(v.is_hidden, false) = false
          and coalesce(v.is_archived, false) = false
          and coalesce(v.privacy, 'public') = 'public')
   where s.id = p_sound;
$$;

revoke all on function public.sound_usage_recount(uuid) from public, anon, authenticated;

create or replace function public.sync_sound_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.sound_id is not null then
    perform public.sound_usage_recount(old.sound_id);
  end if;
  -- On an UPDATE that kept the sound, the recount above already covered it.
  if tg_op = 'INSERT' and new.sound_id is not null
     or tg_op = 'UPDATE' and new.sound_id is not null and new.sound_id is distinct from old.sound_id then
    perform public.sound_usage_recount(new.sound_id);
  end if;
  return null;
end;
$$;

revoke all on function public.sync_sound_usage() from public, anon, authenticated;

-- The duplicate from 0008, and its function.
drop trigger if exists tr_sound_usage on public.videos;
drop function if exists public.bump_sound_usage();

drop trigger if exists tr_sync_sound_usage on public.videos;
create trigger tr_sync_sound_usage
  after insert or delete
     or update of sound_id, is_draft, is_hidden, is_archived, privacy
  on public.videos
  for each row execute function public.sync_sound_usage();

-- ── Recount every sound from reality ──
update public.sounds s
   set usage_count = c.n
  from (
    select s2.id,
           (select count(*) from public.videos v
             where v.sound_id = s2.id
               and coalesce(v.is_draft, false) = false
               and coalesce(v.is_hidden, false) = false
               and coalesce(v.is_archived, false) = false
               and coalesce(v.privacy, 'public') = 'public') as n
      from public.sounds s2
  ) c
 where c.id = s.id
   and s.usage_count is distinct from c.n;

-- ── Checks ──
-- Probe: take one counted video, unpublish it inside a sub-transaction that
-- is always rolled back, and confirm its sound's count drops by exactly one
-- (it dropped by two while both triggers existed).
create or replace function pg_temp.probe_sound_count()
returns text
language plpgsql
as $$
declare v_video uuid; v_sound uuid; v_before integer; v_after integer;
begin
  select v.id, v.sound_id into v_video, v_sound
    from public.videos v
   where v.sound_id is not null and v.is_draft = false and v.is_hidden = false
     and v.is_archived = false and v.privacy = 'public'
   limit 1;
  if v_video is null then return 'SKIPPED (no published video with a sound)'; end if;
  select usage_count into v_before from public.sounds where id = v_sound;
  begin
    update public.videos set is_draft = true where id = v_video;
    select usage_count into v_after from public.sounds where id = v_sound;
    raise exception 'probe_rollback';
  exception when others then
    if sqlerrm <> 'probe_rollback' then return 'FAIL (' || sqlerrm || ')'; end if;
  end;
  if v_after = v_before - 1 then return 'OK'; end if;
  return 'FAIL (before ' || v_before || ', after ' || coalesce(v_after::text, 'null') || ')';
end;
$$;

select 'exactly one usage trigger on videos' as item,
       case when (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                   where t.tgrelid = 'public.videos'::regclass and not t.tgisinternal
                     and p.proname in ('sync_sound_usage', 'bump_sound_usage')) = 1
            then 'OK' else 'CHECK' end as result
union all
select 'no sound count differs from its videos',
       case when not exists (
              select 1 from public.sounds s
               where s.usage_count <> (select count(*) from public.videos v
                                        where v.sound_id = s.id
                                          and v.is_draft = false and v.is_hidden = false
                                          and v.is_archived = false and v.privacy = 'public'))
            then 'OK' else 'DRIFT' end
union all
select 'unpublishing a video drops its sound by exactly 1 (rolled back)', pg_temp.probe_sound_count()
order by 1;
