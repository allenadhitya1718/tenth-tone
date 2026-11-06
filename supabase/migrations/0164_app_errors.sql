-- ============================================================
-- 0164 - app error reports (owner goal: "make sure nothing crashes like
--        this in future"). The app had no crash reporting: an error on
--        someone's phone was never seen. Now every error the app catches
--        (a screen that fails, an error that makes the app reload) is
--        logged here, so it can be found and fixed.
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0163.
-- Safe to re-run.
--
-- Nobody but the service role (dashboard, SQL) can read the table. The app
-- writes only through report_app_error(), which trims every field and
-- limits how much one person (or all signed-out phones together) can log.
-- Rows older than 60 days are cleared as new reports come in.
-- ============================================================

begin;

create table if not exists public.app_errors (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete set null,
  kind        text not null check (kind in ('fatal', 'screen', 'handled')),
  message     text not null,
  stack       text,
  screen      text,
  platform    text,
  app_version text,
  update_id   text,
  channel     text,
  happened_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists app_errors_created_idx on public.app_errors (created_at desc);
create index if not exists app_errors_user_idx on public.app_errors (user_id, created_at desc);

alter table public.app_errors enable row level security;
-- No policies: the app cannot read or write the table directly.
revoke all on public.app_errors from anon, authenticated;

create or replace function public.report_app_error(
  p_kind text,
  p_message text,
  p_stack text default null,
  p_screen text default null,
  p_platform text default null,
  p_app_version text default null,
  p_update_id text default null,
  p_channel text default null,
  p_happened_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_recent integer;
begin
  if p_kind not in ('fatal', 'screen', 'handled') or coalesce(btrim(p_message), '') = '' then
    return false;
  end if;

  -- Rate limits: 30 reports an hour per person; signed-out phones share 300.
  if v_me is not null then
    select count(*) into v_recent from public.app_errors
     where user_id = v_me and created_at > now() - interval '1 hour';
    if v_recent >= 30 then return false; end if;
  else
    select count(*) into v_recent from public.app_errors
     where user_id is null and created_at > now() - interval '1 hour';
    if v_recent >= 300 then return false; end if;
  end if;

  insert into public.app_errors
    (user_id, kind, message, stack, screen, platform, app_version, update_id, channel, happened_at)
  values (
    v_me,
    p_kind,
    left(p_message, 500),
    left(p_stack, 4000),
    left(p_screen, 200),
    left(p_platform, 20),
    left(p_app_version, 40),
    left(p_update_id, 64),
    left(p_channel, 40),
    -- A report sent after a reload carries when it happened; never trust a
    -- time in the future or long past.
    case when p_happened_at between now() - interval '7 days' and now() then p_happened_at else now() end
  );

  -- Keep 60 days.
  delete from public.app_errors where created_at < now() - interval '60 days';
  return true;
end;
$fn$;
revoke all on function public.report_app_error(text, text, text, text, text, text, text, text, timestamptz) from public;
grant execute on function public.report_app_error(text, text, text, text, text, text, text, text, timestamptz) to anon, authenticated;

commit;

-- Checks (SELECT only)
select 'app_errors table' as check,
       case when to_regclass('public.app_errors') is not null then 'OK' else 'MISSING' end as result
union all
select 'table not readable by app',
       case when not has_table_privilege('authenticated', 'public.app_errors', 'select')
             and not has_table_privilege('anon', 'public.app_errors', 'select') then 'OK' else 'EXPOSED' end
union all
select 'reporter callable',
       case when has_function_privilege('authenticated', 'public.report_app_error(text,text,text,text,text,text,text,text,timestamptz)', 'execute') then 'OK' else 'MISSING' end;
