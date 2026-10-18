-- 0123 - a friends-only live is for friends (mutual follows)
--
-- Security review 2026-10, round 2: F01 leftover. Apply after 0122. Safe to
-- re-run.
--
-- The app's copy for a friends-only live is "Only your friends can join",
-- and everywhere else in FLYP a friend is a MUTUAL follow (0097; the settings
-- screen: "people you follow who follow you back"; the map since 0113). The
-- "live read" policy (0004, block check added in 0119) still let any
-- FOLLOWER see a friends-only live, and for a public account anyone can
-- follow. Now both follows must exist, written inline exactly as 0113 does
-- for locations: is_friend() is not executable by anon, and this policy is
-- evaluated for signed-out visitors too, where a call to it would raise
-- instead of answering. Inline EXISTS is the same rule.
--
-- request_to_join_live() (0103, SECURITY DEFINER) repeats the visibility
-- rule by hand; it is recreated from 0103 with the same change, so a
-- non-friend cannot ask to join a friends-only live by id either.
-- agora-token reads the stream as the user, so it follows this policy.

begin;

drop policy if exists "live read" on public.live_streams;
create policy "live read" on public.live_streams
  for select to authenticated, anon
  using (
    status <> 'banned' and (
      host_id = (select auth.uid())
      or (
        not public.has_blocked(live_streams.host_id, (select auth.uid()))
        and (
          privacy = 'public'
          or (
            privacy = 'friends'
            and exists (select 1 from public.follows
                         where follower_id = (select auth.uid())
                           and followed_id = live_streams.host_id)
            and exists (select 1 from public.follows
                         where follower_id = live_streams.host_id
                           and followed_id = (select auth.uid()))
          )
        )
      )
    )
  );

-- Latest request_to_join_live is 0103's; only the friends branch changes.
create or replace function public.request_to_join_live(p_live_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_stream public.live_streams%rowtype;
  v_row    public.live_guests%rowtype;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;

  select * into v_stream from public.live_streams where id = p_live_id;
  -- Same visibility as the "live read" policy (0123): a stream you could not
  -- see is reported as not found, not as forbidden.
  if not found
     or v_stream.status = 'banned'
     or not (v_stream.host_id = v_me
             or v_stream.privacy = 'public'
             or (v_stream.privacy = 'friends'
                 and exists (select 1 from public.follows f
                              where f.follower_id = v_me
                                and f.followed_id = v_stream.host_id)
                 -- 0123: friends are mutual follows.
                 and exists (select 1 from public.follows f
                              where f.follower_id = v_stream.host_id
                                and f.followed_id = v_me))) then
    raise exception 'live_not_found';
  end if;
  if v_stream.status <> 'live' then raise exception 'live_not_live'; end if;
  if v_stream.host_id = v_me then raise exception 'host_is_you'; end if;
  if public.is_blocked_between(v_stream.host_id, v_me) then raise exception 'blocked'; end if;

  select * into v_row from public.live_guests
   where live_id = p_live_id and user_id = v_me
   for update;

  if found then
    if v_row.status in ('requested', 'accepted') then
      return v_row.status;                       -- nothing to do
    elsif v_row.status = 'invited' then
      -- Both sides want it: asking to join while invited is accepting.
      perform public.live_guest_promote(p_live_id, v_me);
      perform public.live_guest_notify(v_stream.host_id, v_me, 'live_guest_accepted', p_live_id);
      return 'accepted';
    elsif v_row.status = 'removed' then
      raise exception 'removed_by_host';
    elsif v_row.updated_at > now() - interval '60 seconds' then
      raise exception 'too_soon';                -- 'left', changed a moment ago
    end if;

    update public.live_guests
       set status = 'requested', updated_at = now()
     where live_id = p_live_id and user_id = v_me;
  else
    insert into public.live_guests (live_id, user_id, status)
    values (p_live_id, v_me, 'requested');
  end if;

  perform public.live_guest_notify(v_stream.host_id, v_me, 'live_join_request', p_live_id);
  return 'requested';
end;
$$;
revoke all on function public.request_to_join_live(uuid) from public, anon;
grant execute on function public.request_to_join_live(uuid) to authenticated;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'live read: friends means mutual' as check,
       case when (select (length(e) - length(replace(e, 'follower_id', ''))) / length('follower_id')
                    from (select pg_get_expr(polqual, polrelid) as e from pg_policy
                           where polrelid = 'public.live_streams'::regclass
                             and polname = 'live read') q) >= 2
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'request_to_join_live: friends means mutual',
       case when pg_get_functiondef('public.request_to_join_live(uuid)'::regprocedure) like '%0123%'
            then 'OK' else 'NOT UPDATED' end
order by 1;
