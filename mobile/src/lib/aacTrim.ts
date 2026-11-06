// Cut a stretch out of an AAC recording without re-encoding it.
//
// The host's phone records the live as ADTS AAC (Agora startAudioRecording,
// features/live/liveRecording.ts). ADTS is a plain run of audio frames, each
// with a 7-byte header giving its length, and every frame holds 1024 samples.
// So a highlight is simply the bytes of the frames between two times: no
// native code, no quality loss, and the phone reads the file in 256 KB pieces
// (a two-hour recording never sits in memory at once).
import { File, FileMode } from 'expo-file-system';

const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const CHUNK = 256 * 1024;

export type TrimResult = { durationMs: number; bytes: number };

export class NotAacError extends Error {
  constructor() {
    super('not_adts_aac');
  }
}

/**
 * Copies [startMs, startMs + durationMs) of `src` into `dest` (overwritten).
 * A recording shorter than that yields what there is from startMs on.
 */
export async function trimAac(src: File, dest: File, startMs: number, durationMs: number): Promise<TrimResult> {
  const handle = src.open(FileMode.ReadOnly);
  try {
    const size = handle.size ?? 0;
    let base = 0; // file offset of buf[0]
    let buf = new Uint8Array(0);
    let t = 0; // ms at the start of the current frame
    let frameMs = 0;
    let frames = 0;
    let startOff = -1;
    let endOff = -1;
    let startT = 0;

    outer: while (base + buf.length < size || buf.length >= 7) {
      // Top up the buffer.
      if (buf.length < 8192 && base + buf.length < size) {
        handle.offset = base + buf.length;
        const more = await handle.readBytes(Math.min(CHUNK, size - (base + buf.length)));
        const joined = new Uint8Array(buf.length + more.length);
        joined.set(buf);
        joined.set(more, buf.length);
        buf = joined;
      }
      let i = 0;
      while (i + 7 <= buf.length) {
        // ADTS sync word: 12 bits set.
        if (buf[i] !== 0xff || (buf[i + 1]! & 0xf0) !== 0xf0) {
          i++;
          continue;
        }
        const len = ((buf[i + 3]! & 0x03) << 11) | (buf[i + 4]! << 3) | ((buf[i + 5]! & 0xe0) >> 5);
        if (len < 7) {
          i++;
          continue;
        }
        if (i + len > buf.length && base + buf.length < size) break; // finish this frame next round
        if (!frameMs) {
          const sr = SAMPLE_RATES[(buf[i + 2]! >> 2) & 0x0f];
          if (!sr) throw new NotAacError();
          frameMs = (1024 * 1000) / sr;
        }
        if (startOff < 0 && t + frameMs > startMs) {
          startOff = base + i;
          startT = t;
        }
        t += frameMs;
        frames++;
        if (startOff >= 0 && t >= startT + durationMs) {
          endOff = Math.min(base + i + len, size);
          break outer;
        }
        i += len;
      }
      // Keep the unread tail and move on.
      base += i;
      buf = buf.slice(i);
      if (base + buf.length >= size && buf.length < 7) break;
      if (i === 0 && base + buf.length >= size) break;
    }

    if (!frames || !frameMs) throw new NotAacError();
    if (startOff < 0) throw new RangeError('start_after_end');
    if (endOff < 0) endOff = size;

    handle.offset = startOff;
    const bytes = await handle.readBytes(endOff - startOff);
    if (dest.exists) dest.delete();
    dest.create();
    await dest.write(bytes);
    return { durationMs: Math.round(Math.min(t, startT + durationMs) - startT), bytes: bytes.length };
  } finally {
    handle.close();
  }
}
