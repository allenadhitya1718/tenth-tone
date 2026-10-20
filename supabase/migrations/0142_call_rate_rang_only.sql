-- 0142 (PROPOSAL, NOT APPLIED): the call rate limit (0094, 20/hour total and
-- 10/hour per person) counted every row, so calls the caller cancelled within
-- a few seconds (before the other phone could really ring) used up the quota
-- of a tester or an anxious caller. Count only attempts that rang: answered,
-- missed, declined, still ringing, or cancelled after ringing for 8 s or more.
-- Same function and trigger as 0094; only the counting filter changes.
create or replace function public.check_call_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n_total integer; n_callee integer;
begin
  select count(*) into n_total from public.calls c
   where c.caller_id = new.caller_id
     and c.created_at > now() - interval '1 hour'
     and not (c.status = 'ended' and c.answered_at is null
              and coalesce(c.ended_at, now()) - c.created_at < interval '8 seconds');
  perform public.rate_limit_exceeded(n_total, 20, 'calls');

  if new.root_id is null then
    select count(*) into n_callee from public.calls c
     where c.caller_id = new.caller_id
       and c.callee_id = new.callee_id
       and c.root_id is null
       and c.created_at > now() - interval '1 hour'
       and not (c.status = 'ended' and c.answered_at is null
                and coalesce(c.ended_at, now()) - c.created_at < interval '8 seconds');
    perform public.rate_limit_exceeded(n_callee, 10, 'calls to this person');
  end if;
  return new;
end;
$$;
