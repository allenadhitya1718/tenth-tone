-- 0061 — tell the HOST their stream started and ended
--
-- Going live already notifies followers (notify_on_live, 0030). The host got
-- nothing that lasts: f13762b added a toast on start and one on end, and a
-- summary card, but all three are transient UI and every one of them can be
-- missed.
--
--   * The start toast sits inside `if (!window.Agora || !isConfigured()) return`,
--     so it never fires when Agora is unconfigured — and never at all for a
--     background-mode stream, which does not call startHost and so never sets
--     the flag the toast depends on.
--   * The end toast is followed immediately by go('/home'), which tears down
--     the screen it was drawn on.
--   * The summary card only appears if the stream ends some OTHER way. The
--     host who taps End navigates away before it can render.
--
-- A notification survives all of that: it is written by the database when the
-- row changes, so it does not depend on which screen is open, whether Agora is
-- configured, or the client still being alive.
--
-- 'system' with a kind, matching how login alerts and location permits are
-- already reported, so notifications_type_check needs no change.

-- ── Started ──
create or replace function public.notify_host_live_started()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status <> 'live' then return new; end if;
  -- Only on the transition into 'live', or every unrelated update to a live
  -- row would announce it again.
  if tg_op = 'UPDATE' and old.status = 'live' then return new; end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  values (new.host_id, new.host_id, 'system',
          jsonb_build_object(
            'kind',      'live_started',
            'stream_id', new.id,
            'mode',      coalesce(new.mode, 'camera'),
            'privacy',   coalesce(new.privacy, 'public')
          ));
  return new;
end;
$fn$;

drop trigger if exists tr_notify_host_live_started on public.live_streams;
create trigger tr_notify_host_live_started
  after insert or update on public.live_streams
  for each row execute function public.notify_host_live_started();

-- ── Ended ──
-- Carries what the summary card was going to show, so the numbers survive
-- even though the screen that displayed them does not.
create or replace function public.notify_host_live_ended()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_seconds integer := 0;
begin
  if new.status <> 'ended' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'ended' then return new; end if;

  if new.started_at is not null then
    v_seconds := greatest(0,
      extract(epoch from (coalesce(new.ended_at, now()) - new.started_at))::integer);
  end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  values (new.host_id, new.host_id, 'system',
          jsonb_build_object(
            'kind',      'live_ended',
            'stream_id', new.id,
            'seconds',   v_seconds,
            -- viewer_count_max rather than viewer_count: by the time a stream
            -- ends the live count has collapsed to zero, so the current value
            -- would always report nobody watched.
            'peak',      coalesce(new.viewer_count_max, 0)
          ));
  return new;
end;
$fn$;

drop trigger if exists tr_notify_host_live_ended on public.live_streams;
create trigger tr_notify_host_live_ended
  after update on public.live_streams
  for each row execute function public.notify_host_live_ended();

-- ── Check it ──
-- Start and end a stream from the app, then:
--
--   select payload->>'kind' as kind, payload, created_at
--     from public.notifications
--    where user_id = auth.uid()
--      and payload->>'kind' in ('live_started', 'live_ended')
--    order by created_at desc limit 4;
--
-- Expect one row of each. The 'live_ended' payload carries the duration in
-- seconds and the highest viewer count the stream reached.
