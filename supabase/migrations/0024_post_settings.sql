-- ============================================================
-- 0024_post_settings.sql
-- Makes the post screen's "Allow comments" and "Allow saving" toggles real.
--
-- They existed in the UI but nothing stored or enforced them - the columns
-- did not exist and no code read them, so flipping either did nothing.
--
-- Storing the flag is not enough: the rules below stop a comment or save
-- being written at the database level, so turning them off cannot be
-- bypassed by calling the API directly.
--
-- Apply in the Supabase SQL editor AFTER 0001..0023.
-- ============================================================

alter table public.videos add column if not exists allow_comments boolean not null default true;
alter table public.videos add column if not exists allow_saving   boolean not null default true;

-- ── Comments respect allow_comments ──
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.videos v
       where v.id = comments.video_id
         and v.allow_comments = true
    )
  );

-- ── Saves respect allow_saving ──
drop policy if exists "saves own write" on public.saves;
create policy "saves own write" on public.saves
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.videos v
       where v.id = saves.video_id
         and v.allow_saving = true
    )
  );

-- Removing your own save must always be allowed, even if the creator has
-- since turned saving off.
drop policy if exists "saves own delete" on public.saves;
create policy "saves own delete" on public.saves
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "saves own read" on public.saves;
create policy "saves own read" on public.saves
  for select to authenticated using (auth.uid() = user_id);
