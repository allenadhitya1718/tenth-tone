// =============================================================
// storage-alert
//
// Emails the operators when storage is filling up. The decision of WHETHER
// to warn is not made here — public.check_storage_alert() makes it on a
// pg_cron schedule (0059), writes the in-app notification, and raises an
// outbox flag. This function only drains that outbox.
//
// Splitting it that way matters: the database can decide and notify entirely
// on its own, but it cannot make an outbound network call without pg_net,
// which is not enabled on this project. So the database queues, and this
// sends. If mail is broken or never deployed, the in-app alert still fires —
// the warning degrades rather than disappears.
//
// claim_storage_alert_email() clears the flag in the same statement that
// reads it, so two overlapping runs cannot both send: the second sees
// nothing pending.
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//
//   ALERT_SECRET     REQUIRED. Any long random string. The caller must present
//                    it, so a stranger who finds the URL cannot drain your
//                    outbox and suppress a real warning.
//
//   RESEND_API_KEY   OPTIONAL. From resend.com, for a properly worded email.
//   ALERT_FROM       OPTIONAL. e.g. "FLYP alerts <alerts@flyp-sa.com>", on a
//                    domain verified in Resend or delivery fails silently.
//
// Without the Resend pair this still works: the response carries alert:true
// and the GitHub workflow fails the run, which makes GitHub email the repo
// owner by itself. That costs nothing to set up and needs no account. Add
// Resend later if you want a branded message rather than "workflow failed".
//
//   RECONCILE_SECRET OPTIONAL here. Already set for send-push / media-reconcile.
//                    Accepted in x-reconcile-secret as an alternative to
//                    ALERT_SECRET, so the database can call this with the
//                    job_endpoints 'send-push' headers it already has (0129).
//   ADMIN_PANEL_URL  OPTIONAL. e.g. "https://flyp-sa.com/admin-v2.html"; the
//                    usage email links to its #/usage page.
//
// TWO KINDS OF ALERT (0129). The request body selects which outbox to drain:
//   {} or no body            storage alert (0059/0060) - unchanged behaviour
//   {"kind":"usage_alert"}   usage watcher: R2 storage / ops and Agora minutes
//                            against usage_limits (claim_usage_alert_email)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
// The service role is required: claim_storage_alert_email() reads operator
// addresses out of auth.users and is granted to service_role alone.
//
// DEPLOY WITH --no-verify-jwt:
//
//   npx supabase functions deploy storage-alert --no-verify-jwt
//
// Edge Functions demand a valid JWT by default, and the caller here is
// send_storage_alert_email() in the database going out through pg_net, which
// sends no user token. Without that flag the request is rejected by the
// platform before any of this code runs, and the alert dies silently. The
// ALERT_SECRET check below is what replaces JWT verification, which is why it
// is required rather than optional.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const ALERT_FROM = Deno.env.get('ALERT_FROM') ?? '';
const ALERT_SECRET = Deno.env.get('ALERT_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RECONCILE_SECRET = Deno.env.get('RECONCILE_SECRET') ?? '';
const ADMIN_PANEL_URL = Deno.env.get('ADMIN_PANEL_URL') ?? '';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}


// Hard daily cap on Resend sends (0139). Reserved BEFORE the call, so a failed
// send still counts; an unreachable counter means NO email (fails closed). The
// in-app notification and admin banner are written regardless.
// deno-lint-ignore no-explicit-any
async function mayEmail(db: any, sender: string, n: number): Promise<boolean> {
  const { data, error } = await db.rpc('email_send_take', { p_sender: sender, p_count: n });
  if (error) { console.error('[storage-alert] email cap check failed:', error.message); return false; }
  return data === true;
}

function capped(kind: string | null) {
  return json({ ...(kind ? { kind } : {}), sent: false, reason: 'email_daily_cap', alert: true,
    note: 'in-app notification and admin banner were still written' });
}

const BAND_LABEL: Record<number, string> = {
  1: 'filling up',
  2: 'nearly full',
  3: 'critical',
};

