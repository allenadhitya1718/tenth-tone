// User settings, privacy, private details, app limits, guidelines, sessions,
// push tokens, client logs, data exports, support tickets, and account
// status (deactivation and deletion). Port of the matching sections of
// web/js/db.js.
//
// ApiError codes thrown here:
//   not_signed_in              (from requireUid in client.ts)
//   support_rate_limited       createSupportTicket: too many tickets, try later
//
// Caching: none here. Screens use settingsKeys with TanStack Query.
// updateUserSettings must invalidate settingsKeys.userSettings(), or the
// settings screen keeps showing the value you just changed.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { signOut } from '@/lib/auth';

import { ApiError, fireAndForget, requireUid, supabase, uid } from './client';
import type { Iso, Uuid } from './types';

export const settingsKeys = {
  userSettings: () => ['userSettings'] as const,
  mySettings: () => ['mySettings'] as const,
  privateDetails: () => ['privateDetails'] as const,
  birthDate: () => ['birthDate'] as const,
  isAdult: () => ['isAdult'] as const,
  canMessage: (id: Uuid) => ['canMessage', id] as const,
  appLimits: () => ['appLimits'] as const,
  guidelines: () => ['guidelinesAccepted'] as const,
  sessions: () => ['sessions'] as const,
  dataExports: () => ['dataExports'] as const,
  supportTickets: () => ['supportTickets'] as const,
  accountStatus: () => ['accountStatus'] as const,
};

// ---------- Types ----------

// 'following' means people I follow.
// TODO(client note 13): 'friends' (mutual follow) arrives with a later SQL
// migration that widens the check constraints on who_can_message /
// who_can_comment / who_can_tag. Until it runs, writing 'friends' fails the
// constraint, so the screens offer 'friends' and handle error 23514 by reverting with a message.
export type WhoCan = 'everyone' | 'following' | 'friends' | 'nobody';

export type UserSettings = {
  notif_likes: boolean;
  notif_comments: boolean;
  notif_follows: boolean;
  notif_messages: boolean;
  notif_live: boolean;
  notif_gifts: boolean;
  who_can_message: WhoCan;
  who_can_comment: WhoCan;
  who_can_tag: WhoCan;
  autoplay: boolean;
  data_saver: boolean;
  user_id?: Uuid;
  updated_at?: Iso;
};

export type UserSettingsPatch = Partial<Omit<UserSettings, 'user_id' | 'updated_at'>>;

const SETTINGS_DEFAULTS: UserSettings = {
  notif_likes: true,
  notif_comments: true,
  notif_follows: true,
  notif_messages: true,
  notif_live: true,
  notif_gifts: true,
  who_can_message: 'everyone',
  who_can_comment: 'everyone',
  who_can_tag: 'everyone',
  autoplay: true,
  data_saver: false,
};

export type Gender = 'male' | 'female' | 'other' | 'undisclosed';

export type PrivateDetails = {
  user_id: Uuid;
  gender: Gender | null;
  country: string | null; // ISO 3166-1 alpha-2
  birth_date: string | null;
  updated_at: Iso;
};

export type MySettings = {
  id?: Uuid;
  name?: string | null;
  handle?: string | null;
  is_private?: boolean;
  verified?: boolean;
};

export type AppLimits = {
  id: 1;
  max_video_bytes: number;
  user_daily_uploads: number;
  user_daily_bytes: number;
  global_max_bytes: number;
  updated_at: Iso;
};

export type AppLimitsPatch = Partial<Omit<AppLimits, 'id'>>;

export type UserSession = {
  id: Uuid;
  user_id: Uuid;
  device: string | null;
  platform: string | null;
  last_seen: Iso;
  created_at: Iso;
};

export type DataExport = {
  id: Uuid;
  user_id: Uuid;
  status: 'pending' | 'ready' | 'failed';
  file_url: string | null;
  requested_at: Iso;
  completed_at: Iso | null;
};

export type SupportCategory = 'bug' | 'account' | 'payment' | 'content' | 'safety' | 'other';

