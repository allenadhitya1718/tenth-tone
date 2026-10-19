// "@handle" for display. A handle is Latin text; next to Arabic or Urdu text
// the bidi algorithm lets the neutral "@" follow the surrounding direction, so
// it showed as "devesh19@" (and "with @devesh19" scrambled). The Unicode
// isolates (LRI ... PDI) keep "@" and the handle together, left to right,
// whatever the language. Do not use it for copy/paste values or search.
export const atHandle = (handle: string | null | undefined): string =>
  handle ? `⁦@${handle.replace(/^@/, '')}⁩` : '';
