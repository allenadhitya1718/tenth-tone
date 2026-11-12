-- 0171: saved highlights (client, Nov 2026). Posting videos is gone, so the
-- profile's Saved tab lists highlights (and voice clips) the person saved
-- from the For You feed. Private: only you see what you saved.
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0170.
-- Safe to re-run.

begin;

create table if not exists public.highlight_saves (
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  highlight_id uuid not null references public.live_highlights(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, highlight_id)
);
create index if not exists highlight_saves_user_idx on public.highlight_saves (user_id, created_at desc);
create index if not exists highlight_saves_highlight_idx on public.highlight_saves (highlight_id);

alter table public.highlight_saves enable row level security;
revoke all on public.highlight_saves from anon, authenticated;
grant select, insert, delete on public.highlight_saves to authenticated;

drop policy if exists "highlight saves read own" on public.highlight_saves;
create policy "highlight saves read own" on public.highlight_saves
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Only for yourself, and only a highlight you can see (the live_highlights
-- read policy applies inside the check: hidden or blocked ones fail).
drop policy if exists "highlight saves insert own" on public.highlight_saves;
create policy "highlight saves insert own" on public.highlight_saves
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.live_highlights h where h.id = highlight_id)
  );

drop policy if exists "highlight saves delete own" on public.highlight_saves;
create policy "highlight saves delete own" on public.highlight_saves
  for delete to authenticated
  using (user_id = (select auth.uid()));

commit;

-- Checks (SELECT only)
select 'highlight_saves table' as check,
       case when to_regclass('public.highlight_saves') is not null then 'OK' else 'MISSING' end as result
union all
select 'row level security on',
       case when (select relrowsecurity from pg_class where oid = 'public.highlight_saves'::regclass) then 'OK' else 'OFF' end
union all
select 'three policies',
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'highlight_saves') = 3 then 'OK' else 'WRONG' end;
