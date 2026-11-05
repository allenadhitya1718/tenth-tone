-- ============================================================
-- 0163 - any group member can add people, as on WhatsApp (owner report:
--        "in a group there is no option to add a member")
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0162.
-- Safe to re-run.
--
-- 0147 let only admins add members. WhatsApp's default is that every member
-- can add people, and an admin can switch that to "only admins". So:
--   chats.members_can_add  (default true): who may add people to the group
--   add_group_members()    admins always; members while members_can_add
--   set_group_members_can_add(chat, allow)   admins only, logged in the chat
-- All the other checks in add_group_members (blocks, who-can-message,
-- 256 members, 50 per call) are unchanged.
-- ============================================================

begin;

alter table public.chats add column if not exists members_can_add boolean not null default true;

create or replace function public.add_group_members(p_chat_id uuid, p_user_ids uuid[])
returns table (user_id uuid, status text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me      uuid := auth.uid();
  v_role    text;
  v_id      uuid;
  v_count   integer;
  v_added   jsonb := '[]'::jsonb;
  v_status  text;
begin
  -- 0163: a member may add people unless an admin turned that off.
  v_role := public.group_caller_role(p_chat_id, false);
  if v_role not in ('owner', 'admin')
     and not coalesce((select c.members_can_add from public.chats c where c.id = p_chat_id), true) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if coalesce(array_length(p_user_ids, 1), 0) > 50 then
    raise exception 'too_many' using errcode = '22023';
  end if;
  select count(*) into v_count from public.chat_members cm where cm.chat_id = p_chat_id;

  for v_id in select distinct u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u where u is not null loop
    if exists (select 1 from public.chat_members cm where cm.chat_id = p_chat_id and cm.user_id = v_id) then
      v_status := 'already_member';
    elsif not exists (select 1 from public.profiles p where p.id = v_id) then
      v_status := 'not_found';
    elsif public.is_blocked_between(v_id, v_me) then
      v_status := 'blocked';
    elsif not public.may_message(v_id, v_me) then
      v_status := 'not_allowed';
    elsif v_count >= 256 then
      v_status := 'group_full';
    else
      insert into public.chat_members (chat_id, user_id, role)
      values (p_chat_id, v_id, 'member')
      on conflict do nothing;
      v_count := v_count + 1;
      v_status := 'added';
      v_added := v_added || jsonb_build_array(
        jsonb_build_object('id', v_id, 'name', coalesce(public.group_display_name(v_id), '')));
    end if;
    user_id := v_id;
    status := v_status;
    return next;
  end loop;

  if jsonb_array_length(v_added) > 0 then
    perform public.group_system_message(p_chat_id, v_me,
      jsonb_build_object('group', 'added', 'targets', v_added));
  end if;
end;
$fn$;
revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;

create or replace function public.set_group_members_can_add(p_chat_id uuid, p_allow boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.group_caller_role(p_chat_id, true);
  update public.chats set members_can_add = coalesce(p_allow, true) where id = p_chat_id;
  return coalesce(p_allow, true);
end;
$fn$;
revoke all on function public.set_group_members_can_add(uuid, boolean) from public, anon;
grant execute on function public.set_group_members_can_add(uuid, boolean) to authenticated;

commit;

-- Checks (SELECT only)
select 'members_can_add column' as check,
       case when exists (select 1 from information_schema.columns where table_schema = 'public'
                          and table_name = 'chats' and column_name = 'members_can_add') then 'OK' else 'MISSING' end as result
union all
select 'add_group_members lets members add',
       case when pg_get_functiondef('public.add_group_members(uuid,uuid[])'::regprocedure) like '%members_can_add%' then 'OK' else 'MISSING' end
union all
select 'setter not callable by anon',
       case when not has_function_privilege('anon', 'public.set_group_members_can_add(uuid,boolean)', 'execute') then 'OK' else 'EXPOSED' end;
