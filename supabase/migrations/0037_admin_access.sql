-- ============================================================
-- 0037_admin_access.sql
--
-- The admin portal could not see several things the app now produces:
--
--   * data_export_requests - people ask for their data and nobody can read it
--   * account deletions     - a 30-day queue with no way to view it
--   * storage / limits      - the spending ceiling had no operator surface
--
-- Support tickets already allow admin reads (0033); the rest did not.
--
-- Apply in the Supabase SQL editor AFTER 0001..0036.
-- ============================================================

-- ── Admins can work the data-export queue ──
drop policy if exists "exports admin read" on public.data_export_requests;
create policy "exports admin read" on public.data_export_requests
  for select to authenticated
  using (public.is_admin());

drop policy if exists "exports admin update" on public.data_export_requests;
create policy "exports admin update" on public.data_export_requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ── Accounts scheduled for deletion ──
-- Returns the queue with days remaining, so an operator can see what is about
-- to be erased and step in before it happens.
create or replace function public.admin_pending_deletions()
returns table (
  id uuid, name text, handle text, avatar_url text,
  deactivated_at timestamptz, deletion_scheduled_at timestamptz, days_left integer
)
language sql
security definer
stable
set search_path = public
as $fn$
  select p.id, p.name, p.handle, p.avatar_url,
         p.deactivated_at, p.deletion_scheduled_at,
         greatest(0, ceil(extract(epoch from (p.deletion_scheduled_at - now())) / 86400))::integer
  from public.profiles p
  where public.is_admin()
    and p.deletion_scheduled_at is not null
  order by p.deletion_scheduled_at asc;
$fn$;

grant execute on function public.admin_pending_deletions() to authenticated;


-- ── Cancel a deletion on someone's behalf ──
-- Support gets "I deleted it by mistake" constantly, and the person often
-- cannot sign in to cancel it themselves.
create or replace function public.admin_cancel_deletion(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;

  update public.profiles
     set deletion_scheduled_at = null,
         deactivated_at = null
   where id = p_user;

  insert into public.admin_logs (admin_id, action, target_type, target_id)
  values (auth.uid(), 'cancel_deletion', 'user', p_user);
end;
$fn$;

grant execute on function public.admin_cancel_deletion(uuid) to authenticated;


-- ── Storage, at a glance ──
-- Per-bucket totals plus the ceiling, so the operator can see how close the
-- app is to the limit that stops uploads.
create or replace function public.admin_storage_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $fn$
declare
  v_buckets jsonb;
  v_total   bigint;
  v_limit   bigint;
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'bucket', bucket_id,
           'files',  cnt,
           'bytes',  bytes
         ) order by bytes desc), '[]'::jsonb)
    into v_buckets
  from (
    select bucket_id,
           count(*)::bigint as cnt,
           coalesce(sum((metadata->>'size')::bigint), 0)::bigint as bytes
    from storage.objects
    group by bucket_id
  ) b;

  select coalesce(sum((metadata->>'size')::bigint), 0) into v_total from storage.objects;
  select global_max_bytes into v_limit from public.app_limits where id = 1;

  return jsonb_build_object(
    'buckets', v_buckets,
    'total_bytes', v_total,
    'limit_bytes', v_limit,
    'pct_used', case when coalesce(v_limit, 0) = 0 then 0
                     else round((v_total::numeric / v_limit) * 100, 1) end
  );
end;
$fn$;

grant execute on function public.admin_storage_overview() to authenticated;


-- ── Counts the dashboard needs in one round trip ──
create or replace function public.admin_queue_counts()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;

  return jsonb_build_object(
    'open_reports',      (select count(*) from public.reports where status = 'pending'),
    'open_tickets',      (select count(*) from public.support_tickets where status in ('open', 'in_progress')),
    'pending_exports',   (select count(*) from public.data_export_requests where status = 'pending'),
    'pending_deletions', (select count(*) from public.profiles where deletion_scheduled_at is not null),
    'live_now',          (select count(*) from public.live_streams where status = 'live'),
    'banned_users',      (select count(*) from public.profiles where banned_until is not null and banned_until > now())
  );
end;
$fn$;

grant execute on function public.admin_queue_counts() to authenticated;


-- ── Growth, for the analytics page ──
-- Daily signups and posts over a window, so the charts show real numbers
-- rather than the sample series they were drawn with.
create or replace function public.admin_growth(p_days integer default 30)
returns table (day date, signups integer, videos integer, comments integer)
language sql
security definer
stable
set search_path = public
as $fn$
  select d::date as day,
         (select count(*) from public.profiles  p where p.created_at::date = d::date)::integer,
         (select count(*) from public.videos    v where v.created_at::date = d::date)::integer,
         (select count(*) from public.comments  c where c.created_at::date = d::date)::integer
  from generate_series(
         current_date - (greatest(1, least(p_days, 365)) - 1),
         current_date,
         interval '1 day'
       ) d
  where public.is_admin()
  order by d;
$fn$;

grant execute on function public.admin_growth(integer) to authenticated;
