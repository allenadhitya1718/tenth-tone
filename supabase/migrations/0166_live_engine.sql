-- ============================================================
-- 0166 - which audio/video system a live runs on (LiveKit move, Nov 2026)
--
-- APPLIED 6 Nov 2026. LiveKit is PARKED (owner: launch on Agora): the app code
-- that uses this column lives on branch livekit-parked. Until then every live
-- is 'agora' (the default), so the column is harmless.
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0165.
-- Safe to re-run.
--
-- Lives move from Agora to FLYP's own LiveKit server. Old app versions only
-- speak Agora and new ones speak both, so each live records which one its
-- host started it on, and viewers join that one:
--   'agora'   : every live so far, and lives started from older apps (default)
--   'livekit' : lives started from the new app
-- The engine is fixed when the live starts: the host cannot change it later.
-- ============================================================

begin;

alter table public.live_streams
  add column if not exists engine text not null default 'agora';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_streams_engine_check') then
    alter table public.live_streams
      add constraint live_streams_engine_check check (engine in ('agora', 'livekit'));
  end if;
end $$;

-- Fixed at start: an update cannot switch a running live to the other engine
-- (viewers already joined would lose the audio).
create or replace function public.live_streams_keep_engine()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.engine is distinct from old.engine then
    new.engine := old.engine;
  end if;
  return new;
end;
$fn$;

drop trigger if exists live_streams_keep_engine on public.live_streams;
create trigger live_streams_keep_engine
  before update on public.live_streams
  for each row execute function public.live_streams_keep_engine();

commit;

-- Checks (SELECT only)
select 'engine column' as check,
       case when exists (select 1 from information_schema.columns where table_schema = 'public'
                          and table_name = 'live_streams' and column_name = 'engine') then 'OK' else 'MISSING' end as result
union all
select 'existing lives on agora',
       case when not exists (select 1 from public.live_streams where engine <> 'agora') then 'OK' else 'CHECK' end;
