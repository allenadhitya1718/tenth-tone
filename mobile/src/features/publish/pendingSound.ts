import { useSyncExternalStore } from 'react';

// The sound picked with "Use this sound" on a sound page, waiting for the
// Post screen. A module-level store because the camera sits between the two
// screens and does not carry it. The camera does not play or mix the sound
// yet; the post is linked to it (videos.sound_id), which is what puts the
// video on the sound's page and counts the use.
export type PendingSound = { id: string; title: string | null; setAt: number };

// A pick nobody posted within this window is stale (forgotten tap).
const MAX_AGE_MS = 60 * 60 * 1000;

let current: PendingSound | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function setPendingSound(sound: { id: string; title: string | null }) {
  current = { id: sound.id, title: sound.title, setAt: Date.now() };
  emit();
}

export function getPendingSound(): PendingSound | null {
  if (current && Date.now() - current.setAt > MAX_AGE_MS) {
    current = null;
  }
  return current;
}

export function clearPendingSound() {
  if (!current) return;
  current = null;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function usePendingSound(): PendingSound | null {
  return useSyncExternalStore(subscribe, getPendingSound, getPendingSound);
}
