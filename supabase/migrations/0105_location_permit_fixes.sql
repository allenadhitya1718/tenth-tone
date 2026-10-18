-- 0105 - location tracking permits: close the self-approval holes, then make
-- an approved permit actually grant access; and a location update that
-- cannot reset your sharing choice
--
-- Found while porting the data layer to the React Native app (see
-- supabase/PHASE4_MIGRATION_NOTES.md, items 1-3). Client note 27 (follow a
-- friend on the map) builds on permits, so they have to be right first.
--
-- 1. A REQUESTER COULD APPROVE THEIR OWN REQUEST.
--    "permits update as target" (0004) has
--        using (auth.uid() = target_id or auth.uid() = requester_id)
--    and no WITH CHECK, so the person asking to track you could set their own
--    request to 'approved'. Worse, "permits create as requester" checks only
--    requester_id, so the request could be INSERTED as 'approved' to begin
--    with. And nothing stopped either side rewriting requester_id/target_id.
--
--    Today this grants nothing, only because of (2). Fixing (2) without this
--    would let anyone track anyone. Both are fixed here, in this order.
--
--    Now: a request is created as 'pending' only. The TARGET may answer it
--    ('approved' / 'denied') or revoke it later. The REQUESTER may only
--    withdraw it ('revoked'). The two ids can never change.
--
-- 2. AN APPROVED PERMIT GRANTED NOTHING.
--    0004 added "or an approved, unexpired permit" to the "locations read"
--    policy on user_locations. 0032 replaced the policy (adding the sharing
--    switch and the 8-hour staleness window) and dropped that clause; 0077
--    replaced it again (block fix) without it. So approving a request looked
--    like it worked and changed nothing. The clause is restored below, inside
--    the same sharing / freshness / block guards 0077 has, so a permit never
--    reveals a stale position, a position whose owner stopped sharing, or a
--    position across a block. The rest of the policy is 0077's, verbatim
--    except for (select auth.uid()).
--
-- 3. EVERY LOCATION FIX RESET YOUR VISIBILITY.
--    The app wrote each fix as a full upsert with visibility = 'friends' and
--    sharing_enabled = true, so a 'public' choice was lost on the next fix,
--    and a fix arriving after you switched sharing off switched it back on.
--    update_my_location() only touches coordinates, and only while sharing is
--    already on. Turning sharing on and choosing visibility stay with
--    set_location_sharing / the settings screen.
--
-- Safe to re-run. Apply after 0077.

begin;

-- ── 1. Permits: who may create and change what ──────────────────────────

drop policy if exists "permits create as requester" on public.location_permits;
create policy "permits create as requester" on public.location_permits
  for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and status = 'pending'
    and responded_at is null
  );

drop policy if exists "permits update as target" on public.location_permits;
create policy "permits update as target" on public.location_permits
  for update to authenticated
  using (target_id = (select auth.uid()))
  with check (
    target_id = (select auth.uid())
    and status in ('approved', 'denied', 'revoked')
  );

drop policy if exists "permits withdraw as requester" on public.location_permits;
create policy "permits withdraw as requester" on public.location_permits
  for update to authenticated
  using (requester_id = (select auth.uid()))
  with check (
    requester_id = (select auth.uid())
    and status = 'revoked'
  );

-- Who a permit is between is fixed at creation. Policies cannot compare old
-- and new rows, so a trigger does.
create or replace function public.permits_keep_parties()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.requester_id is distinct from old.requester_id
     or new.target_id is distinct from old.target_id then
    raise exception 'a location permit cannot change who it is between';
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'denied') then
    new.responded_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_permits_keep_parties on public.location_permits;
create trigger trg_permits_keep_parties
  before update on public.location_permits
  for each row execute function public.permits_keep_parties();

-- ── 2. Reading a location: restore the approved-permit clause ───────────

drop policy if exists "locations read" on public.user_locations;
create policy "locations read" on public.user_locations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      coalesce(sharing_enabled, false) = true
      and updated_at > now() - interval '8 hours'
      and not public.is_blocked_between(user_locations.user_id, (select auth.uid()))
      and (
        visibility = 'public'
        or (
          visibility = 'friends'
          and exists (
            select 1 from public.follows
            where follower_id = (select auth.uid()) and followed_id = user_locations.user_id
          )
        )
        -- Restored from 0004: someone you approved may see you while the
        -- permit stands, whatever your visibility setting.
        or exists (
          select 1 from public.location_permits lp
          where lp.target_id = user_locations.user_id
            and lp.requester_id = (select auth.uid())
            and lp.status = 'approved'
            and (lp.expires_at is null or lp.expires_at > now())
        )
      )
    )
  );

-- ── 3. A location fix that only moves the pin ───────────────────────────

-- Returns false (and writes nothing) when you are not sharing, so a late GPS
-- fix can never switch sharing back on.
create or replace function public.update_my_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy real default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_rows int;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid coordinates';
  end if;

  update public.user_locations
     set lat = p_lat, lng = p_lng, accuracy = p_accuracy, updated_at = now()
   where user_id = v_me
     and coalesce(sharing_enabled, false) = true;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$fn$;

revoke all on function public.update_my_location(double precision, double precision, real) from public, anon;
grant execute on function public.update_my_location(double precision, double precision, real) to authenticated;

commit;

-- ── Checks (run after applying; every row should say true) ──
-- select 'requester cannot approve: policy has a status check',
--        (select with_check from pg_policies where tablename = 'location_permits'
--          and policyname = 'permits withdraw as requester') like '%revoked%';
-- select 'permit clause is back in locations read',
--        (select qual from pg_policies where tablename = 'user_locations'
--          and policyname = 'locations read') like '%location_permits%';
