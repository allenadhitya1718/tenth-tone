-- 0088 — client logs: let a phone say what went wrong
--
-- "The voice note records but will not send" could not be reproduced on any
-- engine available here, and an iPhone has no console anyone can read. The
-- database showed the truth of the tester's attempts - no file, no row - but
-- not WHY. This table lets the app write one line at the points that matter
-- (voice note stopped: how many chunks, how many bytes; send started; send
-- failed: the raw error), so the next attempt on the phone answers the
-- question from here.
--
-- A person can insert their own rows and read nothing back; only admins can
-- read. Best effort on the client: a log that fails must never fail the
-- thing it was logging.

create table if not exists public.client_logs (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  ua         text,
  created_at timestamptz not null default now()
);
create index if not exists client_logs_user_time on public.client_logs (user_id, created_at desc);

alter table public.client_logs enable row level security;
drop policy if exists "client logs insert own" on public.client_logs;
create policy "client logs insert own" on public.client_logs
  for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "client logs admins read" on public.client_logs;
create policy "client logs admins read" on public.client_logs
  for select to authenticated
  using (public.is_admin());
