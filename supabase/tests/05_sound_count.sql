-- 05 - sound usage count (scenario 5)
-- Generated; always ends in RAISE EXCEPTION so the whole transaction rolls back (nothing persists).
-- Run from the repo root:  npx supabase db query --linked -f <this file>
-- Result is in the error message ("RESULTS: [...]").
do $tt$
declare
  res jsonb := '[]'::jsonb;
  sfx text := substr(md5(random()::text), 1, 6);
  j jsonb; j2 jsonb; n bigint; n2 bigint; t text; t2 text; r record;
  u_a uuid := gen_random_uuid(); u_adm uuid := gen_random_uuid(); s1 uuid; s2 uuid; v1 uuid; v2 uuid; cnt integer; trg_n integer;
begin
 begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select x.id, 'authenticated', 'authenticated', 'tt-' || x.h || '@example.invalid',
         jsonb_build_object('handle', 'tt_' || x.h || '_' || sfx), now(), now()
    from (values (u_a, 'a'),(u_adm, 'adm')) x(id, h);
  update public.profiles set is_admin = true where id = u_adm;
  insert into public.sounds (title, created_by) values ('tt sound 1', u_a) returning id into s1;
  insert into public.sounds (title, created_by) values ('tt sound 2', u_a) returning id into s2;
  select count(*) into trg_n from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.videos'::regclass and not t.tgisinternal and p.proname in ('sync_sound_usage','bump_sound_usage');
res := res || jsonb_build_object('t', '5. exactly one sound-usage trigger on videos (the 0008 duplicate is gone)', 'pass', coalesce((trg_n = 1)::boolean,false), 'ev', (trg_n::text)::text);
res := res || jsonb_build_object('t', '5. new sound starts at 0', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 0)::boolean,false), 'ev', ((select usage_count from public.sounds where id = s1)::text)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role','authenticated')::text, true); set local role authenticated;
begin
  insert into public.videos (user_id, description, video_url, thumbnail, privacy, is_draft, sound_id) values (u_a, 'tt sv1', 'https://example.invalid/s1.mp4', 'https://example.invalid/s1.jpg', 'public', false, s1) returning id into v1;
  res := res || jsonb_build_object('t', '5. user posts ONE published public video with the sound (via RLS)', 'pass', coalesce((v1 is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '5. user posts ONE published public video with the sound (via RLS)', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '5. posting one video with a sound counts exactly 1 (not 2)', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 1)::boolean,false), 'ev', ((select usage_count from public.sounds where id = s1)::text)::text);
  insert into public.videos (user_id, description, video_url, thumbnail, privacy, is_draft, sound_id) values (u_a, 'tt sv2', 'https://example.invalid/s2.mp4', 'https://example.invalid/s2.jpg', 'public', false, s1) returning id into v2;
res := res || jsonb_build_object('t', '5. second published video -> 2', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 2)::boolean,false), 'ev', ((select usage_count from public.sounds where id = s1)::text)::text);
  delete from public.videos where id = v2;
res := res || jsonb_build_object('t', '5. deleting the second video -> 1', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 1)::boolean,false), 'ev', ('count=' || (select usage_count from public.sounds where id = s1))::text);
  update public.videos set is_draft = true where id = v1;
res := res || jsonb_build_object('t', '5. unpublish (is_draft = true) lowers to 0', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 0)::boolean,false), 'ev', ('count=' || (select usage_count from public.sounds where id = s1))::text);
  update public.videos set is_draft = false where id = v1;
res := res || jsonb_build_object('t', '5. re-publish -> 1', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 1)::boolean,false), 'ev', ('count=' || (select usage_count from public.sounds where id = s1))::text);
  update public.videos set is_hidden = true where id = v1;
res := res || jsonb_build_object('t', '5. hidden (is_hidden = true, direct) lowers to 0', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 0)::boolean,false), 'ev', ('count=' || (select usage_count from public.sounds where id = s1))::text);
  update public.videos set is_hidden = false where id = v1;
res := res || jsonb_build_object('t', '5. unhidden -> 1', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 1)::boolean,false), 'ev', ('count=' || (select usage_count from public.sounds where id = s1))::text);
  update public.videos set privacy = 'private' where id = v1;
res := res || jsonb_build_object('t', '5. private lowers to 0', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 0)::boolean,false), 'ev', ('count=' || (select usage_count from public.sounds where id = s1))::text);
  update public.videos set privacy = 'public' where id = v1;
res := res || jsonb_build_object('t', '5. public again -> 1', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 1)::boolean,false), 'ev', ('count=' || (select usage_count from public.sounds where id = s1))::text);
  update public.videos set is_archived = true where id = v1;
res := res || jsonb_build_object('t', '5. archived lowers to 0', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 0)::boolean,false), 'ev', ('count=' || (select usage_count from public.sounds where id = s1))::text);
  update public.videos set is_archived = false where id = v1;
res := res || jsonb_build_object('t', '5. unarchived -> 1', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 1)::boolean,false), 'ev', ('count=' || (select usage_count from public.sounds where id = s1))::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  perform public.admin_v2_set_hidden('video', v1, true, 'tt');
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '5. admin_v2_set_hidden lowers to 0', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 0)::boolean,false), 'ev', ((select usage_count from public.sounds where id = s1)::text)::text);
perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role','authenticated')::text, true); set local role authenticated;
  perform public.admin_v2_set_hidden('video', v1, false, 'tt');
reset role; perform set_config('request.jwt.claims','',true);
res := res || jsonb_build_object('t', '5. admin unhide -> 1', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 1)::boolean,false), 'ev', ((select usage_count from public.sounds where id = s1)::text)::text);
  update public.videos set sound_id = s2 where id = v1;
res := res || jsonb_build_object('t', '5. changing the video''s sound moves the count (s1 0, s2 1)', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 0 and (select usage_count from public.sounds where id = s2) = 1)::boolean,false), 'ev', ('s1=' || (select usage_count from public.sounds where id = s1) || ' s2=' || (select usage_count from public.sounds where id = s2))::text);
  update public.videos set sound_id = s1 where id = v1;
  delete from public.videos where id = v1;
res := res || jsonb_build_object('t', '5. deleting the video lowers to 0 (and never below 0)', 'pass', coalesce(((select usage_count from public.sounds where id = s1) = 0)::boolean,false), 'ev', ('count=' || (select usage_count from public.sounds where id = s1))::text);
res := res || jsonb_build_object('t', '5. other sound untouched at 0 after delete', 'pass', coalesce(((select usage_count from public.sounds where id = s2) = 0)::boolean,false), 'ev', ((select usage_count from public.sounds where id = s2)::text)::text);
res := res || jsonb_build_object('t', '5. no sound count differs from reality (all sounds)', 'pass', coalesce((not exists (select 1 from public.sounds s where s.usage_count <> (select count(*) from public.videos v where v.sound_id = s.id and v.is_draft = false and v.is_hidden = false and v.is_archived = false and v.privacy = 'public')))::boolean,false), 'ev', ('')::text);

 exception when others then
  reset role;
  res := res || jsonb_build_object('t', 'HARNESS ABORTED (unhandled error)', 'pass', false, 'ev', sqlstate || ' ' || left(sqlerrm, 300));
 end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RESULTS: %', res::text;
end
$tt$;
