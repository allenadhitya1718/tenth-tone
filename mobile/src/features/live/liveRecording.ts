// The host's own recording of a live, kept on their phone so they can trim a
// one-minute highlight after it ends (0167). Only the chosen minute is ever
// uploaded; the full recording never leaves the phone.
//
// Storage: recordings live in the app's documents folder, are deleted 2 days
// after the live, and at most the 3 newest are kept, so a busy host's phone
// does not fill up. Agora writes ADTS AAC at 32 kHz mono, about 20 MB an hour.
import { Directory, File, Paths } from 'expo-file-system';

const KEEP_MS = 2 * 24 * 60 * 60 * 1000;
const KEEP_COUNT = 3;

// ---------- busy moments ----------
// While the host records, their phone notes when comments, reactions and
// gifts arrive, in 5-second buckets, in a small file beside the recording
// part (<liveId>_<n>.moments.json). The highlight screen uses it to start on
// the busiest minute. Reactions are only broadcast, never stored on the
// server, so the host's phone is the one place that sees all three.
export const BUCKET_S = 5;
export const MOMENT_WEIGHT = { comment: 2, reaction: 1, gift: 5 } as const;
export type MomentKind = keyof typeof MOMENT_WEIGHT;
type MomentsFile = { startedAt: number; buckets: Record<string, number> };

let active: { liveId: string; file: File; data: MomentsFile; dirty: boolean } | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function momentsFileFor(recording: File): File {
  return new File(recording.parentDirectory, recording.name.replace(/\.aac$/, '.moments.json'));
}

function flushMoments() {
  if (!active?.dirty) return;
  try {
    if (!active.file.exists) active.file.create();
    active.file.writeSync(JSON.stringify(active.data));
    active.dirty = false;
  } catch {}
}

/** The recording of a live begins: start a moments log for this part. */
function beginMoments(liveId: string, recording: File) {
  endMoments();
  active = { liveId, file: momentsFileFor(recording), data: { startedAt: Date.now(), buckets: {} }, dirty: true };
  flushMoments();
  flushTimer = setInterval(flushMoments, 15_000);
}

/** The recording stops: write what is left. */
export function endMoments() {
  flushMoments();
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  active = null;
}

/** Something happened in the live. `at` is when (a comment's own time, so
 *  comments loaded late still land on the right second). Ignored unless
 *  this phone is recording that live. */
export function noteMoment(liveId: string, kind: MomentKind, at = Date.now()) {
  if (!active || active.liveId !== liveId) return;
  const s = (at - active.data.startedAt) / 1000;
  if (!(s >= 0)) return;
  const key = String(Math.floor(s / BUCKET_S));
  active.data.buckets[key] = (active.data.buckets[key] ?? 0) + MOMENT_WEIGHT[kind];
  active.dirty = true;
}

/** Activity per 5-second bucket of a recording part; empty when nothing was noted. */
export function momentsFor(recording: File): number[] {
  try {
    const f = momentsFileFor(recording);
    if (!f.exists) return [];
    const data = JSON.parse(f.textSync()) as MomentsFile;
    const out: number[] = [];
    for (const [k, v] of Object.entries(data.buckets ?? {})) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < 100_000 && typeof v === 'number' && v > 0) out[i] = v;
    }
    return Array.from(out, (v) => v ?? 0);
  } catch {
    return [];
  }
}

/** The start (seconds, a multiple of 5) of the busiest `windowS` of a
 *  recording `totalS` long, or null when nothing happened. People react a
 *  few seconds after what they heard, so activity counts 10 s earlier than it
 *  arrived. When several starts are equally busy, the middle one is taken,
 *  so the busy stretch sits in the middle of the minute, not at its edge. */
export function busiestStart(buckets: number[], totalS: number, windowS: number): number | null {
  const n = Math.ceil(totalS / BUCKET_S);
  const w = Math.max(1, Math.round(windowS / BUCKET_S));
  const shift = 10 / BUCKET_S;
  const lastStart = Math.max(0, Math.floor(Math.max(0, totalS - windowS) / BUCKET_S));
  if (!n || !buckets.some((v) => v > 0)) return null;
  // What was said in bucket i, judged by the activity just after it.
  const at = (i: number) => {
    if (i < 0 || i >= n) return 0;
    let v = i + shift < n ? (buckets[i + shift] ?? 0) : 0;
    // Activity in the first 10 s has nothing before it: it counts at 0:00.
    if (i === 0) for (let j = 0; j < shift; j++) v += buckets[j] ?? 0;
    return v;
  };
  const sums: number[] = [];
  let sum = 0;
  for (let i = 0; i < w; i++) sum += at(i);
  sums.push(sum);
  for (let i = 1; i <= lastStart; i++) {
    sum += at(i + w - 1) - at(i - 1);
    sums.push(sum);
  }
  const best = Math.max(...sums);
  if (best <= 0) return null;
  const first = sums.indexOf(best);
  let last = first;
  while (last + 1 < sums.length && sums[last + 1] === best) last++;
  return Math.floor((first + last) / 2) * BUCKET_S;
}

function folder(): Directory {
  const dir = new Directory(Paths.document, 'live-recordings');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** The file a live's recording goes to, with its moments log started. A
 *  rejoin (app restarted mid-live) starts a new part instead of overwriting
 *  the first. */
export function newRecordingFile(liveId: string): File {
  const dir = folder();
  let n = 1;
  let f = new File(dir, `${liveId}_${n}.aac`);
  while (f.exists) {
    n++;
    f = new File(dir, `${liveId}_${n}.aac`);
  }
  beginMoments(liveId, f);
  return f;
}

/** Agora wants a plain path, not a file:// URI. */
export function nativePath(f: File): string {
  return decodeURIComponent(f.uri.replace(/^file:\/\//, ''));
}

/** The longest recording part of a live, or null when there is none. */
export function recordingFor(liveId: string): File | null {
  try {
    const parts = folder()
      .list()
      .filter((e): e is File => e instanceof File && e.name.startsWith(`${liveId}_`) && e.name.endsWith('.aac'))
      .filter((f) => (f.size ?? 0) > 4096);
    if (!parts.length) return null;
    return parts.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]!;
  } catch {
    return null;
  }
}

export function deleteRecordings(liveId: string) {
  try {
    for (const e of folder().list()) {
      if (e instanceof File && e.name.startsWith(`${liveId}_`)) e.delete();
    }
  } catch {}
}

/** Old recordings out: run once at start-up. Never throws. Only the .aac
 *  parts count towards the 3 kept; each one's moments log goes with it. */
export function cleanupRecordings() {
  try {
    const entries = folder().list();
    const files = entries
      .filter((e): e is File => e instanceof File && e.name.endsWith('.aac'))
      .map((f) => ({ f, at: f.info().modificationTime ?? 0 }))
      .sort((a, b) => b.at - a.at);
    const now = Date.now();
    files.forEach(({ f, at }, i) => {
      if (i >= KEEP_COUNT || now - at > KEEP_MS) {
        try {
          const m = momentsFileFor(f);
          if (m.exists) m.delete();
          f.delete();
        } catch {}
      }
    });
    // A moments log whose recording is gone.
    for (const e of entries) {
      if (e instanceof File && e.name.endsWith('.moments.json')) {
        const rec = new File(e.parentDirectory, e.name.replace(/\.moments\.json$/, '.aac'));
        if (!rec.exists) {
          try {
            e.delete();
          } catch {}
        }
      }
    }
  } catch {}
}
