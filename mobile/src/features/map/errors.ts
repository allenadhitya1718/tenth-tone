// Translation key for a failed location call. The database raises
// "location sharing requires 18+" (0036) for anyone not proven adult.
export function locationErrorKey(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? '';
  if (/18\+|requires 18/i.test(msg)) return 'map.errAdult';
  if (/not.signed.in/i.test(msg) || (e as { code?: string } | null)?.code === 'not_signed_in') return 'map.errSignedOut';
  return 'map.errGeneric';
}
