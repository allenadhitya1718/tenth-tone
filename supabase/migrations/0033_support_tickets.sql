-- ============================================================
-- 0033_support_tickets.sql
--
-- "Report a problem" and "Contact us" opened a mailto: link, which does
-- nothing in the app webview - the buttons appeared dead. Worse, anything
-- that did send went to an inbox with no record in the product.
--
-- Reports now land in a table you can actually work through.
--
-- Note: public.reports already exists and is for moderation - reporting a
-- video, comment, user or stream. This is a different thing: a person
-- telling you the app is broken.
--
-- Apply in the Supabase SQL editor AFTER 0001..0032.
-- ============================================================

create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete set null,

  category    text not null default 'other'
              check (category in ('bug', 'account', 'payment', 'content', 'safety', 'other')),
  subject     text,
  message     text not null,

  -- Captured automatically. Half of support is working out what they were on.
  app_version text,
  device      text,

  status      text not null default 'open'
              check (status in ('open', 'in_progress', 'resolved', 'closed')),
  admin_reply text,
  replied_at  timestamptz,
  replied_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_support_status
  on public.support_tickets (status, created_at desc);
create index if not exists idx_support_user
  on public.support_tickets (user_id, created_at desc);

alter table public.support_tickets enable row level security;

-- You can raise a ticket and read your own; admins see everything.
drop policy if exists "support insert own" on public.support_tickets;
create policy "support insert own" on public.support_tickets
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "support read own or admin" on public.support_tickets;
create policy "support read own or admin" on public.support_tickets
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists "support admin update" on public.support_tickets;
create policy "support admin update" on public.support_tickets
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));


-- ── Don't let one person flood the queue ──
create or replace function public.check_support_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare n integer;
begin
  select count(*) into n
    from public.support_tickets
   where user_id = new.user_id
     and created_at > now() - interval '1 hour';

  if n >= 5 then
    raise exception 'too many reports, try again later';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_support_rate_limit on public.support_tickets;
create trigger trg_support_rate_limit
  before insert on public.support_tickets
  for each row execute function public.check_support_rate_limit();


-- ── Tell the person when you reply ──
create or replace function public.notify_on_support_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.admin_reply is not null
     and new.admin_reply is distinct from old.admin_reply
     and new.user_id is not null then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (new.user_id, new.replied_by, 'system',
            jsonb_build_object('ticket_id', new.id,
                               'text', left(new.admin_reply, 120)));
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_notify_support_reply on public.support_tickets;
create trigger trg_notify_support_reply
  after update on public.support_tickets
  for each row execute function public.notify_on_support_reply();
