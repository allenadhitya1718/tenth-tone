-- 01 - permissions (scenario 1)
-- Generated; always ends in RAISE EXCEPTION so the whole transaction rolls back (nothing persists).
-- Run from the repo root:  npx supabase db query --linked -f <this file>
-- Result is in the error message ("RESULTS: [...]").
do $tt$
declare
  res jsonb := '[]'::jsonb;
  sfx text := substr(md5(random()::text), 1, 6);
  j jsonb; j2 jsonb; n bigint; n2 bigint; t text; t2 text; r record;
  u_adm uuid := gen_random_uuid(); u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid(); u_c uuid := gen_random_uuid();
  ap_a uuid; ap_b uuid; kyc_b uuid; w_b uuid; e_b uuid; f record; args text; tested int := 0; refused int := 0; bad jsonb := '[]'::jsonb;
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select x.id, 'authenticated', 'authenticated', 'tt-' || x.h || '@example.invalid',
         jsonb_build_object('handle', 'tt_' || x.h || '_' || sfx), now(), now()
    from (values (u_adm, 'adm'),(u_a, 'a'),(u_b, 'b'),(u_c, 'c')) x(id, h);
  update public.profiles set is_admin = true where id = u_adm;
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  perform public.admin_v2_set_ban(u_a, now() + interval '7 days', 'tt');
  perform public.admin_v2_set_ban(u_b, now() + interval '7 days', 'tt');
  perform public.admin_v2_set_ban(u_c, now() + interval '7 days', 'tt');
reset role; perform set_config('request.jwt.claims','',true);
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_a, 'ban', 'user', u_a, 'a appeal') returning id into ap_a;
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_b, 'ban', 'user', u_b, 'b appeal') returning id into ap_b;
  insert into public.creator_kyc (user_id, legal_name, id_number, id_type, id_photo_path, iban, bank_name, owner_attested)
    values (u_b, 'Bee Person', '1000000001', 'national_id', u_b::text || '/x.jpg', 'SA0380000000608010167519', 'Bank', true) returning id into kyc_b;
  insert into public.creator_withdrawals (user_id, kyc_id, amount_sar, diamonds, sar_per_diamond, legal_name, iban, bank_name)
    values (u_b, kyc_b, 100, 11236, 0.0089, 'Bee Person', 'SA0380000000608010167519', 'Bank') returning id into w_b;
  insert into public.creator_earnings (receiver_id, coins, diamonds, status, available_at) values (u_b, 5, 5, 'available', now()) returning id into e_b;
perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role','authenticated')::text, true); set local role authenticated;
  tested := 0; refused := 0; bad := '[]'::jsonb;
  for f in
    select p.proname,
           coalesce((select string_agg(case x.t::regtype::text
                       when 'uuid' then 'gen_random_uuid()' when 'text' then '''x''' when 'boolean' then 'true'
                       when 'timestamp with time zone' then 'now()' when 'text[]' then 'array[]::text[]' else '1' end,
                       ',' order by x.o)
                from unnest(p.proargtypes::oid[]) with ordinality as x(t, o)
               where x.o <= p.pronargs - p.pronargdefaults), '') as args
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname like 'admin\_v2\_%' order by 1
  loop
    tested := tested + 1;
    begin
      execute format('select public.%I(%s)', f.proname, f.args);
      bad := bad || to_jsonb(f.proname || ' ALLOWED');
    exception when others then
      if sqlstate = '42501' then refused := refused + 1;
      else bad := bad || to_jsonb(f.proname || ' -> ' || sqlstate || ' ' || left(sqlerrm, 80)); end if;
    end;
  end loop;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '1. every admin_v2_* RPC refused with 42501 as authenticated non-admin', 'pass', coalesce((tested > 30 and refused = tested)::boolean,false), 'ev', (tested || ' functions tested, ' || refused || ' refused; exceptions: ' || bad::text)::text);
perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true); set local role anon;
  tested := 0; refused := 0; bad := '[]'::jsonb;
  for f in
    select p.proname,
           coalesce((select string_agg(case x.t::regtype::text
                       when 'uuid' then 'gen_random_uuid()' when 'text' then '''x''' when 'boolean' then 'true'
                       when 'timestamp with time zone' then 'now()' when 'text[]' then 'array[]::text[]' else '1' end,
                       ',' order by x.o)
                from unnest(p.proargtypes::oid[]) with ordinality as x(t, o)
               where x.o <= p.pronargs - p.pronargdefaults), '') as args
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname like 'admin\_v2\_%' order by 1
  loop
    tested := tested + 1;
    begin
      execute format('select public.%I(%s)', f.proname, f.args);
      bad := bad || to_jsonb(f.proname || ' ALLOWED');
    exception when others then
      if sqlstate = '42501' then refused := refused + 1;
      else bad := bad || to_jsonb(f.proname || ' -> ' || sqlstate || ' ' || left(sqlerrm, 80)); end if;
    end;
  end loop;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '1. every admin_v2_* RPC refused with 42501 as anon', 'pass', coalesce((tested > 30 and refused = tested)::boolean,false), 'ev', (tested || ' functions tested, ' || refused || ' refused; exceptions: ' || bad::text)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_appeal_counts(); perform public.admin_v2_payout_overview();
  res := res || jsonb_build_object('t', '1. control: real admin CAN call admin_v2_appeal_counts / payout_overview', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '1. control: real admin CAN call admin_v2_appeal_counts / payout_overview', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role','authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.appeals where user_id = u_b;
  select count(*) into n2 from public.appeals;
res := res || jsonb_build_object('t', '1. user cannot select another user''s appeals (RLS)', 'pass', coalesce((n = 0 and n2 = 1)::boolean,false), 'ev', ('other=' || n || ' visible_total=' || n2 || ' (own only)')::text);
begin
  perform 1 from public.creator_kyc limit 1;
  res := res || jsonb_build_object('t', '1. user cannot select creator_kyc (no grant)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. user cannot select creator_kyc (no grant)', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform 1 from public.creator_withdrawals limit 1;
  res := res || jsonb_build_object('t', '1. user cannot select creator_withdrawals (no grant)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. user cannot select creator_withdrawals (no grant)', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
  select count(*) into n from public.creator_earnings where receiver_id = u_b;
res := res || jsonb_build_object('t', '1. user cannot see another creator''s creator_earnings (RLS)', 'pass', coalesce((n = 0)::boolean,false), 'ev', ('rows=' || n)::text);
begin
  insert into public.creator_earnings (receiver_id, coins, diamonds, status, available_at) values (u_a, 1, 999999, 'available', now());
  res := res || jsonb_build_object('t', '1. user cannot insert creator_earnings', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. user cannot insert creator_earnings', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  update public.payout_config set sar_per_diamond = 5;
  res := res || jsonb_build_object('t', '1. user cannot update payout_config', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. user cannot update payout_config', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.payout_balance(u_b);
  res := res || jsonb_build_object('t', '1. user cannot call payout_balance (internal)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. user cannot call payout_balance (internal)', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.payout_settle(u_b);
  res := res || jsonb_build_object('t', '1. user cannot call payout_settle (internal)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. user cannot call payout_settle (internal)', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  update public.appeals set status = 'accepted' where id = ap_a;
  res := res || jsonb_build_object('t', '1. user cannot UPDATE own appeal', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. user cannot UPDATE own appeal', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  delete from public.appeals where id = ap_a;
  res := res || jsonb_build_object('t', '1. user cannot DELETE own appeal', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. user cannot DELETE own appeal', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
  select status into t from public.appeals where id = ap_a;
res := res || jsonb_build_object('t', '1. own appeal still open after blocked update/delete', 'pass', coalesce((t = 'open')::boolean,false), 'ev', (t)::text);
begin
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_b, 'ban', 'user', u_b, 'x');
  res := res || jsonb_build_object('t', '1. user cannot appeal on behalf of someone else (user_id forced to caller, then target not eligible)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. user cannot appeal on behalf of someone else (user_id forced to caller, then target not eligible)', 'pass', (sqlerrm like '%appeal_not_eligible%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
  select count(*) into n from public.appeals where user_id = u_b;
res := res || jsonb_build_object('t', '1. other user''s appeal rows unchanged (still exactly 1)', 'pass', coalesce((n = 1)::boolean,false), 'ev', ('rows=' || n)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  insert into public.appeals (user_id, kind, target_type, target_id, reason, status, admin_note, decided_at) values (u_c, 'ban', 'user', u_c, 'x', 'open', 'sneaky', null) returning status, admin_note into t, t2;
  res := res || jsonb_build_object('t', '1. user cannot self-accept: inserting status ''accepted'' + admin_note is forced back to open/null', 'pass', coalesce((t = 'open' and t2 is null)::boolean,false), 'ev', (t || '/' || coalesce(t2,'null'))::text);
exception when others then
  res := res || jsonb_build_object('t', '1. user cannot self-accept: inserting status ''accepted'' + admin_note is forced back to open/null', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role','authenticated')::text, true); set local role authenticated;
  update public.profiles set is_admin = true, verified = true, banned_until = null where id = u_a;
reset role; perform set_config('request.jwt.claims','',true);
  select is_admin, verified, (banned_until is not null and banned_until > now()) as still_banned into r from public.profiles where id = u_a;
res := res || jsonb_build_object('t', '1. user cannot set own is_admin / verified / clear own ban (silently reverted by guard trigger)', 'pass', coalesce((r.is_admin = false and r.verified = false and r.still_banned)::boolean,false), 'ev', (row_to_json(r)::text)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role','authenticated')::text, true); set local role authenticated;
  update public.profiles set is_admin = true where id = u_b;
  get diagnostics n = row_count;
reset role; perform set_config('request.jwt.claims','',true);
  select is_admin into r from public.profiles where id = u_b;
res := res || jsonb_build_object('t', '1. user cannot update another user''s profile', 'pass', coalesce((n = 0 and r.is_admin = false)::boolean,false), 'ev', ('rows updated=' || n)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role','authenticated')::text, true); set local role authenticated;
begin
  
  res := res || jsonb_build_object('t', '1. after tampering attempts user still not admin: is_admin() false', 'pass', coalesce((not public.is_admin())::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '1. after tampering attempts user still not admin: is_admin() false', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true); set local role anon;
begin
  perform 1 from public.appeals limit 1;
  res := res || jsonb_build_object('t', '1. anon cannot select appeals', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. anon cannot select appeals', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform 1 from public.creator_kyc limit 1;
  res := res || jsonb_build_object('t', '1. anon cannot select creator_kyc', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. anon cannot select creator_kyc', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform 1 from public.creator_withdrawals limit 1;
  res := res || jsonb_build_object('t', '1. anon cannot select creator_withdrawals', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. anon cannot select creator_withdrawals', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform 1 from public.creator_earnings limit 1;
  res := res || jsonb_build_object('t', '1. anon cannot select creator_earnings', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. anon cannot select creator_earnings', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.my_creator_earnings();
  res := res || jsonb_build_object('t', '1. anon cannot call my_creator_earnings', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. anon cannot call my_creator_earnings', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_request_withdrawal(100);
  res := res || jsonb_build_object('t', '1. anon cannot call creator_request_withdrawal', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. anon cannot call creator_request_withdrawal', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.my_appealable_items();
  res := res || jsonb_build_object('t', '1. anon cannot call my_appealable_items', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '1. anon cannot call my_appealable_items', 'pass', (sqlstate = '42501'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);

  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RESULTS: %', res::text;
end
$tt$;
