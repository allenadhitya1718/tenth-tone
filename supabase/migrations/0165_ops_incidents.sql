-- ============================================================
-- 0165 - incident queue for the auto-fix service (owner request: when the
--        live server or the app reports a problem, Claude Code on the
--        owner's laptop picks it up and fixes it as soon as the laptop is on).
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0164.
-- Safe to re-run.
--
-- Alerts (Better Stack, Sentry) arrive at the ops-alert function, which
-- files them here. The laptop's worker claims one at a time through the
-- same function and reports back. Only the service role can touch this
-- table or call these functions: the app never sees it.
--
-- status: new -> claimed -> fixed | needs_human | failed
--         new -> resolved (the alert cleared before anyone picked it up)
-- A claim older than 2 hours (laptop shut mid-fix) goes back to new.
-- ============================================================

begin;

create table if not exists public.ops_incidents (
  id          bigint generated always as identity primary key,
  source      text not null,             -- betterstack | sentry | app_errors | manual
  dedupe_key  text not null,
  title       text not null,
  details     jsonb not null default '{}'::jsonb,
  status      text not null default 'new'
              check (status in ('new', 'claimed', 'fixed', 'needs_human', 'failed', 'resolved')),
  attempts    integer not null default 0,
  claimed_at  timestamptz,
  finished_at timestamptz,
  result      text,
  created_at  timestamptz not null default now()
);
-- One open incident per problem: repeats of an open alert are not refiled.
create unique index if not exists ops_incidents_open_key
  on public.ops_incidents (dedupe_key) where status in ('new', 'claimed');
create index if not exists ops_incidents_status_idx on public.ops_incidents (status, created_at);

alter table public.ops_incidents enable row level security;
revoke all on public.ops_incidents from anon, authenticated;

-- File an alert. Returns the incident id, or null when the same problem is
-- already open.
create or replace function public.ops_file_incident(p_source text, p_key text, p_title text, p_details jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare v_id bigint;
begin
  insert into public.ops_incidents (source, dedupe_key, title, details)
  values (left(p_source, 40), left(p_key, 300), left(p_title, 300), coalesce(p_details, '{}'::jsonb))
  on conflict (dedupe_key) where status in ('new', 'claimed') do nothing
  returning id into v_id;
  return v_id;
end;
$fn$;

-- The alert cleared by itself before anyone picked it up.
create or replace function public.ops_resolve_incident(p_key text)
returns integer
language sql
security definer
set search_path = public
as $fn$
  with done as (
    update public.ops_incidents set status = 'resolved', finished_at = now(), result = 'Cleared before it was picked up.'
     where dedupe_key = p_key and status = 'new'
    returning 1
  )
  select count(*)::int from done;
$fn$;

-- The worker takes the oldest open incident (one at a time; at most 3 tries).
create or replace function public.ops_claim_incident()
returns setof public.ops_incidents
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.ops_incidents set status = 'new', claimed_at = null
   where status = 'claimed' and claimed_at < now() - interval '2 hours';
  update public.ops_incidents set status = 'failed', finished_at = now(), result = 'Gave up after 3 tries.'
   where status = 'new' and attempts >= 3;
  return query
    with c as (
      update public.ops_incidents i
         set status = 'claimed', claimed_at = now(), attempts = i.attempts + 1
       where i.id = (select id from public.ops_incidents where status = 'new'
                      order by created_at limit 1 for update skip locked)
      returning i.*
    )
    select * from c;
end;
$fn$;

create or replace function public.ops_finish_incident(p_id bigint, p_status text, p_result text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_status not in ('fixed', 'needs_human', 'failed') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  update public.ops_incidents set status = p_status, finished_at = now(), result = left(p_result, 8000)
   where id = p_id and status = 'claimed';
  return found;
end;
$fn$;

revoke all on function public.ops_file_incident(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.ops_resolve_incident(text) from public, anon, authenticated;
revoke all on function public.ops_claim_incident() from public, anon, authenticated;
revoke all on function public.ops_finish_incident(bigint, text, text) from public, anon, authenticated;
grant execute on function public.ops_file_incident(text, text, text, jsonb) to service_role;
grant execute on function public.ops_resolve_incident(text) to service_role;
grant execute on function public.ops_claim_incident() to service_role;
grant execute on function public.ops_finish_incident(bigint, text, text) to service_role;

commit;

-- Checks (SELECT only)
select 'ops_incidents table' as check,
       case when to_regclass('public.ops_incidents') is not null then 'OK' else 'MISSING' end as result
union all
select 'queue hidden from the app',
       case when not has_table_privilege('authenticated', 'public.ops_incidents', 'select')
             and not has_function_privilege('authenticated', 'public.ops_claim_incident()', 'execute')
            then 'OK' else 'EXPOSED' end;
