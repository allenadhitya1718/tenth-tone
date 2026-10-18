// Content screening. Port of web/js/moderation.js plus API.report.
//
// The thin client end of the `moderate-content` Edge Function. Everything of
// consequence (the API key, the thresholds, the decision, the audit row)
// lives on the server. This file gathers what is about to be written, asks,
// and reports the answer. Nothing here is a secret or authoritative.
// supabase/migrations/0066_content_moderation.sql has the full reasoning.
//
// What is NOT sent: direct messages and private group names/photos. The
// provider is Gemini on its unpaid tier, whose terms let Google use and
// human-review what it is sent: fine for a public post, not for a private
// conversation. PRIVATE_KINDS is a backstop against a call site being added
// by mistake; the server refuses the same kinds.
//
// Everything fails open. A thrown error, a timeout, an undeployed function
// or a signed-out session gives blocked: false and the write proceeds. That
// is a deliberate promise; the server records the gap
// (scans_unavailable_24h on the admin dashboard).
//
// Images: the server accepts `images` as data URIs
// (`data:image/jpeg;base64,...`, jpeg/png/webp/heic/heif), at most 4, each at
// most 1.5M characters. The web build drew frames onto a canvas and
// downscaled them to 512px. React Native has no canvas, so callers must pass
// already-small images (a poster or thumbnail frame at low resolution);
// anything over the server's size limit is dropped here rather than sent to
// be discarded.
//
// ApiError codes: none new. Screening never throws; report() throws the
// shared 'not_signed_in' (requireUid) and Postgrest errors as-is.
import type { LocalMedia } from './upload';
import { requireUid, supabase } from './client';
import type { Uuid } from './types';

export type ModerationKind =
  | 'video'
  | 'comment'
  | 'live_title'
  | 'live_cover'
  | 'live_comment'
  | 'profile'
  | 'avatar'
  | (string & {});

export type Verdict = {
  blocked: boolean;
  // Arabic, written by the server and deliberately unspecific.
  message: string | null;
  eventId: string | null;
  attach: boolean;
  target: string | null;
};

// An image to screen: a local file URI or a LocalMedia (whose mimeType is
// used when present).
export type ScreenImage = string | LocalMedia;

// Longer than the Edge Function's own budget, so a slow but successful scan
// is not thrown away a second before the answer arrives.
const TIMEOUT_TEXT = 12_000;
const TIMEOUT_IMAGE = 25_000;

// Mirrors the server's own limits (moderate-content/index.ts).
const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 1_500_000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

// Circuit breaker. A build can reach a phone before the function is
// deployed, or it can be down; without this every post would spend its full
// timeout discovering that again. Three consecutive failures and screening
// steps aside for ten minutes. A UX guard, not a security one: it only ever
// allows MORE, which is already what a failure does.
let consecutiveFailures = 0;
let mutedUntil = 0;
const FAILURE_LIMIT = 3;
const MUTE_MS = 10 * 60 * 1000;

const PASS: Verdict = { blocked: false, message: null, eventId: null, attach: false, target: null };

// Private surfaces. Loud rather than silent, so somebody notices.
const PRIVATE_KINDS = new Set(['message', 'group']);

export function enabled() {
  return Date.now() >= mutedUntil;
}

function noteFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_LIMIT) {
    mutedUntil = Date.now() + MUTE_MS;
    consecutiveFailures = 0;
    console.warn('[Moderation] repeated failures, standing down for 10 minutes');
  }
}

type ModerateResponse = {
  decision?: 'allow' | 'review' | 'block';
  message?: string | null;
  eventId?: string | null;
  attach?: boolean;
  target?: string | null;
};

async function ask(kind: ModerationKind, text: string, images: string[] = []): Promise<Verdict> {
  if (!enabled()) return PASS;
  if (PRIVATE_KINDS.has(kind)) {
    console.warn(`[Moderation] refusing to send private content (${kind}), not screened by design`);
    return PASS;
  }
  if (!text && !images.length) return PASS;

  try {
    const budget = images.length ? TIMEOUT_IMAGE : TIMEOUT_TEXT;
    const call = supabase.functions.invoke<ModerateResponse>('moderate-content', {
      body: { kind, text: text || '', images },
    });
    // functions.invoke has no timeout of its own. The losing promise is
    // abandoned rather than cancelled: the server has already logged its
    // decision either way.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ data: null; error: Error }>((resolve) => {
      timer = setTimeout(() => resolve({ data: null, error: new Error('moderation timeout') }), budget);
    });
    const { data, error } = await Promise.race([call, timeout]);
    clearTimeout(timer);

    if (error || !data) {
      noteFailure();
      console.warn('[Moderation] unavailable, allowing:', error?.message);
      return PASS;
    }
    consecutiveFailures = 0;
    return {
      blocked: data.decision === 'block',
      message: data.message ?? null,
      eventId: data.eventId ?? null,
      attach: !!data.attach,
      target: data.target ?? null,
    };
  } catch (e) {
    noteFailure();
    console.warn('[Moderation] threw, allowing:', (e as Error)?.message);
    return PASS;
  }
}

