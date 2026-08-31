-- 0066 — the missing half of moderation: a filter that runs BEFORE publish
--
-- ── Why this exists ──
-- App Store Guideline 1.2 asks a user-generated-content app for four things.
-- FLYP has three of them and has had them for a long time:
--
--   (b) a way to report content        — public.reports + the admin queue
--   (c) a way to block abusive users   — public.blocks (0049, 0054, 0065)
--   (d) published contact information  — the marketing site and Support
--
-- The fourth, (a) "a method for filtering objectionable content", was missing.
-- Nothing screened anything. Every defence in this codebase is REACTIVE: it
-- needs a human to see the bad thing first and press a button. auto_hide_on_
-- report() (0012, retuned in 0014) does not fire until FIVE separate people
-- have reported the same item, which means the fifth person has already seen
-- it — and so have the four before them.
--
-- ── Why not 0015 ──
-- 0015_ai_moderation.sql was written for this and never applied. Two reasons,
-- and both still hold:
--
--   1. It was built around Sightengine, which starts at ~$29/month for video.
--   2. Its trigger calls extensions.http_post(), which needs pg_net. pg_net is
--      NOT enabled on this project (see the same warning in 0060 and 0064), so
--      the trigger would have been a silent no-op even if it had been applied.
--
-- 0015 stays unapplied. This migration replaces it and does not depend on
-- pg_net at all: nothing here makes an outbound call. The network hop happens
-- in the `moderate-content` Edge Function, invoked by the app on the way to
-- writing, and this file is only the record and the queue behind it.
--
-- ── What actually gets screened ──
-- OpenAI's /v1/moderations endpoint with omni-moderation-latest, which is free
-- to call and takes text AND images in one request. So:
--
--   text   — video descriptions, comments, live comments, live titles, profile
--            names and bios, group names, direct messages
--   images — avatars, group photos, live covers, and THREE SAMPLED FRAMES of
--            every uploaded video (25%, 50%, 75% of its duration)
--
-- What it does NOT screen, stated plainly because a half-true claim to an App
-- Review team is worse than a modest one: it does not watch a video end to end,
-- so something objectionable that appears only between the sampled frames is
-- not caught here; it does not listen to audio at all; and live video, once a
-- stream is running, is covered by its title and cover image plus reporting and
-- the admin kill switch, not by frame scanning.
--
-- ── Three outcomes, not two ──
--   block  — the write is refused and never reaches the database. Nothing to
--            review, so no report is created; the attempt is logged, and an
--            account that keeps trying earns a report against ITSELF.
--   review — the write is allowed and a report is queued. This is the band for
--            "probably fine, possibly not", and it is why the numbers matter
--            more than the boolean: `flagged` alone would either block far too
--            much or queue nothing.
--   allow  — nothing recorded beyond an aggregate. Ordinary posts are the
--            overwhelming majority and logging them all would bury the rest.
--
-- ── Fail OPEN, and say so ──
-- If OpenAI is unreachable, the key is missing, or the call times out, the
-- upload PROCEEDS and the event is written with outcome 'unavailable'. An app
-- that stops accepting posts because a third party is having an outage is a
-- worse app than one that queues a review, and a moderation layer that fails
-- closed will be switched off by the first person it inconveniences.
--
-- Failing open is only defensible if the failure is visible, so: publicly
-- visible content that could not be scanned gets a report in the SAME queue,
-- and admin_queue_counts() below grows a scans_unavailable_24h field. An
-- outage shows up as a number, not as silence.
--
-- Private direct messages are the exception and are never queued for review
-- even when the scan fails. They are still screened, and can still be blocked,
-- but a failed scan on a private conversation must not put that conversation
-- in front of an administrator.
--
-- ── Nothing here stores what anyone wrote ──
-- moderation_events keeps category names and scores. Not the comment, not the
-- message, not the image. The report row points at content that already exists
-- and is readable through the normal admin path; the event log is evidence
-- that a decision was made, not a second copy of the content.
--
-- ── Everything lands in the EXISTING queue ──
-- A flag is an ordinary row in public.reports with reporter_id NULL. That was
-- already the cheapest correct answer, because the surrounding machinery
-- happens to be exactly right for it:
--
--   * admin_queue_counts().open_reports already counts them, so the sidebar
--     badge in web/js/admin.js lights up with no change to that file
--   * check_report_rate() (0050) returns early when reporter_id is null, so
--     system flags cannot rate-limit themselves out
--   * auto_hide_on_report() (0014) counts DISTINCT reporter_id, and SQL's
--     count(distinct) skips nulls — so a machine flag can never, on its own,
--     take a creator's video down. It queues a human. That is the correct
--     behaviour and it comes for free.
--
-- Apply in the Supabase SQL editor AFTER 0001..0065. Safe to re-run.

