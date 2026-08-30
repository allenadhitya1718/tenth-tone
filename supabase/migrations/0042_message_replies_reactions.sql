-- ============================================================
-- 0042_message_replies_reactions.sql
--
-- Two things a conversation needs once it has more than one thread of
-- discussion running, and which every messenger the users compare us to
-- already has:
--
--   1. Replying to a specific message, so an answer arriving ten messages
--      later still points at what it answers.
--   2. Reacting to a message, so a shared reel can be acknowledged without
--      sending "haha" as its own message.
--
-- Both hang off a single message, so they land together.
-- ============================================================

-- ── Replies ──────────────────────────────────────────────
-- Self reference. on delete set null rather than cascade: deleting the
-- quoted message must not delete the replies to it — the reply is still a
-- real thing somebody said. The UI renders a null target as "message
-- deleted" instead of vanishing.
alter table public.messages
  add column if not exists reply_to_id uuid
  references public.messages (id) on delete set null;

create index if not exists idx_messages_reply_to
  on public.messages (reply_to_id)
  where reply_to_id is not null;

-- ── Reactions ────────────────────────────────────────────
-- One reaction per person per message: the primary key enforces it, so
-- reacting again replaces rather than accumulates, which is how Instagram
-- and WhatsApp both behave. A set of counted emoji per message would need a
-- different key; this is deliberately the simpler model.
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists idx_message_reactions_message
  on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

-- Membership is checked through the message's chat. is_chat_member is the
-- security-definer helper from 0018 — calling chat_members directly from a
-- policy is what caused the infinite recursion that migration fixed.
drop policy if exists "reactions read" on public.message_reactions;
create policy "reactions read" on public.message_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = message_reactions.message_id
         and public.is_chat_member(m.chat_id)
    )
  );

drop policy if exists "reactions write own" on public.message_reactions;
create policy "reactions write own" on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
       where m.id = message_reactions.message_id
         and public.is_chat_member(m.chat_id)
    )
  );

drop policy if exists "reactions update own" on public.message_reactions;
create policy "reactions update own" on public.message_reactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "reactions delete own" on public.message_reactions;
create policy "reactions delete own" on public.message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Toggling a reaction ──────────────────────────────────
-- Tapping the emoji you already picked clears it; tapping a different one
-- swaps it. Doing that as one statement avoids the delete-then-insert round
-- trip and the flicker it causes.
create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_current text;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;

  -- Refuse a reaction to a message in a chat you are not in.
  if not exists (
    select 1 from public.messages m
     where m.id = p_message_id and public.is_chat_member(m.chat_id)
  ) then
    raise exception 'not a member of this chat';
  end if;

  select emoji into v_current
    from public.message_reactions
   where message_id = p_message_id and user_id = v_me;

  if v_current is not distinct from p_emoji then
    delete from public.message_reactions
     where message_id = p_message_id and user_id = v_me;
    return null;                       -- same emoji tapped again: cleared
  end if;

  insert into public.message_reactions (message_id, user_id, emoji)
  values (p_message_id, v_me, p_emoji)
  on conflict (message_id, user_id) do update set emoji = excluded.emoji,
                                                  created_at = now();
  return p_emoji;
end;
$$;

revoke all on function public.toggle_message_reaction(uuid, text) from public;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;

-- Realtime: without this the other person's reaction only appears on reload.
do $$
begin
  begin
    alter publication supabase_realtime add table public.message_reactions;
  exception
    when duplicate_object then null;   -- already published
    when undefined_object then null;   -- publication absent on this project
  end;
end $$;
