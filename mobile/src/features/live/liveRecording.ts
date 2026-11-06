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

function folder(): Directory {
  const dir = new Directory(Paths.document, 'live-recordings');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** The file a live's recording goes to. A rejoin (app restarted mid-live)
 *  starts a new part instead of overwriting the first. */
export function newRecordingFile(liveId: string): File {
  const dir = folder();
  let n = 1;
  let f = new File(dir, `${liveId}_${n}.aac`);
  while (f.exists) {
    n++;
    f = new File(dir, `${liveId}_${n}.aac`);
  }
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

/** Old recordings out: run once at start-up. Never throws. */
export function cleanupRecordings() {
  try {
    const files = folder()
      .list()
      .filter((e): e is File => e instanceof File)
      .map((f) => ({ f, at: f.info().modificationTime ?? 0 }))
      .sort((a, b) => b.at - a.at);
    const now = Date.now();
    files.forEach(({ f, at }, i) => {
      if (i >= KEEP_COUNT || now - at > KEEP_MS) {
        try {
          f.delete();
        } catch {}
      }
    });
  } catch {}
}