export type SupportTicket = {
  id: Uuid;
  user_id: Uuid | null;
  category: SupportCategory;
  subject: string | null;
  message: string;
  app_version: string | null;
  device: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  admin_reply: string | null;
  replied_at: Iso | null;
  replied_by: Uuid | null;
  created_at: Iso;
};

export type AccountStatus = {
  deactivated: boolean;
  deactivated_at: Iso | null;
  deletion_scheduled_at: Iso | null;
  days_left: number | null;
};

export type PushPlatform = 'ios' | 'android' | 'web';

// ---------- Client info ----------
// The web app read these from navigator.userAgent and TT_CONFIG.

function appVersion(): string {
  return Constants.expoConfig?.version ?? '';
}

function deviceLabel(): string {
  return `${Platform.OS} ${String(Platform.Version)}`.slice(0, 200);
}

// ---------- User settings ----------
// The database enforces these (0027); they are not just client preferences.

export async function fetchUserSettings(): Promise<UserSettings> {
  const me = await uid();
  if (!me) return { ...SETTINGS_DEFAULTS };
  const { data, error } = await supabase.from('user_settings').select('*').eq('user_id', me).maybeSingle();
  if (error) return { ...SETTINGS_DEFAULTS }; // table not there yet -> defaults
  return { ...SETTINGS_DEFAULTS, ...((data as Partial<UserSettings> | null) ?? {}) };
}

export async function updateUserSettings(patch: UserSettingsPatch): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: me, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

// Can I open a DM with this person? Honours their "who can message me"
// choice and any block they have on me.
// TODO(client note 13): may_message gains the 'friends' (mutual follow) case
// in the same later migration; nothing changes on this side.
export async function canMessage(targetId: Uuid): Promise<boolean> {
  const me = await uid();
  if (!me) return false;
  const { data, error } = await supabase.rpc('may_message', { p_target: targetId, p_actor: me });
  if (error) return true; // function not deployed yet - do not block the user
  return data !== false;
}

// ---------- Privacy ----------

// The profile fields the settings screen needs, including is_private so the
// toggle shows the stored state.
export async function fetchMySettings(): Promise<MySettings> {
  const me = await uid();
  if (!me) return {};
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, handle, is_private, verified')
    .eq('id', me)
    .maybeSingle();
  if (error) throw error;
  return (data as MySettings | null) ?? {};
}

export async function setPrivate(isPrivate: boolean): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase.from('profiles').update({ is_private: !!isPrivate }).eq('id', me);
  if (error) throw error;
}

// ---------- Private details ----------
// Gender and country live in user_private because public.profiles is
// world-readable, anon included (0022). saveBirthDate is in lib/auth.ts.

export async function fetchMyPrivateDetails(): Promise<PrivateDetails | null> {
  const me = await uid();
  if (!me) return null;
  const { data, error } = await supabase.from('user_private').select('*').eq('user_id', me).maybeSingle();
  if (error) throw error;
  return (data as PrivateDetails | null) ?? null;
}

// The birthday is written once at signup and a trigger refuses later edits,
// because it is what the 18+ location gate reads.
export async function getMyBirthDate(): Promise<string | null> {
  const me = await uid();
  if (!me) return null;
  const { data, error } = await supabase.from('user_private').select('birth_date').eq('user_id', me).maybeSingle();
  if (error) return null;
  return (data as { birth_date: string | null } | null)?.birth_date ?? null;
}

export async function isAdult(): Promise<boolean> {
  const me = await uid();
  if (!me) return false;
  const { data, error } = await supabase.rpc('is_adult', { p_user: me });
  if (error) return false; // migration not applied yet - treat as not proven
  return data === true;
}

export async function saveMyPrivateDetails({
  gender = null,
  country = null,
}: {
  gender?: Gender | null;
  country?: string | null;
}): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase
    .from('user_private')
    .upsert({ user_id: me, gender, country }, { onConflict: 'user_id' });
  if (error) throw error;
}