-- ── The kill switch ──
-- A singleton, in a table rather than in code, so screening can be turned off
-- during an incident without redeploying the Edge Function — and so the
-- thresholds can be retuned the same way. RLS is on with NO policies at all,
-- which denies every ordinary client outright; only service_role and the
-- security-definer functions below can read it.
create table if not exists public.moderation_settings (
  id         boolean primary key default true check (id),

  -- false → the Edge Function returns 'allow' without calling anything. The
  -- app behaves exactly as it did before this migration.
  enabled    boolean not null default true,

  -- Per-category overrides for the Edge Function's built-in bars, as
  --   {"block": {"harassment": 0.95}, "review": 0.55}
  -- Empty means "use the defaults compiled into the function".
  thresholds jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now()
);

insert into public.moderation_settings (id) values (true) on conflict (id) do nothing;
alter table public.moderation_settings enable row level security;


-- ── The event log ──
-- One row per decision that was not a plain 'allow'. Written only by the
-- moderate-content Edge Function through moderation_log_event() below, using
-- the service role — never by a client, which is what makes it evidence.
create table if not exists public.moderation_events (
  id           uuid primary key default gen_random_uuid(),

  user_id      uuid references public.profiles (id) on delete set null,

  -- Which surface the content was headed for. Deliberately free text rather
  -- than a check constraint: a new surface should not need a migration before
  -- it can be screened, and an unrecognised value here is harmless.
  kind         text not null,

  outcome      text not null check (outcome in ('allow', 'review', 'block', 'unavailable')),

  -- category -> score, and ONLY for categories at or above the review bar.
  -- Never the content itself. See the privacy note in the header.
  categories   jsonb not null default '{}'::jsonb,
  top_category text,
  top_score    numeric(6, 4),

  had_image    boolean not null default false,

  -- Filled in afterwards by moderation_attach_target(), once the row the
  -- content became actually exists. Null means either 'block' (nothing was
  -- written) or a client that never came back — see the note on that function.
  target_type  text,
  target_id    uuid,
  report_id    uuid references public.reports (id) on delete set null,

  created_at   timestamptz not null default now()
);

create index if not exists idx_moderation_events_created
  on public.moderation_events (created_at desc);
create index if not exists idx_moderation_events_user
  on public.moderation_events (user_id, created_at desc);
create index if not exists idx_moderation_events_outcome
  on public.moderation_events (outcome, created_at desc);

alter table public.moderation_events enable row level security;

-- Read-only, admins only. There is deliberately no insert/update/delete policy:
-- writes go through the security-definer functions below and nowhere else.
drop policy if exists "moderation_events admin read" on public.moderation_events;
create policy "moderation_events admin read" on public.moderation_events
  for select to authenticated using (public.is_admin());


