-- 0086 — hashtag counts reflect what a person can actually watch
--
-- Discover said "#najran 2 videos, #dunkin 1 video" while one of those
-- videos was a DRAFT — never published, visible to nobody but its author.
-- sync_hashtags() indexed every row in videos regardless of state, and its
-- trigger only fired on description changes, so publishing a draft (is_draft
-- flipping to false) or hiding a video never re-indexed it either.
--
-- A hashtag now counts a video only while it is published, public, not
-- hidden and not archived, and the trigger fires whenever any of those
-- change. usage_count keeps following the join table, so it stays exact.

create or replace function public.sync_hashtags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  v_live boolean;
begin
  if tg_op in ('DELETE', 'UPDATE') then
    delete from public.video_hashtags where video_id = old.id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.description is not null then
    v_live := coalesce(new.is_draft, false) = false
          and coalesce(new.is_hidden, false) = false
          and coalesce(new.is_archived, false) = false
          and coalesce(new.privacy, 'public') = 'public';
    if v_live then
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
  end if;

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
  after insert or delete or update of description, is_draft, is_hidden, is_archived, privacy
  on public.videos
  for each row execute function public.sync_hashtags();

-- Re-index everything under the new rule. A no-op UPDATE OF description
-- fires the trigger for every row, which rebuilds the join table and the
-- counts from scratch.
update public.videos set description = description;