// Constant-time secret comparison (F19). Both sides are hashed first so the
// comparison always walks 32 bytes, whatever the lengths, and a plain `===`
// cannot leak how many leading characters matched through its timing.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function mb(bytes: number) {
  return (bytes / 1048576).toFixed(0) + ' MB';
}

// ── Usage watcher email (0129) ──────────────────────────────────────────

type UsageAlert = {
  id: number;
  metric: string;
  pct: number;
  value: number;
  limit_value: number;
  band: number;
  month: string;
  detail?: { unit?: string; accuracy?: string; breakdown?: Record<string, unknown> } | null;
  created_at: string;
};

const USAGE_BAND: Record<number, string> = {
  1: 'past 70%',
  2: 'past 85%',
  3: 'past 95%',
  4: 'OVER the limit',
};

const METRICS: Record<string, { name: string; unit: 'bytes' | 'ops' | 'minutes'; how: string; todo: string[] }> = {
  r2_storage: {
    name: 'Cloudflare R2 storage',
    unit: 'bytes',
    how: 'Measured from the media ledger (sizes R2 reported) plus the baseline you set. Good, but misses objects the ledger does not know (old project, orphans).',
    todo: [
      'Check the real size: Cloudflare dashboard -> R2 -> the media bucket -> Metrics.',
      'R2 storage costs about $0.015 per GB-month above the free 10 GB.',
      'To slow it: lower the per-user upload limits (admin panel -> Storage & limits) and clean up unconfirmed uploads (lifecycle rule / media-reconcile).',
      'If the spend is fine, raise the limit in admin panel -> Usage & billing.',
    ],
  },
  r2_class_a: {
    name: 'Cloudflare R2 Class A operations (writes) this month',
    unit: 'ops',
    how: 'Upper bound: one per signed upload URL handed out this month.',
    todo: [
      'Check the real count: Cloudflare dashboard -> R2 -> Metrics -> Class A operations.',
      'Free: 1,000,000 a month, then about $4.50 per million.',
      'A sudden jump usually means one account uploading in a loop: look at the newest videos / users in the admin panel and ban if needed, or lower "uploads per user per day".',
    ],
  },
  r2_class_b: {
    name: 'Cloudflare R2 Class B operations (reads) this month',
    unit: 'ops',
    how: 'LOWER bound: only the server-side check after each upload. Viewers downloading media through the CDN are not visible to the database.',
    todo: [
      'Check the real count: Cloudflare dashboard -> R2 -> Metrics -> Class B operations.',
      'Free: 10,000,000 a month, then about $0.36 per million.',
      'Make sure the media domain caches files (Cloudflare Cache Rules), so repeat views do not reach R2.',
    ],
  },
  agora_minutes: {
    name: 'Agora participant-minutes this month',
    unit: 'minutes',
    how: 'Estimate from calls (join to leave), lives (host + logged listeners) and walkie tokens (one hour each). Real billing can differ.',
    todo: [
      'Check the real number: Agora Console -> Usage. Set a usage alert there as well.',
      'Free: 10,000 minutes a month (audio and video together), then roughly $0.99 per 1,000 audio minutes and $3.99 per 1,000 HD video minutes.',
      'If one live or account is driving it, end the live or ban the account in the admin panel.',
      'If the spend is fine, raise the limit in admin panel -> Usage & billing.',
    ],
  },
};

function fmtUsage(v: number, unit: string): string {
  const n = Number(v) || 0;
  if (unit === 'bytes') return (n / 1073741824).toFixed(2) + ' GB';
  return Math.round(n).toLocaleString('en-US') + (unit === 'minutes' ? ' min' : ' ops');
}

