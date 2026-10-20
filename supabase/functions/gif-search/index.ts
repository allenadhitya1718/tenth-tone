// =============================================================
// gif-search
//
// The GIF tab of the emoji panel (chat composer and comments sheet). A thin,
// signed-in-only proxy in front of Google's Tenor API v2, so the Tenor key
// never ships inside the app and every account is metered.
//
// ── Request ──
//   POST { q?: string, pos?: string, limit?: number, lang?: string }
//   q      the search text, at most 100 characters. Empty -> Tenor 'featured'
//          (trending); otherwise Tenor 'search'.
//   pos    Tenor's opaque paging cursor from the previous answer's `next`.
//   limit  1..24 (default 24).
//   lang   the app language (ar, en, zh, hi, ur, fr, es, tr, id); picks the
//          Tenor locale. Anything else reads English.
//
// Always sent to Tenor: country=SA, contentfilter=high (Tenor's strictest
// rating, roughly G), media_filter=tinygif,mediumgif,gif (the smallest set
// the app needs: a low-res preview for the grid and one size for the bubble).
//
// ── Response ──
//   200 { results: Gif[], next: string | null }
//       Gif = { id, preview_url, url, width, height, description }
//       preview_url  tinygif (about 220 px wide), for the picker grid
//       url          mediumgif, else gif: what gets stored and shown
//       width/height the pixel size of `url`
//       Every URL is on media.tenor.com or media1.tenor.com; anything else is
//       dropped here, because migration 0144 only accepts those hosts.
//   400 { error: 'bad_request' }
//   401 { error: 'unauthorized' }
//   429 { error: 'rate_limited' }
//   503 { error: 'gif_unavailable', reason }   no key, Tenor down, limit
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
//   TENOR_API_KEY  a Google Cloud API key with the Tenor API enabled,
//                  restricted to that API. NEW: set it before deploying.
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected.
//
// ── Deploy WITH jwt verification (the default) ──
//   npx supabase secrets set TENOR_API_KEY=...
//   npx supabase functions deploy gif-search
// Never --no-verify-jwt: the rate limit is per user.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => (Deno.env.get(k) ?? '').trim();

const TENOR_API_KEY = env('TENOR_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = env('SUPABASE_ANON_KEY');

const TENOR = 'https://tenor.googleapis.com/v2';
const CLIENT_KEY = 'flyp_app';
const MAX_LIMIT = 24;
const MAX_Q = 100;
const MAX_POS = 200;
// Must match the CHECK constraints in 0144_gifs.sql.
const ALLOWED_HOSTS = new Set(['media.tenor.com', 'media1.tenor.com']);

const LOCALES: Record<string, string> = {
  ar: 'ar_SA',
  en: 'en_US',
  zh: 'zh_CN',
  hi: 'hi_IN',
  ur: 'ur_PK',
  fr: 'fr_FR',
  es: 'es_ES',
  tr: 'tr_TR',
  id: 'id_ID',
};

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

type TenorFormat = { url?: string; dims?: number[] };
type TenorResult = {
  id?: string;
  title?: string;
  content_description?: string;
  media_formats?: Record<string, TenorFormat | undefined>;
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
  if (typeof u !== 'string' || !u.startsWith('https://')) return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && ALLOWED_HOSTS.has(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function dims(f: TenorFormat | undefined): [number, number] {
  const w = Math.round(Number(f?.dims?.[0]) || 0);
  const h = Math.round(Number(f?.dims?.[1]) || 0);
  return [w, h];
}

function toGif(r: TenorResult): Gif | null {
  const mf = r.media_formats ?? {};
  const main = mf.mediumgif?.url ? mf.mediumgif : mf.gif;
  const url = allowedUrl(main?.url);
  const preview = allowedUrl(mf.tinygif?.url) ?? url;
  if (!r.id || !url || !preview) return null;
  let [width, height] = dims(main);
  if (!width || !height) [width, height] = dims(mf.tinygif);
  if (!width || !height) return null;
  const description = String(r.content_description || r.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return { id: String(r.id), preview_url: preview, url, width, height, description };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!TENOR_API_KEY) return unavailable('no_key');
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
  const pos = typeof body.pos === 'string' ? body.pos.trim().slice(0, MAX_POS) : '';
  const limitRaw = Math.floor(Number(body.limit) || MAX_LIMIT);
  const limit = Math.min(MAX_LIMIT, Math.max(1, limitRaw));
  const lang = String(body.lang ?? '').toLowerCase().slice(0, 2);
  const locale = LOCALES[lang] ?? LOCALES.en;

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

  const params = new URLSearchParams({
    key: TENOR_API_KEY,
    client_key: CLIENT_KEY,
    limit: String(limit),
    locale,
    country: 'SA',
    contentfilter: 'high',
    media_filter: 'tinygif,mediumgif,gif',
    ar_range: 'all',
  });
  if (pos) params.set('pos', pos);
  if (q) params.set('q', q);
  const endpoint = `${TENOR}/${q ? 'search' : 'featured'}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) {
      // Never log the URL: it carries the key.
      const detail = (await res.text()).slice(0, 200);
      console.warn('[gif-search] Tenor', res.status, detail);
      if (res.status === 429) return unavailable('quota');
      if (res.status === 400 || res.status === 403) return unavailable(/key/i.test(detail) ? 'bad_key' : `http_${res.status}`);
      return unavailable(`http_${res.status}`);
    }
    const payload = (await res.json()) as { results?: TenorResult[]; next?: string };
    const results = (payload.results ?? []).map(toGif).filter((g): g is Gif => !!g);
    const next = typeof payload.next === 'string' && payload.next && payload.next !== '0' && results.length ? payload.next : null;
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
