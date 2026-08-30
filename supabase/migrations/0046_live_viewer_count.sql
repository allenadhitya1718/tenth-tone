-- ============================================================
-- 0046_live_viewer_count.sql
--
-- The viewer count on a stream was read once when the screen opened and then
-- never moved. A broadcast would sit at "3 watching" for its whole run, which
-- is worse than showing nothing — it looks live and is not.
--
-- Viewers cannot write the number themselves: 0038 restricts updates on
-- live_streams to the host, and rightly so, or anyone could inflate their own
-- audience. These two functions are the only way in, they move the count by
-- exactly one, and they cannot touch anything else on the row.
--
-- This is a counter, not presence. A viewer whose phone dies without firing
-- leave leaves the count one too high until the stream ends. That is the
-- accepted trade in every app that does it this way; real presence needs a
-- heartbeat table and is not worth it here.
-- ============================================================

create or replace function public.join_live_stream(p_live_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  update public.live_streams
     set viewer_count = viewer_count + 1,
         -- The peak is what the host is told afterwards, so it only ever rises.
         viewer_count_max = greatest(viewer_count_max, viewer_count + 1)
   where id = p_live_id
     and status = 'live'
  returning viewer_count into v_count;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.leave_live_stream(p_live_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.live_streams
     set viewer_count = greatest(viewer_count - 1, 0)   -- never negative
   where id = p_live_id
  returning viewer_count into v_count;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.join_live_stream(uuid)  from public;
revoke all on function public.leave_live_stream(uuid) from public;
grant execute on function public.join_live_stream(uuid)  to authenticated;
grant execute on function public.leave_live_stream(uuid) to authenticated;

-- Realtime on live_streams: without this the count still would not move on
-- anyone else's screen, and viewers would not learn the stream had ended.
do $$
begin
  begin
    alter publication supabase_realtime add table public.live_streams;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