function usageBlock(a: UsageAlert): string {
  const m = METRICS[a.metric] ?? { name: a.metric, unit: (a.detail?.unit as 'ops') ?? 'ops', how: 'Estimate.', todo: [] };
  const lines = [
    `■ ${m.name}: ${USAGE_BAND[Number(a.band)] ?? ''}`,
    `  Usage:  ${fmtUsage(a.value, m.unit)}`,
    `  Limit:  ${fmtUsage(a.limit_value, m.unit)}`,
    `  Level:  ${Number(a.pct)}% of your limit`,
    `  How measured: ${m.how}`,
  ];
  const b = a.detail?.breakdown;
  if (a.metric === 'agora_minutes' && b) {
    const g = (k: string) => Math.round(Number(b[k] ?? 0)).toLocaleString('en-US');
    lines.push(
      `  Breakdown: calls audio ${g('calls_audio')}, calls video ${g('calls_video')}, live hosts ${g('live_hosts')},`,
      `             live listeners ${g('live_audience')} (+${g('live_audience_guess')} guessed), walkie ${g('walkie')}`,
    );
  }
  if (m.todo.length) {
    lines.push('  What to do:');
    for (const t of m.todo) lines.push(`   - ${t}`);
  }
  return lines.join('\n');
}

// deno-lint-ignore no-explicit-any
async function usageAlert(db: any): Promise<Response> {
  const { data, error } = await db.rpc('claim_usage_alert_email');
  if (error) return json({ kind: 'usage_alert', error: error.message }, 500);
  if (!data) return json({ kind: 'usage_alert', sent: false, reason: 'nothing_pending' });

  const alerts: UsageAlert[] = Array.isArray(data.alerts) ? data.alerts : [];
  const recipients: string[] = Array.isArray(data.recipients) ? data.recipients : [];
  const summary = alerts.map((a) => ({ metric: a.metric, pct: a.pct, band: a.band }));

  if (!alerts.length) return json({ kind: 'usage_alert', sent: false, reason: 'nothing_pending' });
  if (!recipients.length) {
    return json({ kind: 'usage_alert', sent: false, reason: 'no_recipients', alert: true, alerts: summary });
  }
  if (!RESEND_API_KEY || !ALERT_FROM) {
    return json({
      kind: 'usage_alert', sent: false, reason: 'mail_not_configured', alert: true,
      alerts: summary, recipients: recipients.length,
    });
  }

  const top = alerts[0];
  const topName = (METRICS[top.metric]?.name ?? top.metric).replace(/ this month$/, '');
  const subject = alerts.length === 1
    ? `FLYP usage alert: ${topName} at ${Number(top.pct)}% of your limit`
    : `FLYP usage alert: ${alerts.length} limits need attention (highest ${Number(top.pct)}%)`;

  const panel = ADMIN_PANEL_URL ? ADMIN_PANEL_URL.replace(/#.*$/, '') + '#/usage' : '';
  const body = [
    `Cloudflare R2 and Agora have no hard spending cap. Usage is getting close`,
    `to the limits you set, so this is your warning before the bill grows.`,
    `Month: ${String(top.month ?? '').slice(0, 7)} (UTC)`,
    ``,
    ...alerts.map(usageBlock).flatMap((b) => [b, '']),
    `These figures are estimates from FLYP's own database, not a bill. The`,
    `Cloudflare and Agora dashboards are the real meters.`,
    ``,
    panel
      ? `Acknowledge and change limits: ${panel}`
      : `Acknowledge and change limits: admin panel -> Usage & billing.`,
    `You get this again when a higher level is crossed, and once a day while`,
    `a metric stays at 85% or more.`,
  ].join('\n');

  if (!(await mayEmail(db, 'usage_alert', recipients.length))) return capped('usage_alert');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: ALERT_FROM, to: recipients, subject, text: body }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return json({
      kind: 'usage_alert', sent: false, reason: 'resend_failed', status: res.status,
      detail: detail.slice(0, 300), note: 'in-app notification and admin banner were still written',
    }, 502);
  }

  return json({ kind: 'usage_alert', sent: true, alerts: summary, recipients: recipients.length });
}

