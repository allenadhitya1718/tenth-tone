-- ============================================================
-- 0134_delivery_on_push.sql
--
-- Two grey ticks while the recipient's app is CLOSED (client note 10).
--
-- Until now chat_members.last_delivered_at (0099) was stamped only by the
-- recipient's running app (a realtime insert, the inbox load, opening the
-- chat). With the app closed nothing ran, so the sender saw one tick until
-- the other person next opened FLYP.
--
-- From here on the send-push Edge Function stamps it too: after a 'message'
-- push was ACCEPTED by Firebase Cloud Messaging or APNs for at least one of
-- the recipient's devices, it calls mark_delivered_by_push(notification_id).
--
-- Semantics of "delivered" (two grey ticks), now:
--   the recipient's app received the message (0099, unchanged), OR
--   the push provider accepted the message's push for one of their devices.
-- "Accepted" is the HTTP 200 from FCM / APNs: the provider holds it for the
-- device and hands it over as soon as the phone is reachable (FCM keeps it
-- up to 28 days, APNs keeps the latest one). A phone that is switched off
-- therefore shows ✓✓ a little early, which is how most messengers behave
-- with push-based receipts. No push (no token, notifications switched off
-- for messages, the provider refused) means no stamp: the app path still
-- stamps it when FLYP next runs.
--
-- The stamp is the MESSAGE's created_at (payload.message_id, 0093/0116),
-- not now(): a message sent while the push was in flight is not marked
-- delivered by a push that was not about it. Like 0099 it only moves
-- forward, and only writes (and broadcasts a realtime UPDATE to the sender)
-- when it actually moves.
--
-- Service role only: the Edge Function is the one caller. Users keep
-- mark_chat_delivered / mark_all_delivered (0099) for their own stamps.
--
-- Safe to re-run. Apply after 0099 (and 0116 for the payload shape).
-- ============================================================

begin;

create or replace function public.mark_delivered_by_push(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid;
  v_chat  uuid;
  v_stamp timestamptz;
  v_rows  integer;
begin
  select n.user_id,
         case when (n.payload->>'chat_id') ~* '^[0-9a-f-]{36}$'
              then (n.payload->>'chat_id')::uuid end,
         coalesce(
           (select m.created_at from public.messages m
             where m.id = case when (n.payload->>'message_id') ~* '^[0-9a-f-]{36}$'
                               then (n.payload->>'message_id')::uuid end),
           n.created_at)
    into v_user, v_chat, v_stamp
    from public.notifications n
   where n.id = p_notification_id
     and n.type = 'message';

  if v_user is null or v_chat is null then
    return false;
  end if;

  -- Never ahead of the database clock.
  v_stamp := least(v_stamp, now());

  update public.chat_members cm
     set last_delivered_at = v_stamp
   where cm.chat_id = v_chat
     and cm.user_id = v_user
     and (cm.last_delivered_at is null or cm.last_delivered_at < v_stamp);

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- Roles must be named (see 0073): `from public` alone leaves anon's grant.
revoke all on function public.mark_delivered_by_push(uuid) from public, anon, authenticated;
grant execute on function public.mark_delivered_by_push(uuid) to service_role;

commit;

-- ── Checks (every row should say OK) ───────────────────
select 'mark_delivered_by_push exists' as check,
       case when to_regprocedure('public.mark_delivered_by_push(uuid)') is not null
            then 'OK' else 'MISSING' end as result
union all select 'mark_delivered_by_push is security definer',
       case when (select prosecdef from pg_proc
                   where oid = to_regprocedure('public.mark_delivered_by_push(uuid)'))
            then 'OK' else 'NOT DEFINER' end
union all select 'mark_delivered_by_push not callable by users',
       case when not has_function_privilege('authenticated', 'public.mark_delivered_by_push(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.mark_delivered_by_push(uuid)', 'execute')
            then 'OK' else 'EXPOSED' end
union all select 'mark_delivered_by_push callable by service_role',
       case when has_function_privilege('service_role', 'public.mark_delivered_by_push(uuid)', 'execute')
            then 'OK' else 'MISSING' end
union all select 'chat_members.last_delivered_at present (0099)',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'chat_members'
                            and column_name = 'last_delivered_at')
            then 'OK' else 'APPLY 0099 FIRST' end;
