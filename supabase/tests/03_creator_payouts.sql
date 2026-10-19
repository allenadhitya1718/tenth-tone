-- 03 - creator payouts (scenario 3). available_at is back-dated inside the transaction to simulate the 7-day hold passing.
-- Generated; always ends in RAISE EXCEPTION so the whole transaction rolls back (nothing persists).
-- Run from the repo root:  npx supabase db query --linked -f <this file>
-- Result is in the error message ("RESULTS: [...]").
do $tt$
declare
  res jsonb := '[]'::jsonb;
  sfx text := substr(md5(random()::text), 1, 6);
  j jsonb; j2 jsonb; n bigint; n2 bigint; t text; t2 text; r record;
  u_adm uuid := gen_random_uuid(); u_c uuid := gen_random_uuid(); u_s uuid := gen_random_uuid(); u_s2 uuid := gen_random_uuid();
  u_s3 uuid := gen_random_uuid(); u_s4 uuid := gen_random_uuid(); u_m uuid := gen_random_uuid(); u_d uuid := gen_random_uuid(); u_nb uuid := gen_random_uuid();
  tx uuid; tx2 uuid; kyc uuid; w1 uuid; w2 uuid; w3 uuid; wd uuid; e_rev uuid; avail0 bigint; avail1 bigint; cfg jsonb;
  c_bal0 integer; big_gift text; v_ok boolean;
begin
 begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select x.id, 'authenticated', 'authenticated', 'tt-' || x.h || '@example.invalid',
         jsonb_build_object('handle', 'tt_' || x.h || '_' || sfx), now(), now()
    from (values (u_adm, 'adm'),(u_c, 'c'),(u_s, 's'),(u_s2, 's2'),(u_s3, 's3'),(u_s4, 's4'),(u_m, 'm'),(u_d, 'd'),(u_nb, 'nb')) x(id, h);
  update public.profiles set is_admin = true where id = u_adm;
  update public.profiles set created_at = now() - interval '90 days' where id in (u_c, u_m, u_d, u_nb);
  insert into public.user_private (user_id, birth_date) values (u_c, date '1990-01-01'), (u_m, current_date - interval '15 years'), (u_d, date '1985-05-05')
    on conflict (user_id) do update set birth_date = excluded.birth_date;
  -- coins: production top-ups (the "paid" coins the funding rule looks for)
  insert into public.wallet_topups (user_id, platform, store_transaction_id, coins, status, environment, credited_at)
    values (u_s, 'ios', 'tt-' || sfx || '-1', 20000, 'credited', 'production', now()),
           (u_s2, 'ios', 'tt-' || sfx || '-2', 500, 'credited', 'production', now()),
           (u_s4, 'ios', 'tt-' || sfx || '-4', 200, 'credited', 'production', now());
  insert into public.wallets (user_id, balance) values (u_s, 20000), (u_s2, 500), (u_s3, 100), (u_s4, 200)
    on conflict (user_id) do update set balance = excluded.balance;
  select balance into c_bal0 from public.wallets where user_id = u_c;
