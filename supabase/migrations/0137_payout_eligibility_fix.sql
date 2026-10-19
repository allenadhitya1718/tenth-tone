-- 0137: two fixes found by the rolled-back scenario tests (supabase/tests/03).
--
-- 1. payout_eligibility() raised 22P02 "malformed array literal" for every
--    creator who was not yet eligible: on Postgres 17 `text[] || 'literal'`
--    parses the literal as an array. It now uses array_append(). Without
--    this, my_creator_earnings(), creator_request_withdrawal(),
--    admin_v2_payout_creator() and admin_v2_payout_withdrawals() all errored
--    for any creator before KYC approval.
-- 2. admin_v2_payout_set_config() accepted absurd values (sar_per_diamond 89,
--    min_withdraw_sar 0.01). It now bounds both.
-- Safe to re-run.

drop function if exists public.payout_eligibility(uuid);
create function public.payout_eligibility(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  c        public.payout_config;
  p        record;
  v_birth  date;
  v_kyc    text;
  reasons  text[] := '{}';
  v_days_left integer := 0;
begin
  c := public.payout_cfg();
  select created_at, banned_until, deactivated_at, deletion_scheduled_at
    into p from public.profiles where id = p_user;
  if not found then
    return jsonb_build_object('eligible', false, 'reasons', jsonb_build_array('no_account'));
  end if;

  if not coalesce(c.active, false) then reasons := array_append(reasons, 'payouts_paused'); end if;

  select birth_date into v_birth from public.user_private where user_id = p_user;
  if v_birth is null then
    reasons := array_append(reasons, 'no_birth_date');
  elsif v_birth > (current_date - make_interval(years => c.min_age))::date then
    reasons := array_append(reasons, 'under_age');
  end if;

  if p.created_at > now() - make_interval(days => c.min_account_age_days) then
    reasons := array_append(reasons, 'account_too_new');
    v_days_left := ceil(extract(epoch from (p.created_at + make_interval(days => c.min_account_age_days) - now())) / 86400)::integer;
  end if;

  if (p.banned_until is not null and p.banned_until > now())
     or p.deactivated_at is not null or p.deletion_scheduled_at is not null then
    reasons := array_append(reasons, 'account_restricted');
  end if;

  if exists (select 1 from public.wallet_flags f where f.user_id = p_user and f.reviewed_at is null) then
    reasons := array_append(reasons, 'account_flagged');
  end if;
  if exists (select 1 from public.creator_payout_holds h where h.user_id = p_user) then
    reasons := array_append(reasons, 'on_hold');
  end if;

  select status into v_kyc from public.creator_kyc where user_id = p_user;
  if v_kyc is null then reasons := array_append(reasons, 'kyc_missing');
  elsif v_kyc = 'pending' then reasons := array_append(reasons, 'kyc_pending');
  elsif v_kyc = 'rejected' then reasons := array_append(reasons, 'kyc_rejected');
  end if;

  return jsonb_build_object('eligible', cardinality(reasons) = 0,
                            'reasons', to_jsonb(reasons),
                            'account_days_left', v_days_left);
end;
$fn$;


drop function if exists public.admin_v2_payout_set_config(numeric, numeric, numeric, integer, integer, integer, integer, boolean);
create function public.admin_v2_payout_set_config(
  p_diamonds_per_coin    numeric default null,
  p_sar_per_diamond      numeric default null,
  p_min_withdraw_sar     numeric default null,
  p_hold_days            integer default null,
  p_min_account_age_days integer default null,
  p_min_age              integer default null,
  p_refund_lookback_days integer default null,
  p_active               boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old public.payout_config;
  v_new public.payout_config;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_sar_per_diamond is not null and (p_sar_per_diamond < 0.0001 or p_sar_per_diamond > 1) then
    raise exception 'sar_per_diamond must be between 0.0001 and 1' using errcode = '22023';
  end if;
  if p_min_withdraw_sar is not null and (p_min_withdraw_sar < 10 or p_min_withdraw_sar > 100000) then
    raise exception 'min_withdraw_sar must be between 10 and 100000' using errcode = '22023';
  end if;
  select * into v_old from public.payout_config where id for update;

  update public.payout_config
     set diamonds_per_coin    = coalesce(p_diamonds_per_coin, diamonds_per_coin),
         sar_per_diamond      = coalesce(p_sar_per_diamond, sar_per_diamond),
         min_withdraw_sar     = coalesce(p_min_withdraw_sar, min_withdraw_sar),
         hold_days            = coalesce(p_hold_days, hold_days),
         min_account_age_days = coalesce(p_min_account_age_days, min_account_age_days),
         min_age              = coalesce(p_min_age, min_age),
         refund_lookback_days = coalesce(p_refund_lookback_days, refund_lookback_days),
         active               = coalesce(p_active, active),
         updated_at = now(), updated_by = auth.uid()
   where id
  returning * into v_new;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'payout_config', 'payout_config', null,
          jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_new)));
  return to_jsonb(v_new);
end;
$fn$;


revoke all on function public.payout_eligibility(uuid) from public, anon, authenticated;

revoke all on function public.admin_v2_payout_set_config(numeric, numeric, numeric, integer, integer, integer, integer, boolean) from public, anon;
grant execute on function public.admin_v2_payout_set_config(numeric, numeric, numeric, integer, integer, integer, integer, boolean) to authenticated;

-- Checks.
select 'payout_eligibility no longer raises for an ineligible user' as item,
       case when (public.payout_eligibility(gen_random_uuid())->>'eligible') = 'false' then 'OK' else 'MISSING' end as result
union all
select 'payout_eligibility not callable by the API',
       case when not has_function_privilege('authenticated', 'public.payout_eligibility(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.payout_eligibility(uuid)', 'execute') then 'OK' else 'MISSING' end
union all
select 'set_config callable by authenticated, not anon',
       case when has_function_privilege('authenticated', 'public.admin_v2_payout_set_config(numeric,numeric,numeric,integer,integer,integer,integer,boolean)', 'execute')
             and not has_function_privilege('anon', 'public.admin_v2_payout_set_config(numeric,numeric,numeric,integer,integer,integer,integer,boolean)', 'execute') then 'OK' else 'MISSING' end
union all
select 'set_config bounds present',
       case when pg_get_functiondef('public.admin_v2_payout_set_config(numeric,numeric,numeric,integer,integer,integer,integer,boolean)'::regprocedure) like '%0.0001 and 1%' then 'OK' else 'MISSING' end;
