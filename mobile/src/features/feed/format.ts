// 1234 -> 1.2K, 2500000 -> 2.5M. Kept short so the rail stays narrow.
export function formatCount(n: number | null | undefined) {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${trim(v / 1000)}K`;
  return `${trim(v / 1_000_000)}M`;
}

const trim = (x: number) => (x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ''));
