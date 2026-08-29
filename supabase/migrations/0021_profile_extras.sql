-- ============================================================
-- 0021_profile_extras.sql
-- Profile page additions:
--   * profiles.link       - "link in bio" (creators expect this)
--   * profiles.is_private - private-account flag. This was originally in
--                           0006_self_service.sql, which was never applied
--                           to this database, so it is repeated here with
--                           "if not exists" - safe either way.
--   * videos.is_pinned    - pin up to 3 videos to the top of a profile,
--                           the way TikTok does.
--
-- Apply in the Supabase SQL editor AFTER 0001..0020.
-- ============================================================

alter table public.profiles add column if not exists link       text;
alter table public.profiles add column if not exists is_private boolean not null default false;

alter table public.videos   add column if not exists is_pinned  boolean not null default false;

-- Pinned videos are read on every profile visit, so index the lookup.
create index if not exists idx_videos_pinned
  on public.videos (user_id, is_pinned, created_at desc)
  where is_pinned = true;

-- ── Cap pinning at 3 per user ──
-- Enforced in the database so the client cannot exceed it, whatever the UI does.
create or replace function public.enforce_pin_limit()
returns trigger
language plpgsql
as $$
begin
  if new.is_pinned and (tg_op = 'INSERT' or old.is_pinned is distinct from new.is_pinned) then
    if (select count(*) from public.videos
         where user_id = new.user_id and is_pinned = true and id <> new.id) >= 3 then
      raise exception 'pin limit reached';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tr_enforce_pin_limit on public.videos;
create trigger tr_enforce_pin_limit
  before insert or update of is_pinned on public.videos
  for each row execute function public.enforce_pin_limit();
