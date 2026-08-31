// =============================================================
// moderate-content
//
// The screening layer. Everything on the way INTO the database that a stranger
// can end up looking at passes through here first.
//
// Read 0066_content_moderation.sql before this file — it carries the reasoning
// for the whole design, and this is only the network hop.
//
// ── Why an Edge Function and not a database trigger ──
// 0015_ai_moderation.sql tried the trigger route and was never applied. Its
// trigger calls extensions.http_post(), which needs pg_net, and pg_net is not
// enabled on this project (0060 and 0064 both say so). A trigger also fires
// AFTER the insert, which is the wrong side of the decision: by then the row
// exists and the only thing left to do is hide it again.
//
// So the check happens before the write, and it happens here rather than in the
// browser for the same reason the R2 credentials live in media-upload: the key
// must never be in a shipped bundle. web/js/moderation.js calls this; it holds
// no key and can be read by anyone.
//
// ── Why OpenAI ──
// /v1/moderations with omni-moderation-latest is free to call, and it takes
// text and images in the SAME request — which is what makes screening a video
// affordable at all: three sampled frames plus the description are one call.
// Sightengine, which 0015 was built around, starts at ~$29/month for video.
//
// Free is not unlimited. A free-tier OpenAI account is capped around 250
// requests/minute and 5,000/day; a paid account raises that considerably. One
// call per post, comment, message or profile edit, so 5,000/day is generous for
// a launch and absolutely not generous forever. When the cap is hit OpenAI
// answers 429, this function fails open, and scans_unavailable_24h in the admin
// dashboard starts climbing. That counter is how you find out — watch it.
//
// ── Fail OPEN ──
// No key, a timeout, a 429, a 500, a malformed answer: the content is ALLOWED
// and the event is recorded as 'unavailable'. An app that refuses to accept
// posts because a third party is having an afternoon is a worse app. The cost
// of that choice is paid in the admin queue, not in a broken upload — see
// moderation_attach_target() in 0066.
//
// ── Secrets (Supabase -> Edge Functions -> Secrets) ──
//
//   OPENAI_API_KEY   REQUIRED. platform.openai.com -> API keys. This is the
//                    ONLY place it may exist. Never in web/, never in a
//                    migration, never in the repo. Rotating it is a secret
//                    change and a redeploy, nothing else.
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected by
// the platform. The service role is needed for moderation_log_event(), which is
// granted to service_role alone so that no client can forge a decision.
//
// ── Deploy WITH jwt verification (the default) ──
//
//   npx supabase functions deploy moderate-content
//
// Deliberately unlike storage-alert, which is called by a scheduler and needs
// --no-verify-jwt. This one is called by a signed-in person and the log has to
// record WHO — the repeat-offender escalation in moderation_log_event() is
// worthless without a user id. Never add --no-verify-jwt here.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

// Trimmed for the reason spelled out in media-upload: secrets are pasted by
// hand into a web form, and a stray space survives that journey silently. Here
// it would produce a 401 from OpenAI on every single call — which, because this
// fails open, would look exactly like "moderation is working and nothing is bad".
const env = (k: string) => (Deno.env.get(k) ?? '').trim();

