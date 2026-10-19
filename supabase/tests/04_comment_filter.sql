-- 04 - comment word filter (scenario 4)
-- Generated; always ends in RAISE EXCEPTION so the whole transaction rolls back (nothing persists).
-- Run from the repo root:  npx supabase db query --linked -f <this file>
-- Result is in the error message ("RESULTS: [...]").
do $tt$
declare
  res jsonb := '[]'::jsonb;
  sfx text := substr(md5(random()::text), 1, 6);
  j jsonb; j2 jsonb; n bigint; n2 bigint; t text; t2 text; r record;
  u_a uuid := gen_random_uuid(); u_c uuid := gen_random_uuid(); u_adm uuid := gen_random_uuid(); vid uuid; live uuid; cm uuid; lc uuid;
begin
 begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select x.id, 'authenticated', 'authenticated', 'tt-' || x.h || '@example.invalid',
         jsonb_build_object('handle', 'tt_' || x.h || '_' || sfx), now(), now()
    from (values (u_a, 'a'),(u_c, 'c'),(u_adm, 'adm')) x(id, h);
  update public.profiles set is_admin = true where id = u_adm;
  insert into public.videos (user_id, description, video_url, thumbnail, privacy, is_draft) values (u_a, 'tt comment target', 'https://example.invalid/v.mp4', 'https://example.invalid/t.jpg', 'public', false) returning id into vid;
  insert into public.live_streams (host_id, title, status) values (u_a, 'tt live', 'live') returning id into live;
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'fuck you bitch');
  res := res || jsonb_build_object('t', '4. comment rejected (EN): fuck you bitch', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (EN): fuck you bitch', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'fuck you bitch');
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): fuck you bitch', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): fuck you bitch', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'you are a stupid idiot');
  res := res || jsonb_build_object('t', '4. comment rejected (EN): you are a stupid idiot', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (EN): you are a stupid idiot', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'you are a stupid idiot');
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): you are a stupid idiot', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): you are a stupid idiot', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'f.u.c.k y0u b1tchhhh');
  res := res || jsonb_build_object('t', '4. comment rejected (EN): f.u.c.k y0u b1tchhhh', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (EN): f.u.c.k y0u b1tchhhh', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'f.u.c.k y0u b1tchhhh');
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): f.u.c.k y0u b1tchhhh', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): f.u.c.k y0u b1tchhhh', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'what a f*cking b!tch');
  res := res || jsonb_build_object('t', '4. comment rejected (EN): what a f*cking b!tch', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (EN): what a f*cking b!tch', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'what a f*cking b!tch');
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): what a f*cking b!tch', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): what a f*cking b!tch', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'just kys');
  res := res || jsonb_build_object('t', '4. comment rejected (EN): just kys', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (EN): just kys', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'just kys');
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): just kys', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): just kys', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'u r so dumb');
  res := res || jsonb_build_object('t', '4. comment rejected (EN): u r so dumb', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (EN): u r so dumb', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'u r so dumb');
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): u r so dumb', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): u r so dumb', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'you are a moron');
  res := res || jsonb_build_object('t', '4. comment rejected (EN): you are a moron', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (EN): you are a moron', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'you are a moron');
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): you are a moron', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): you are a moron', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'shut up you idiot');
  res := res || jsonb_build_object('t', '4. comment rejected (EN): shut up you idiot', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (EN): shut up you idiot', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'shut up you idiot');
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): shut up you idiot', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (EN): shut up you idiot', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'يا حمار');
  res := res || jsonb_build_object('t', '4. comment rejected (AR): يا حمار', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (AR): يا حمار', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'يا حمار');
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): يا حمار', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): يا حمار', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'يلعن ابوك');
  res := res || jsonb_build_object('t', '4. comment rejected (AR): يلعن ابوك', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (AR): يلعن ابوك', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'يلعن ابوك');
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): يلعن ابوك', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): يلعن ابوك', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'انت غبي والله');
  res := res || jsonb_build_object('t', '4. comment rejected (AR): انت غبي والله', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (AR): انت غبي والله', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'انت غبي والله');
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): انت غبي والله', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): انت غبي والله', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'يا ابن الكلب');
  res := res || jsonb_build_object('t', '4. comment rejected (AR): يا ابن الكلب', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (AR): يا ابن الكلب', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'يا ابن الكلب');
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): يا ابن الكلب', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): يا ابن الكلب', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'ياكلب');
  res := res || jsonb_build_object('t', '4. comment rejected (AR): ياكلب', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (AR): ياكلب', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'ياكلب');
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): ياكلب', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): ياكلب', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'انت غبييييي');
  res := res || jsonb_build_object('t', '4. comment rejected (AR): انت غبييييي', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (AR): انت غبييييي', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'انت غبييييي');
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): انت غبييييي', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): انت غبييييي', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'يا حِمَارْ');
  res := res || jsonb_build_object('t', '4. comment rejected (AR): يا حِمَارْ', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (AR): يا حِمَارْ', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'يا حِمَارْ');
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): يا حِمَارْ', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): يا حِمَارْ', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'شرمـــوطة');
  res := res || jsonb_build_object('t', '4. comment rejected (AR): شرمـــوطة', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. comment rejected (AR): شرمـــوطة', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'شرمـــوطة');
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): شرمـــوطة', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment rejected (AR): شرمـــوطة', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'Great video, thanks for sharing!') returning id into cm;
  res := res || jsonb_build_object('t', '4. comment accepted (clean): Great video, thanks for sharing!', 'pass', coalesce((cm is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. comment accepted (clean): Great video, thanks for sharing!', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'Great video, thanks for sharing!') returning id into lc;
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): Great video, thanks for sharing!', 'pass', coalesce((lc is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): Great video, thanks for sharing!', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'that was a stupid rule honestly') returning id into cm;
  res := res || jsonb_build_object('t', '4. comment accepted (clean): that was a stupid rule honestly', 'pass', coalesce((cm is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. comment accepted (clean): that was a stupid rule honestly', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'that was a stupid rule honestly') returning id into lc;
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): that was a stupid rule honestly', 'pass', coalesce((lc is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): that was a stupid rule honestly', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'classic assassin class in Scunthorpe') returning id into cm;
  res := res || jsonb_build_object('t', '4. comment accepted (clean): classic assassin class in Scunthorpe', 'pass', coalesce((cm is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. comment accepted (clean): classic assassin class in Scunthorpe', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'classic assassin class in Scunthorpe') returning id into lc;
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): classic assassin class in Scunthorpe', 'pass', coalesce((lc is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): classic assassin class in Scunthorpe', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'ما شاء الله فيديو رائع') returning id into cm;
  res := res || jsonb_build_object('t', '4. comment accepted (clean): ما شاء الله فيديو رائع', 'pass', coalesce((cm is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. comment accepted (clean): ما شاء الله فيديو رائع', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'ما شاء الله فيديو رائع') returning id into lc;
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): ما شاء الله فيديو رائع', 'pass', coalesce((lc is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): ما شاء الله فيديو رائع', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'كلبي الصغير يحب اللعب') returning id into cm;
  res := res || jsonb_build_object('t', '4. comment accepted (clean): كلبي الصغير يحب اللعب', 'pass', coalesce((cm is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. comment accepted (clean): كلبي الصغير يحب اللعب', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'كلبي الصغير يحب اللعب') returning id into lc;
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): كلبي الصغير يحب اللعب', 'pass', coalesce((lc is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): كلبي الصغير يحب اللعب', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'لا تكسر الباب') returning id into cm;
  res := res || jsonb_build_object('t', '4. comment accepted (clean): لا تكسر الباب', 'pass', coalesce((cm is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. comment accepted (clean): لا تكسر الباب', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'لا تكسر الباب') returning id into lc;
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): لا تكسر الباب', 'pass', coalesce((lc is not null)::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. live_comment accepted (clean): لا تكسر الباب', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;
  insert into public.comments (video_id, user_id, text) values (vid, u_c, 'nice one') returning id into cm;
  insert into public.live_comments (live_stream_id, user_id, text) values (live, u_c, 'nice live') returning id into lc;
reset role; perform set_config('request.jwt.claims','',true);
perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role','authenticated')::text, true); set local role authenticated;
  begin
    update public.comments set text = 'fuck you bitch' where id = cm;
    get diagnostics n = row_count;
    res := res || jsonb_build_object('t','4. UPDATE of own comment to an insult via the API is stopped (no rows changed or error)','pass', n = 0 or false,'ev','rows updated=' || n);
  exception when others then
    res := res || jsonb_build_object('t','4. UPDATE of own comment to an insult via the API is stopped (no rows changed or error)','pass', sqlstate in ('42501','23514'),'ev', sqlstate || ' ' || left(sqlerrm,120));
  end;
  begin
    update public.live_comments set text = 'fuck you bitch' where id = lc;
    get diagnostics n = row_count;
    res := res || jsonb_build_object('t','4. UPDATE of own live_comment to an insult via the API is stopped (no rows changed or error)','pass', n = 0,'ev','rows updated=' || n);
  exception when others then
    res := res || jsonb_build_object('t','4. UPDATE of own live_comment to an insult via the API is stopped (no rows changed or error)','pass', sqlstate in ('42501','23514'),'ev', sqlstate || ' ' || left(sqlerrm,120));
  end;
reset role; perform set_config('request.jwt.claims','',true);
  select text into t from public.comments where id = cm;
  select text into t2 from public.live_comments where id = lc;
res := res || jsonb_build_object('t', '4. texts unchanged after bypass attempts', 'pass', coalesce((t = 'nice one' and t2 = 'nice live')::boolean,false), 'ev', (t || ' / ' || t2)::text);
begin
  update public.comments set text = 'يا حمار' where id = cm;
  res := res || jsonb_build_object('t', '4. trigger also blocks UPDATE of text even for a trusted (service/SQL) writer, comments', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. trigger also blocks UPDATE of text even for a trusted (service/SQL) writer, comments', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  update public.live_comments set text = 'you are a stupid idiot' where id = lc;
  res := res || jsonb_build_object('t', '4. trigger also blocks UPDATE of text for trusted writer, live_comments', 'pass', false, 'ev', 'NO ERROR RAISED');
exception when others then
  res := res || jsonb_build_object('t', '4. trigger also blocks UPDATE of text for trusted writer, live_comments', 'pass', (sqlstate = '23514' or sqlerrm like '%comment_blocked%'), 'ev', sqlstate || ' ' || left(sqlerrm, 220));
end;
begin
  update public.comments set text = 'edited fine' where id = cm;
  res := res || jsonb_build_object('t', '4. UPDATE of text to a clean value still allowed for trusted writer', 'pass', coalesce(((select text from public.comments where id = cm) = 'edited fine')::boolean,false), 'ev', ('')::text);
exception when others then
  res := res || jsonb_build_object('t', '4. UPDATE of text to a clean value still allowed for trusted writer', 'pass', false, 'ev', 'UNEXPECTED ERROR ' || sqlstate || ' ' || left(sqlerrm, 220));
end;

 exception when others then
  reset role;
  res := res || jsonb_build_object('t', 'HARNESS ABORTED (unhandled error)', 'pass', false, 'ev', sqlstate || ' ' || left(sqlerrm, 300));
 end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RESULTS: %', res::text;
end
$tt$;
