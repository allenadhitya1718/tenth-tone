-- 02 - appeals (scenario 2). NOTE: decided_at is back-dated by 2h once to simulate time passing, because now() is constant inside one transaction.
-- Generated; always ends in RAISE EXCEPTION so the whole transaction rolls back (nothing persists).
-- Run from the repo root:  npx supabase db query --linked -f <this file>
-- Result is in the error message ("RESULTS: [...]").
do $tt$
declare
  res jsonb := '[]'::jsonb;
  sfx text := substr(md5(random()::text), 1, 6);
  j jsonb; j2 jsonb; n bigint; n2 bigint; t text; t2 text; r record;
  u_adm uuid := gen_random_uuid(); u_b uuid := gen_random_uuid(); u_c uuid := gen_random_uuid();
  v1 uuid; v2 uuid; v3 uuid; v4 uuid; ap_ban uuid; ap_v1 uuid; ap_v2 uuid; ap_ban2 uuid; res_j jsonb; logs_before bigint;
begin
 begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select x.id, 'authenticated', 'authenticated', 'tt-' || x.h || '@example.invalid',
         jsonb_build_object('handle', 'tt_' || x.h || '_' || sfx), now(), now()
    from (values (u_adm, 'adm'),(u_b, 'b'),(u_c, 'c')) x(id, h);
  update public.profiles set is_admin = true where id = u_adm;
  insert into public.videos (user_id, description, video_url, thumbnail, privacy, is_draft) values (u_b, 'tt v1', 'https://example.invalid/v1.mp4', 'https://example.invalid/t1.jpg', 'public', false) returning id into v1;
  insert into public.videos (user_id, description, video_url, thumbnail, privacy, is_draft) values (u_b, 'tt v2', 'https://example.invalid/v2.mp4', 'https://example.invalid/t2.jpg', 'public', false) returning id into v2;
  insert into public.videos (user_id, description, video_url, thumbnail, privacy, is_draft) values (u_b, 'tt v3', 'https://example.invalid/v3.mp4', 'https://example.invalid/t3.jpg', 'public', false) returning id into v3;
  insert into public.videos (user_id, description, video_url, thumbnail, privacy, is_draft) values (u_b, 'tt v4', 'https://example.invalid/v4.mp4', 'https://example.invalid/t4.jpg', 'public', false) returning id into v4;
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_set_ban(u_b, now() + interval '30 days', 'spamming tt');
  res := res || jsonb_build_object('t', '2. admin bans user (admin_v2_set_ban)', 'pass', coalesce((true)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '2. admin bans user (admin_v2_set_ban)', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '2. ban stored (banned_until in the future)', 'pass', coalesce(((select banned_until > now() from public.profiles where id = u_b))::boolean,false), 'ev', ((select banned_until::text from public.profiles where id = u_b))::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role','authenticated')::text, true); set local role authenticated;
  j := public.my_account_status();
res := res || jsonb_build_object('t', '2. my_account_status shows banned + reason', 'pass', coalesce(((j->>'banned')::boolean and j->>'ban_reason' = 'spamming tt' and j->>'banned_until' is not null)::boolean,false), 'ev', (j::text)::text);
  j := public.my_appealable_items();
res := res || jsonb_build_object('t', '2. my_appealable_items lists the ban (kind ban, target user, appeal null)', 'pass', coalesce((jsonb_array_length(j) = 1 and j->0->>'kind' = 'ban' and j->0->>'target_type' = 'user' and j->0->'appeal' = 'null'::jsonb)::boolean,false), 'ev', (j::text)::text);
begin
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_b, 'ban', 'user', u_b, 'I did nothing wrong') returning id into ap_ban;
  res := res || jsonb_build_object('t', '2. banned user inserts appeal (kind ban)', 'pass', coalesce((ap_ban is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '2. banned user inserts appeal (kind ban)', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_b, 'ban', 'user', u_b, 'again');
  res := res || jsonb_build_object('t', '2. duplicate open appeal refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '2. duplicate open appeal refused', 'pass', (sqlerrm like '%appeal_already_open%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
  j := public.my_appealable_items();
res := res || jsonb_build_object('t', '2. my_appealable_items now shows the open appeal on the ban', 'pass', coalesce((j->0->'appeal'->>'status' = 'open')::boolean,false), 'ev', (j->0->'appeal'::text)::text);
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  perform public.admin_v2_set_hidden('video', v1, true, 'tt hide v1');
  perform public.admin_v2_set_hidden('video', v2, true, 'tt hide v2');
  perform public.admin_v2_set_hidden('video', v3, true, 'tt hide v3');
  perform public.admin_v2_set_hidden('video', v4, true, 'tt hide v4');
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role','authenticated')::text, true); set local role authenticated;
  j := public.my_appealable_items();
res := res || jsonb_build_object('t', '2. hidden videos appear in my_appealable_items (4 videos + ban = 5 items)', 'pass', coalesce((jsonb_array_length(j) = 5)::boolean,false), 'ev', (jsonb_array_length(j)::text)::text);
begin
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_b, 'content', 'video', v1, 'it is fine') returning id into ap_v1;
  res := res || jsonb_build_object('t', '2. appeal on hidden video v1', 'pass', coalesce((ap_v1 is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '2. appeal on hidden video v1', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_b, 'content', 'video', v2, 'it is fine') returning id into ap_v2;
  res := res || jsonb_build_object('t', '2. appeal on hidden video v2 (3rd open)', 'pass', coalesce((ap_v2 is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '2. appeal on hidden video v2 (3rd open)', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_b, 'content', 'video', v3, 'it is fine');
  res := res || jsonb_build_object('t', '2. 4th open appeal refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '2. 4th open appeal refused', 'pass', (sqlerrm like '%appeal_limit_open%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_c, 'content', 'video', v4, 'not mine');
  res := res || jsonb_build_object('t', '2. appeal against someone else''s content refused (u_c appeals u_b''s hidden video v4)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '2. appeal against someone else''s content refused (u_c appeals u_b''s hidden video v4)', 'pass', (sqlerrm like '%appeal_not_eligible%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_c, 'ban', 'user', u_b, 'not mine');
  res := res || jsonb_build_object('t', '2. u_c cannot appeal someone else''s ban', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '2. u_c cannot appeal someone else''s ban', 'pass', (sqlerrm like '%appeal_not_eligible%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  j := public.admin_v2_appeal_counts();
res := res || jsonb_build_object('t', '2. admin_v2_appeal_counts shows 3 open', 'pass', coalesce(((j->>'open')::int = 3 and (j->>'accepted')::int = 0 and j->>'oldest_open_at' is not null)::boolean,false), 'ev', (j::text)::text);
  select count(*) into n from public.admin_v2_list_appeals('open', 50, 0) l where l.user_id = u_b;
  select count(*) into n2 from public.admin_v2_list_appeals('open', 50, 0) l where l.id = ap_ban and l.kind = 'ban' and l.target->>'still_actioned' = 'true' and l.user_handle is not null;
res := res || jsonb_build_object('t', '2. admin_v2_list_appeals lists all 3 with ban snapshot still_actioned', 'pass', coalesce((n = 3 and n2 = 1)::boolean,false), 'ev', ('rows for user=' || n || ' ban row ok=' || n2)::text);
begin
  perform public.admin_v2_decide_appeal(ap_ban, false, null);
  res := res || jsonb_build_object('t', '2. reject WITHOUT note refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '2. reject WITHOUT note refused', 'pass', (sqlerrm like '%a note is required%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_decide_appeal(ap_ban, false, '   ');
  res := res || jsonb_build_object('t', '2. reject with blank note refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '2. reject with blank note refused', 'pass', (sqlerrm like '%a note is required%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
  select count(*) into logs_before from public.notifications where user_id = u_b and payload->>'kind' = 'appeal_decided';
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  res_j := public.admin_v2_decide_appeal(ap_ban, true, 'looks fine');
reset role; perform set_config('request.jwt.claims','',true);
  select count(*) into n from public.admin_logs where target_id = u_b and action = 'unban_user';
  select count(*) into n2 from public.admin_logs where target_id = ap_ban and action = 'appeal_accepted';
res := res || jsonb_build_object('t', '2. accept returns restored=unbanned', 'pass', coalesce((res_j::text like '%unbanned%')::boolean,false), 'ev', (res_j::text)::text);
res := res || jsonb_build_object('t', '2. accept lifts the ban (banned_until cleared)', 'pass', coalesce(((select banned_until is null from public.profiles where id = u_b))::boolean,false), 'ev', ((select coalesce(banned_until::text,'NULL') from public.profiles where id = u_b))::text);
res := res || jsonb_build_object('t', '2. accept writes admin_logs (unban_user + appeal_accepted)', 'pass', coalesce((n = 1 and n2 = 1)::boolean,false), 'ev', ('unban_user=' || n || ' appeal_accepted=' || n2)::text);
  select * into r from public.notifications where user_id = u_b and payload->>'kind' = 'appeal_decided';
res := res || jsonb_build_object('t', '2. accept creates ''appeal_decided'' system notification (outcome accepted)', 'pass', coalesce((r.type = 'system' and r.payload->>'outcome' = 'accepted' and r.payload->>'restored' = 'unbanned')::boolean,false), 'ev', (r.payload::text)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
begin
  perform public.admin_v2_decide_appeal(ap_ban, true, 'twice');
  res := res || jsonb_build_object('t', '2. deciding an already decided appeal refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '2. deciding an already decided appeal refused', 'pass', (sqlerrm like '%already decided%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  perform public.admin_v2_decide_appeal(ap_ban, false, 'twice');
  res := res || jsonb_build_object('t', '2. rejecting an already accepted appeal refused', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '2. rejecting an already accepted appeal refused', 'pass', (sqlerrm like '%already decided%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role','authenticated')::text, true); set local role authenticated;
  j := public.my_account_status();
res := res || jsonb_build_object('t', '2. user''s my_account_status no longer banned', 'pass', coalesce((not (j->>'banned')::boolean)::boolean,false), 'ev', (j::text)::text);
reset role; perform set_config('request.jwt.claims','',true);
  update public.appeals set decided_at = decided_at - interval '2 hours', created_at = created_at - interval '3 hours' where id = ap_ban;
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  perform public.admin_v2_set_ban(u_b, now() + interval '30 days', 'second offence tt');
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role','authenticated')::text, true); set local role authenticated;
begin
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_b, 'ban', 'user', u_b, 'second appeal') returning id into ap_ban2;
  res := res || jsonb_build_object('t', '2. after a NEW ban the user can appeal again', 'pass', coalesce((ap_ban2 is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '2. after a NEW ban the user can appeal again', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  res_j := public.admin_v2_decide_appeal(ap_ban2, false, 'decision stands');
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '2. reject with note keeps the ban', 'pass', coalesce(((select banned_until > now() from public.profiles where id = u_b))::boolean,false), 'ev', ((select banned_until::text from public.profiles where id = u_b))::text);
  select * into r from public.notifications where user_id = u_b and payload->>'outcome' = 'rejected';
res := res || jsonb_build_object('t', '2. reject creates appeal_decided notification outcome rejected', 'pass', coalesce((r.payload->>'kind' = 'appeal_decided' and r.payload->>'note' = 'decision stands')::boolean,false), 'ev', (r.payload::text)::text);
  select status, admin_note into t, t2 from public.appeals where id = ap_ban2;
res := res || jsonb_build_object('t', '2. rejected appeal row: status rejected, note stored', 'pass', coalesce((t = 'rejected' and t2 = 'decision stands')::boolean,false), 'ev', (t || ' / ' || t2)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role','authenticated')::text, true); set local role authenticated;
begin
  insert into public.appeals (user_id, kind, target_type, target_id, reason) values (u_b, 'ban', 'user', u_b, 'third');
  res := res || jsonb_build_object('t', '2. immediately re-appealing the same decided ban is refused (appeal_already_decided)', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '2. immediately re-appealing the same decided ban is refused (appeal_already_decided)', 'pass', (sqlerrm like '%appeal_already_decided%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  res_j := public.admin_v2_decide_appeal(ap_v1, true, 'ok');
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '2. content appeal accept unhides the video', 'pass', coalesce(((select not is_hidden from public.videos where id = v1) and res_j::text like '%unhidden%')::boolean,false), 'ev', ((select is_hidden::text from public.videos where id = v1) || ' ' || res_j::text)::text);
res := res || jsonb_build_object('t', '2. other hidden videos stay hidden (v2, v3, v4)', 'pass', coalesce(((select count(*) from public.videos where id in (v2,v3,v4) and is_hidden) = 3)::boolean,false), 'ev', ('')::text);
  select count(*) into n from public.admin_logs where action = 'appeal_accepted' and target_id = ap_v1;
  select count(*) into n2 from public.notifications where user_id = u_b and payload->>'appeal_id' = ap_v1::text and payload->>'target_type' = 'video';
res := res || jsonb_build_object('t', '2. content accept writes admin_logs + notification', 'pass', coalesce((n = 1 and n2 = 1)::boolean,false), 'ev', ('logs=' || n || ' notifs=' || n2)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  perform public.admin_v2_decide_appeal(ap_v2, false, 'video stays hidden');
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '2. content reject keeps the video hidden', 'pass', coalesce(((select is_hidden from public.videos where id = v2))::boolean,false), 'ev', ('')::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role','authenticated')::text, true); set local role authenticated;
  j := public.my_appealable_items();
res := res || jsonb_build_object('t', '2. unhidden v1 no longer in my_appealable_items; v2 shows rejected appeal', 'pass', coalesce((not exists (select 1 from jsonb_array_elements(j) e where e->>'target_id' = v1::text) and exists (select 1 from jsonb_array_elements(j) e where e->>'target_id' = v2::text and e->'appeal'->>'status' = 'rejected'))::boolean,false), 'ev', (j::text)::text);
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
