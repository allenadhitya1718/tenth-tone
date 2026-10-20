// =============================================================
// gif-search
//
// The GIF tab of the emoji panel (chat composer and comments sheet). A thin,
// signed-in-only proxy in front of the KLIPY GIF API, so the KLIPY key never
// ships inside the app and every account is metered. (It was Tenor until
// Google shut the Tenor API down on 30 June 2026; migration 0148.)
//
// ── Request ──
//   POST { q?: string, pos?: string, limit?: number, lang?: string }
//   q      the search text, at most 100 characters. Empty -> KLIPY trending;
//          otherwise KLIPY search.
//   pos    the paging cursor from the previous answer's `next` (a page
//          number as a string; opaque to the app).
//   limit  8..24 (default 24; KLIPY's per_page minimum is 8).
//   lang   the app language (ar, en, zh, hi, ur, fr, es, tr, id); sent to
//          KLIPY as its locale. Anything else reads English.
//
// Always sent to KLIPY: content_filter=high (the strictest rating), and
// customer_id = a SHA-256 of the user id (KLIPY wants a stable per-user id;
// it never sees the real one). If KLIPY refuses the optional locale or
// content_filter (a 4xx other than auth or quota), the call is made once
// more without them rather than failing.
//
// ── Response ──
//   200 { results: Gif[], next: string | null }
//       Gif = { id, preview_url, url, width, height, description }
//       preview_url  the small size, for the picker grid
//       url          the medium size, else small / hd: what gets stored
//       width/height the pixel size of `url`
//       Every URL is https on klipy.com or a subdomain; anything else is
//       dropped here, because migration 0148 only accepts those hosts.
//       KLIPY ad items are skipped.
//   400 { error: 'bad_request' }
//   401 { error: 'unauthorized' }
//   429 { error: 'rate_limited' }
//   503 { error: 'gif_unavailable', reason }   no key, KLIPY down, limit
//                                              table missing. The app hides
//                                              the GIF tab.
//
// ── Rate limit ──
// edge_rate_take (0120), bucket 'gif_search', 600 an hour / 3000 a day per
// account (the picker debounces typing and pages 24 at a time, so a person
// browsing hard makes a few dozen calls). Fails CLOSED: if the limit cannot
// be checked the key is not spent unmetered.
//
// ── Secrets ──
//   KLIPY_API_KEY  the app key from KLIPY's Partner Panel (partner.klipy.com).
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected.
//
// ── Deploy WITH jwt verification (the default) ──
//   npx supabase secrets set KLIPY_API_KEY=...
//   npx supabase functions deploy gif-search
// Never --no-verify-jwt: the rate limit is per user.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => (Deno.env.get(k) ?? '').trim();

const KLIPY_API_KEY = env('KLIPY_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = env('SUPABASE_ANON_KEY');

const KLIPY = 'https://api.klipy.com/api/v1';
const MAX_LIMIT = 24;
const MIN_LIMIT = 8;
const MAX_Q = 100;
const MAX_PAGE = 500;
// Must match the CHECK constraints in 0148_gifs_klipy.sql.
const isAllowedHost = (host: string) => host === 'klipy.com' || /^([a-z0-9-]+\.)+klipy\.com$/.test(host);

const LANGS = new Set(['ar', 'en', 'zh', 'hi', 'ur', 'fr', 'es', 'tr', 'id']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      // The answer depends only on the query, but it is fetched with the
      // user's token, so only the device may cache it.
      'Cache-Control': cacheSeconds > 0 ? `private, max-age=${cacheSeconds}` : 'no-store',
    },
  });
}

const unavailable = (reason: string) => json({ error: 'gif_unavailable', reason }, 503);

// KLIPY: file.<size>.<format> = { url, width, height }, size hd/md/sm/xs.
type KlipyFormat = { url?: string; width?: number | string; height?: number | string };
type KlipySize = Record<string, KlipyFormat | undefined>;
type KlipyItem = {
  id?: string | number;
  slug?: string;
  title?: string;
  type?: string;
  file?: Record<string, KlipySize | undefined>;
};

type Gif = {
  id: string;
  preview_url: string;
  url: string;
  width: number;
  height: number;
  description: string;
};

function allowedUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u.startsWith('https://') || u.length > 560) return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && isAllowedHost(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const gifOf = (f: KlipyItem['file'], size: string) => f?.[size]?.gif;

function toGif(r: KlipyItem): Gif | null {
  if (!r || r.type === 'ad' || r.id == null) return null;
  const f = r.file;
  const main = [gifOf(f, 'md'), gifOf(f, 'sm'), gifOf(f, 'hd')].find((g) => allowedUrl(g?.url));
  const small = [gifOf(f, 'sm'), gifOf(f, 'xs'), main].find((g) => allowedUrl(g?.url));
  const url = allowedUrl(main?.url);
  const preview = allowedUrl(small?.url);
  if (!url || !preview) return null;
  const width = Math.round(Number(main?.width) || 0);
  const height = Math.round(Number(main?.height) || 0);
  if (!width || !height) return null;
  const description = String(r.title || r.slug?.replace(/-/g, ' ') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return { id: String(r.id), preview_url: preview, url, width, height, description };
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// { data: { data: [...], has_next, current_page } } per KLIPY's examples;
// a flat { data: [...] } is read too.
function readPage(payload: unknown): { items: KlipyItem[]; hasNext: boolean } {
  const outer = (payload as { data?: unknown })?.data;
  if (Array.isArray(outer)) return { items: outer as KlipyItem[], hasNext: false };
  const inner = outer as { data?: unknown; has_next?: unknown } | undefined;
  return { items: Array.isArray(inner?.data) ? (inner.data as KlipyItem[]) : [], hasNext: inner?.has_next === true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!KLIPY_API_KEY) return unavailable('no_key');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return unavailable('not_configured');

  // ── Who is asking ──
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json({ error: 'unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_request' }, 400);

  const q = typeof body.q === 'string' ? body.q.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, MAX_Q) : '';
  const pageRaw = Math.floor(Number(typeof body.pos === 'string' ? body.pos : 1) || 1);
  const page = Math.min(MAX_PAGE, Math.max(1, pageRaw));
  const limitRaw = Math.floor(Number(body.limit) || MAX_LIMIT);
  const limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, limitRaw));
  const langRaw = String(body.lang ?? '').toLowerCase().slice(0, 2);
  const lang = LANGS.has(langRaw) ? langRaw : 'en';

  // ── Rate limit (0120) ──
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  {
    const { error } = await db.rpc('edge_rate_take', {
      p_user_id: user.id,
      p_bucket: 'gif_search',
      p_per_hour: 600,
      p_per_day: 3000,
    });
    if (error) {
      // 23514: rate_limit_exceeded() (0050).
      if (error.code === '23514') return json({ error: 'rate_limited' }, 429);
      console.error('[gif-search] rate limit unavailable:', error.code, error.message);
      return unavailable('rate_limit_unavailable');
    }
  }

  const base = new URLSearchParams({
    page: String(page),
    per_page: String(limit),
    customer_id: await sha256(`flyp:${user.id}`),
  });
  if (q) base.set('q', q);
  const extras = new URLSearchParams(base);
  extras.set('locale', lang);
  extras.set('content_filter', 'high');
  const path = `${KLIPY}/${encodeURIComponent(KLIPY_API_KEY)}/gifs/${q ? 'search' : 'trending'}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    let res = await fetch(`${path}?${extras.toString()}`, { signal: controller.signal });
    if (res.status >= 400 && res.status < 500 && ![401, 403, 429].includes(res.status)) {
      // Never log the URL: it carries the key.
      console.warn('[gif-search] KLIPY refused the extras:', res.status, (await res.text()).slice(0, 200));
      res = await fetch(`${path}?${base.toString()}`, { signal: controller.signal });
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      console.warn('[gif-search] KLIPY', res.status, detail);
      if (res.status === 429) return unavailable('quota');
      if (res.status === 401 || res.status === 403) return unavailable('bad_key');
      return unavailable(`http_${res.status}`);
    }
    const { items, hasNext } = readPage(await res.json());
    const results = items.map(toGif).filter((g): g is Gif => !!g);
    const next = hasNext && results.length && page < MAX_PAGE ? String(page + 1) : null;
    // Trending changes slowly; a search answer is stable for a while too.
    return json({ results, next }, 200, q ? 300 : 600);
  } catch (e) {
    const reason = (e as Error)?.name === 'AbortError' ? 'timeout' : 'network';
    console.warn('[gif-search] call failed:', reason);
    return unavailable(reason);
  } finally {
    clearTimeout(timer);
  }
});
