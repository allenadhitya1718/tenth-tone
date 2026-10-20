// GIFs from Tenor, for the GIF tab of the emoji panel (chat and comments).
// The thin client end of the `gif-search` Edge Function, which holds the
// Tenor key, meters each account and returns a compact list.
//
// A chosen GIF is stored as its Tenor CDN URL with the pixel size in the
// fragment ('https://media.tenor.com/.../x.gif#w=220&h=180'), so a bubble can
// take the right shape before the image loads. 0144 only accepts URLs on
// media.tenor.com / media1.tenor.com. The fragment is stripped before the
// URL is loaded.
//
// ApiError codes:
//   rate_limited     this account searched too often; try again later
//   gif_unavailable  not deployed, no TENOR_API_KEY, Tenor down. The panel
//                    hides the GIF tab.
import { ApiError, supabase } from './client';

export type Gif = {
  id: string;
  /** Low-res tinygif for the picker grid. */
  preview_url: string;
  /** The size that is sent and shown in a bubble or comment. */
  url: string;
  width: number;
  height: number;
  /** Tenor's description; the accessibility label. May be empty. */
  description: string;
};

export type GifPage = { results: Gif[]; next: string | null };

export const gifKeys = {
  list: (q: string, lang: string) => ['gifs', q, lang] as const,
};

export const GIF_PAGE = 24;
const TIMEOUT_MS = 12_000;
const TENOR_URL = /^https:\/\/(media|media1)\.tenor\.com\/\S+$/;

type FunctionsErrorLike = { message?: string; context?: Response };
type ErrorBody = { error?: string; reason?: string };

export async function searchGifs({ q, pos, lang }: { q: string; pos?: string | null; lang: string }): Promise<GifPage> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError('gif_unavailable', 'gif-search timeout')), TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([
      supabase.functions.invoke<GifPage>('gif-search', {
        body: { q: q.trim() || undefined, pos: pos || undefined, limit: GIF_PAGE, lang },
      }),
      timeout,
    ]);
    if (error) {
      const ctx = (error as FunctionsErrorLike).context;
      let payload: ErrorBody | null = null;
      try {
        payload = ((await ctx?.json()) as ErrorBody | undefined) ?? null;
      } catch {}
      const code = ctx?.status === 429 || payload?.error === 'rate_limited' ? 'rate_limited' : 'gif_unavailable';
      throw new ApiError(code, payload?.reason ?? payload?.error ?? error.message, { status: ctx?.status });
    }
    const results = (Array.isArray(data?.results) ? data.results : []).filter(
      (g): g is Gif =>
        !!g &&
        typeof g.id === 'string' &&
        isTenorUrl(g.url) &&
        isTenorUrl(g.preview_url) &&
        Number(g.width) > 0 &&
        Number(g.height) > 0,
    );
    return { results, next: typeof data?.next === 'string' && data.next ? data.next : null };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('gif_unavailable', (e as Error)?.message);
  } finally {
    clearTimeout(timer);
  }
}

export function isTenorUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length <= 600 && TENOR_URL.test(url);
}

/** The URL to store: the GIF's URL with its size in the fragment. */
export function gifStoredUrl(g: Pick<Gif, 'url' | 'width' | 'height'>): string {
  const base = g.url.split('#')[0];
  return `${base}#w=${Math.round(g.width)}&h=${Math.round(g.height)}`;
}

/** A stored GIF URL split into what to load and its aspect ratio (w / h). */
export function parseGifUrl(stored: string | null | undefined): { uri: string; aspect: number } | null {
  if (!stored) return null;
  const [uri, frag = ''] = stored.split('#');
  if (!uri) return null;
  const w = Number(/(?:^|&)w=(\d+)/.exec(frag)?.[1]);
  const h = Number(/(?:^|&)h=(\d+)/.exec(frag)?.[1]);
  const aspect = w > 0 && h > 0 ? w / h : 1;
  // Clamp: a 10:1 strip or a 1:10 sliver would make an unusable bubble.
  return { uri, aspect: Math.min(2.5, Math.max(0.5, aspect)) };
}
