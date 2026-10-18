// Camera filters as 4x5 colour matrices (Skia/Android ColorMatrix layout:
// row-major RGBA rows, fifth column is an offset in 0..1, NOT 0..255). One
// matrix drives both the live Skia preview and the native re-encode after
// recording (CIColorMatrix bias on iOS, the GL matrix's 4th column on
// Android, both in 0..1), so the posted file looks exactly like the preview.
//
// Every matrix works on gamma-encoded RGB in 0..1, which is what Skia and
// both exporters hand it. The looks are modelled on the character of the
// classic Instagram/Snapchat colour filters but are our own tunings and names.

export type ColorMatrix = readonly number[];

export const FILTER_IDS = [
  'normal',
  'crisp',
  'golden',
  'breeze',
  'film',
  'dusk',
  'pastel',
  'retro',
  'cinema',
  'vivid',
  'silver',
  'ink',
] as const;
export type FilterId = (typeof FILTER_IDS)[number];

const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

// Rec. 709 luma, the same weights the video itself is encoded with.
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

/** Per-channel affine: out = in * gain + offset. */
function affine(gain: readonly number[], offset: readonly number[] = [0, 0, 0]): ColorMatrix {
  return [gain[0], 0, 0, 0, offset[0], 0, gain[1], 0, 0, offset[1], 0, 0, gain[2], 0, offset[2], 0, 0, 0, 1, 0];
}

/** 0 = greyscale, 1 = unchanged, >1 = richer. Keeps luma constant. */
function saturation(s: number): ColorMatrix {
  const r = LR * (1 - s);
  const g = LG * (1 - s);
  const b = LB * (1 - s);
  return [r + s, g, b, 0, 0, r, g + s, b, 0, 0, r, g, b + s, 0, 0, 0, 0, 0, 1, 0];
}

/** Scales around mid grey so shadows and highlights move apart together. */
function contrast(c: number): ColorMatrix {
  const o = (1 - c) / 2;
  return affine([c, c, c], [o, o, o]);
}

/** Multiplicative brightness: blacks stay black, everything else scales. */
function exposure(e: number): ColorMatrix {
  return affine([e, e, e]);
}

/**
 * White balance as channel gains, renormalised so a neutral grey keeps its
 * luma: only the hue of the light changes, not the exposure.
 */
function balance(r: number, g: number, b: number): ColorMatrix {
  const k = 1 / (LR * r + LG * g + LB * b);
  return affine([r * k, g * k, b * k]);
}

/** Warm (+) / cool (-) shift along the blue-amber axis. */
const temperature = (t: number) => balance(1 + t, 1, 1 - t);
/** Magenta (+) / green (-) shift. */
const tint = (m: number) => balance(1 + m / 2, 1 - m, 1 + m / 2);

/**
 * Per-channel levels: maps black to `shadows` and white to `highlights`.
 * Lifting the shadows is the "faded film" look; giving shadows and highlights
 * different colours is a simple split tone (e.g. teal shadows, warm whites).
 */
function levels(shadows: readonly number[], highlights: readonly number[]): ColorMatrix {
  return affine(
    [0, 1, 2].map((i) => highlights[i] - shadows[i]),
    shadows,
  );
}

const SEPIA: ColorMatrix = [0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0];

function mix(a: ColorMatrix, b: ColorMatrix, t: number): ColorMatrix {
  return a.map((v, i) => v * (1 - t) + b[i] * t);
}

/** a ∘ b: applies b first, then a. */
export function compose(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out: number[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let v = col === 4 ? a[row * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += a[row * 5 + k] * b[k * 5 + col];
      out.push(v);
    }
  }
  return out;
}

/** Applies the steps left to right. */
const chain = (...ms: ColorMatrix[]) => ms.reduce((acc, m) => compose(m, acc), IDENTITY);