// ---------- App limits (admin) ----------
// Neither storage provider offers a hard spending cap, so the ceiling lives
// in this row and a storage policy enforces it.

export async function fetchAppLimits(): Promise<AppLimits | null> {
  const { data, error } = await supabase.from('app_limits').select('*').eq('id', 1).maybeSingle();
  if (error) return null;
  return (data as AppLimits | null) ?? null;
}

export async function updateAppLimits(fields: AppLimitsPatch): Promise<void> {
  const { error } = await supabase.from('app_limits').update(fields).eq('id', 1);
  if (error) throw error;
}

// ---------- Community Guidelines (required before first publish) ----------

export async function hasAcceptedGuidelines(): Promise<boolean> {
  const me = await uid();
  if (!me) return false;
  const { data, error } = await supabase.from('profiles').select('guidelines_accepted_at').eq('id', me).single();
  if (error) return false;
  return !!(data as { guidelines_accepted_at: Iso | null } | null)?.guidelines_accepted_at;
}

export async function acceptGuidelines(): Promise<void> {
  await requireUid();
  const { error } = await supabase.rpc('accept_guidelines');
  if (error) throw error;
}

// ---------- Client logs ----------
// One line from the phone at a point that matters (0088), read by admins.
// Best effort: never throws and is never awaited, so a failed log cannot
// fail the thing it was logging. The app version goes in every line: a fix
// that "did not work" is very different from one that was never installed.
export function logClient(kind: string, detail?: unknown): void {
  fireAndForget(
    (async () => {
      try {
        const me = await uid();
        if (!me) return;
        const base =
          detail && typeof detail === 'object'
            ? (detail as Record<string, unknown>)
            : { value: String(detail ?? '').slice(0, 500) };
        await supabase.from('client_logs').insert({
          user_id: me,
          kind: String(kind).slice(0, 60),
          detail: { v: appVersion(), ...base },
          ua: deviceLabel(),
        });
      } catch {
        // a log is never worth an error
      }
    })(),
    'logClient',
  );
}

// ---------- Push tokens ----------
// One row per (account, device token), primary key (user_id, token).
// Upserted on every registration so an existing token just refreshes its
// language and time. Remove it on sign-out, BEFORE the session ends: after
// signOut nothing can authorise the delete, and the phone would keep getting
// the old account's notifications.

// The nine app languages (src/i18n/index.ts LANGUAGES). 'zh-CN' -> 'zh'.
const PUSH_LANGS = ['ar', 'en', 'zh', 'hi', 'ur', 'fr', 'es', 'tr', 'id'];
function pushLang(code: string): string {
  const base = String(code || '').trim().toLowerCase().split(/[-_]/)[0];
  return PUSH_LANGS.includes(base) ? base : 'en';
}

export async function savePushToken(token: string, platform: string, lang: string): Promise<void> {
  const me = await uid();
  if (!me || !token) return;
  const row = {
    user_id: me,
    token: String(token),
    platform: (platform === 'ios' || platform === 'android' ? platform : 'web') as PushPlatform,
    // The language the app runs in: send-push writes every push in it (and
    // English for a code it does not know).
    lang: pushLang(lang),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('push_tokens').upsert(row, { onConflict: 'user_id,token' });
  if (error) throw error;
}

export async function removePushToken(token: string): Promise<void> {
  const me = await uid();
  if (!me || !token) return;
  await supabase.from('push_tokens').delete().eq('user_id', me).eq('token', String(token));
}

// ---------- Sessions / login alerts ----------

// `device` is a label like "iPhone 15 · iOS". Use a separator, never a
// connector word: the value is stored and frozen at sign-in, so "on" or its
// Arabic equivalent would sit in the wrong language forever for anyone who
// switches. `platform` is free text in record_session; the web app wrote
// 'mobile' for every phone and 'web' otherwise. The server matches an
// existing session on (device, platform), so any new pair is a new row and
// raises a "new sign-in" alert.
//
// Returns the session row id. The caller keeps it (the web app used
// localStorage) so the devices list can mark the row it is being read on.
export async function recordSession(device: string, platform: string): Promise<Uuid | null> {
  const me = await uid();
  if (!me) return null;
  const { data, error } = await supabase.rpc('record_session', { p_device: device, p_platform: platform });
  if (error) return null; // migration not applied yet
  return (data as Uuid | null) ?? null;
}

export async function fetchMySessions(): Promise<UserSession[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase
    .from('user_sessions')
    .select('*')
    .eq('user_id', me)
    .order('last_seen', { ascending: false });
  if (error) return [];
  return (data as UserSession[] | null) ?? [];
}

export async function revokeSession(id: Uuid): Promise<void> {
  const me = await uid();
  if (!me) return;
  const { error } = await supabase.from('user_sessions').delete().eq('id', id).eq('user_id', me);
  if (error) throw error;
}

// ---------- Download your data ----------

export async function requestDataExport(): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase.from('data_export_requests').insert({ user_id: me });
  // A unique index allows only one pending request, so a second tap is a
  // no-op rather than an error the user has to read.
  if (error && error.code !== '23505') throw error;
}

