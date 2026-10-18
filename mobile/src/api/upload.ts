// Media uploads. Port of API.uploadMedia / releaseMedia (web/js/db.js).
//
// Videos and posters go to Cloudflare R2 through the media-upload Edge
// Function, the only holder of the R2 keys, which also runs the upload
// quota check. Three steps: sign, PUT the bytes straight to R2, confirm so
// the server records what actually landed. Other buckets (avatars,
// chat-media, group-photos) use Supabase Storage, where row policies enforce
// the quota.
import { ApiError, fireAndForget, requireUid, supabase } from './client';

// Deliberate refusals from the gate. These are shown to the person and never
// retried against another backend.
const REFUSALS = new Set([
  'quota_exceeded',
  'file_too_large',
  'too_many_pending',
  'bad_extension',
  'bad_content_type',
  'bad_size',
]);

type SignResponse = { id: string; uploadUrl: string; publicUrl: string; headers?: Record<string, string> };

async function mediaCall<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('media-upload', { body });
  if (error) {
    // The readable reason is in the body; the SDK only says "non-2xx".
    let payload: { error?: string } | null = null;
    try {
      payload = await (error as { context?: Response }).context?.json();
    } catch {}
    const code = payload?.error ?? '';
    if (REFUSALS.has(code)) throw new ApiError(code, code, payload);
    throw new ApiError('upload_unavailable', code || error.message);
  }
  return data as T;
}

export type LocalMedia = { uri: string; mimeType?: string | null; size?: number | null; name?: string | null };

const EXT_BY_TYPE: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

function describe(media: LocalMedia) {
  // Base type only: recorders report codecs ("video/mp4;codecs=..."), and the
  // server whitelists the bare type.
  const type = (media.mimeType ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const fromName = (media.name ?? media.uri).split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const ext = EXT_BY_TYPE[type] ?? fromName;
  return { type, ext };
}

async function fileSize(uri: string, known?: number | null) {
  if (known) return known;
  const { File } = await import('expo-file-system');
  return new File(uri).size;
}

export type Progress = (sent: number, total: number) => void;

// Uploads a video or poster to R2. Returns its public URL.
export async function uploadToR2(media: LocalMedia, onProgress?: Progress): Promise<string> {
  const { type, ext } = describe(media);
  if (!ext) throw new ApiError('bad_extension');
  const size = await fileSize(media.uri, media.size);
  const sig = await mediaCall<SignResponse>({ action: 'sign', bucket: 'videos', ext, contentType: type, size });
  if (!sig?.uploadUrl) throw new ApiError('upload_unavailable');

  // Every signed header goes back byte for byte, except content-length,
  // which the HTTP layer sets from the body itself.
  const headers = { ...(sig.headers ?? {}) };
  delete headers['content-length'];
  delete headers['Content-Length'];

  const { File, UploadType } = await import('expo-file-system');
  const task = new File(media.uri).createUploadTask(sig.uploadUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers,
    onProgress: onProgress ? ({ bytesSent, totalBytes }) => onProgress(bytesSent, totalBytes) : undefined,
  });
  const put = await task.uploadAsync();
  if (!put || put.status < 200 || put.status >= 300) {
    // The bytes may be stored behind an unconfirmed ledger row; the hourly
    // sweeper removes those. Do not retry elsewhere.
    throw new ApiError('upload_failed', `upload failed (${put?.status})`);
  }

  // Retried once: the bytes are already stored, so losing this call would
  // leave a real object behind an unconfirmed row.
  let done: { publicUrl?: string };
  try {
    done = await mediaCall({ action: 'confirm', id: sig.id });
  } catch (e) {
    if (e instanceof ApiError && REFUSALS.has(e.code)) throw e;
    await new Promise((r) => setTimeout(r, 800));
    done = await mediaCall({ action: 'confirm', id: sig.id });
  }
  return done?.publicUrl ?? sig.publicUrl;
}

// Uploads to a Supabase Storage bucket under the user's own folder (the
// storage policies require `<uid>/...`) and returns the object path.
export async function uploadToBucket(
  bucket: string,
  media: LocalMedia,
  opts: { prefix?: string; upsert?: boolean } = {},
): Promise<string> {
  const me = await requireUid();
  const { type, ext } = describe(media);
  const path = `${me}/${opts.prefix ?? 'file'}-${Date.now()}.${ext || 'bin'}`;
  // React Native fetch reads a local file:// URI into an ArrayBuffer, which
  // supabase-js uploads as-is.
  const body = await (await fetch(media.uri)).arrayBuffer();
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, { contentType: type, upsert: opts.upsert ?? false, cacheControl: '31536000' });
  if (error) throw error;
  return path;
}

// For public buckets (avatars, group-photos): returns the public URL.
// Private buckets (chat-media) use uploadToBucket and sign the path instead.
export async function uploadToStorage(
  bucket: 'avatars' | 'group-photos' | 'videos' | string,
  media: LocalMedia,
  opts: { prefix?: string; upsert?: boolean } = {},
): Promise<string> {
  const path = await uploadToBucket(bucket, media, opts);
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// Asks the server to delete media a deletion just orphaned. Only AFTER the
// row is gone (the reference check counts the row itself), never awaited,
// never throws: the server re-checks every column that can hold a URL and
// refuses on any doubt, and the hourly sweeper is the fallback.
export function releaseMedia(urls: (string | null | undefined)[] | string | null | undefined) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter((u): u is string => !!u);
  for (const url of list) fireAndForget(mediaCall({ action: 'delete', url }), 'media cleanup');
}
