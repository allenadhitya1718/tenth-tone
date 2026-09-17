-- 0087 — push notifications: the database half
--
-- push_tokens existed with nothing writing to it. This makes it usable and
-- turns every new notifications row into a call to the send-push function.
--
--   1. pg_net, so SQL can make an HTTP call. call_job_endpoint() has been
--      checking for it since 0068 and reporting "pg_net not enabled — nothing
--      called" - which also means the hourly media-reconcile job has never
--      actually run. Enabling it here fixes that as a side effect.
--   2. push_tokens gains the app language (the app keeps it only on the
--      device, so the sender cannot look it up), an updated_at, and policies
--      so a person can save and remove their own device tokens.
--   3. A job_endpoints row for send-push that reuses media-reconcile's
--      headers - same shared secret, same apikey - so no new secret exists.
--   4. A trigger: after every INSERT into notifications, POST the row's id to
--      send-push. Fire-and-forget; a push that fails never fails the insert.

create extension if not exists pg_net with schema extensions;

alter table public.push_tokens
  add column if not exists lang text not null default 'ar',
  add column if not exists updated_at timestamptz not null default now();

alter table public.push_tokens enable row level security;
drop policy if exists "push tokens own" on public.push_tokens;
create policy "push tokens own" on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

insert into public.job_endpoints (name, url, headers)
select 'send-push', replace(url, '/media-reconcile', '/send-push'), headers
  from public.job_endpoints where name = 'media-reconcile'
on conflict (name) do update set url = excluded.url, headers = excluded.headers;

create or replace function public.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ep     public.job_endpoints%rowtype;
  v_schema text;
begin
  select n.nspname into v_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_net';
  if v_schema is null then return null; end if;
  select * into v_ep from public.job_endpoints where name = 'send-push';
  if not found or coalesce(v_ep.url, '') = '' then return null; end if;
  begin
    execute format('select %I.http_post(url := $1, body := $2, headers := $3)', v_schema)
      using v_ep.url, jsonb_build_object('notification_id', new.id), v_ep.headers;
  exception when others then
    -- A push is a courtesy. The notification row itself must never be lost
    -- because the HTTP queue had a bad moment.
    null;
  end;
  return null;
end;
$$;

drop trigger if exists tr_push_on_notification on public.notifications;
create trigger tr_push_on_notification
  after insert on public.notifications
  for each row execute function public.push_on_notification();