export async function fetchDataExports(): Promise<DataExport[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase
    .from('data_export_requests')
    .select('*')
    .eq('user_id', me)
    .order('requested_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data as DataExport[] | null) ?? [];
}

// ---------- Support ----------

export async function createSupportTicket({
  category,
  subject,
  message,
  device,
}: {
  category?: SupportCategory | null;
  subject?: string | null;
  message: string;
  // Defaults to "<os> <version>"; pass a richer label (expo-device) if known.
  device?: string;
}): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase.from('support_tickets').insert({
    user_id: me,
    category: category || 'other',
    subject: subject || null,
    message,
    app_version: appVersion() || 'unknown',
    device: (device ?? deviceLabel()).slice(0, 200),
  });
  if (error) {
    if (/too many reports/i.test(error.message || '')) throw new ApiError('support_rate_limited', error.message, error);
    throw error;
  }
}

export async function fetchMySupportTickets(): Promise<SupportTicket[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return [];
  return (data as SupportTicket[] | null) ?? [];
}

// ---------- Account status ----------
// Deactivate hides the account and destroys nothing. Deletion is scheduled
// 30 days out and cancelled by signing back in, so the warning shown is
// actually true.
//
// The functions that end with a sign-out take an optional push token: the
// web app's signOut dropped this phone's token first, while the session could
// still authorise the delete.

async function signOutQuietly(pushToken?: string | null) {
  try {
    if (pushToken) await removePushToken(pushToken);
  } catch {}
  try {
    await signOut();
  } catch {}
}

export async function fetchAccountStatus(): Promise<AccountStatus | null> {
  const me = await uid();
  if (!me) return null;
  const { data, error } = await supabase.rpc('my_account_status');
  if (error) return null; // migration not applied yet
  return (data as AccountStatus | null) ?? null;
}

export async function deactivateAccount(pushToken?: string | null): Promise<void> {
  const { error } = await supabase.rpc('deactivate_account');
  if (error) throw error;
  await signOutQuietly(pushToken);
}

export async function reactivateAccount(): Promise<void> {
  const { error } = await supabase.rpc('reactivate_account');
  if (error) throw error;
}

// Returns when the deletion will happen.
export async function scheduleAccountDeletion(pushToken?: string | null): Promise<Iso | null> {
  const { data, error } = await supabase.rpc('schedule_account_deletion');
  if (error) throw error;
  await signOutQuietly(pushToken);
  return (data as Iso | null) ?? null;
}

export async function cancelAccountDeletion(): Promise<void> {
  const { error } = await supabase.rpc('cancel_account_deletion');
  if (error) throw error;
}

export async function selfDeleteAccount(pushToken?: string | null): Promise<void> {
  const { error } = await supabase.rpc('self_delete_account');
  if (error) throw error;
  await signOutQuietly(pushToken);
}