-- ── Record one decision ──
-- Called by the Edge Function with the service role. Returns the event id,
-- which the app hands back to moderation_attach_target() after the content row
-- exists.
--
-- The escalation at the bottom is the answer to a real gap: a blocked write
-- leaves nothing to review, so an account that tries ten times in an afternoon
-- would otherwise be invisible. Past a threshold the ACCOUNT becomes the
-- report. One open report per account at a time — repeat offences after that
-- keep landing in the log, but they do not clone the queue entry.
create or replace function public.moderation_log_event(
  p_user_id      uuid,
  p_kind         text,
  p_outcome      text,
  p_categories   jsonb   default '{}'::jsonb,
  p_top_category text    default null,
  p_top_score    numeric default null,
  p_had_image    boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id     uuid;
  v_blocks integer;
begin
  insert into public.moderation_events (
    user_id, kind, outcome, categories, top_category, top_score, had_image
  ) values (
    p_user_id, p_kind, p_outcome, coalesce(p_categories, '{}'::jsonb),
    p_top_category, p_top_score, coalesce(p_had_image, false)
  )
  returning id into v_id;

  if p_outcome = 'block' and p_user_id is not null then
    select count(*) into v_blocks
      from public.moderation_events
     where user_id = p_user_id
       and outcome = 'block'
       and created_at > now() - interval '24 hours';

    if v_blocks >= 5 and not exists (
      select 1 from public.reports
       where target_type = 'user'
         and target_id   = p_user_id
         and reporter_id is null
         and status      = 'pending'
    ) then
      insert into public.reports (reporter_id, target_type, target_id, reason)
      values (
        null, 'user', p_user_id,
        'فحص تلقائي: حاول هذا الحساب نشر محتوى مرفوض ' || v_blocks || ' مرات خلال ٢٤ ساعة'
      );
    end if;
  end if;

  return v_id;
end;
$fn$;

revoke all on function public.moderation_log_event(uuid, text, text, jsonb, text, numeric, boolean) from public, anon, authenticated;
grant execute on function public.moderation_log_event(uuid, text, text, jsonb, text, numeric, boolean) to service_role;


-- ── Category names in Arabic ──
-- The admin panel renders reports.reason verbatim, and the whole interface is
-- Arabic. A queue reading "sexual/minors" in the middle of Arabic text is
-- worse than useless to the person doing the reviewing.
create or replace function public.moderation_category_ar(p_category text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select case p_category
    when 'sexual'                 then 'محتوى جنسي'
    when 'sexual/minors'          then 'محتوى جنسي يشمل قاصرين'
    when 'harassment'             then 'تحرش أو إساءة'
    when 'harassment/threatening' then 'تحرش مع تهديد'
    when 'hate'                   then 'خطاب كراهية'
    when 'hate/threatening'       then 'خطاب كراهية مع تهديد'
    when 'illicit'                then 'نشاط غير قانوني'
    when 'illicit/violent'        then 'نشاط غير قانوني عنيف'
    when 'self-harm'              then 'إيذاء النفس'
    when 'self-harm/intent'       then 'نية إيذاء النفس'
    when 'self-harm/instructions' then 'إرشادات لإيذاء النفس'
    when 'violence'               then 'عنف'
    when 'violence/graphic'       then 'عنف صادم'
    else null
  end;
$fn$;

grant execute on function public.moderation_category_ar(text) to authenticated, service_role;


-- ── Point a queued event at the row the content became ──
-- Two-phase by necessity: the scan has to finish BEFORE the insert (or a block
-- would be pointless), but the id it needs to reference only exists AFTER it.
-- So the app calls this once the write succeeds, and the report materialises
-- then — which also means an abandoned draft never queues anything.
--
-- Three guards, because this is the one moderation function a client can call:
--
--   1. the event must belong to the caller — otherwise anyone could take
--      someone else's flagged event id and re-point it
--   2. the caller must OWN the target row. Without this, a malicious client
--      could attach its own flagged event to a rival's video and manufacture a
--      report against them. Ownership fails → the target is not recorded and
--      no report is created.
--   3. thirty minutes. An event id is not a standing licence to file reports.
--
-- Idempotent: a retry returns the report that already exists rather than
-- filing a second one.
create or replace function public.moderation_attach_target(
  p_event_id    uuid,
  p_target_type text,
  p_target_id   uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ev     public.moderation_events%rowtype;
  v_owns   boolean := false;
  v_report uuid;
  v_reason text;
begin
  if auth.uid() is null then return null; end if;

  select * into v_ev
    from public.moderation_events
   where id = p_event_id
     and user_id = auth.uid()
     and created_at > now() - interval '30 minutes';

  if not found then return null; end if;

  -- Already attached — hand back whatever was filed the first time.
  if v_ev.target_id is not null then return v_ev.report_id; end if;

  -- ── Does the caller actually own this? ──
  if p_target_type = 'video' then
    select exists (select 1 from public.videos where id = p_target_id and user_id = auth.uid()) into v_owns;
  elsif p_target_type = 'comment' then
    select exists (select 1 from public.comments where id = p_target_id and user_id = auth.uid()) into v_owns;
  elsif p_target_type = 'live_stream' then
    select exists (select 1 from public.live_streams where id = p_target_id and host_id = auth.uid()) into v_owns;
  elsif p_target_type = 'user' then
    v_owns := (p_target_id = auth.uid());
  end if;

  if not v_owns then return null; end if;

  update public.moderation_events
     set target_type = p_target_type, target_id = p_target_id
   where id = v_ev.id;

  -- 'allow' never reaches here, and 'block' never wrote anything to point at.
  if v_ev.outcome not in ('review', 'unavailable') then return null; end if;

  if v_ev.outcome = 'unavailable' then
    v_reason := 'فحص تلقائي: تعذّر فحص هذا المحتوى آليًا وقت النشر — يحتاج مراجعة بشرية';
  else
    v_reason := 'فحص تلقائي: قد يحتوي على '
                || coalesce(public.moderation_category_ar(v_ev.top_category), 'محتوى مخالف')
                || ' (درجة ' || coalesce(round(v_ev.top_score, 2)::text, '-') || ')';
  end if;

  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (null, p_target_type, p_target_id, v_reason)
  returning id into v_report;

  update public.moderation_events set report_id = v_report where id = v_ev.id;

  return v_report;
end;
$fn$;

revoke all on function public.moderation_attach_target(uuid, text, uuid) from public, anon;
grant execute on function public.moderation_attach_target(uuid, text, uuid) to authenticated;


-- ── The dashboard counts ──
-- Recreated from 0037 with three fields added. The six original keys are
-- unchanged and in the same order, so web/js/admin.js keeps working untouched:
-- it reads open_reports, open_tickets, pending_exports, pending_deletions,
-- live_now and banned_users by name, and additional keys are simply ignored.
--
-- open_reports already includes the machine flags — a flag IS a report — so
-- the existing badge starts counting them with no change to the panel. The new
-- keys separate out what only this layer can tell you:
--
--   ai_flags_pending      how much of the open queue came from screening
--   scans_unavailable_24h an OUTAGE COUNTER. Non-zero means content published
--                         unscanned in the last day. This is the number that
--                         makes failing open honest; if it climbs, either the
--                         key is wrong, the daily request cap was reached, or
--                         OpenAI is down.
--   content_blocked_24h   refusals — content that never reached the database
create or replace function public.admin_queue_counts()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;

  return jsonb_build_object(
    'open_reports',          (select count(*) from public.reports where status = 'pending'),
    'open_tickets',          (select count(*) from public.support_tickets where status in ('open', 'in_progress')),
    'pending_exports',       (select count(*) from public.data_export_requests where status = 'pending'),
    'pending_deletions',     (select count(*) from public.profiles where deletion_scheduled_at is not null),
    'live_now',              (select count(*) from public.live_streams where status = 'live'),
    'banned_users',          (select count(*) from public.profiles where banned_until is not null and banned_until > now()),
    'ai_flags_pending',      (select count(*) from public.reports where status = 'pending' and reporter_id is null),
    'scans_unavailable_24h', (select count(*) from public.moderation_events
                               where outcome = 'unavailable' and created_at > now() - interval '24 hours'),
    'content_blocked_24h',   (select count(*) from public.moderation_events
                               where outcome = 'block' and created_at > now() - interval '24 hours')
  );
end;
$fn$;

grant execute on function public.admin_queue_counts() to authenticated;


-- ── Recent decisions, for an admin screen ──
-- The queue shows what needs acting on. This shows what the layer has been
-- DOING, which is the only way to notice it has quietly stopped working: a
-- screening system that returns 'allow' to everything looks identical to a
-- well-behaved community until you look at the distribution.
create or replace function public.admin_moderation_recent(p_limit integer default 100)
returns table (
  id           uuid,
  created_at   timestamptz,
  kind         text,
  outcome      text,
  top_category text,
  top_score    numeric,
  had_image    boolean,
  target_type  text,
  target_id    uuid,
  user_name    text,
  user_handle  text
)
language sql
security definer
stable
set search_path = public
as $fn$
  select e.id, e.created_at, e.kind, e.outcome, e.top_category, e.top_score,
         e.had_image, e.target_type, e.target_id, p.name, p.handle
    from public.moderation_events e
    left join public.profiles p on p.id = e.user_id
   where public.is_admin()
   order by e.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$fn$;

grant execute on function public.admin_moderation_recent(integer) to authenticated;


-- ── Verify after running ─────────────────────────────────
-- ONE query, because the Supabase SQL editor only shows the result of the LAST
-- statement — a verify block split into several selects silently reports only
-- its final line, which has caught this project twice.
--
-- Every row should read OK. Anything else means this file did not finish, or a
-- migration it depends on is missing.
select 'moderation_settings table' as check,
       case when to_regclass('public.moderation_settings') is null then 'MISSING' else 'OK' end as result
union all
select 'moderation_settings seeded + enabled',
       coalesce((select case when enabled then 'OK' else 'OK (disabled)' end
                   from public.moderation_settings where id = true), 'MISSING ROW')
union all
select 'moderation_events table',
       case when to_regclass('public.moderation_events') is null then 'MISSING' else 'OK' end
union all
select 'moderation_events RLS on, admin-read only',
       case when (select relrowsecurity from pg_class where oid = 'public.moderation_events'::regclass)
             and (select count(*) from pg_policies where tablename = 'moderation_events') = 1
            then 'OK' else 'CHECK POLICIES' end
union all
select 'moderation_log_event()',
       coalesce(to_regprocedure('public.moderation_log_event(uuid,text,text,jsonb,text,numeric,boolean)')::text, 'MISSING')
union all
select 'moderation_attach_target()',
       coalesce(to_regprocedure('public.moderation_attach_target(uuid,text,uuid)')::text, 'MISSING')
union all
select 'moderation_category_ar()',
       coalesce(to_regprocedure('public.moderation_category_ar(text)')::text, 'MISSING')
union all
select 'admin_queue_counts() has the new keys',
       case when to_regprocedure('public.admin_queue_counts()') is null then 'MISSING'
            when pg_get_functiondef(to_regprocedure('public.admin_queue_counts()')::oid)
                 like '%scans_unavailable_24h%' then 'OK'
            else 'OLD VERSION STILL INSTALLED' end
union all
select 'admin_moderation_recent()',
       coalesce(to_regprocedure('public.admin_moderation_recent(integer)')::text, 'MISSING')
union all
select 'reports accepts a NULL reporter (system flags)',
       case when (select is_nullable from information_schema.columns
                   where table_schema = 'public' and table_name = 'reports'
                     and column_name = 'reporter_id') = 'YES'
            then 'OK' else 'reports.reporter_id IS NOT NULL — flags cannot be filed' end
union all
select 'check_report_rate() exempts system flags (0050)',
       case when to_regprocedure('public.check_report_rate()') is null then 'RUN 0050 FIRST'
            when pg_get_functiondef(to_regprocedure('public.check_report_rate()')::oid)
                 like '%reporter_id is null%' then 'OK'
            else 'system flags will hit the report rate limit' end
union all
select 'is_admin() exists (0002)',
       case when to_regprocedure('public.is_admin()') is null then 'RUN 0002 FIRST' else 'OK' end;

-- Then, and only then:
--
--   1. Set OPENAI_API_KEY in Supabase -> Edge Functions -> Secrets
--   2. npx supabase functions deploy moderate-content
--      (WITH jwt verification — no --no-verify-jwt. The caller is a signed-in
--       person and the log has to know who they are.)
--   3. Post a harmless comment from the app, then:
--        select count(*) from public.moderation_events;
--      Zero is CORRECT for clean content — only non-'allow' decisions are
--      logged. To prove the pipeline end to end, temporarily flip the function
--      to log allows, or post something the model will flag and confirm the
--      block reaches you as an Arabic message rather than a silent failure.
--   4. Watch scans_unavailable_24h in the admin dashboard for the first day.
--      Steadily non-zero means the key or the quota is wrong, not that the
--      internet is broken.
