-- 0139 - hard daily cap on emails sent through Resend
--
-- Security review 2026-10, "Resend: set a daily send limit". Apply after 0138.
-- Safe to re-run.
--
-- The only code that calls api.resend.com is the storage-alert Edge Function
-- (two call sites: the storage alert and the usage alert; the hourly usage
-- watcher in 0129 reaches it through post_alert_mail). Auth emails (OTP, reset)
-- go through Supabase Auth's own SMTP settings, not through this project's
-- code, and are capped by Supabase Auth's rate limits, not here.
--
-- email_send_take(sender, n) reserves n sends against today's (UTC) total and
-- returns false when that would pass email_config.daily_cap (default 50).
-- Reserved BEFORE sending, so a failed send still counts: the cap can only err
-- on the safe side. A refusal is logged once per day to admin_logs
-- ('email_cap_hit'). email_config.enabled = false stops all sending.

begin;

create table if not exists public.email_config (
  id         boolean primary key default true check (id),
  daily_cap  integer not null default 50 check (daily_cap >= 0),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.email_config (id) values (true) on conflict (id) do nothing;
alter table public.email_config enable row level security;
revoke all on public.email_config from public, anon, authenticated;

create table if not exists public.email_send_log (
  day     date    not null,
  sender  text    not null,
  sent    integer not null default 0,
  refused integer not null default 0,
  primary key (day, sender)
);
alter table public.email_send_log enable row level security;
revoke all on public.email_send_log from public, anon, authenticated;

create or replace function public.email_send_take(p_sender text, p_count integer default 1)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cfg   public.email_config%rowtype;
  v_day   date := (now() at time zone 'utc')::date;
  v_total integer;
  v_n     integer := greatest(coalesce(p_count, 1), 1);
  v_first boolean;
begin
  select * into v_cfg from public.email_config where id;
  if not found then
    v_cfg.daily_cap := 50; v_cfg.enabled := true;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('email_send_take', 0));

  select coalesce(sum(sent), 0) into v_total from public.email_send_log where day = v_day;

  if not v_cfg.enabled or v_total + v_n > v_cfg.daily_cap then
    insert into public.email_send_log (day, sender, refused) values (v_day, coalesce(p_sender, 'unknown'), v_n)
      on conflict (day, sender) do update set refused = public.email_send_log.refused + v_n;
    if not exists (select 1 from public.admin_logs
                    where action = 'email_cap_hit' and created_at >= v_day::timestamptz) then
      insert into public.admin_logs (action, target_type, payload)
      values ('email_cap_hit', 'system',
              jsonb_build_object('sender', p_sender, 'cap', v_cfg.daily_cap, 'sent_today', v_total,
                                 'wanted', v_n, 'enabled', v_cfg.enabled));
    end if;
    return false;
  end if;

  insert into public.email_send_log (day, sender, sent) values (v_day, coalesce(p_sender, 'unknown'), v_n)
    on conflict (day, sender) do update set sent = public.email_send_log.sent + v_n;
  return true;
end;
$fn$;
revoke all on function public.email_send_take(text, integer) from public, anon, authenticated;
grant execute on function public.email_send_take(text, integer) to service_role;

-- housekeeping: keep 60 days
delete from public.email_send_log where day < (now() at time zone 'utc')::date - 60;

commit;

-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'email_config default cap is 50' as check,
       case when (select daily_cap from public.email_config where id) = 50 then 'OK' else 'CHANGED' end as result
union all select 'tables are not readable by clients',
       case when not has_table_privilege('authenticated', 'public.email_send_log', 'select')
             and not has_table_privilege('anon', 'public.email_config', 'select') then 'OK' else 'EXPOSED' end
union all select 'email_send_take is service_role only',
       case when not has_function_privilege('authenticated', 'public.email_send_take(text,integer)', 'execute')
             and has_function_privilege('service_role', 'public.email_send_take(text,integer)', 'execute')
            then 'OK' else 'WRONG' end;
