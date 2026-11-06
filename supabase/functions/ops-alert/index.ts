// =============================================================
// ops-alert
//
// The incident queue for the auto-fix service (0165, infra/auto-fix).
//
//   POST /ops-alert?key=<OPS_ALERT_SECRET>   an alert from Better Stack or
//        Sentry (their webhook integrations). Filed once per open problem;
//        a "resolved" alert closes it if nobody picked it up yet.
//   POST /ops-alert/claim      the laptop worker takes the next incident.
//   POST /ops-alert/finish     {id, status, result} the worker reports back.
//        Both worker calls need the header x-ops-worker: <OPS_WORKER_SECRET>.
//
// Secrets (Supabase -> Edge Functions -> Secrets), long random strings:
//   OPS_ALERT_SECRET   goes in the webhook URLs given to Better Stack/Sentry.
//   OPS_WORKER_SECRET  only on the owner's laptop (infra/auto-fix/.env).
// Two different secrets: a leaked webhook URL can file noise, but it can
// never read the queue or mark things fixed.
//
// DEPLOY WITH --no-verify-jwt (the callers have no Supabase login):
//   npx supabase functions deploy ops-alert --no-verify-jwt
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_DETAILS = 20_000;

function same(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Parsed = { source: string; key: string; title: string; resolved: boolean };

// Better Stack incident webhooks, Sentry issue alerts, or anything with a
// title/message (manual tests).
function parseAlert(body: Record<string, unknown>): Parsed {
  const data = (body.data ?? {}) as Record<string, unknown>;
  const attrs = (data.attributes ?? {}) as Record<string, unknown>;
  if (data.type === 'incident' || attrs.cause !== undefined) {
    const id = String(data.id ?? attrs.name ?? 'unknown');
    const status = String(attrs.status ?? '').toLowerCase();
    const name = String(attrs.name ?? attrs.url ?? 'Monitor down');
    const cause = attrs.cause ? ` (${String(attrs.cause)})` : '';
    return { source: 'betterstack', key: `betterstack:${id}`, title: `${name}${cause}`, resolved: status === 'resolved' };
  }
  const issue = (data.issue ?? data.event ?? null) as Record<string, unknown> | null;
  if (issue || body.project_name || body.culprit !== undefined) {
    const src = issue ?? body;
    const id = String(src.id ?? src.issue_id ?? src.title ?? body.message ?? 'unknown');
    const title = String(src.title ?? body.message ?? 'Sentry issue');
    const action = String(body.action ?? '');
    return { source: 'sentry', key: `sentry:${id}`, title, resolved: action === 'resolved' };
  }
  const title = String(body.title ?? body.message ?? 'Alert');
  return { source: String(body.source ?? 'manual'), key: `manual:${title}`, title, resolved: body.resolved === true };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const url = new URL(req.url);
  const route = url.pathname.split('/').filter(Boolean).pop();

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // ---------- worker ----------
  if (route === 'claim' || route === 'finish') {
    if (!same(req.headers.get('x-ops-worker') ?? '', Deno.env.get('OPS_WORKER_SECRET') ?? '')) {
      return json({ error: 'forbidden' }, 403);
    }
    if (route === 'claim') {
      const { data, error } = await db.rpc('ops_claim_incident');
      if (error) return json({ error: error.message }, 500);
      return json({ incident: Array.isArray(data) && data.length ? data[0] : null });
    }
    const b = (await req.json().catch(() => ({}))) as { id?: number; status?: string; result?: string };
    if (!b.id || !b.status) return json({ error: 'id and status needed' }, 400);
    const { data, error } = await db.rpc('ops_finish_incident', {
      p_id: b.id,
      p_status: b.status,
      p_result: String(b.result ?? ''),
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: data === true });
  }

  // ---------- incoming alert ----------
  if (!same(url.searchParams.get('key') ?? '', Deno.env.get('OPS_ALERT_SECRET') ?? '')) {
    return json({ error: 'forbidden' }, 403);
  }
  const raw = await req.text();
  if (raw.length > 200_000) return json({ error: 'too large' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return json({ error: 'not json' }, 400);
  }
  const a = parseAlert(body);
  if (a.resolved) {
    const { data } = await db.rpc('ops_resolve_incident', { p_key: a.key });
    return json({ resolved: data ?? 0 });
  }
  const details = raw.length > MAX_DETAILS ? { truncated: raw.slice(0, MAX_DETAILS) } : body;
  const { data, error } = await db.rpc('ops_file_incident', {
    p_source: a.source,
    p_key: a.key,
    p_title: a.title,
    p_details: details,
  });
  if (error) return json({ error: error.message }, 500);
  return json({ filed: data ?? null, duplicate: data === null });
});
