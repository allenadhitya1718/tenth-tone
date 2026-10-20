-- 0141: reactions and "delete for everyone" reach the other phone live.
-- Idempotent. The app subscribes to DELETE on messages and to every change on
-- message_reactions (api/chat.ts subscribeToMessageChanges); both tables must
-- be in the realtime publication, and message_reactions needs REPLICA
-- IDENTITY FULL so a removed reaction still says which message it was on.
-- (messages stays on the default identity: the deleted row's id is enough.)

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
      alter publication supabase_realtime add table public.message_reactions;
    end if;
  end if;
end $$;

alter table public.message_reactions replica identity full;

-- Follow requests: the requester's "Requested" button clears live when the
-- other person approves or declines (the app listens for DELETE on this
-- table; the old row must carry requester_id and target_id).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'follow_requests') then
    alter publication supabase_realtime add table public.follow_requests;
  end if;
end $$;

alter table public.follow_requests replica identity full;
