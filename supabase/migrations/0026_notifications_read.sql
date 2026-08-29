-- ============================================================
-- 0026_notifications_read.sql
-- Lets people mark their own notifications as read.
--
-- public.notifications had only a SELECT policy ("notifications own"),
-- so setting read_at was silently rejected - the update returned no
-- error but affected zero rows. That is why the unread badge could
-- never clear, and why nothing in the app ever tried.
--
-- Apply in the Supabase SQL editor AFTER 0001..0025.
-- ============================================================

drop policy if exists "notifications own update" on public.notifications;
create policy "notifications own update" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Clearing your own notification list is a normal thing to want.
drop policy if exists "notifications own delete" on public.notifications;
create policy "notifications own delete" on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());

-- Unread lookups run on every screen that shows the bell badge.
create index if not exists idx_notifs_unread
  on public.notifications (user_id, created_at desc)
  where read_at is null;
