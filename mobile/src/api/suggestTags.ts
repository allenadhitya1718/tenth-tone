// AI hashtag suggestions (client note 23). The thin client end of the
// `suggest-tags` Edge Function, which asks the same Gemini key as
// moderate-content for 5-10 hashtags describing one image, and turns the
// post's place name into a hashtag.
//
// Sent: one image (the video's poster frame or a story photo), downscaled
// here to 512 px so the request is small and cheap, the place name, and the
// caption language. Never direct-message media.
//
// The server limits each account (0107: 20 an hour, 60 a day) because every
// call spends the free tier's daily cap that moderation shares. Ask once per
// image; the query key below is what keeps it to once.
//
// ApiError codes:
//   rate_limited  this account asked too often; try again later
//   unavailable   anything else: not deployed, no key, timeout, Google's own
//                 quota, a bad answer. The UI hides the row.
import * as ImageManipulator from 'expo-image-manipulator';

import { ApiError, supabase } from './client';
import type { LocalMedia } from './upload';

export type SuggestedTags = {
  /** No '#', deduplicated, lowercase where the script has case. Never includes placeTag. */
  tags: string[];
  /** The post's place as a hashtag, when a place was given. */
  placeTag: string | null;
};

export type SuggestTagsErrorCode = 'rate_limited' | 'unavailable';
export type TagLang = 'ar' | 'en';

export const suggestTagsKeys = {
  forImage: (uri: string | null, place: string | null, lang: TagLang) => ['suggestTags', uri, place, lang] as const,
};

const SIDE = 512;
const TIMEOUT_MS = 20_000;
// Mirrors the server (suggest-tags/index.ts).
const MAX_IMAGE_CHARS = 1_500_000;

export function tagLangFor(language: string | null | undefined): TagLang {
  return String(language ?? '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

async function toSmallDataUri(image: LocalMedia | string): Promise<string | null> {
  try {
    const uri = typeof image === 'string' ? image : image.uri;
    const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: SIDE } }], {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    if (!out.base64) return null;
    const data = `data:image/jpeg;base64,${out.base64}`;
    return data.length <= MAX_IMAGE_CHARS ? data : null;
  } catch (e) {
    console.warn('[suggestTags] could not read image:', (e as Error)?.message);
    return null;
  }
}

type FunctionsErrorLike = { message?: string; context?: Response };
type ErrorBody = { error?: string; reason?: string };

export async function suggestTags({
  image,
  place,
  lang,
}: {
  image: LocalMedia | string | null;
  place?: string | null;
  lang: TagLang;
}): Promise<SuggestedTags> {
  const placeName = (place ?? '').trim().slice(0, 120);
  const data = image ? await toSmallDataUri(image) : null;
  if (!data && !placeName) throw new ApiError('unavailable', 'nothing to suggest from');

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError('unavailable', 'suggest-tags timeout')), TIMEOUT_MS);
  });
  try {
    const { data: res, error } = await Promise.race([
      supabase.functions.invoke<SuggestedTags>('suggest-tags', {
        body: { image: data ?? undefined, place: placeName || undefined, lang },
      }),
      timeout,
    ]);
    if (error) {
      const ctx = (error as FunctionsErrorLike).context;
      let payload: ErrorBody | null = null;
      try {
        payload = ((await ctx?.json()) as ErrorBody | undefined) ?? null;
      } catch {}
      const code: SuggestTagsErrorCode =
        ctx?.status === 429 || payload?.error === 'rate_limited' ? 'rate_limited' : 'unavailable';
      throw new ApiError(code, payload?.reason ?? payload?.error ?? error.message, { status: ctx?.status });
    }
    return {
      tags: Array.isArray(res?.tags) ? res.tags.filter((s): s is string => typeof s === 'string' && !!s) : [],
      placeTag: typeof res?.placeTag === 'string' && res.placeTag ? res.placeTag : null,
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('unavailable', (e as Error)?.message);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- caption helpers ----------

// The hashtags already in a caption, read the way the database reads them
// (0016/0025: #([^\s#]{1,60}), lowercased), plus each one with trailing
// punctuation removed so "#beach," still counts as #beach.
export function captionTags(caption: string): Set<string> {
  const found = new Set<string>();
  for (const m of caption.matchAll(/#([^\s#]{1,60})/g)) {
    const t = m[1].toLowerCase();
    found.add(t);
    found.add(t.replace(/[.,!?;:،؛؟)"'\]]+$/, ''));
  }
  return found;
}

// The caption with #tag appended, or null when it is already there or would
// not fit in `max` characters.
export function appendTag(caption: string, tag: string, max: number): string | null {
  if (captionTags(caption).has(tag.toLowerCase())) return null;
  const sep = caption && !/\s$/.test(caption) ? ' ' : '';
  const next = `${caption}${sep}#${tag}`;
  return next.length <= max ? next : null;
}
