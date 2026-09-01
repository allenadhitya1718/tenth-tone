-- 0070 — blocking has never actually hidden a profile
--
-- Found by testing with two accounts and then chasing it properly: account A
-- blocked account B, and B could still read A's profile row — name, handle,
-- bio, counts.
--
-- ── Why, and it is not what it looks like ──
-- 0054's policy is CORRECT. It reads:
--
--     or not exists (
--       select 1 from public.blocks b
--        where b.blocker_id = profiles.id
--          and b.blocked_id = auth.uid()
--     )
--
-- and the deployed definition matches the file exactly. There is also only one
-- SELECT policy on profiles, so nothing is OR-ing it open. Both of those were
-- checked before writing this.
--
-- The failure is one level down. That subquery reads public.blocks, and blocks
-- has RLS of its own — from 0004:
--
--     create policy "blocks read own" on public.blocks
--       for select to authenticated using (auth.uid() = blocker_id);
--
-- Only the BLOCKER may read their own block rows. So when B queries profiles,
-- the subquery runs as B, RLS hides A's block row from B, EXISTS finds
-- nothing, NOT EXISTS is true — and the profile is returned.
--
-- The policy was guarding against exactly the person who cannot see the
-- evidence it depends on. It would have passed any review that read it, and
-- it never worked once.
--
-- ── The fix ──
-- A SECURITY DEFINER function runs as its owner and is not subject to the
-- caller's RLS, so it can see the block row that the caller cannot. 0049
-- already established this pattern with is_blocked_between().
--
-- is_blocked_between() itself is NOT usable here: it checks both directions,
-- and 0054 is deliberately one-directional —
--
--     "The person who blocked keeps seeing the person they blocked — they have
--      to, or the Blocked Users screen would be a list of empty rows they
--      could never unblock."
--
-- Using it would hide each from the other and take that screen down, which is
-- the precise mistake 0054 wrote itself a note not to make. Hence a
-- one-directional helper.

create or replace function public.has_blocked(p_blocker uuid, p_blocked uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- One direction only: has p_blocker blocked p_blocked?
  select exists (
    select 1 from public.blocks
     where blocker_id = p_blocker
       and blocked_id = p_blocked
  );
$$;

revoke all on function public.has_blocked(uuid, uuid) from public;
-- anon as well as authenticated: the profiles policy applies to both, and a
-- policy that cannot call its own helper fails closed for signed-out visitors.
grant execute on function public.has_blocked(uuid, uuid) to authenticated, anon;


-- Same shape as 0054, same one-directional intent — the only change is that
-- the block check now goes through a function that can actually see blocks.
drop policy if exists "profiles read public" on public.profiles;
create policy "profiles read public" on public.profiles
  for select to authenticated, anon
  using (
    -- Always your own row.
    id = auth.uid()
    -- Signed out: nothing to block against.
    or auth.uid() is null
    -- Otherwise: hidden if THIS profile's owner has blocked the viewer.
    or not public.has_blocked(profiles.id, auth.uid())
  );


-- ── Verify ──
-- Structural check first, then the behavioural one, which is the one that
-- matters — the old policy passed every structural check there was.
select 'has_blocked() exists and is security definer' as check,
       case when exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'has_blocked' and p.prosecdef
       ) then 'OK' else 'MISSING' end as result
union all
select 'profiles policy now calls has_blocked',
       case when pg_get_expr(polqual, polrelid) like '%has_blocked%'
            then 'OK' else 'NOT UPDATED' end
  from pg_policy
 where polrelid = 'public.profiles'::regclass and polname = 'profiles read public'
union all
select 'still exactly one SELECT policy on profiles',
       case when (select count(*) from pg_policy
                   where polrelid = 'public.profiles'::regclass
                     and polcmd in ('r', '*')) = 1
            then 'OK' else 'MORE THAN ONE — they OR together' end
order by 1;

-- THE TEST THAT ACTUALLY PROVES IT, with two accounts:
--   1. Account A blocks account B.
--   2. As B, open A's profile directly. It must now be unavailable.
--   3. As A, open Settings > Privacy > Blocked users. B must still be listed
--      with a real name — if that list goes blank, the fix went too far and
--      took the one-directional rule with it.
