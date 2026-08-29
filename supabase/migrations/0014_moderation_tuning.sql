-- ============================================================
-- 0014_moderation_tuning.sql
--   1. Raise auto-hide threshold 3 -> 5 distinct reporters
--      (3 is brigade-able — a handful of coordinated/fake
--      accounts could take down a legitimate creator's video)
--   2. admin_unhide_content() RPC — the missing reversal path:
--      auto-hide with no appeal mechanism is a real gap, an
--      admin dismissing a false report must be able to restore
--      the content
--   3. Community Guidelines agreement gate — profiles.
--      guidelines_accepted_at, required before a user's first
--      publish (Apple Guideline 1.2 requires UGC apps to have
--      users agree that objectionable content will be removed)
-- ============================================================

-- ── 1. Raise the auto-hide threshold ──
create or replace function public.auto_hide_on_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_reports integer;
begin
  select count(distinct reporter_id) into v_recent_reports
  from public.reports
  where target_type = new.target_type
    and target_id = new.target_id
    and created_at >= now() - interval '24 hours';

  if v_recent_reports >= 5 then
    if new.target_type = 'video' then
      update public.videos
        set is_hidden = true, hidden_at = now(), hidden_reason = 'auto: reported ' || v_recent_reports || ' times'
        where id = new.target_id and is_hidden = false;
    elsif new.target_type = 'comment' then
      update public.comments
        set is_hidden = true, hidden_at = now(), hidden_reason = 'auto: reported ' || v_recent_reports || ' times'
        where id = new.target_id and is_hidden = false;
    end if;
  end if;

  return new;
end;
$$;

-- ── 2. Admin reversal path for auto-hidden content ──
create or replace function public.admin_unhide_content(
  p_target_type text,
  p_target_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  if p_target_type = 'video' then
    update public.videos set is_hidden = false, hidden_at = null, hidden_reason = null where id = p_target_id;
  elsif p_target_type = 'comment' then
    update public.comments set is_hidden = false, hidden_at = null, hidden_reason = null where id = p_target_id;
  else
    raise exception 'unsupported target_type for unhide';
  end if;

  insert into public.admin_logs (admin_id, action, target_type, target_id)
  values (auth.uid(), 'unhide_content', p_target_type, p_target_id);
end;
$$;

grant execute on function public.admin_unhide_content(text, uuid) to authenticated;

-- ── 3. Community Guidelines agreement gate ──
alter table public.profiles add column if not exists guidelines_accepted_at timestamptz;

create or replace function public.accept_guidelines()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set guidelines_accepted_at = now() where id = auth.uid();
end;
$$;

grant execute on function public.accept_guidelines() to authenticated;
