-- ============================================================
-- 0107_suggest_tags.sql
--
-- Client note 23: "AI hashtags from the photo, plus location". The
-- suggest-tags Edge Function sends the poster frame (or story photo) to the
-- same Gemini key moderate-content uses and returns a handful of hashtags.
--
-- Every call spends the free tier's DAILY request cap, which moderation
-- shares. A for-loop against suggest-tags could therefore switch screening
-- off for the whole app (moderate-content fails open on 429). So the call is
-- rate limited per account, the same way 0050 and 0056 limit everything else:
-- count the recent rows, raise via rate_limit_exceeded() if there are too
-- many. The only difference is that nothing else in the schema records a
-- suggestion, so this migration adds the small table that gets counted.
--
-- Limits are GENEROUS, as in 0050: the app asks once per poster frame, so a
-- person posting all afternoon stays far below them.
--     20 per hour, 60 per day.
--
-- Safe to re-run: if-not-exists / create-or-replace / drop-if-exists
-- throughout, and the grants are idempotent.
-- ============================================================


-- ── The ledger that gets counted ─────────────────────────
-- Written by the Edge Function with the service role only. RLS on with no
-- policies, so no client can read it, write it or delete its own rows to
-- reset the counter.
create table if not exists public.tag_suggestion_requests (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.tag_suggestion_requests enable row level security;

revoke all on public.tag_suggestion_requests from anon, authenticated;

-- The check filters by person and time window; without this it would scan.
create index if not exists idx_tag_suggestion_requests_user_created
  on public.tag_suggestion_requests (user_id, created_at desc);


-- ── Count, raise, record ─────────────────────────────────
-- One call per suggestion, made by the Edge Function BEFORE it calls Gemini.
-- Raises check_violation (SQLSTATE 23514) through rate_limit_exceeded() from
-- 0050 when over a limit; the function maps that to { error: 'rate_limited' }.
--
-- Rows older than a day are no longer counted by anything, so each call
-- trims the caller's own old rows. The table stays at roughly one day of
-- requests per active person, with no background job.
create or replace function public.suggest_tags_take(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare n_hour integer; n_day integer;
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = 'invalid_parameter_value';
  end if;

  -- Serialise one person's concurrent calls, so a burst fired in parallel
  -- cannot all read the same count and all get through.
  perform pg_advisory_xact_lock(hashtextextended('suggest_tags:' || p_user_id::text, 0));

  delete from public.tag_suggestion_requests
   where user_id = p_user_id
     and created_at < now() - interval '1 day';

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*)
    into n_hour, n_day
    from public.tag_suggestion_requests
   where user_id = p_user_id
     and created_at > now() - interval '1 day';

  perform public.rate_limit_exceeded(n_hour, 20, 'hashtag suggestions');
  perform public.rate_limit_exceeded(n_day, 60, 'hashtag suggestions today');

  insert into public.tag_suggestion_requests (user_id) values (p_user_id);
end;
$$;

-- Service role only: a client calling this directly would only burn its own
-- allowance, but there is no reason to let it, and the user id is a
-- parameter, so a client could burn SOMEONE ELSE'S. Same reasoning as
-- moderation_log_event() in 0066.
revoke all on function public.suggest_tags_take(uuid) from public, anon, authenticated;
grant execute on function public.suggest_tags_take(uuid) to service_role;


-- ── Verification ─────────────────────────────────────────
-- Run after applying. Every row should read 'yes'.
select 'tag_suggestion_requests' as object,
       case when to_regclass('public.tag_suggestion_requests') is not null then 'yes' else 'MISSING' end as installed
union all select 'rls on tag_suggestion_requests',
       case when exists (select 1 from pg_class
                          where oid = to_regclass('public.tag_suggestion_requests') and relrowsecurity)
            then 'yes' else 'MISSING' end
union all select 'idx_tag_suggestion_requests_user_created',
       case when to_regclass('public.idx_tag_suggestion_requests_user_created') is not null then 'yes' else 'MISSING' end
union all select 'suggest_tags_take()',
       case when to_regprocedure('public.suggest_tags_take(uuid)') is not null then 'yes' else 'MISSING' end
union all select 'rate_limit_exceeded() from 0050',
       case when to_regprocedure('public.rate_limit_exceeded(integer, integer, text)') is not null then 'yes' else 'MISSING' end
union all select 'authenticated cannot execute suggest_tags_take',
       case when not has_function_privilege('authenticated', 'public.suggest_tags_take(uuid)', 'execute')
            then 'yes' else 'MISSING' end
union all select 'service_role can execute suggest_tags_take',
       case when has_function_privilege('service_role', 'public.suggest_tags_take(uuid)', 'execute')
            then 'yes' else 'MISSING' end;
