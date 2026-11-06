// Error reports (supabase/migrations/0164_app_errors.sql). Every error the
// app catches is logged, so a problem on someone's phone is seen and fixed
// instead of staying invisible.
//
// Reports go into a small queue on the phone first, then to the server. A
// fatal error reloads the app straight away (lib/crashGuard.ts), so its
// report is sent on the next start. Never throws, never blocks the UI.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export type ErrorKind = 'fatal' | 'screen' | 'handled';

type Report = {
  kind: ErrorKind;
  message: string;
  stack: string | null;
  screen: string | null;
  at: string;
};

const KEY = 'tt-error-reports';
const MAX_QUEUE = 20;
// The same error over and over (a render loop) is reported once a session.
const seen = new Set<string>();
let lastScreen: string | null = null;
let flushing = false;

/** The screen on show, kept current by the root layout. */
export function setErrorScreen(path: string) {
  lastScreen = path;
}

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack ?? null };
  const e = error as { message?: unknown; stack?: unknown } | null;
  if (e && typeof e.message === 'string') return { message: e.message, stack: typeof e.stack === 'string' ? e.stack : null };
  try {
    return { message: String(error), stack: null };
  } catch {
    return { message: 'Unknown error', stack: null };
  }
}

async function readQueue(): Promise<Report[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const q = raw ? (JSON.parse(raw) as Report[]) : [];
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

/** Queue an error; `send` false when the app is about to reload. */
export async function reportError(kind: ErrorKind, error: unknown, send = true): Promise<void> {
  try {
    if (__DEV__) return;
    const { message, stack } = describe(error);
    const sig = `${kind}|${message}|${lastScreen ?? ''}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    const q = await readQueue();
    q.push({ kind, message, stack, screen: lastScreen, at: new Date().toISOString() });
    await AsyncStorage.setItem(KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
    if (send) void flushErrorReports();
  } catch {}
}

/** Send what is queued. Called at start-up and after each report. */
export async function flushErrorReports(): Promise<void> {
  if (flushing || __DEV__) return;
  flushing = true;
  try {
    const q = await readQueue();
    const left: Report[] = [];
    for (const r of q) {
      const { error } = await supabase.rpc('report_app_error', {
        p_kind: r.kind,
        p_message: r.message,
        p_stack: r.stack,
        p_screen: r.screen,
        p_platform: `${Platform.OS} ${String(Platform.Version)}`,
        p_app_version: Constants.expoConfig?.version ?? null,
        p_update_id: Updates.updateId ?? 'embedded',
        p_channel: Updates.channel ?? null,
        p_happened_at: r.at,
      });
      // Offline or the server is down: keep it for next time.
      if (error) left.push(r);
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(left.slice(-MAX_QUEUE)));
  } catch {
  } finally {
    flushing = false;
  }
}
