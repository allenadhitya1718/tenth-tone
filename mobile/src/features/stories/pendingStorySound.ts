import type { Sound } from '@/api/sounds';

// "Use this sound" on a sound page opens a new story with that song already
// chosen (posting videos was removed, Nov 2026). The composer reads it when
// it opens and clears it.
let pending: { sound: Sound; at: number } | null = null;
const MAX_AGE_MS = 10 * 60_000;

export function setPendingStorySound(sound: Sound) {
  pending = { sound, at: Date.now() };
}

export function peekPendingStorySound(): Sound | null {
  return pending && Date.now() - pending.at < MAX_AGE_MS ? pending.sound : null;
}

export function clearPendingStorySound() {
  pending = null;
}
