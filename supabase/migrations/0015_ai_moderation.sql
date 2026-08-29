-- ============================================================
-- 0015_ai_moderation.sql
-- Instant-publish + async AI content scan. Videos go public
-- immediately on upload (no pre-publish gate); this migration
-- adds the pipeline that scans them in parallel and auto-hides
-- flagged content within seconds of the scan completing, using
-- the same is_hidden mechanism the report system already uses.
--
-- Deploy steps (once you have a live Supabase project + a
-- moderation API account, e.g. Sightengine):
--   1. Run this migration.
--   2. Deploy the two edge functions in supabase/functions/
--      (moderate-video, moderate-video-callback).
--   3. Run:
--        update public.moderation_config set
--          edge_function_url = 'https://<project-ref>.supabase.co/functions/v1/moderate-video',
--          shared_secret = '<a random secret you generate>',
--          enabled = true
--        where id = true;
--      and set the same secret + your Sightengine API creds as
--      env vars/secrets on both edge functions.
--   Until step 3 is done, videos publish exactly as they do
--   today — this pipeline is inert (no-op) by default, so it's
--   safe to deploy ahead of having the API account.
-- ============================================================

create extension if not exists pg_net with schema extensions;

-- Singleton config row — kept in a table (not hardcoded) so the
-- edge function URL / secret can be set post-deploy without a
-- new migration, and so the secret never appears in application
-- code or client bundles (RLS below blocks anon/authenticated
-- access entirely; only service_role / the Postgres role bypass it).
create table if not exists public.moderation_config (
  id                boolean primary key default true check (id),
  edge_function_url text,
  shared_secret     text,
  enabled           boolean not null default false
);
insert into public.moderation_config (id, enabled) values (true, false) on conflict (id) do nothing;
alter table public.moderation_config enable row level security;
-- Intentionally no policies: no role except service_role/postgres (which bypass RLS) can read this table.

-- ── ai_flag_video: called by the moderation callback function
-- with the Supabase service role key, never by client code. ──
create or replace function public.ai_flag_video(
  p_video_id uuid,
  p_reason   text default 'AI moderation flagged this content'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.videos
    set is_hidden = true, hidden_at = now(), hidden_reason = p_reason
    where id = p_video_id and is_hidden = false;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (null, 'ai_auto_hide', 'video', p_video_id, jsonb_build_object('reason', p_reason));
end;
$$;

revoke all on function public.ai_flag_video(uuid, text) from public, authenticated, anon;
grant execute on function public.ai_flag_video(uuid, text) to service_role;

-- ── Trigger: fires the moderation scan the instant a video is
-- published. No-op (returns immediately) if moderation_config
-- isn't set up yet, so this is safe to deploy before step 3 above. ──
create or replace function public.trigger_ai_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg record;
begin
  if new.is_draft = true or new.video_url is null then
    return new;
  end if;

  select * into cfg from public.moderation_config where id = true;
  if cfg is null or cfg.enabled is not true or cfg.edge_function_url is null then
    return new; -- not configured yet — video stays live, relies on user-report moderation only
  end if;

  perform extensions.http_post(
    url     := cfg.edge_function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-moderation-secret', cfg.shared_secret),
    body    := jsonb_build_object('video_id', new.id, 'video_url', new.video_url)
  );

  return new;
end;
$$;

drop trigger if exists tr_ai_moderation on public.videos;
create trigger tr_ai_moderation
  after insert on public.videos
  for each row execute function public.trigger_ai_moderation();
