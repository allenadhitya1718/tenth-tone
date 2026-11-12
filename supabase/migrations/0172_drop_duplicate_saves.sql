-- 0172: remove a duplicate, unused table.
--
-- On 12 Nov two sessions built "saved highlights" in parallel. The app uses
-- public.highlight_saves (0171). A copy of 0170 applied the same day also
-- created public.live_highlight_saves, which nothing reads or writes. It was
-- empty when this was written. Drop it so there is one place for saves.
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Safe to re-run.

begin;

drop table if exists public.live_highlight_saves;

commit;

-- Checks (SELECT only)
select 'duplicate saves table gone' as check,
       case when to_regclass('public.live_highlight_saves') is null then 'OK' else 'STILL THERE' end as result
union all
select 'highlight_saves (0171) still there',
       case when to_regclass('public.highlight_saves') is not null then 'OK' else 'MISSING' end;