// Order inside each look: white balance, exposure, contrast, saturation, then
// levels last so the fade/split tone sits on top of the graded image the way
// a film stock's base colour would.
const MATRICES: Record<FilterId, ColorMatrix> = {
  normal: IDENTITY,
  // Bright, clean pop: punchier contrast and colour, slightly cool shadows.
  crisp: chain(exposure(1.02), contrast(1.12), saturation(1.16), levels([0, 0.01, 0.03], [1, 1, 1])),
  // Golden-hour glow: warm light, a little brighter and softer, honey blacks.
  golden: chain(temperature(0.08), exposure(1.04), contrast(0.95), saturation(1.1), levels([0.04, 0.025, 0], [1, 0.98, 0.95])),
  // Cool and airy: bright, lower contrast, gently desaturated, blue-grey lift.
  breeze: chain(temperature(-0.07), exposure(1.07), contrast(0.9), saturation(0.9), levels([0.04, 0.05, 0.07], [1, 1, 1])),
  // Faded film: muted colour, low contrast, milky lifted blacks, cream whites.
  film: chain(temperature(0.03), contrast(0.9), saturation(0.72), levels([0.1, 0.09, 0.08], [0.98, 0.96, 0.92])),
  // High-contrast moody: darker, deep shadows, cooled and desaturated.
  dusk: chain(temperature(-0.04), exposure(0.92), contrast(1.28), saturation(0.75), levels([0.02, 0.03, 0.05], [0.98, 0.98, 0.98])),
  // Soft pastel: light, flat and powdery with a faint pink cast.
  pastel: chain(tint(0.04), exposure(1.06), contrast(0.82), saturation(0.7), levels([0.11, 0.08, 0.1], [1, 0.97, 0.99])),
  // Vintage warm: a touch of sepia, plum shadows and creamy highlights.
  retro: chain(
    mix(IDENTITY, SEPIA, 0.22),
    temperature(0.06),
    contrast(0.9),
    saturation(0.88),
    levels([0.08, 0.05, 0.1], [1, 0.95, 0.85]),
  ),
  // Teal-orange cinematic: teal shadows, warm skin and highlights.
  cinema: chain(contrast(1.12), saturation(1.05), levels([0, 0.06, 0.12], [1.06, 0.98, 0.84])),
  // Rich and vivid: strong saturation with a bit more contrast.
  vivid: chain(exposure(1.02), contrast(1.1), saturation(1.45)),
  // Soft black & white: gentle contrast, lifted silvery blacks.
  silver: chain(saturation(0), contrast(0.95), levels([0.06, 0.06, 0.06], [0.97, 0.97, 0.97])),
  // High-contrast black & white: deep blacks, bright whites.
  ink: chain(saturation(0), exposure(1.02), contrast(1.32)),
};

// "Beauty" is a tonal soften (slight lift, lower contrast, a touch warm) that
// flatters skin. It is not a skin-smoothing blur: that needs a per-pixel
// shader that is hard to reproduce identically in the export pipelines.
const BEAUTY: ColorMatrix = chain(contrast(0.92), affine([1.03, 1.0, 0.97], [0.03, 0.025, 0.02]));

export function filterMatrix(id: FilterId, beauty: boolean): ColorMatrix {
  const base = MATRICES[id];
  return beauty ? compose(base, BEAUTY) : base;
}

export function isIdentity(m: ColorMatrix): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-6);
}

function apply(m: ColorMatrix, rgb: readonly number[]): string {
  const ch = [0, 1, 2].map((row) => {
    let v = m[row * 5 + 4] + m[row * 5 + 3];
    for (let k = 0; k < 3; k++) v += m[row * 5 + k] * rgb[k];
    return Math.round(Math.max(0, Math.min(1, v)) * 255);
  });
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

// A tiny "scene" (sky, skin, foliage in shadow) run through the matrix, drawn
// as bands inside the round strip thumbnail so each look reads at a glance.
const SCENE = [
  [0.5, 0.68, 0.9],
  [0.86, 0.66, 0.55],
  [0.22, 0.32, 0.2],
] as const;

export function swatchColors(id: FilterId): string[] {
  return SCENE.map((rgb) => apply(MATRICES[id], rgb));
}