const OPENAI_API_KEY = env('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── The bars ──
// A score at or above the number below is refused outright. These are NOT the
// model's own `flagged` boolean, which is tuned for "would OpenAI's own
// products decline this" and is far too eager for a social app: ordinary heated
// Arabic between friends trips `harassment` regularly, and blocking on it would
// have people convinced the app is broken.
//
// So: `flagged` is ignored as a decision, the numbers decide, and each category
// gets the bar it deserves.
//
//   sexual/minors is 0.20 — a hair-trigger, deliberately. There is no
//   acceptable false-negative rate here and a false positive costs one annoyed
//   person one post.
//
//   harassment is 0.92 — the loosest, because it is the noisiest. Anything
//   above the review bar still reaches a human; this is only the line past
//   which the app stops asking and says no.
//
// Overridable per category from public.moderation_settings.thresholds without
// redeploying:  {"block": {"harassment": 0.95}, "review": 0.5}
const BLOCK_DEFAULT: Record<string, number> = {
  'sexual/minors': 0.20,
  'hate/threatening': 0.60,
  'self-harm/instructions': 0.60,
  'harassment/threatening': 0.70,
  'self-harm/intent': 0.70,
  'illicit/violent': 0.70,
  'sexual': 0.80,
  'violence/graphic': 0.85,
  'hate': 0.85,
  'self-harm': 0.85,
  'violence': 0.90,
  'illicit': 0.90,
  'harassment': 0.92,
};

// Below the block bar but at or above this: publish it, and put it in front of
// a human. The whole point of having a middle band.
const REVIEW_DEFAULT = 0.40;

// ── Which surfaces feed the review queue ──
// Every kind is screened and every kind can be BLOCKED. `queue` decides only
// whether a borderline item also becomes a row in public.reports.
//
// The three false ones are not oversights:
//   message      — a private conversation between two people. Screened, and a
//                  severe message is still refused, but a borderline one must
//                  not be placed in front of an administrator. Blocking is a
//                  safety measure; queueing would be surveillance.
//   group        — same reasoning, for a private group's name and photo.
//   live_comment — ephemeral and high volume. Queueing borderline live chat
//                  would bury the queue in minutes and drown the reports that
//                  matter. Severe ones are still blocked as they are typed.
//
// `target` is the public.reports.target_type the app should attach the event
// to. The column's check constraint only accepts these four values, which is
// why a flagged bio reports the ACCOUNT rather than inventing a 'profile' type.
const SURFACE: Record<string, { queue: boolean; target: string | null }> = {
  video:        { queue: true,  target: 'video' },
  comment:      { queue: true,  target: 'comment' },
  live_title:   { queue: true,  target: 'live_stream' },
  live_cover:   { queue: true,  target: 'live_stream' },
  profile:      { queue: true,  target: 'user' },
  avatar:       { queue: true,  target: 'user' },
  message:      { queue: false, target: null },
  group:        { queue: false, target: null },
  live_comment: { queue: false, target: null },
};

const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 1_500_000;   // ~1.1 MB of bytes once base64 is undone
const MAX_TEXT_CHARS = 8_000;

// Settings change roughly never and this runs on every post. Cached per warm
// instance for a minute: flipping `enabled` during an incident takes effect
// within 60 seconds everywhere, which is fast enough for a kill switch and
// saves a round trip on the hot path.
let settingsCache: { at: number; enabled: boolean; block: Record<string, number>; review: number } | null = null;

// deno-lint-ignore no-explicit-any
async function loadSettings(db: any) {
  if (settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache;

  const fallback = { at: Date.now(), enabled: true, block: BLOCK_DEFAULT, review: REVIEW_DEFAULT };
  try {
    const { data, error } = await db
      .from('moderation_settings')
      .select('enabled, thresholds')
      .eq('id', true)
      .single();
    if (error || !data) {
      // The migration has not been run yet. Screening still works — it simply
      // uses the compiled-in bars and cannot be switched off from the database.
      settingsCache = fallback;
      return settingsCache;
    }
    const t = (data.thresholds ?? {}) as Record<string, unknown>;
    settingsCache = {
      at: Date.now(),
      enabled: data.enabled !== false,
      block: { ...BLOCK_DEFAULT, ...(t.block as Record<string, number> ?? {}) },
      review: typeof t.review === 'number' ? t.review : REVIEW_DEFAULT,
    };
    return settingsCache;
  } catch {
    settingsCache = fallback;
    return settingsCache;
  }
}

type Verdict = {
  outcome: 'allow' | 'review' | 'block';
  categories: Record<string, number>;
  topCategory: string | null;
  topScore: number;
};

// Takes the WORST score seen for each category across every result the API
// returned, then compares each against its own bar.
//
// Written to survive either response shape. The documented behaviour is one
// result per element of the input array, so four parts (a description and three
// frames) come back as four results — but a single merged result for a
// multimodal input would be handled identically, because this only ever folds
// scores together and never indexes into the array.
function judge(results: any[], block: Record<string, number>, review: number): Verdict {
  const scores: Record<string, number> = {};

  for (const r of results || []) {
    const cs = (r && r.category_scores) || {};
    for (const key of Object.keys(cs)) {
      // illicit and illicit/violent are documented as sometimes null. A null
      // must read as "no signal", not as NaN quietly poisoning a comparison.
      const v = Number(cs[key]);
      if (!Number.isFinite(v)) continue;
      if (!(key in scores) || v > scores[key]) scores[key] = v;
    }
  }

  let outcome: Verdict['outcome'] = 'allow';
  let topCategory: string | null = null;
  let topScore = 0;
  const kept: Record<string, number> = {};

  for (const [key, score] of Object.entries(scores)) {
    const bar = block[key];
    const hitBlock = bar != null && score >= bar;
    if (hitBlock) outcome = 'block';

    // `|| hitBlock` is not redundant. sexual/minors blocks at 0.20, which is
    // BELOW the review bar — so without it, a refusal at 0.25 would be recorded
    // with no category and no score at all, and the event log would say
    // "blocked" while refusing to say why.
    if (score >= review || hitBlock) {
      kept[key] = Number(score.toFixed(4));
      // "Top" means furthest past its OWN bar, not the largest raw number. A
      // 0.35 on sexual/minors matters more than a 0.7 on harassment, and
      // sorting by the raw score would put the wrong one in the queue's reason
      // line — which is the one thing a reviewer reads before opening the item.
      const bias = bar != null ? score / bar : score;
      const topBias = topCategory != null
        ? (block[topCategory] != null ? topScore / block[topCategory] : topScore)
        : -1;
      if (bias > topBias) { topCategory = key; topScore = score; }
    }
  }

  if (outcome !== 'block' && topCategory != null) outcome = 'review';

  return { outcome, categories: kept, topCategory, topScore };
}

const BLOCK_MESSAGE = 'لا يمكن نشر هذا المحتوى لأنه يخالف إرشادات المجتمع';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not_configured' }, 500);

  // ── Who is asking ──
  // The caller's own token. moderation_log_event() records the user id, and the
  // repeat-offender escalation is built on it, so an anonymous caller has
  // nothing to attribute a decision to and is refused.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json({ error: 'unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const kind = String(body.kind ?? '');
  // An unknown kind is screened as a public surface but never queued. Failing
  // towards "check it, do not file it" keeps a typo in the app from either
  // skipping the scan or spamming the queue.
  const surface = SURFACE[kind] ?? { queue: false, target: null };

  const text = String(body.text ?? '').slice(0, MAX_TEXT_CHARS).trim();
  const rawImages = Array.isArray(body.images) ? body.images : [];
  const images = rawImages
    .filter((s) => typeof s === 'string' && s.length > 0 && s.length <= MAX_IMAGE_CHARS)
    .slice(0, MAX_IMAGES) as string[];

  if (!text && !images.length) return json({ decision: 'allow', eventId: null, attach: false });

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Logging is best-effort by design. A decision that could not be recorded is
  // still a decision, and losing the audit trail must never turn into refusing
  // a legitimate post.
  async function log(outcome: string, v?: Verdict): Promise<string | null> {
    try {
      const { data, error } = await db.rpc('moderation_log_event', {
        p_user_id: user.id,
        p_kind: kind || 'unknown',
        p_outcome: outcome,
        p_categories: v?.categories ?? {},
        p_top_category: v?.topCategory ?? null,
        p_top_score: v?.topScore ?? null,
        p_had_image: images.length > 0,
      });
      if (error) { console.error('[moderate-content] log failed:', error.message); return null; }
      return (data as string) ?? null;
    } catch (e) {
      console.error('[moderate-content] log threw:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  const settings = await loadSettings(db);

  // ── Kill switch ──
  // Not logged as 'unavailable'. Screening being deliberately off is a
  // decision someone made, not an outage, and mixing the two would make the
  // outage counter lie.
  if (!settings.enabled) {
    return json({ decision: 'allow', eventId: null, attach: false, disabled: true });
  }

  if (!OPENAI_API_KEY) {
    const eventId = await log('unavailable');
    return json({
      decision: 'allow', eventId, attach: surface.queue && !!eventId,
      target: surface.target, degraded: true, reason: 'no_key',
    });
  }

  // ── The one call ──
  // Text and every image in a single request: one description plus three
  // sampled video frames is ONE call against the daily cap, not four.
  const input: unknown[] = [];
  if (text) input.push({ type: 'text', text });
  for (const url of images) input.push({ type: 'image_url', image_url: { url } });

  // Images make this slower and there is a person watching a spinner at the
  // other end. Past the timeout the upload proceeds unscanned rather than
  // stalling; that is the fail-open promise being kept literally.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), images.length ? 20_000 : 8_000);

  let results: any[] | null = null;
  let failure = 'unknown';
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // 429 is the daily or per-minute cap and is the failure most likely to
      // be seen in practice. Named separately in the log so "we outgrew the
      // free tier" is distinguishable from "OpenAI was down".
      failure = res.status === 429 ? 'rate_limited' : `http_${res.status}`;
      console.warn('[moderate-content] OpenAI', res.status, (await res.text()).slice(0, 300));
    } else {
      const payload = await res.json();
      if (Array.isArray(payload?.results) && payload.results.length) results = payload.results;
      else failure = 'empty_response';
    }
  } catch (e) {
    failure = (e as Error)?.name === 'AbortError' ? 'timeout' : 'network';
    console.warn('[moderate-content] call failed:', failure, e instanceof Error ? e.message : e);
  } finally {
    clearTimeout(timeout);
  }

  // ── Unreachable: allow, and make the gap visible ──
  if (!results) {
    const eventId = await log('unavailable');
    return json({
      decision: 'allow', eventId, attach: surface.queue && !!eventId,
      target: surface.target, degraded: true, reason: failure,
    });
  }

  const verdict = judge(results, settings.block, settings.review);

  if (verdict.outcome === 'allow') {
    // Not logged. Ordinary content is nearly all content, and a row per post
    // would turn the event table into a firehose that hides the decisions that
    // actually mattered.
    return json({ decision: 'allow', eventId: null, attach: false });
  }

  const eventId = await log(verdict.outcome, verdict);

  if (verdict.outcome === 'block') {
    return json({
      decision: 'block',
      eventId,
      attach: false,
      // Arabic, and deliberately unspecific. Naming the exact category and
      // score teaches someone determined precisely how far to dial it back to
      // get under the bar.
      message: BLOCK_MESSAGE,
      category: verdict.topCategory,
    });
  }

  // review — publish it, and queue it. The app calls
  // moderation_attach_target() with the new row's id once the write lands.
  return json({
    decision: 'review',
    eventId,
    attach: surface.queue && !!eventId,
    target: surface.target,
    category: verdict.topCategory,
  });
});
