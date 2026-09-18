-- 0090 — pg_net's functions live in schema `net`, not where the extension is
--
-- 0087's trigger (and call_job_endpoint() before it) found pg_net's schema
-- through pg_extension and called <that schema>.http_post(). pg_net keeps its
-- functions in `net` regardless of where the extension record sits, so the
-- call was `extensions.http_post(...)` - a function that does not exist.
-- The trigger's "a push must never fail the insert" guard then swallowed the
-- error, so six message notifications went by without a single HTTP call
-- and nothing complained. Measured: net._http_response empty.
--
-- Resolve the schema from the function itself. Same fix for
-- call_job_endpoint(), which reported "queued" while calling nothing.

create or replace function public.pg_net_schema()
returns text
language sql
stable
as $$
  select n.nspname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_post'
     and n.nspname in ('net', 'extensions', 'public')
   order by case n.nspname when 'net' then 0 when 'extensions' then 1 else 2 end
   limit 1
$$;

create or replace function public.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ep     public.job_endpoints%rowtype;
  v_schema text := public.pg_net_schema();
begin
  if v_schema is null then return null; end if;
  select * into v_ep from public.job_endpoints where name = 'send-push';
  if not found or coalesce(v_ep.url, '') = '' then return null; end if;
  begin
    execute format('select %I.http_post(url := $1, body := $2, headers := $3)', v_schema)
      using v_ep.url, jsonb_build_object('notification_id', new.id), v_ep.headers;
  exception when others then
    -- Still never fail the insert - but say so, where a log will show it.
    raise warning 'push_on_notification: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

create or replace function public.call_job_endpoint(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ep     public.job_endpoints%rowtype;
  v_schema text := public.pg_net_schema();
begin
  if v_schema is null then
    return 'pg_net not enabled — nothing called';
  end if;
  select * into v_ep from public.job_endpoints where name = p_name;
  if not found or v_ep.url is null or v_ep.url = '' then
    return 'endpoint ' || p_name || ' not configured';
  end if;
  execute format('select %I.http_post(url := $1, body := $2, headers := $3)', v_schema)
    using v_ep.url, '{}'::jsonb, v_ep.headers;
  return 'queued';
end;
$$;
