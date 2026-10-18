-- 0120 - per-account limits for the Edge Functions that spend a shared quota
--
-- Security review 2026-10, findings F07 (agora-token) and F11
-- (moderate-content). Apply after 0119, BEFORE deploying the new
-- agora-token and moderate-content. Safe to re-run.
--
-- Same shape as suggest_tags_take() (0107): a ledger only the service role
-- touches, a function that locks per person, trims old rows, counts the last
-- hour and day, raises check_violation (SQLSTATE 23514) through
-- rate_limit_exceeded() (0050) when over, and records the call.
--
-- One table for every bucket, so a new Edge Function does not need a new
-- migration. Limits are passed by the caller and are GENEROUS, as in 0050:
--   agora-token       600 / hour, 3000 / day   (a call or a live asks a few
--                                               times; role switches and
--                                               reconnects ask again)
--   moderate-content  150 / hour, 1000 / day   (above the comment, upload and
--                                               live limits combined)

create table if not exists public.edge_rate_requests (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  bucket     text not null,
  created_at timestamptz not null default now()
);

alter table public.edge_rate_requests enable row level security;
revoke all on public.edge_rate_requests from anon, authenticated;

create index if not exists idx_edge_rate_requests_user_bucket_created
  on public.edge_rate_requests (user_id, bucket, created_at desc);

create or replace function public.edge_rate_take(
  p_user_id  uuid,
  p_bucket   text,
  p_per_hour integer,
  p_per_day  integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare n_hour integer; n_day integer;
begin
  if p_user_id is null or coalesce(p_bucket, '') = '' then
    raise exception 'user id and bucket required' using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('edge_rate:' || p_bucket || ':' || p_user_id::text, 0));

  delete from public.edge_rate_requests
   where user_id = p_user_id
     and bucket = p_bucket
     and created_at < now() - interval '1 day';

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*)
    into n_hour, n_day
    from public.edge_rate_requests
   where user_id = p_user_id
     and bucket = p_bucket
     and created_at > now() - interval '1 day';

  perform public.rate_limit_exceeded(n_hour, greatest(p_per_hour, 1), p_bucket || ' requests');
  perform public.rate_limit_exceeded(n_day, greatest(p_per_day, 1), p_bucket || ' requests today');

  insert into public.edge_rate_requests (user_id, bucket) values (p_user_id, p_bucket);
end;
$$;

-- Service role only: the user id is a parameter, so a client could otherwise
-- burn someone else's allowance.
revoke all on function public.edge_rate_take(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.edge_rate_take(uuid, text, integer, integer) to service_role;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'edge_rate_requests' as check,
       case when to_regclass('public.edge_rate_requests') is not null then 'OK' else 'MISSING' end as result
union all
select 'rls on edge_rate_requests',
       case when (select relrowsecurity from pg_class where oid = to_regclass('public.edge_rate_requests'))
            then 'OK' else 'MISSING' end
union all
select 'authenticated cannot execute edge_rate_take',
       case when not has_function_privilege('authenticated', 'public.edge_rate_take(uuid, text, integer, integer)', 'execute')
            then 'OK' else 'STILL EXPOSED' end
union all
select 'service_role can execute edge_rate_take',
       case when has_function_privilege('service_role', 'public.edge_rate_take(uuid, text, integer, integer)', 'execute')
            then 'OK' else 'MISSING' end;
