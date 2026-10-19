-- 06 - reactivate_account (scenario 6)
-- Generated; always ends in RAISE EXCEPTION so the whole transaction rolls back (nothing persists).
-- Run from the repo root:  npx supabase db query --linked -f <this file>
-- Result is in the error message ("RESULTS: [...]").
do $tt$
declare
  res jsonb := '[]'::jsonb;
  sfx text := substr(md5(random()::text), 1, 6);
  j jsonb; j2 jsonb; n bigint; n2 bigint; t text; t2 text; r record;
  u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid(); u_adm uuid := gen_random_uuid();
begin
 begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select x.id, 'authenticated', 'authenticated', 'tt-' || x.h || '@example.invalid',
         jsonb_build_object('handle', 'tt_' || x.h || '_' || sfx), now(), now()
    from (values (u_a, 'a'),(u_b, 'b'),(u_adm, 'adm')) x(id, h);
  update public.profiles set is_admin = true where id = u_adm;
perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role','authenticated')::text, true); set local role authenticated;
  perform public.deactivate_account();
  j := public.my_account_status();
res := res || jsonb_build_object('t', '6. deactivate_account sets deactivated', 'pass', coalesce(((j->>'deactivated')::boolean)::boolean,false), 'ev', (j::text)::text);
  perform public.schedule_account_deletion();
  j := public.my_account_status();
res := res || jsonb_build_object('t', '6. schedule_account_deletion sets deletion_scheduled_at (~30 days)', 'pass', coalesce((j->>'deletion_scheduled_at' is not null and (j->>'days_left')::int between 29 and 30)::boolean,false), 'ev', (j::text)::text);
  perform public.reactivate_account();
  j := public.my_account_status();
res := res || jsonb_build_object('t', '6. reactivate_account clears deactivated_at AND deletion_scheduled_at', 'pass', coalesce((not (j->>'deactivated')::boolean and j->>'deletion_scheduled_at' is null and j->>'deactivated_at' is null)::boolean,false), 'ev', (j::text)::text);
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  perform public.admin_v2_set_ban(u_b, now() + interval '30 days', 'tt');
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role','authenticated')::text, true); set local role authenticated;
  perform public.deactivate_account();
  perform public.reactivate_account();
  j := public.my_account_status();
res := res || jsonb_build_object('t', '6. banned user: reactivate clears the deactivation but the BAN stays', 'pass', coalesce((not (j->>'deactivated')::boolean and (j->>'banned')::boolean)::boolean,false), 'ev', (j::text)::text);
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '6. banned_until untouched in profiles', 'pass', coalesce(((select banned_until > now() + interval '29 days' from public.profiles where id = u_b))::boolean,false), 'ev', ((select banned_until::text from public.profiles where id = u_b))::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role','authenticated')::text, true); set local role authenticated;
  perform public.schedule_account_deletion();
  perform public.reactivate_account();
  j := public.my_account_status();
res := res || jsonb_build_object('t', '6. banned user scheduled for deletion: reactivate cancels deletion, ban stays', 'pass', coalesce((j->>'deletion_scheduled_at' is null and (j->>'banned')::boolean)::boolean,false), 'ev', (j::text)::text);
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true); set local role anon;
begin
  perform public.reactivate_account();
  res := res || jsonb_build_object('t', '6. anon cannot reactivate (refused: 42501 or ''not signed in'')', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '6. anon cannot reactivate (refused: 42501 or ''not signed in'')', 'pass', (sqlstate = '42501' or sqlerrm like '%not signed in%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.reactivate_account();
  res := res || jsonb_build_object('t', '6. reactivate on an active account is a harmless no-op', 'pass', coalesce((not (public.my_account_status()->>'deactivated')::boolean)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '6. reactivate on an active account is a harmless no-op', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);

 exception when others then
  reset role;
  res := res || jsonb_build_object('t', 'HARNESS ABORTED (unhandled error)', 'pass', false, 'ev', sqlstate || ' ' || left(sqlerrm, 300));
 end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RESULTS: %', res::text;
end
$tt$;
