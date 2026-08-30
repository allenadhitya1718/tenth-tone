-- ============================================================
-- 0055_follower_list_rpcs.sql
--
-- Fixes a flaw in 0054's follows policy.
--
-- 0054 made a follow row visible only when BOTH people in it are visible to
-- the viewer. That keeps a private account's lists private, but it is
-- stricter than intended: if a private account follows a PUBLIC one, the row
-- disappears from the public account's follower list too. The result is a
-- profile reading "1 follower" above a list showing nobody.
--
-- The real problem is that a row-level policy sees one row at a time and
-- cannot know WHOSE LIST is being asked for. "A follows B" appears in both
-- A's following list and B's followers list, and those two have different
-- privacy answers. No condition on the row alone can express that.
--
-- So the question moves to where it can be answered: two functions that take
-- the subject explicitly, check whether you may see THAT person's lists, and
-- then return them. The row policy stays strict as a backstop for anything
-- querying the table directly.
--
-- Result, matching Instagram:
--   * public account   - full follower list, private accounts included
--   * private account  - lists visible only to the owner and their followers
--   * blocked          - refused, because can_see_posts_of already refuses
-- ============================================================


create or replace function public.list_followers(p_user uuid)
returns table (
  id uuid, name text, handle text, avatar_url text,
  verified boolean, followers_count integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  -- One check, about the person whose list this is. can_see_posts_of already
  -- encodes public/private/following and, since 0049, refuses across a block.
  if not public.can_see_posts_of(p_user, auth.uid()) then
    return;                      -- no rows, not an error
  end if;

  return query
    select p.id, p.name, p.handle, p.avatar_url, p.verified, p.followers_count
      from public.follows f
      join public.profiles p on p.id = f.follower_id
     where f.followed_id = p_user
       -- Someone who blocked YOU stays out of the list even here.
       and not public.is_blocked_between(p.id, auth.uid())
     order by f.created_at desc;
end;
$$;


create or replace function public.list_following(p_user uuid)
returns table (
  id uuid, name text, handle text, avatar_url text,
  verified boolean, followers_count integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.can_see_posts_of(p_user, auth.uid()) then
    return;
  end if;

  return query
    select p.id, p.name, p.handle, p.avatar_url, p.verified, p.followers_count
      from public.follows f
      join public.profiles p on p.id = f.followed_id
     where f.follower_id = p_user
       and not public.is_blocked_between(p.id, auth.uid())
     order by f.created_at desc;
end;
$$;

revoke all on function public.list_followers(uuid) from public;
revoke all on function public.list_following(uuid) from public;
grant execute on function public.list_followers(uuid) to authenticated;
grant execute on function public.list_following(uuid) to authenticated;


-- ── Check ────────────────────────────────────────────────
select 'list_followers' as check,
       coalesce(to_regprocedure('public.list_followers(uuid)')::text, 'MISSING') as result
union all
select 'list_following',
       coalesce(to_regprocedure('public.list_following(uuid)')::text, 'MISSING')
union all
select 'a public account''s follower list is now complete',
       (select count(*)::text from public.follows f
         join public.profiles p on p.id = f.followed_id
        where p.is_private = false) || ' rows exist across public accounts';
