-- ============================================================
-- 0025_hashtag_index.sql
-- Turns hashtags from a text search into a real index.
--
-- Before: tapping #travel ran `description LIKE '%#travel%'`. That matches
-- #travelling too, cannot use an index, and gets slower with every video.
-- The hashtags table existed but was only used to render the trending list.
--
-- This adds a join table so a tag lookup is exact and indexed, keeps it in
-- sync with captions via the existing trigger, and backfills what is already
-- posted.
--
-- Apply in the Supabase SQL editor AFTER 0001..0024.
-- ============================================================

create table if not exists public.video_hashtags (
  video_id uuid not null references public.videos   (id) on delete cascade,
  tag      text not null references public.hashtags (tag) on delete cascade,
  primary key (video_id, tag)
);

create index if not exists idx_video_hashtags_tag on public.video_hashtags (tag);

alter table public.video_hashtags enable row level security;

drop policy if exists "video_hashtags read" on public.video_hashtags;
create policy "video_hashtags read" on public.video_hashtags
  for select to authenticated, anon using (true);
-- Writes happen only through the trigger below (security definer).

-- ── Keep hashtags AND video_hashtags in sync with captions ──
-- Replaces the function added in 0016, which only maintained usage_count.
create or replace function public.sync_hashtags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
begin
  if tg_op in ('DELETE', 'UPDATE') then
    delete from public.video_hashtags where video_id = old.id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.description is not null then
    for t in
      select distinct lower(m[1])
        from regexp_matches(new.description, '#([^\s#]{1,60})', 'g') m
    loop
      insert into public.hashtags (tag, usage_count) values (t, 0)
        on conflict (tag) do nothing;
      insert into public.video_hashtags (video_id, tag) values (new.id, t)
        on conflict do nothing;
    end loop;
  end if;

  -- usage_count follows the join table rather than being incremented blindly,
  -- so it can never drift out of step with reality.
  update public.hashtags h
     set usage_count = (select count(*) from public.video_hashtags vh where vh.tag = h.tag),
         updated_at  = now()
   where h.tag in (
     select tag from public.video_hashtags where video_id = coalesce(new.id, old.id)
     union
     select tag from public.hashtags
   );

  return null;
end;
$$;

drop trigger if exists tr_sync_hashtags on public.videos;
create trigger tr_sync_hashtags
  after insert or update of description or delete on public.videos
  for each row execute function public.sync_hashtags();

-- ── Backfill from captions already posted ──
insert into public.hashtags (tag, usage_count)
select distinct lower(m[1]), 0
  from public.videos v,
       lateral regexp_matches(v.description, '#([^\s#]{1,60})', 'g') m
 where v.description is not null
on conflict (tag) do nothing;

insert into public.video_hashtags (video_id, tag)
select distinct v.id, lower(m[1])
  from public.videos v,
       lateral regexp_matches(v.description, '#([^\s#]{1,60})', 'g') m
 where v.description is not null
on conflict do nothing;

update public.hashtags h
   set usage_count = (select count(*) from public.video_hashtags vh where vh.tag = h.tag);

-- Drop tags that no longer appear in any caption.
delete from public.hashtags h
 where not exists (select 1 from public.video_hashtags vh where vh.tag = h.tag);
