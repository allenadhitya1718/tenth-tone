-- 0076 — "who can save my videos" has never done anything
--
-- Run this whole file once in the Supabase SQL editor. Safe to re-run.
--
-- 0001 created the policy as:
--     create policy "saves write own" on public.saves ...
--
-- 0024 then tried to replace it with a version that honours allow_saving, and
-- opened with:
--     drop policy if exists "saves own write" on public.saves;
--
-- "saves own write" versus "saves write own". The words are transposed, so the
-- drop matched nothing, `if exists` swallowed it silently, and 0001's original
-- policy survived. Postgres ORs permissive policies together, so 0024's
-- allow_saving check has been satisfied-by-alternative on every insert since.
-- The switch saves, displays, and is enforced nowhere.
--
-- The sibling in the same migration, `comments insert own`, reuses 0001's exact
-- name and therefore DOES replace it - which is why allow_comments works and
-- this does not. One transposition, one dead setting, two years of looking
-- identical in the file.
--
-- Note the UPDATE policy. API.save uses .upsert(), which needs INSERT *and*
-- UPDATE. 0001's policy was FOR ALL and covered both; dropping it without
-- adding an UPDATE policy would break saving entirely for everyone - a worse
-- outcome than the bug being fixed.

drop policy if exists "saves own write" on public.saves;   -- 0024's typo, harmless
drop policy if exists "saves write own" on public.saves;   -- the one that actually exists

-- Insert: your own row, and only when the video's owner allows saving.
-- coalesce because allow_saving is null on every row predating 0024, and a
-- null there must mean "allowed" rather than silently blocking old videos.
drop policy if exists "saves insert allowed" on public.saves;
create policy "saves insert allowed" on public.saves
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.videos v
       where v.id = saves.video_id
         and coalesce(v.allow_saving, true) = true
    )
  );

-- Update: needed by .upsert(). Deliberately does NOT re-check allow_saving -
-- the row already exists, so this is touching your own save, not creating one.
drop policy if exists "saves update own" on public.saves;
create policy "saves update own" on public.saves
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Unsaving must always be possible, even if the owner has since turned saving
-- off. Being unable to remove your own bookmark would be a worse bug.
drop policy if exists "saves delete own" on public.saves;
create policy "saves delete own" on public.saves
  for delete to authenticated
  using (auth.uid() = user_id);


-- ── Verify ──
select 'the 0001 policy is gone' as check,
       case when not exists (
         select 1 from pg_policies where schemaname = 'public'
           and tablename = 'saves' and policyname = 'saves write own'
       ) then 'OK' else 'STILL PRESENT — allow_saving stays unenforced' end as result
union all
select 'insert policy checks allow_saving',
       case when exists (
         select 1 from pg_policies where schemaname = 'public'
           and tablename = 'saves' and policyname = 'saves insert allowed'
           and with_check like '%allow_saving%'
       ) then 'OK' else 'MISSING' end
union all
select 'update policy exists (upsert needs it)',
       case when exists (
         select 1 from pg_policies where schemaname = 'public'
           and tablename = 'saves' and policyname = 'saves update own'
       ) then 'OK' else 'MISSING — saving will break' end
union all
select 'delete policy exists (unsave must always work)',
       case when exists (
         select 1 from pg_policies where schemaname = 'public'
           and tablename = 'saves' and policyname = 'saves delete own'
       ) then 'OK' else 'MISSING' end
order by 1;

-- After running: save a video, unsave it, and save it again - all three must
-- work. Then set a video's allow_saving to false and confirm saving it is
-- refused while unsaving an existing save still succeeds.