res := res || jsonb_build_object('t', '3. config: payout_config.sar_per_diamond = 0.0089', 'pass', coalesce(((select sar_per_diamond from public.payout_config where id) = 0.0089)::boolean,false), 'ev', ((select sar_per_diamond::text from public.payout_config where id))::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_s, 'role','authenticated')::text, true); set local role authenticated;
begin
  tx := public.send_gift(u_c, 'star', null);
  res := res || jsonb_build_object('t', '3. funded sender sends ''star'' (10 coins) to creator via send_gift', 'pass', coalesce((tx is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. funded sender sends ''star'' (10 coins) to creator via send_gift', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
  select * into r from public.creator_earnings where gift_transaction_id = tx;
res := res || jsonb_build_object('t', '3. gift creates creator_earnings row: 10 diamonds, pending, 7-day hold, no withhold reason', 'pass', coalesce((r.diamonds = 10 and r.coins = 10 and r.status = 'pending' and r.withhold_reason is null and r.receiver_id = u_c and r.sender_id = u_s and r.available_at > now() + interval '6 days 23 hours')::boolean,false), 'ev', (row_to_json(r)::text)::text);
res := res || jsonb_build_object('t', '3. creator receives NO coins (wallet balance unchanged)', 'pass', coalesce(((select balance from public.wallets where user_id = u_c) = c_bal0)::boolean,false), 'ev', ('before=' || c_bal0 || ' after=' || (select balance from public.wallets where user_id = u_c))::text);
res := res || jsonb_build_object('t', '3. sender coins debited by price (20000 -> 19990)', 'pass', coalesce(((select balance from public.wallets where user_id = u_s) = 19990)::boolean,false), 'ev', ((select balance::text from public.wallets where user_id = u_s))::text);
res := res || jsonb_build_object('t', '3. ledger: gift_sent=10 for sender, gift_received=0 for creator', 'pass', coalesce(((select amount from public.wallet_transactions where reference = tx and type = 'gift_sent') = 10 and (select amount from public.wallet_transactions where reference = tx and type = 'gift_received') = 0)::boolean,false), 'ev', ((select string_agg(type || '=' || amount, ',') from public.wallet_transactions where reference = tx))::text);
  select id into big_gift from public.gifts where active order by price desc limit 1;
perform set_config('request.jwt.claims', json_build_object('sub', u_s3, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.send_gift(u_c, big_gift, null);
  res := res || jsonb_build_object('t', '3. send_gift refused when sender lacks coins (balance 100 vs most expensive gift)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. send_gift refused when sender lacks coins (balance 100 vs most expensive gift)', 'pass', (sqlerrm like '%insufficient balance%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  tx2 := public.send_gift(u_c, 'star', null);
  res := res || jsonb_build_object('t', '3. unfunded sender (coins not from production top-up) can send a gift ...', 'pass', coalesce((tx2 is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. unfunded sender (coins not from production top-up) can send a gift ...', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
  select * into r from public.creator_earnings where gift_transaction_id = tx2;
res := res || jsonb_build_object('t', '3. ... but its diamonds are WITHHELD (unfunded_coins)', 'pass', coalesce((r.status = 'withheld' and r.withhold_reason = 'unfunded_coins')::boolean,false), 'ev', (r.status || ' ' || coalesce(r.withhold_reason,'-'))::text);
  insert into public.gift_transactions (from_user_id, to_user_id, gift_id, amount) values (u_s, u_c, 'star', 12000);
  select * into r from public.creator_earnings where receiver_id = u_c and coins = 12000;
res := res || jsonb_build_object('t', '3. bulk gift (direct gift_transactions insert, 12000 coins) -> 12000 diamonds pending via trigger', 'pass', coalesce((r.diamonds = 12000 and r.status = 'pending')::boolean,false), 'ev', (r.status || ' ' || r.diamonds)::text);
  perform public.payout_settle(u_c);
  j := public.payout_balance(u_c);
res := res || jsonb_build_object('t', '3. payout_balance: pending 12010, withheld 10, available 0 during hold', 'pass', coalesce(((j->>'pending')::int = 12010 and (j->>'withheld')::int = 10 and (j->>'available')::int = 0)::boolean,false), 'ev', (j::text)::text);
begin
  j := public.payout_eligibility(u_c);
  res := res || jsonb_build_object('t', '3. payout_eligibility(ineligible user) returns the reasons list instead of raising [BUG: text[] || ''literal'']', 'pass', coalesce((not (j->>'eligible')::boolean and j->'reasons' = jsonb_build_array('kyc_missing'))::boolean,false), 'ev', (j::text)::text);
exception when others then
  res := res || jsonb_build_object('t', '3. payout_eligibility(ineligible user) returns the reasons list instead of raising [BUG: text[] || ''literal'']', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  j := public.my_creator_earnings();
  res := res || jsonb_build_object('t', '3. my_creator_earnings works for a creator who has not finished KYC [BUG: same cause]', 'pass', coalesce((j->'eligibility'->>'eligible' = 'false')::boolean,false), 'ev', (left(j::text, 200))::text);
exception when others then
  res := res || jsonb_build_object('t', '3. my_creator_earnings works for a creator who has not finished KYC [BUG: same cause]', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.creator_request_withdrawal(100);
  res := res || jsonb_build_object('t', '3. withdrawal BEFORE KYC refused with clean not_eligible:kyc_missing [BUG: same cause]', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. withdrawal BEFORE KYC refused with clean not_eligible:kyc_missing [BUG: same cause]', 'pass', (sqlerrm like '%not_eligible:kyc_missing%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. (but) no withdrawal row was created before KYC', 'pass', coalesce(((select count(*) from public.creator_withdrawals where kyc_id is null and legal_name = 'Ahmed Test Person') = 0)::boolean,false), 'ev', ('')::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  j := public.admin_v2_payout_creator(u_c);
  res := res || jsonb_build_object('t', '3. admin_v2_payout_creator drawer loads for a creator without KYC [BUG: same cause]', 'pass', coalesce((j ? 'balance')::boolean,false), 'ev', (left(j::text,120))::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin_v2_payout_creator drawer loads for a creator without KYC [BUG: same cause]', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
  insert into storage.objects (bucket_id, name) values ('kyc', u_c::text || '/id.jpg'), ('kyc', u_m::text || '/id.jpg');
perform set_config('request.jwt.claims', json_build_object('sub', u_m, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.creator_submit_kyc('Minor Person Test', '1234567890', u_m::text || '/id.jpg', 'SA0380000000608010167519', 'Test Bank', true);
  res := res || jsonb_build_object('t', '3. under-18 KYC refused (under_age)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. under-18 KYC refused (under_age)', 'pass', (sqlerrm like '%under_age%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_nb, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.creator_submit_kyc('Nobirth Person Test', '1234567891', u_nb::text || '/id.jpg', 'SA0380000000608010167519', 'Test Bank', true);
  res := res || jsonb_build_object('t', '3. KYC with no birth date on file refused (no_birth_date)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. KYC with no birth date on file refused (no_birth_date)', 'pass', (sqlerrm like '%no_birth_date%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.creator_submit_kyc('Ahmed Test Person', '1234567890', u_c::text || '/id.jpg', 'SA0380000000608010167518', 'Test Bank', true);
  res := res || jsonb_build_object('t', '3. KYC invalid IBAN (checksum off by one) refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. KYC invalid IBAN (checksum off by one) refused', 'pass', (sqlerrm like '%invalid_iban%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_submit_kyc('Ahmed Test Person', '1234567890', u_c::text || '/id.jpg', 'GB82WEST12345698765432', 'Test Bank', true);
  res := res || jsonb_build_object('t', '3. KYC IBAN wrong length/country refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. KYC IBAN wrong length/country refused', 'pass', (sqlerrm like '%invalid_iban%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_submit_kyc('Ahmed Test Person', '0234567890', u_c::text || '/id.jpg', 'SA0380000000608010167519', 'Test Bank', true);
  res := res || jsonb_build_object('t', '3. KYC invalid national ID refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. KYC invalid national ID refused', 'pass', (sqlerrm like '%invalid_id_number%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_submit_kyc('Ahmed', '1234567890', u_c::text || '/id.jpg', 'SA0380000000608010167519', 'Test Bank', true);
  res := res || jsonb_build_object('t', '3. KYC single-word name refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. KYC single-word name refused', 'pass', (sqlerrm like '%invalid_name%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_submit_kyc('Ahmed Test Person', '1234567890', u_c::text || '/id.jpg', 'SA0380000000608010167519', 'Test Bank', false);
  res := res || jsonb_build_object('t', '3. KYC without owner attestation refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. KYC without owner attestation refused', 'pass', (sqlerrm like '%must_confirm_owner%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_submit_kyc('Ahmed Test Person', '1234567890', u_m::text || '/id.jpg', 'SA0380000000608010167519', 'Test Bank', true);
  res := res || jsonb_build_object('t', '3. KYC photo path in someone else''s folder refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. KYC photo path in someone else''s folder refused', 'pass', (sqlerrm like '%photo_missing%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_submit_kyc('Ahmed Test Person', '1234567890', u_c::text || '/nope.jpg', 'SA0380000000608010167519', 'Test Bank', true);
  res := res || jsonb_build_object('t', '3. KYC photo that does not exist refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. KYC photo that does not exist refused', 'pass', (sqlerrm like '%photo_missing%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  j := public.creator_submit_kyc('Ahmed Test Person', '1234567890', u_c::text || '/id.jpg', 'SA0380000000608010167519', 'Test Bank', true);
  res := res || jsonb_build_object('t', '3. KYC with the published sample IBAN (SA0380000000608010167519) accepted', 'pass', coalesce((j->>'status' = 'pending')::boolean,false), 'ev', (j::text)::text);
exception when others then
  res := res || jsonb_build_object('t', '3. KYC with the published sample IBAN (SA0380000000608010167519) accepted', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_request_withdrawal(100);
  res := res || jsonb_build_object('t', '3. withdrawal while KYC pending refused with not_eligible:kyc_pending [BUG: same cause]', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. withdrawal while KYC pending refused with not_eligible:kyc_pending [BUG: same cause]', 'pass', (sqlerrm like '%not_eligible:kyc_pending%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
  select id into kyc from public.creator_kyc where user_id = u_c;
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_kyc_review(kyc, false, null);
  res := res || jsonb_build_object('t', '3. admin kyc reject without reason refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. admin kyc reject without reason refused', 'pass', (sqlerrm like '%a reason is required%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_kyc_review(kyc, false, 'blurry photo');
  res := res || jsonb_build_object('t', '3. admin rejects KYC with a reason', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin rejects KYC with a reason', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. KYC row now rejected with reason', 'pass', coalesce(((select status = 'rejected' and reject_reason = 'blurry photo' from public.creator_kyc where id = kyc))::boolean,false), 'ev', ('')::text);
res := res || jsonb_build_object('t', '3. KYC rejected notification created for creator', 'pass', coalesce(((select count(*) from public.notifications where user_id = u_c and payload->>'kind' = 'payout_kyc_rejected') = 1)::boolean,false), 'ev', ('')::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.creator_request_withdrawal(100);
  res := res || jsonb_build_object('t', '3. withdrawal after KYC rejected refused with not_eligible:kyc_rejected [BUG: same cause]', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. withdrawal after KYC rejected refused with not_eligible:kyc_rejected [BUG: same cause]', 'pass', (sqlerrm like '%not_eligible:kyc_rejected%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  j := public.creator_submit_kyc('Ahmed Test Person', '1234567890', u_c::text || '/id.jpg', 'SA0380000000608010167519', 'Test Bank', true);
  res := res || jsonb_build_object('t', '3. creator re-submits KYC after rejection', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. creator re-submits KYC after rejection', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. resubmitted KYC is pending, submissions=2', 'pass', coalesce(((select status = 'pending' and submissions = 2 from public.creator_kyc where id = kyc))::boolean,false), 'ev', ('')::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_kyc_review(kyc, true, null);
  res := res || jsonb_build_object('t', '3. admin_v2_kyc_review approve', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin_v2_kyc_review approve', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform * from public.admin_v2_kyc_list('all', 10, 0); j := public.admin_v2_kyc_document(kyc);
  res := res || jsonb_build_object('t', '3. admin_v2_kyc_list / kyc_document callable by admin', 'pass', coalesce((j->>'bucket' = 'kyc')::boolean,false), 'ev', (j::text)::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin_v2_kyc_list / kyc_document callable by admin', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
  j := public.my_creator_earnings();
res := res || jsonb_build_object('t', '3. my_creator_earnings returns masked IBAN/ID only', 'pass', coalesce((j->'kyc'->>'iban_masked' like 'SA%7519' and j->'kyc'->>'iban_masked' not like '%0380000000%' and j->'kyc'->>'id_masked' like '%890' and j::text not like '%1234567890%')::boolean,false), 'ev', (j->'kyc'::text)::text);
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. KYC row now approved', 'pass', coalesce(((select status = 'approved' and reviewed_by = u_adm from public.creator_kyc where id = kyc))::boolean,false), 'ev', ('')::text);
res := res || jsonb_build_object('t', '3. KYC approved notification created', 'pass', coalesce(((select count(*) from public.notifications where user_id = u_c and payload->>'kind' = 'payout_kyc_approved') = 1)::boolean,false), 'ev', ('')::text);
  j := public.payout_eligibility(u_c);
res := res || jsonb_build_object('t', '3. eligibility now true (age>=18, account>=30d, KYC approved)', 'pass', coalesce(((j->>'eligible')::boolean)::boolean,false), 'ev', (j::text)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.creator_request_withdrawal(100);
  res := res || jsonb_build_object('t', '3. withdrawal INSIDE hold period refused (all diamonds still pending -> above_available)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. withdrawal INSIDE hold period refused (all diamonds still pending -> above_available)', 'pass', (sqlerrm like '%above_available%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
  j := public.my_creator_earnings();
res := res || jsonb_build_object('t', '3. my_creator_earnings: available 0, pending 12010, can_request false, next_release_at set', 'pass', coalesce(((j->'diamonds'->>'available')::int = 0 and (j->'diamonds'->>'pending')::int = 12010 and not (j->>'can_request')::boolean and j->>'next_release_at' is not null)::boolean,false), 'ev', (j::text)::text);
reset role; perform set_config('request.jwt.claims','',true);
  update public.creator_earnings set available_at = now() - interval '1 day' where receiver_id = u_c and status = 'pending';
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
  j := public.my_creator_earnings();
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. after hold ends (lazy settle) diamonds available 12010, withheld stays 10; max_withdraw_sar = 106.88 (trunc 12010 x 0.0089)', 'pass', coalesce(((j->'diamonds'->>'available')::int = 12010 and (j->'diamonds'->>'withheld')::int = 10 and (j->>'max_withdraw_sar')::numeric = 106.88 and (j->>'can_request')::boolean)::boolean,false), 'ev', ((j->'diamonds')::text || ' max=' || (j->>'max_withdraw_sar') || ' can_request=' || (j->>'can_request'))::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.creator_request_withdrawal(50);
  res := res || jsonb_build_object('t', '3. withdrawal below minimum (50 SAR) refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. withdrawal below minimum (50 SAR) refused', 'pass', (sqlerrm like '%below_minimum%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_request_withdrawal(0);
  res := res || jsonb_build_object('t', '3. withdrawal bad amount (0) refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. withdrawal bad amount (0) refused', 'pass', (sqlerrm like '%bad_amount%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_request_withdrawal(100.123);
  res := res || jsonb_build_object('t', '3. withdrawal bad amount (3 decimals) refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. withdrawal bad amount (3 decimals) refused', 'pass', (sqlerrm like '%bad_amount%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_request_withdrawal(null);
  res := res || jsonb_build_object('t', '3. withdrawal bad amount (null) refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. withdrawal bad amount (null) refused', 'pass', (sqlerrm like '%bad_amount%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_request_withdrawal(106.89);
  res := res || jsonb_build_object('t', '3. cannot request more than available (106.89 SAR > 106.88 max)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. cannot request more than available (106.89 SAR > 106.88 max)', 'pass', (sqlerrm like '%above_available%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_request_withdrawal(999999);
  res := res || jsonb_build_object('t', '3. cannot request far more than available (999999)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. cannot request far more than available (999999)', 'pass', (sqlerrm like '%above_available%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_payout_hold(u_c, true, null);
  res := res || jsonb_build_object('t', '3. admin_v2_payout_hold requires a reason', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. admin_v2_payout_hold requires a reason', 'pass', (sqlerrm like '%a reason is required%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  j := public.admin_v2_payout_hold(u_c, true, 'investigating tt');
  res := res || jsonb_build_object('t', '3. admin puts creator on payout hold', 'pass', coalesce(((j->>'rows')::int >= 2)::boolean,false), 'ev', (j::text)::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin puts creator on payout hold', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
  perform public.payout_settle(u_c);
  j := public.payout_balance(u_c);
res := res || jsonb_build_object('t', '3. on hold: nothing available, all earnings withheld', 'pass', coalesce(((j->>'available')::int = 0 and (j->>'withheld')::int = 12020)::boolean,false), 'ev', (j::text)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.creator_request_withdrawal(100);
  res := res || jsonb_build_object('t', '3. withdrawal while on admin hold refused with not_eligible:on_hold [BUG: same cause]', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. withdrawal while on admin hold refused with not_eligible:on_hold [BUG: same cause]', 'pass', (sqlerrm like '%not_eligible:on_hold%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  j := public.admin_v2_payout_hold(u_c, false, null);
  res := res || jsonb_build_object('t', '3. admin releases hold', 'pass', coalesce((true)::boolean,false), 'ev', (j::text)::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin releases hold', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
  j := public.payout_balance(u_c);
res := res || jsonb_build_object('t', '3. released: 12020 diamonds available again (admin release overrides auto-withhold incl. the unfunded 10)', 'pass', coalesce(((j->>'available')::int in (12010, 12020))::boolean,false), 'ev', (j::text)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_s, 'role','authenticated')::text, true); set local role authenticated;
  tx := public.send_gift(u_c, 'heart', null);
reset role; perform set_config('request.jwt.claims','',true);
  select id into e_rev from public.creator_earnings where gift_transaction_id = tx;
  update public.creator_earnings set available_at = now() - interval '1 day' where id = e_rev;
  perform public.payout_settle(u_c);
  avail0 := (public.payout_balance(u_c)->>'available')::bigint;
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_payout_set_earning(e_rev, 'reverse', null);
  res := res || jsonb_build_object('t', '3. reverse earning requires reason', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. reverse earning requires reason', 'pass', (sqlerrm like '%a reason is required%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_earning(e_rev, 'delete', 'x');
  res := res || jsonb_build_object('t', '3. set_earning rejects unknown action', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. set_earning rejects unknown action', 'pass', (sqlerrm like '%action must be%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_earning(e_rev, 'reverse', 'chargeback tt');
  res := res || jsonb_build_object('t', '3. admin reverses the 5-diamond earning', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin reverses the 5-diamond earning', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. earning row is now reversed', 'pass', coalesce(((select status from public.creator_earnings where id = e_rev) = 'reversed')::boolean,false), 'ev', ('')::text);
  avail1 := (public.payout_balance(u_c)->>'available')::bigint;
res := res || jsonb_build_object('t', '3. reversing an earning lowers available balance by its diamonds (5)', 'pass', coalesce((avail0 - avail1 = 5)::boolean,false), 'ev', ('before=' || avail0 || ' after=' || avail1)::text);
  update public.creator_earnings set status = 'reversed' where id = e_rev; -- no-op, keep reversed
perform set_config('request.jwt.claims', json_build_object('sub', u_s2, 'role','authenticated')::text, true); set local role authenticated;
  tx := public.send_gift(u_c, 'star', null);
reset role; perform set_config('request.jwt.claims','',true);
  select * into r from public.creator_earnings where gift_transaction_id = tx;
res := res || jsonb_build_object('t', '3. funded sender s2 gift is pending/clean before any refund', 'pass', coalesce((r.status = 'pending' and r.withhold_reason is null)::boolean,false), 'ev', (r.status)::text);
  avail0 := (public.payout_balance(u_c)->>'available')::bigint;
  insert into public.iap_refunds (store_transaction_id, platform, user_id, outcome, coins_reversed) values ('tt-ref-' || sfx, 'ios', u_s2, 'reversed', 500);
  select * into r from public.creator_earnings where gift_transaction_id = tx;
res := res || jsonb_build_object('t', '3. refund (iap_refunds outcome reversed) withholds that sender''s pending earnings at once (sender_refund)', 'pass', coalesce((r.status = 'withheld' and r.withhold_reason = 'sender_refund')::boolean,false), 'ev', (r.status || ' ' || coalesce(r.withhold_reason,'-'))::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_s2, 'role','authenticated')::text, true); set local role authenticated;
  tx2 := public.send_gift(u_c, 'heart', null);
reset role; perform set_config('request.jwt.claims','',true);
  select * into r from public.creator_earnings where gift_transaction_id = tx2;
res := res || jsonb_build_object('t', '3. a NEW gift from a recently-refunded sender is withheld at birth (sender_refund)', 'pass', coalesce((r.status = 'withheld' and r.withhold_reason = 'sender_refund')::boolean,false), 'ev', (r.status || ' ' || coalesce(r.withhold_reason,'-'))::text);
res := res || jsonb_build_object('t', '3. refund did not touch other senders'' available balance', 'pass', coalesce(((public.payout_balance(u_c)->>'available')::bigint = avail0)::boolean,false), 'ev', (avail0 || ' -> ' || (public.payout_balance(u_c)->>'available'))::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_s4, 'role','authenticated')::text, true); set local role authenticated;
  tx := public.send_gift(u_c, 'star', null);
reset role; perform set_config('request.jwt.claims','',true);
  insert into public.wallet_flags (user_id, refund_count, refunded_coins, reason) values (u_s4, 1, 200, 'tt flag');
  select * into r from public.creator_earnings where gift_transaction_id = tx;
res := res || jsonb_build_object('t', '3. wallet_flags (unreviewed) withholds that sender''s earnings (sender_flagged)', 'pass', coalesce((r.status = 'withheld' and r.withhold_reason = 'sender_flagged')::boolean,false), 'ev', (r.status || ' ' || coalesce(r.withhold_reason,'-'))::text);
  update public.creator_earnings set available_at = now() - interval '1 day' where receiver_id = u_c and status = 'pending';
  perform public.payout_settle(u_c);
  avail0 := (public.payout_balance(u_c)->>'available')::bigint;
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  j := public.creator_request_withdrawal(100);
  res := res || jsonb_build_object('t', '3. creator requests 100 SAR withdrawal', 'pass', coalesce((j->>'status' = 'requested' and (j->>'diamonds')::int = 11236)::boolean,false), 'ev', (j::text)::text);
exception when others then
  res := res || jsonb_build_object('t', '3. creator requests 100 SAR withdrawal', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
  w1 := (j->>'id')::uuid;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. request reserves ceil(100/0.0089)=11236 diamonds -> available drops by exactly that', 'pass', coalesce((avail0 - (public.payout_balance(u_c)->>'available')::bigint = 11236)::boolean,false), 'ev', (avail0 || ' -> ' || (public.payout_balance(u_c)->>'available'))::text);
res := res || jsonb_build_object('t', '3. withdrawal row locks rate 0.0089 + snapshots IBAN/name', 'pass', coalesce(((select sar_per_diamond = 0.0089 and iban = 'SA0380000000608010167519' and legal_name = 'Ahmed Test Person' and amount_sar = 100 from public.creator_withdrawals where id = w1))::boolean,false), 'ev', ('')::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.creator_request_withdrawal(100);
  res := res || jsonb_build_object('t', '3. second open withdrawal refused (open_withdrawal)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. second open withdrawal refused (open_withdrawal)', 'pass', (sqlerrm like '%open_withdrawal%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_submit_kyc('Ahmed Test Person', '1234567890', u_c::text || '/id.jpg', 'SA0380000000608010167519', 'Other Bank', true);
  res := res || jsonb_build_object('t', '3. KYC cannot be changed while a withdrawal is open (kyc_locked)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. KYC cannot be changed while a withdrawal is open (kyc_locked)', 'pass', (sqlerrm like '%kyc_locked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.creator_cancel_withdrawal(w1);
  res := res || jsonb_build_object('t', '3. creator cancels the requested withdrawal', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. creator cancels the requested withdrawal', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. withdrawal row is cancelled', 'pass', coalesce(((select status from public.creator_withdrawals where id = w1) = 'cancelled')::boolean,false), 'ev', ('')::text);
res := res || jsonb_build_object('t', '3. cancel returns the diamonds (available back to before)', 'pass', coalesce(((public.payout_balance(u_c)->>'available')::bigint = avail0)::boolean,false), 'ev', ((public.payout_balance(u_c)->>'available'))::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
  j := public.creator_request_withdrawal(100); w2 := (j->>'id')::uuid;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_payout_reject(w2, null);
  res := res || jsonb_build_object('t', '3. admin reject without reason refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. admin reject without reason refused', 'pass', (sqlerrm like '%a reason is required%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_mark_paid(w2, 'REF1');
  res := res || jsonb_build_object('t', '3. mark_paid on a merely ''requested'' withdrawal refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. mark_paid on a merely ''requested'' withdrawal refused', 'pass', (sqlerrm like '%approve it first%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_reject(w2, 'name mismatch tt');
  res := res || jsonb_build_object('t', '3. admin rejects withdrawal with reason', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin rejects withdrawal with reason', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. withdrawal row is rejected', 'pass', coalesce(((select status from public.creator_withdrawals where id = w2) = 'rejected')::boolean,false), 'ev', ('')::text);
res := res || jsonb_build_object('t', '3. reject returns the diamonds (available back to before)', 'pass', coalesce(((public.payout_balance(u_c)->>'available')::bigint = avail0)::boolean,false), 'ev', ((public.payout_balance(u_c)->>'available'))::text);
res := res || jsonb_build_object('t', '3. reject sends payout_withdrawal_rejected notification', 'pass', coalesce(((select count(*) from public.notifications where user_id = u_c and payload->>'kind' = 'payout_withdrawal_rejected') = 1)::boolean,false), 'ev', ('')::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
  j := public.creator_request_withdrawal(100); w3 := (j->>'id')::uuid;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_payout_approve(w3, 'ok');
  res := res || jsonb_build_object('t', '3. admin approves withdrawal', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin approves withdrawal', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_mark_paid(w3, null);
  res := res || jsonb_build_object('t', '3. mark_paid with NO reference refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. mark_paid with NO reference refused', 'pass', (sqlerrm like '%a bank reference is required%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_mark_paid(w3, '   ');
  res := res || jsonb_build_object('t', '3. mark_paid with blank reference refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. mark_paid with blank reference refused', 'pass', (sqlerrm like '%a bank reference is required%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.creator_cancel_withdrawal(w3);
  res := res || jsonb_build_object('t', '3. creator cannot cancel an approved withdrawal', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. creator cannot cancel an approved withdrawal', 'pass', (sqlerrm like '%cannot_cancel%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_payout_mark_paid(w3, 'SARIE-TT-0001');
  res := res || jsonb_build_object('t', '3. admin marks paid with a bank reference', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin marks paid with a bank reference', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_mark_paid(w3, 'SARIE-TT-0002');
  res := res || jsonb_build_object('t', '3. cannot pay twice', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. cannot pay twice', 'pass', (sqlerrm like '%withdrawal is paid%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_reject(w3, 'x');
  res := res || jsonb_build_object('t', '3. cannot reject a paid withdrawal', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. cannot reject a paid withdrawal', 'pass', (sqlerrm like '%withdrawal is paid%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. withdrawal row is paid with reference', 'pass', coalesce(((select status = 'paid' and bank_reference = 'SARIE-TT-0001' from public.creator_withdrawals where id = w3))::boolean,false), 'ev', ('')::text);
  j := public.payout_balance(u_c);
res := res || jsonb_build_object('t', '3. after paid: withdrawn=11236, reserved=0, available=avail0-11236', 'pass', coalesce(((j->>'withdrawn')::int = 11236 and (j->>'reserved')::int = 0 and (j->>'available')::bigint = avail0 - 11236)::boolean,false), 'ev', (j::text)::text);
res := res || jsonb_build_object('t', '3. (informational) paid bookkeeping FIFO labels whole earnings rows ''withdrawn'' only when they fit entirely; balance is unaffected either way', 'pass', coalesce((true)::boolean,false), 'ev', ((select count(*) || ' rows withdrawn' from public.creator_earnings where receiver_id = u_c and status = 'withdrawn'))::text);
res := res || jsonb_build_object('t', '3. paid notification created', 'pass', coalesce(((select count(*) from public.notifications where user_id = u_c and payload->>'kind' = 'payout_withdrawal_paid') = 1)::boolean,false), 'ev', ('')::text);
res := res || jsonb_build_object('t', '3. admin_logs has payout_approve + payout_paid + payout_reject', 'pass', coalesce(((select count(distinct action) from public.admin_logs where target_id = u_c and action in ('payout_approve','payout_paid','payout_reject')) = 3)::boolean,false), 'ev', ('')::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
  j := public.my_creator_earnings();
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. my_creator_earnings after pay: sar.withdrawn=100, can_request false (remaining < min)', 'pass', coalesce(((j->'sar'->>'withdrawn')::numeric = 100 and not (j->>'can_request')::boolean)::boolean,false), 'ev', (j->'sar'::text)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  j := public.admin_v2_payout_overview();
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. admin_v2_payout_overview works and counts paid_all_time', 'pass', coalesce(((j->'paid_all_time'->>'count')::int >= 1)::boolean,false), 'ev', (j->'paid_all_time'::text)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_payout_set_config(p_sar_per_diamond => 0);
  res := res || jsonb_build_object('t', '3. set_config sar_per_diamond=0 rejected', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. set_config sar_per_diamond=0 rejected', 'pass', (sqlstate = '22023'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_config(p_sar_per_diamond => -1);
  res := res || jsonb_build_object('t', '3. set_config sar_per_diamond negative rejected', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. set_config sar_per_diamond negative rejected', 'pass', (sqlstate = '22023'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_config(p_diamonds_per_coin => 0);
  res := res || jsonb_build_object('t', '3. set_config diamonds_per_coin=0 rejected', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. set_config diamonds_per_coin=0 rejected', 'pass', (sqlstate = '22023'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_config(p_min_age => 17);
  res := res || jsonb_build_object('t', '3. set_config min_age=17 (below 18) rejected', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. set_config min_age=17 (below 18) rejected', 'pass', (sqlstate = '22023'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_config(p_hold_days => 400);
  res := res || jsonb_build_object('t', '3. set_config hold_days=400 rejected', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. set_config hold_days=400 rejected', 'pass', (sqlstate = '22023'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_config(p_hold_days => -1);
  res := res || jsonb_build_object('t', '3. set_config hold_days=-1 rejected', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. set_config hold_days=-1 rejected', 'pass', (sqlstate = '22023'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_config(p_min_withdraw_sar => 0);
  res := res || jsonb_build_object('t', '3. set_config min_withdraw_sar=0 rejected', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. set_config min_withdraw_sar=0 rejected', 'pass', (sqlstate = '22023'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_config(p_sar_per_diamond => 89);
  res := res || jsonb_build_object('t', '3. set_config sar_per_diamond=89 (10000x typo of 0.0089) rejected', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. set_config sar_per_diamond=89 (10000x typo of 0.0089) rejected', 'pass', (sqlstate = '22023'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_config(p_sar_per_diamond => 1.5);
  res := res || jsonb_build_object('t', '3. set_config sar_per_diamond=1.5 (above 1 SAR per diamond, implausible) rejected', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. set_config sar_per_diamond=1.5 (above 1 SAR per diamond, implausible) rejected', 'pass', (sqlstate = '22023'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_config(p_min_withdraw_sar => 0.01);
  res := res || jsonb_build_object('t', '3. set_config min_withdraw_sar=0.01 (dust withdrawals) rejected', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. set_config min_withdraw_sar=0.01 (dust withdrawals) rejected', 'pass', (sqlstate = '22023'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
  perform public.admin_v2_payout_set_config(p_sar_per_diamond => 0.0089, p_min_withdraw_sar => 100);
begin
  cfg := public.admin_v2_payout_set_config(p_min_withdraw_sar => 120);
  res := res || jsonb_build_object('t', '3. set_config valid change works', 'pass', coalesce(((cfg->>'min_withdraw_sar')::numeric = 120)::boolean,false), 'ev', (cfg::text)::text);
exception when others then
  res := res || jsonb_build_object('t', '3. set_config valid change works', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_payout_set_config(p_active => false);
  res := res || jsonb_build_object('t', '3. set_config active=false pauses payouts', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. set_config active=false pauses payouts', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.creator_request_withdrawal(500);
  res := res || jsonb_build_object('t', '3. payouts paused -> creator withdrawal refused with not_eligible:payouts_paused [BUG: same cause]', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '3. payouts paused -> creator withdrawal refused with not_eligible:payouts_paused [BUG: same cause]', 'pass', (sqlerrm like '%not_eligible:payouts_paused%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  perform public.admin_v2_payout_set_config(p_active => true, p_min_withdraw_sar => 100);
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. admin_logs holds payout_config entry with old/new', 'pass', coalesce(((select count(*) from public.admin_logs where action = 'payout_config' and (payload->'old'->>'min_withdraw_sar')::numeric = 100 and (payload->'new'->>'min_withdraw_sar')::numeric = 120) = 1)::boolean,false), 'ev', ('')::text);
res := res || jsonb_build_object('t', '3. an already-paid withdrawal keeps its locked rate after config changes', 'pass', coalesce(((select sar_per_diamond from public.creator_withdrawals where id = w3) = 0.0089)::boolean,false), 'ev', ('')::text);
  select count(*) into n from public.creator_earnings where receiver_id = u_c;
  select count(*) into n2 from public.creator_earnings where receiver_id = u_c and status in ('available','pending','withheld');
res := res || jsonb_build_object('t', '3. (before delete) creator has unpaid diamonds that would be forfeited', 'pass', coalesce((n2 > 0)::boolean,false), 'ev', ('earnings rows=' || n || ' unpaid rows=' || n2)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.schedule_account_deletion();
  res := res || jsonb_build_object('t', '3. creator schedules own account deletion (schedule_account_deletion; self_delete_account itself is not granted to users)', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. creator schedules own account deletion (schedule_account_deletion; self_delete_account itself is not granted to users)', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
  update public.profiles set deletion_scheduled_at = now() - interval '1 minute' where id = u_c;
  n := public.purge_scheduled_deletions();
res := res || jsonb_build_object('t', '3. purge_scheduled_deletions removes the due account', 'pass', coalesce((n >= 1 and not exists (select 1 from auth.users where id = u_c) and not exists (select 1 from public.profiles where id = u_c))::boolean,false), 'ev', ('purged=' || n)::text);
  select count(*) into n from public.creator_earnings where receiver_id = u_c;
  select count(*) into n2 from public.creator_kyc where id = kyc and user_id is null;
res := res || jsonb_build_object('t', '3. account deletion forfeits all earnings (rows cascade-deleted)', 'pass', coalesce((n = 0)::boolean,false), 'ev', ('earnings left=' || n)::text);
res := res || jsonb_build_object('t', '3. KYC row survives for accounting with user_id NULL', 'pass', coalesce((n2 = 1)::boolean,false), 'ev', ('')::text);
res := res || jsonb_build_object('t', '3. withdrawal history survives (3 rows, user_id NULL)', 'pass', coalesce(((select count(*) from public.creator_withdrawals where id in (w1,w2,w3) and user_id is null) = 3)::boolean,false), 'ev', ('')::text);
  insert into public.creator_earnings (receiver_id, sender_id, coins, diamonds, status, available_at) values (u_d, u_s, 12000, 12000, 'available', now() - interval '1 day');
  insert into public.creator_kyc (user_id, legal_name, id_number, id_type, id_photo_path, iban, bank_name, owner_attested, status)
    values (u_d, 'Dina Test Person', '2234567890', 'iqama', u_d::text || '/id.jpg', 'SA0380000000608010167519', 'Test Bank', true, 'approved');
perform set_config('request.jwt.claims', json_build_object('sub', u_d, 'role','authenticated')::text, true); set local role authenticated;
  j := public.creator_request_withdrawal(100); wd := (j->>'id')::uuid;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_payout_hold(u_d, true, 'tt'); perform * from public.admin_v2_payout_withdrawals('requested', 50, 0);
  res := res || jsonb_build_object('t', '3. admin payout queue (admin_v2_payout_withdrawals) still loads when a requester is on hold [BUG: same cause breaks the whole queue]', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin payout queue (admin_v2_payout_withdrawals) still loads when a requester is on hold [BUG: same cause breaks the whole queue]', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_delete_user(u_d);
  res := res || jsonb_build_object('t', '3. admin_delete_user (auth.users delete) on a creator with an OPEN withdrawal', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin_delete_user (auth.users delete) on a creator with an OPEN withdrawal', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
  select status, user_id into t, tx from public.creator_withdrawals where id = wd;
  select count(*) into n from public.creator_earnings where receiver_id = u_d;
res := res || jsonb_build_object('t', '3. (observation) open withdrawal of a deleted account is KEPT (status requested, user_id NULL); remaining earnings gone', 'pass', coalesce((t = 'requested' and tx is null and n = 0)::boolean,false), 'ev', ('status=' || t || ' user_id=' || coalesce(tx::text,'NULL') || ' earnings=' || n)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_payout_approve(wd, null); perform public.admin_v2_payout_mark_paid(wd, 'SARIE-TT-ORPHAN');
  res := res || jsonb_build_object('t', '3. admin can still approve + pay that orphan withdrawal (no crash on NULL user)', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '3. admin can still approve + pay that orphan withdrawal (no crash on NULL user)', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '3. orphan withdrawal is paid', 'pass', coalesce(((select status from public.creator_withdrawals where id = wd) = 'paid')::boolean,false), 'ev', ('')::text);

 exception when others then
  reset role;
  res := res || jsonb_build_object('t', 'HARNESS ABORTED (unhandled error)', 'pass', false, 'ev', sqlstate || ' ' || left(sqlerrm, 300));
 end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RESULTS: %', res::text;
end
$tt$;
