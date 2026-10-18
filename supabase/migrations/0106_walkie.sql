-- 0106 - live walkie-talkie in a chat (client note 26)
--
-- Push-to-talk audio now goes through Agora: one channel per chat named
-- 'walkie_<chat id>'. The agora-token Edge Function must decide who may get a
-- token for it, and unlike a live stream even LISTENING is private, so both
-- roles are checked. That decision lives here, in one SECURITY DEFINER
-- function, so the Edge Function and any future caller agree:
--
--   walkie_allowed(chat) is true when the caller (auth.uid())
--     * is a member of the chat (chat_members);
--     * is not looking at an unanswered message request (chat_request_flags,
--       0043): a stranger's thread must be accepted before anyone can talk
--       into it live;
--     * in a one-to-one chat, has not blocked and is not blocked by the other
--       person (is_blocked_between, 0049).
--
-- Nothing is stored: no table, no rows. Presence and "is talking" ride the
-- realtime topic 'walkie:<chat id>' the web app already uses.
--
-- Safe to re-run: create or replace, and grants are idempotent.

begin;

create or replace function public.walkie_allowed(p_chat_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.chat_members
        where chat_id = p_chat_id and user_id = auth.uid()
     )
     and coalesce(
       (select f.is_request from public.chat_request_flags() f where f.chat_id = p_chat_id),
       false
     ) = false
     and not exists (
       select 1
         from public.chats c
         join public.chat_members o
           on o.chat_id = c.id and o.user_id <> auth.uid()
        where c.id = p_chat_id
          and c.type = 'dm'
          and public.is_blocked_between(auth.uid(), o.user_id)
     );
$$;

revoke all on function public.walkie_allowed(uuid) from public, anon;
grant execute on function public.walkie_allowed(uuid) to authenticated;

commit;

-- ── Verification ─────────────────────────────────────────────────────────
-- Run after applying. Every row should read OK.
select 'walkie_allowed function' as check,
       case when to_regprocedure('public.walkie_allowed(uuid)') is not null then 'OK' else 'MISSING' end as result
union all select 'security definer',
       case when (select prosecdef from pg_proc where oid = to_regprocedure('public.walkie_allowed(uuid)'))
            then 'OK' else 'NOT DEFINER' end
union all select 'callable by authenticated',
       case when has_function_privilege('authenticated', 'public.walkie_allowed(uuid)', 'execute')
            then 'OK' else 'MISSING GRANT' end
union all select 'not callable by anon',
       case when not has_function_privilege('anon', 'public.walkie_allowed(uuid)', 'execute')
            then 'OK' else 'EXPOSED' end
union all select 'dependencies (0043, 0049)',
       case when to_regprocedure('public.chat_request_flags()') is not null
             and to_regprocedure('public.is_blocked_between(uuid,uuid)') is not null
            then 'OK' else 'MISSING' end
-- No signed-in user in the SQL editor, so this must be false:
union all select 'refuses without a user',
       case when public.walkie_allowed('00000000-0000-0000-0000-000000000000'::uuid) = false
            then 'OK' else 'WRONG' end;
