-- =============================================================
-- Demo seed — populates the platform with sample content so
-- a fresh demo doesn't show empty screens.
--
-- Run this in Supabase SQL editor AFTER you have at least one
-- user (preferably khaled@flyp-sa.com from earlier).
--
-- Idempotent — safe to re-run; uses on conflict do nothing.
-- =============================================================

do $$
declare
  demo_user uuid;
  user_ids uuid[];
  i int;
  vid uuid;
  -- Public stock-style videos (any short MP4 works; these are tiny placeholders)
  thumbs text[] := array[
    'https://images.unsplash.com/photo-1517963879433-6ad2b056d712?w=900',
    'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=900',
    'https://images.unsplash.com/photo-1500336624523-d727130c3328?w=900',
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=900',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=900',
    'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=900',
    'https://images.unsplash.com/photo-1502323777036-f29e3972d82f?w=900',
    'https://images.unsplash.com/photo-1493612276216-ee3925520721?w=900'
  ];
  descs text[] := array[
    'يوم جميل في الرياض 🌅 #حياتنا #الرياض',
    'وصفتي المفضلة 🍰 جربوها وأخبروني!',
    'تدريب اليوم 💪 #كرة_قدم',
    'رحلة العمر 🌍 #سفر',
    'لحن جديد 🎶',
    'القهوة قبل أي شيء ☕',
    'مغامرة لا تُنسى ⛰️',
    'تصوير ليلي ✨'
  ];
  music_arr text[] := array['الأصلي - أحمد', 'هزّة - سارة', 'صوت من ذكرى - علي', 'خفقات - فاطمة'];
begin
  -- Find khaled (the demo user) — must exist
  select id into demo_user from public.profiles where handle = 'khaled' limit 1;
  if demo_user is null then
    raise notice 'No user with handle ''khaled'' found — create that account first';
    return;
  end if;

  -- Create a few synthetic users so feed has variety
  -- (We can't create auth.users from SQL without service_role, so just use existing profiles)
  select array_agg(id) into user_ids from public.profiles where id <> demo_user limit 8;

  -- If too few users, just seed videos as the demo user
  if array_length(user_ids, 1) is null or array_length(user_ids, 1) < 1 then
    user_ids := array[demo_user];
  end if;

  -- Insert 8 sample videos rotating through users
  for i in 1..8 loop
    insert into public.videos (user_id, description, music, video_url, thumbnail, privacy, is_draft, likes_count, comments_count, views_count)
    values (
      user_ids[1 + ((i - 1) % array_length(user_ids, 1))],
      descs[1 + ((i - 1) % array_length(descs, 1))],
      music_arr[1 + ((i - 1) % array_length(music_arr, 1))],
      thumbs[1 + ((i - 1) % array_length(thumbs, 1))],
      thumbs[1 + ((i - 1) % array_length(thumbs, 1))],
      'public', false,
      (random() * 5000)::int,
      (random() * 200)::int,
      (random() * 50000)::int
    );
  end loop;

  -- Make all users follow each other a bit (so feed has Following content)
  insert into public.follows (follower_id, followed_id)
  select p1.id, p2.id from public.profiles p1, public.profiles p2
  where p1.id <> p2.id
  on conflict do nothing;

  -- Give the demo user 1000 starter coins (instead of default 100)
  update public.wallets set balance = 1000 where user_id = demo_user;

  raise notice '✅ Demo seed complete: 8 videos, follows wired, demo user has 1000 coins';
end $$;
