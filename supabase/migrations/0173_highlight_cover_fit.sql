-- 0173: how a highlight's / voice clip's cover is shown (owner, 14 Nov 2026:
-- "the img is only shown in a small centre of the screen ... choose ...
-- whole screen or just horizontal or vertical or centre").
--
-- 1. live_highlights.cover_fit: 'square' (the old look: a square in the
--    middle), 'tall' (a portrait card), 'wide' (a landscape card) or 'full'
--    (the photo fills the whole page). Existing rows stay 'square'.
-- 2. set_highlight_cover_fit(p_id, p_fit): the host sets it, right after
--    posting (the app calls it when the choice is not 'square'). The two
--    create functions are left as they are, so older app versions keep
--    working unchanged.
--
-- Safe to re-run. Applied to FLYP (vfkwipvinmnybilcrdzr) on 15 Nov 2026.

begin;

alter table public.live_highlights
  add column if not exists cover_fit text not null default 'square';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'live_highlights_cover_fit_check'
  ) then
    alter table public.live_highlights
      add constraint live_highlights_cover_fit_check
      check (cover_fit in ('square', 'tall', 'wide', 'full'));
  end if;
end $$;

create or replace function public.set_highlight_cover_fit(p_id uuid, p_fit text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_fit is null or p_fit not in ('square', 'tall', 'wide', 'full') then
    raise exception 'bad_cover_fit' using errcode = '22023';
  end if;
  update public.live_highlights
     set cover_fit = p_fit
   where id = p_id and host_id = v_me;
  if not found then
    raise exception 'not_host' using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.set_highlight_cover_fit(uuid, text) from public, anon;
grant execute on function public.set_highlight_cover_fit(uuid, text) to authenticated;

commit;