// Reads a local image into a data URI. Data URIs rather than URLs on
// purpose: an image can be refused BEFORE its bytes are written to storage,
// so a rejected image never sits in a public bucket, however briefly.
// Returns null for anything unreadable, of a type the server would skip, or
// too large to be accepted.
async function toDataUri(image: ScreenImage): Promise<string | null> {
  try {
    const uri = typeof image === 'string' ? image : image.uri;
    const declared = typeof image === 'string' ? null : image.mimeType;
    const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    const type = (declared ?? TYPE_BY_EXT[ext] ?? 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) return null;
    const { File } = await import('expo-file-system');
    const b64 = await new File(uri).base64();
    const out = `data:${type};base64,${b64}`;
    return out.length <= MAX_IMAGE_CHARS ? out : null;
  } catch {
    return null;
  }
}

async function toDataUris(images: ScreenImage[]): Promise<string[]> {
  const read = await Promise.all(images.slice(0, MAX_IMAGES).map(toDataUri));
  return read.filter((s): s is string => !!s);
}

// Text only: comments, captions, bios and titles. NOT direct messages or
// private group names.
export async function checkText(kind: ModerationKind, text: string | null | undefined): Promise<Verdict> {
  const body = String(text ?? '').trim();
  if (!body) return PASS;
  return ask(kind, body);
}

// One image, with optional accompanying text: avatars, live covers. Called
// with the local file, so the refusal happens before upload.
export async function checkImage(
  kind: ModerationKind,
  image: ScreenImage | null | undefined,
  text?: string | null,
): Promise<Verdict> {
  if (!image) return checkText(kind, text);
  if (!enabled()) return PASS;
  const [shot] = await toDataUris([image]);
  if (!shot) return checkText(kind, text);
  return ask(kind, text ?? '', [shot]);
}

// A video's caption and sampled frames in ONE request: the free Gemini tier
// is capped per day and a per-frame call would burn it several times as fast.
// Frames are a sample (the web build took three, evenly spaced); something
// shown only between them is not caught here, and reporting is the backstop.
// No frames is not a failure: the caption is still worth screening.
export async function checkVideo(
  frames: ScreenImage[] | null | undefined,
  description: string | null | undefined,
): Promise<Verdict> {
  if (!enabled()) return PASS;
  const images = frames?.length ? await toDataUris(frames) : [];
  return ask('video', description ?? '', images);
}

// Closes the loop once the row exists. Only a 'review' or an unscanned
// publish has anything to attach. Swallows every error: this is bookkeeping,
// and a post that succeeded must never fail because the queue entry could
// not be filed.
export async function attach(verdict: Verdict | null | undefined, targetType: string | null, targetId: Uuid | null | undefined) {
  try {
    if (!verdict || !verdict.attach || !verdict.eventId || !targetId) return null;
    const { data, error } = await supabase.rpc('moderation_attach_target', {
      p_event_id: verdict.eventId,
      p_target_type: targetType || verdict.target,
      p_target_id: targetId,
    });
    if (error) {
      console.warn('[Moderation] attach failed:', error.message);
      return null;
    }
    return (data as unknown) ?? null;
  } catch (e) {
    console.warn('[Moderation] attach threw:', (e as Error)?.message);
    return null;
  }
}

// ---------- Reports ----------
export type ReportTarget = 'video' | 'comment' | 'user' | 'live_stream' | (string & {});

export async function report({ targetType, targetId, reason }: { targetType: ReportTarget; targetId: Uuid; reason: string }) {
  const me = await requireUid();
  const { error } = await supabase
    .from('reports')
    .insert({ reporter_id: me, target_type: targetType, target_id: targetId, reason });
  if (error) throw error;
}
