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
// Secrets required (Supabase -> Edge Functions -> Secrets):
//   RESEND_API_KEY   from resend.com. Free tier covers this many times over.
//   ALERT_FROM       e.g. "FLYP alerts <alerts@flyp-sa.com>". The domain has
//                    to be verified in Resend, or delivery fails silently.
//   ALERT_SECRET     any long random string. The caller must present it, so
//                    a stranger who finds the URL cannot drain your outbox
//                    and suppress a real warning.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
// The service role is required: claim_storage_alert_email() reads operator
// addresses out of auth.users and is granted to service_role alone.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const ALERT_FROM = Deno.env.get('ALERT_FROM') ?? '';
const ALERT_SECRET = Deno.env.get('ALERT_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const BAND_LABEL: Record<number, string> = {
  1: 'filling up',
  2: 'nearly full',
  3: 'critical',
};

function mb(bytes: number) {
  return (bytes / 1048576).toFixed(0) + ' MB';
}

Deno.serve(async (req) => {
  // A shared secret rather than a JWT: the caller is a scheduler, not a
  // person. Compared with a constant-time-ish check to avoid leaking length
  // through timing, which matters little here but costs nothing.
  const given = req.headers.get('x-alert-secret') ?? '';
  if (!ALERT_SECRET || given.length !== ALERT_SECRET.length || given !== ALERT_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not configured' }, 500);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data, error } = await db.rpc('claim_storage_alert_email');
  if (error) return json({ error: error.message }, 500);

  // The normal case, most days: the check ran, nothing crossed a threshold.
  if (!data) return json({ sent: false, reason: 'nothing_pending' });

  const recipients: string[] = Array.isArray(data.recipients) ? data.recipients : [];
  if (!recipients.length) {
    // Worth reporting rather than swallowing: it means no profile has
    // is_admin set, so the whole alert path has no audience.
    return json({ sent: false, reason: 'no_admin_recipients', pct: data.pct });
  }

  if (!RESEND_API_KEY || !ALERT_FROM) {
    return json({ sent: false, reason: 'mail_not_configured', pct: data.pct, recipients: recipients.length }, 500);
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
