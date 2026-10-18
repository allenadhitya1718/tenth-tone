// The Mumbai Supabase project (vfkwipvinmnybilcrdzr). The publishable key is
// meant to ship in clients; row-level security does the guarding.
// EXPO_PUBLIC_* overrides (eas.json / EAS environments / .env.local) let a
// build point at another project; they win when set.
//
// The fallback is Mumbai's PUBLIC url and publishable key, never the old
// project: a build with no env used to talk to qnzgxihlrwanywndcmpf without
// anyone noticing. A value that is set but malformed is a configuration
// error and stops the app at startup rather than half-working.
const MUMBAI_URL = 'https://vfkwipvinmnybilcrdzr.supabase.co';
const MUMBAI_PUBLISHABLE_KEY = 'sb_publishable_dgWbaJlmKOgP3VDEriA7Lg_LDHOiomD';

function pick(value: string | undefined, fallback: string) {
  const v = (value ?? '').trim();
  return v || fallback;
}

export const SUPABASE_URL = pick(process.env.EXPO_PUBLIC_SUPABASE_URL, MUMBAI_URL);
export const SUPABASE_ANON_KEY = pick(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, MUMBAI_PUBLISHABLE_KEY);

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPABASE_URL)) {
  throw new Error('FLYP config: EXPO_PUBLIC_SUPABASE_URL must be https://<project-ref>.supabase.co');
}
if (!SUPABASE_ANON_KEY.startsWith('sb_publishable_') && !SUPABASE_ANON_KEY.startsWith('eyJ')) {
  throw new Error('FLYP config: EXPO_PUBLIC_SUPABASE_ANON_KEY is not a publishable / anon key');
}
// Must match Supabase: Authentication -> Sign In / Providers -> Email OTP Length.
export const OTP_LENGTH = 6;

// Supabase will not send another code for 60 seconds.
export const RESEND_COOLDOWN = 60;

export const MIN_AGE = 13;
