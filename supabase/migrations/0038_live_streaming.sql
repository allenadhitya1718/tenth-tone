-- =============================================================
-- 0038  Live streaming: the write policies that were never added
--
-- live_streams had RLS enabled in 0001 with only a read policy, and an
-- admin-update policy in 0002. There was no insert policy and no policy
-- letting a host touch their own row, so:
--   * nobody could start a stream at all
--   * a host could not end their own stream
-- Both failed with "new row violates row-level security policy".
--
-- Safe to run more than once.
-- =============================================================

-- ── A host may open a stream as themselves ────────────────────
-- A banned or deactivated account cannot, which matches the rule the
-- upload path already applies to videos.
drop policy if exists "live insert own" on public.live_streams;
create policy "live insert own" on public.live_streams
  for insert to authenticated
  with check (
    auth.uid() = host_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        -- Same not-banned test the feed and upload paths use.
        and (p.banned_until is null or p.banned_until <= now())
        and p.deactivated_at is null
    )
  );

-- ── A host may update their own stream ────────────────────────
-- Ending it, retitling it, and writing the viewer count that Agora
-- reports on the host client.
drop policy if exists "live update own" on public.live_streams;
create policy "live update own" on public.live_streams
  for update to authenticated
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

-- ── A host may delete their own stream ────────────────────────
-- Ending sets status to 'ended' and keeps the row. This is for a host
-- who wants the record gone entirely.
drop policy if exists "live delete own" on public.live_streams;
create policy "live delete own" on public.live_streams
  for delete to authenticated
  using (auth.uid() = host_id);

-- ── A host may clear chat on their own stream ─────────────────
-- 0016 gave live_comments read and insert policies but no delete, so a
-- host had no way to remove an abusive comment from their own stream.
drop policy if exists "live comments delete own or host" on public.live_comments;
create policy "live comments delete own or host" on public.live_comments
  for delete to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.live_streams ls
      where ls.id = live_stream_id and ls.host_id = auth.uid()
    )
    or public.is_admin()
  );

-- ── Close streams left open by a crash or a closed tab ────────
-- Without this a stream whose host disappeared stays 'live' forever and
-- keeps showing in the browse list with nothing behind it.
create or replace function public.close_stale_live_streams(p_minutes integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.live_streams
     set status = 'ended',
         ended_at = now()
   where status = 'live'
     and started_at < now() - make_interval(mins => greatest(p_minutes, 1));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.close_stale_live_streams(integer) from public;
grant execute on function public.close_stale_live_streams(integer) to authenticated;

-- Index the browse query: live streams, most watched first.
create index if not exists idx_live_streams_live
  on public.live_streams (status, viewer_count desc)
  where status = 'live';
