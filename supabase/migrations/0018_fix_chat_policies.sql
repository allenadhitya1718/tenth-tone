-- ============================================================
-- 0018_fix_chat_policies.sql
-- Fixes messaging, which was completely broken.
--
-- Two problems:
--
-- 1. INFINITE RECURSION. The read policy on chat_members ran a subquery
--    against chat_members, so Postgres re-evaluated the same policy forever:
--      "infinite recursion detected in policy for relation chat_members"
--    Opening any DM failed with that error.
--
-- 2. NO INSERT POLICY. chat_members had only SELECT policies, so nobody
--    (except via admin policies) could ever add a member to a chat. Creating
--    a DM or a group could not work.
--
-- The fix is a security-definer helper. Because it runs as the definer it
-- does NOT re-trigger the caller's RLS, which breaks the recursion loop.
--
-- Apply in the Supabase SQL editor AFTER 0001..0017.
-- ============================================================

-- ── Helpers ──────────────────────────────────────────────
create or replace function public.is_chat_member(p_chat_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chat_members
     where chat_id = p_chat_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_chat_creator(p_chat_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chats
     where id = p_chat_id and created_by = auth.uid()
  );
$$;

revoke all on function public.is_chat_member(uuid)  from public;
revoke all on function public.is_chat_creator(uuid) from public;
grant execute on function public.is_chat_member(uuid)  to authenticated;
grant execute on function public.is_chat_creator(uuid) to authenticated;

-- ── chat_members ─────────────────────────────────────────
-- Read: your own row, or any row in a chat you belong to (via the helper,
-- so no recursion).
drop policy if exists "chat_members self read" on public.chat_members;
create policy "chat_members self read" on public.chat_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_chat_member(chat_id));

-- Insert: the person who created the chat may add members (including
-- themselves). This is what makes "New chat" and "New group" work at all.
drop policy if exists "chat_members insert by creator" on public.chat_members;
create policy "chat_members insert by creator" on public.chat_members
  for insert to authenticated
  with check (public.is_chat_creator(chat_id));

-- Delete: leave a chat yourself, or be removed by the chat's creator.
drop policy if exists "chat_members delete" on public.chat_members;
create policy "chat_members delete" on public.chat_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_chat_creator(chat_id));

-- ── chats ────────────────────────────────────────────────
drop policy if exists "chats members read" on public.chats;
create policy "chats members read" on public.chats
  for select to authenticated
  using (created_by = auth.uid() or public.is_chat_member(id));

-- Group name / photo edits by the creator.
drop policy if exists "chats update by creator" on public.chats;
create policy "chats update by creator" on public.chats
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- ── messages ─────────────────────────────────────────────
drop policy if exists "messages members read" on public.messages;
create policy "messages members read" on public.messages
  for select to authenticated
  using (public.is_chat_member(chat_id));

drop policy if exists "messages members insert" on public.messages;
create policy "messages members insert" on public.messages
  for insert to authenticated
  with check (auth.uid() = from_user_id and public.is_chat_member(chat_id));

drop policy if exists "messages delete own" on public.messages;
create policy "messages delete own" on public.messages
  for delete to authenticated
  using (auth.uid() = from_user_id);
