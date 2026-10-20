-- 0143: the Chat tab badge and inbox unread counts counted call-log rows
-- (type 'call': missed / declined / ended) as unread messages. Only real
-- messages count now. Same signature and grants as 0041, so nothing in the
-- app changes. NOT APPLIED yet.
create or replace function public.chat_unread_counts()
returns table (chat_id uuid, unread_count integer)
language sql
security definer
stable
set search_path = public
as $$
  select cm.chat_id,
         count(m.id)::integer as unread_count
    from public.chat_members cm
    left join public.messages m
           on m.chat_id = cm.chat_id
          and m.from_user_id <> cm.user_id
          and m.type <> 'call'                      -- call log rows are not messages
          and m.created_at > coalesce(cm.last_read_at, cm.joined_at)
   where cm.user_id = auth.uid()
   group by cm.chat_id;
$$;

revoke all on function public.chat_unread_counts() from public;
grant execute on function public.chat_unread_counts() to authenticated;
