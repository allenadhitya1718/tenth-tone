// Links from the system into the app. A photo or video shared into FLYP
// from another app arrives as flyp://dataUrl=flypShareKey (expo-share-intent);
// that is not a page, so it opens the Share screen instead. Everything else
// passes through unchanged.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes('dataUrl=')) return '/share';
  } catch {}
  return path;
}
