-- ============================================================
-- 0019_calls.sql
-- Voice / video calling: the signalling layer.
--
-- Agora carries the actual audio and video, but it has no concept of
-- "ringing" - it can only connect two people who both join the same
-- channel. This table is what tells the other person a call is coming,
-- and lets either side accept, decline or hang up.
--
-- Deliberately independent of Agora: everything here works before an
-- Agora App ID exists, so the whole flow can be built and tested now.
--
-- Apply in the Supabase SQL editor AFTER 0001..0018.
-- ============================================================

create table if not exists public.calls (
  id           uuid primary key default uuid_generate_v4(),
  caller_id    uuid not null references public.profiles (id) on delete cascade,
  callee_id    uuid not null references public.profiles (id) on delete cascade,
  chat_id      uuid references public.chats (id) on delete set null,
  kind         text not null default 'audio' check (kind in ('audio', 'video')),
  -- ringing  : caller has dialled, callee has not answered yet
  -- accepted : callee picked up, both sides join the channel
  -- declined : callee rejected
  -- missed   : nobody answered before the timeout
  -- ended    : call finished normally, or caller cancelled
  status       text not null default 'ringing'
               check (status in ('ringing', 'accepted', 'declined', 'missed', 'ended')),
  -- Agora channel name. Generated up front so both sides agree on it
  -- without another round trip.
  channel      text not null,
  created_at   timestamptz not null default now(),
  answered_at  timestamptz,
  ended_at     timestamptz
);

create index if not exists idx_calls_callee_status on public.calls (callee_id, status, created_at desc);
create index if not exists idx_calls_caller        on public.calls (caller_id, created_at desc);

alter table public.calls enable row level security;

-- Either participant can see the call.
drop policy if exists "calls read own" on public.calls;
create policy "calls read own" on public.calls
  for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid());

-- You can only start a call as yourself, and not to yourself.
drop policy if exists "calls insert as caller" on public.calls;
create policy "calls insert as caller" on public.calls
  for insert to authenticated
  with check (caller_id = auth.uid() and callee_id <> auth.uid());

-- Either side can update (accept / decline / hang up).
drop policy if exists "calls update participant" on public.calls;
create policy "calls update participant" on public.calls
  for update to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid())
  with check (caller_id = auth.uid() or callee_id = auth.uid());

-- Realtime: the callee's device listens for inserts, and both sides listen
-- for status changes on their own call.
-- Guarded: re-running this file must not fail if the table is already
-- published for realtime.
do $pub$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;
end
$pub$;
