// Same Supabase project as the web app (web/js/supabase.js). The publishable
// key is meant to ship in clients; row-level security does the guarding.
// EXPO_PUBLIC_* overrides let a build point at a staging project instead.
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://qnzgxihlrwanywndcmpf.supabase.co';
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_dMa7Ce6Gml-NC4bCmbsC9Q_DR16xAdf';

// Must match Supabase: Authentication -> Sign In / Providers -> Email OTP Length.
export const OTP_LENGTH = 6;

// Supabase will not send another code for 60 seconds.
export const RESEND_COOLDOWN = 60;

export const MIN_AGE = 13;
