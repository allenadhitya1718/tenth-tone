// Account security calls the settings screens need that lib/auth.ts does not
// have yet. Port of changeEmail / verifyEmailChange / signOutOtherDevices
// from web/js/supabase.js. Kept here rather than in lib/auth.ts so the
// settings work does not touch a file other features share.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

// The email on the live session, read locally (no network).
export async function currentEmail(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.email ?? null;
  } catch {
    return null;
  }
}

// Asks Supabase to move the account to a new address. Supabase mails the new
// address a six digit code (the "Change Email Address" template must include
// {{ .Token }}), which verifyEmailChange exchanges. With "secure email
// change" on, the current address gets its own code as well.
export async function requestEmailChange(newEmail: string) {
  const { error } = await supabase.auth.updateUser({ email: newEmail.trim().toLowerCase() });
  if (error) throw error;
}

export async function verifyEmailChange(newEmail: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: newEmail.trim().toLowerCase(),
    token,
    type: 'email_change',
  });
  if (error) throw error;
  return data;
}

// Ends every session but this one, after a password change. Best effort:
// the caller has already changed the password.
export async function signOutOtherDevices() {
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) throw error;
}

// The id recordSession() returned for this device, so the devices list can
// mark "this device". Whoever calls recordSession at startup should store it
// under this key (the web app used localStorage 'tt-session-id').
export const SESSION_ID_KEY = 'tt-session-id';

export async function thisSessionId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SESSION_ID_KEY);
  } catch {
    return null;
  }
}
