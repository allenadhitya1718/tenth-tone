// Port of the auth half of web/js/supabase.js. Every call throws the raw
// Supabase error; screens turn it into words with authErrorKey().
import { unregisterPush } from '@/features/notifications/push';

import { probeClient, supabase } from './supabase';

export async function signUp(p: { email: string; password: string; name: string; handle: string }) {
  // Refuse rather than send a blank: the profile trigger only replaces NULL,
  // so an empty name went straight through and made a nameless account.
  const name = p.name.trim();
  if (name.length < 2) throw new Error('name-required');
  // handle_new_user reads the handle from user metadata. Sent only when it
  // matches the database rule, so the trigger's generated fallback still
  // applies to accounts made any other way.
  const handle = p.handle.trim().toLowerCase();
  const data: Record<string, string> = { name };
  if (HANDLE_RE.test(handle)) data.handle = handle;
  const res = await supabase.auth.signUp({ email: p.email, password: p.password, options: { data } });
  if (res.error) throw res.error;
  // An address that already has an account comes back as a user with no
  // identities, no error and no email (so nobody can probe which addresses
  // are registered). Without this check the person waits for a code that
  // was never sent.
  const ident = res.data.user?.identities;
  return { alreadyRegistered: Array.isArray(ident) && ident.length === 0 };
}

// profiles.handle rule from migration 0007.
export const HANDLE_RE = /^[a-z0-9._]{3,30}$/;

export async function isHandleAvailable(handle: string) {
  const h = handle.trim().toLowerCase();
  if (h.length < 3) return false;
  const { data, error } = await supabase.from('profiles').select('id').eq('handle', h).limit(1);
  if (error) throw error;
  return !data?.length;
}

// Email only: Supabase auth is configured for email and password, and there
// is no SMS provider.
export async function signIn(p: { email: string; password: string }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: p.email, password: p.password });
  if (error) throw error;
  return data;
}

// Re-sends the original signup confirmation. signInWithOtp would send the
// Magic Link template instead, which carries a link rather than the code.
export async function resendSignup(email: string) {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) throw error;
}

// Signup confirmation is 'signup' on current projects; older ones issued
// 'email' or 'magiclink' codes, so those are tried in turn like the web app.
export async function verifySignupCode(email: string, token: string) {
  let last: unknown = null;
  for (const type of ['signup', 'email', 'magiclink'] as const) {
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type });
    if (!error) return data;
    last = error;
  }
  throw last;
}

// Recovery is by six digit code, not link: the app has no screen that would
// consume a link. The email template must include {{ .Token }}.
export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

export async function verifyRecoveryCode(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
  if (error) throw error;
  return data;
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

// Checks the current password on a client that never stores a session, so
// neither a wrong guess nor a right one rewrites the live session.
export async function verifyPassword(current: string) {
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) throw new Error('no-email');
  const probe = probeClient();
  const { error } = await probe.auth.signInWithPassword({ email, password: current });
  try {
    await probe.auth.signOut({ scope: 'local' });
  } catch {}
  if (!error) return true;
  if (/invalid login credentials/i.test(error.message)) return false;
  throw error;
}

export async function signInWithApple(token: string, nonce?: string) {
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce });
  if (error) throw error;
  return data;
}

export async function signOut() {
  // The token is removed while the session can still authorise the delete;
  // otherwise the next account on this phone gets the previous one's pushes.
  await unregisterPush().catch(() => {});
  await supabase.auth.signOut();
}

// The signup wizard collects a birthday, but there is no session to save it
// with until the code is verified. The table's trigger enforces the minimum
// age and that it cannot change afterwards.
export async function saveBirthDate(isoDate: string) {
  const { data } = await supabase.auth.getUser();
  const me = data.user?.id;
  if (!me) throw new Error('not signed in');
  const { error } = await supabase
    .from('user_private')
    .upsert({ user_id: me, birth_date: isoDate }, { onConflict: 'user_id' });
  if (error) throw error;
}

// Supabase refuses a repeat send with "...only request this after 57 seconds".
export function retryAfterSeconds(e: unknown): number {
  const hit = String((e as Error)?.message ?? '').match(/after (\d+) seconds?/i);
  return hit ? parseInt(hit[1], 10) : 0;
}

// Maps a Supabase auth error to a translation key under "errors.".
export function authErrorKey(e: unknown): { key: string; seconds?: number } {
  const m = String((e as Error)?.message ?? '');
  const wait = retryAfterSeconds(e);
  if (wait) return { key: 'errors.waitSeconds', seconds: wait };
  if (/Invalid login credentials/i.test(m)) return { key: 'errors.invalidLogin' };
  if (/Email not confirmed/i.test(m)) return { key: 'errors.emailNotConfirmed' };
  if (/User already registered/i.test(m)) return { key: 'errors.emailTaken' };
  if (/Password should be at least/i.test(m)) return { key: 'errors.passwordTooShort' };
  if (/expired|invalid.*(otp|token)|token.*(expired|invalid)/i.test(m)) return { key: 'errors.badCode' };
  if (/minimum age/i.test(m)) return { key: 'errors.tooYoung' };
  if (m === 'name-required') return { key: 'register.nameRequired' };
  if (/rate limit|too many/i.test(m)) return { key: 'errors.rateLimited' };
  if (/network|fetch/i.test(m)) return { key: 'errors.network' };
  return { key: 'errors.generic' };
}