Deno.serve(async (req) => {
  // A shared secret rather than a JWT: the caller is a scheduler, not a
  // person. Compared in constant time (safeEqual), so neither the length nor
  // a matching prefix leaks through timing.
  // Either secret will do (0129): ALERT_SECRET in x-alert-secret, or the
  // RECONCILE_SECRET that send-push and media-reconcile already share.
  const given = req.headers.get('x-alert-secret') ?? '';
  const givenReconcile = req.headers.get('x-reconcile-secret') ?? '';
  const okAlert = !!ALERT_SECRET && !!given && (await safeEqual(given, ALERT_SECRET));
  const okReconcile = !!RECONCILE_SECRET && !!givenReconcile && (await safeEqual(givenReconcile, RECONCILE_SECRET));
  if (!okAlert && !okReconcile) {
    return json({ error: 'unauthorized' }, 401);
  }

  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not configured' }, 500);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // An empty or missing body is the storage alert, as it always was.
  let kind = '';
  try {
    const raw = await req.text();
    if (raw) kind = String((JSON.parse(raw) as { kind?: unknown })?.kind ?? '');
  } catch {
    kind = '';
  }
  if (kind === 'usage_alert') return await usageAlert(db);

  const { data, error } = await db.rpc('claim_storage_alert_email');
  if (error) return json({ error: error.message }, 500);

  // The normal case, most days: the check ran, nothing crossed a threshold.
  if (!data) return json({ sent: false, reason: 'nothing_pending' });

  const recipients: string[] = Array.isArray(data.recipients) ? data.recipients : [];
  if (!recipients.length) {
    // The worst case, not a footnote: storage crossed a threshold and nobody
    // has profiles.is_admin, so neither the email NOR the in-app notification
    // reached a single person. Carries alert:true so the caller fails loudly
    // rather than logging a warning nobody reads.
    return json({
      sent: false, reason: 'no_admin_recipients', alert: true,
      pct: data.pct, band: data.band, used: data.used, limit: data.limit,
    });
  }

  // Not an error, and deliberately a 200. Running without Resend is a
  // supported setup: the caller turns "an alert is pending but no mailer is
  // configured" into a failed workflow run, and GitHub emails the repo owner
  // about that by itself. Returning 500 here would make an ordinary
  // configuration look like a broken function.
  if (!RESEND_API_KEY || !ALERT_FROM) {
    return json({
      sent: false,
      reason: 'mail_not_configured',
      alert: true,
      pct: data.pct,
      band: data.band,
      used: data.used,
      limit: data.limit,
      recipients: recipients.length,
    });
  }

  const pct = Number(data.pct);
  const band = Number(data.band);
  const label = BAND_LABEL[band] ?? 'filling up';
  const subject = `FLYP storage ${label} — ${pct}% of the cap`;

  const body = [
    `Storage is at ${pct}% of the configured ceiling.`,
    ``,
    `Used:  ${mb(Number(data.used))}`,
    `Limit: ${mb(Number(data.limit))}   (app_limits.global_max_bytes)`,
    ``,
    `Uploads stop automatically when the ceiling is reached — this is a`,
    `warning, not an outage.`,
    ``,
    `If media has been moved to Cloudflare R2, check that storage_used_bytes()`,
    `was repointed at R2. If it still reads Supabase it will report a nearly`,
    `empty bucket while R2 fills toward the 10 GB where billing begins.`,
  ].join('\n');

  if (!(await mayEmail(db, 'storage_alert', recipients.length))) return capped(null);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: ALERT_FROM, to: recipients, subject, text: body }),
  });

  if (!res.ok) {
    const detail = await res.text();
    // The flag is already cleared, so this alert will not be retried. Say so
    // loudly in the response: the in-app notification did land, and that is
    // the copy that matters.
    return json({
      sent: false,
      reason: 'resend_failed',
      status: res.status,
      detail: detail.slice(0, 300),
      note: 'in-app notification was still written',
    }, 502);
  }

  return json({ sent: true, pct, band, recipients: recipients.length });
});
