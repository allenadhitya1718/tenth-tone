// Face effects: vector sprites that are anchored to a tracked face. Everything
// here is plain data and plain maths (no Skia, no native calls) so it runs in
// the camera's worklet runtime for the live preview, on the JS thread for the
// thumbnails and for the post-recording timeline that the native export
// replays frame by frame.
//
// Coordinates: sprites are drawn in "face units": the origin is the midpoint
// between the eyes, +x runs along the eye line (to the right on screen), +y is
// "down the face", and 1 unit is the distance between the two eyes.

export const FACE_FX_IDS = ['dog', 'cat', 'bunny', 'shades', 'glasses', 'crown', 'hearts', 'sweet', 'hero', 'halo'] as const;
export type FaceFxId = (typeof FACE_FX_IDS)[number];

// ---------------------------------------------------------------- sprite art

export type Op =
  // A path in an SVG subset: absolute M, L, C, Q, Z only (parsed by Skia in JS
  // and by a tiny parser in the native export).
  | { k: 'p'; d: string; f?: string; s?: string; w?: number; o?: number }
  | { k: 'e'; cx: number; cy: number; rx: number; ry: number; f?: string; s?: string; w?: number; o?: number }
  // A soft disc: radial gradient from colour c at alpha a0 (centre) to alpha a1 (edge).
  | { k: 'g'; cx: number; cy: number; r: number; c: string; a0: number; a1: number };
export type Sprite = Op[];

const HEART = 'M 0 0.35 C -0.55 -0.1 -0.35 -0.55 0 -0.25 C 0.35 -0.55 0.55 -0.1 0 0.35 Z';
const STAR = 'M 0 -0.3 C 0.04 -0.08 0.08 -0.04 0.3 0 C 0.08 0.04 0.04 0.08 0 0.3 C -0.04 0.08 -0.08 0.04 -0.3 0 C -0.08 -0.04 -0.04 -0.08 0 -0.3 Z';

export const S_DOG_EAR = 0;
export const S_DOG_NOSE = 1;
export const S_TONGUE = 2;
export const S_CAT_EAR = 3;
export const S_CAT_NOSE = 4;
export const S_WHISKERS = 5;
export const S_BUNNY_EAR = 6;
export const S_BUNNY_NOSE = 7;
export const S_TEETH = 8;
export const S_SHADES = 9;
export const S_ROUND = 10;
export const S_CROWN = 11;
export const S_HEART = 12;
export const S_BLUSH = 13;
export const S_FRECKLES = 14;
export const S_MASK = 15;
export const S_HALO = 16;
export const S_SPARK = 17;

export const SPRITES: Sprite[] = [
  // 0 dog ear (left, origin at the attachment point; the right one is mirrored)
  [
    { k: 'p', d: 'M 0 0 C -0.55 -0.2 -1.0 0.1 -0.95 0.8 C -0.92 1.25 -0.55 1.45 -0.3 1.1 C -0.12 0.8 0.05 0.45 0 0 Z', f: '#7A4A22', s: '#4E2D12', w: 0.04 },
    { k: 'p', d: 'M -0.12 0.1 C -0.5 0 -0.8 0.25 -0.75 0.75 C -0.72 1.0 -0.5 1.1 -0.38 0.9 C -0.25 0.7 -0.1 0.4 -0.12 0.1 Z', f: '#A36A3A' },
  ],
  // 1 dog nose
  [
    { k: 'e', cx: 0, cy: 0, rx: 0.21, ry: 0.15, f: '#1B1B1B' },
    { k: 'e', cx: -0.07, cy: -0.05, rx: 0.06, ry: 0.035, f: '#FFFFFF', o: 0.55 },
  ],
  // 2 tongue (origin at the mouth line)
  [
    { k: 'p', d: 'M -0.2 0 L 0.2 0 C 0.23 0.3 0.12 0.52 0 0.52 C -0.12 0.52 -0.23 0.3 -0.2 0 Z', f: '#FF6B81', s: '#D94A63', w: 0.02 },
    { k: 'p', d: 'M 0 0.04 L 0 0.3', s: '#D94A63', w: 0.025 },
  ],
  // 3 cat ear (left; origin at the base centre, tip up)
  [
    { k: 'p', d: 'M -0.5 0.15 L -0.2 -0.95 L 0.45 -0.05 Z', f: '#8E8E93', s: '#8E8E93', w: 0.06 },
    { k: 'p', d: 'M -0.32 0.05 L -0.2 -0.62 L 0.2 -0.05 Z', f: '#F4A8B8' },
  ],
  // 4 cat nose and mouth
  [
    { k: 'p', d: 'M -0.13 -0.07 L 0.13 -0.07 L 0 0.09 Z', f: '#F06292', s: '#F06292', w: 0.03 },
    { k: 'p', d: 'M 0 0.09 L 0 0.22 M -0.22 0.3 C -0.1 0.33 -0.03 0.27 0 0.22 M 0.22 0.3 C 0.1 0.33 0.03 0.27 0 0.22', s: '#4E342E', w: 0.03 },
  ],
  // 5 whiskers (left side, reaching to -x; mirrored for the right)
  [
    { k: 'p', d: 'M 0 0 L -0.95 -0.2 M 0 0.07 L -1.0 0.08 M 0 0.14 L -0.9 0.38', s: '#000000', w: 0.07, o: 0.22 },
    { k: 'p', d: 'M 0 0 L -0.95 -0.2 M 0 0.07 L -1.0 0.08 M 0 0.14 L -0.9 0.38', s: '#FFFFFF', w: 0.035, o: 0.95 },
  ],
  // 6 bunny ear (left, origin at the base)
  [
    { k: 'p', d: 'M 0.28 0 C -0.2 -0.4 -0.45 -1.5 -0.2 -2.35 C -0.05 -2.8 0.35 -2.7 0.42 -2.2 C 0.5 -1.5 0.5 -0.6 0.28 0 Z', f: '#FFFFFF', s: '#D9D9DE', w: 0.035 },
    { k: 'p', d: 'M 0.22 -0.2 C -0.05 -0.7 -0.16 -1.5 -0.03 -2.15 C 0.05 -2.45 0.28 -2.4 0.32 -2.1 C 0.36 -1.5 0.34 -0.8 0.22 -0.2 Z', f: '#FFB6C8' },
  ],
  // 7 bunny nose
  [{ k: 'p', d: 'M -0.12 -0.06 C -0.1 -0.13 0.1 -0.13 0.12 -0.06 C 0.12 0.02 0.03 0.1 0 0.1 C -0.03 0.1 -0.12 0.02 -0.12 -0.06 Z', f: '#FF8FA8', s: '#E56F8A', w: 0.02 }],
  // 8 bunny teeth
  [
    { k: 'p', d: 'M -0.15 0 L -0.01 0 L -0.01 0.2 C -0.01 0.25 -0.15 0.25 -0.15 0.2 Z M 0.01 0 L 0.15 0 L 0.15 0.2 C 0.15 0.25 0.01 0.25 0.01 0.2 Z', f: '#FFFFFF', s: '#C9C9CF', w: 0.02 },
  ],
  // 9 sunglasses (origin at the eye line)
  [
    { k: 'p', d: 'M -1.05 -0.22 L -0.12 -0.22 C -0.08 0.35 -0.2 0.62 -0.58 0.62 C -0.95 0.62 -1.08 0.3 -1.05 -0.22 Z M 0.12 -0.22 L 1.05 -0.22 C 1.08 0.3 0.95 0.62 0.58 0.62 C 0.2 0.62 0.08 0.35 0.12 -0.22 Z', f: '#111418', o: 0.93 },
    { k: 'p', d: 'M -1.08 -0.24 L 1.08 -0.24 M -0.12 -0.15 C -0.05 -0.26 0.05 -0.26 0.12 -0.15 M -1.05 -0.15 L -1.5 -0.08 M 1.05 -0.15 L 1.5 -0.08', s: '#111418', w: 0.08 },
    { k: 'p', d: 'M -0.92 -0.1 L -0.55 -0.1 L -0.76 0.32 L -0.96 0.32 Z M 0.28 -0.1 L 0.65 -0.1 L 0.44 0.32 L 0.24 0.32 Z', f: '#FFFFFF', o: 0.22 },
  ],
  // 10 round glasses
  [
    { k: 'e', cx: -0.5, cy: 0, rx: 0.45, ry: 0.45, f: '#BFE9FF', o: 0.2 },
    { k: 'e', cx: 0.5, cy: 0, rx: 0.45, ry: 0.45, f: '#BFE9FF', o: 0.2 },
    { k: 'e', cx: -0.5, cy: 0, rx: 0.45, ry: 0.45, s: '#C9971C', w: 0.07 },
    { k: 'e', cx: 0.5, cy: 0, rx: 0.45, ry: 0.45, s: '#C9971C', w: 0.07 },
    { k: 'p', d: 'M -0.07 -0.06 C -0.03 -0.14 0.03 -0.14 0.07 -0.06 M -0.95 -0.05 L -1.45 0 M 0.95 -0.05 L 1.45 0', s: '#C9971C', w: 0.07 },
    { k: 'p', d: 'M -0.75 -0.22 C -0.65 -0.3 -0.55 -0.3 -0.45 -0.25 M 0.25 -0.22 C 0.35 -0.3 0.45 -0.3 0.55 -0.25', s: '#FFFFFF', w: 0.04, o: 0.7 },
  ],
  // 11 crown (origin at the base centre, spikes up)
  [
    { k: 'p', d: 'M -0.95 0 L -1.05 -0.85 L -0.55 -0.45 L 0 -1.1 L 0.55 -0.45 L 1.05 -0.85 L 0.95 0 Z', f: '#F7C948', s: '#B8860B', w: 0.05 },
    { k: 'p', d: 'M -0.95 -0.2 L 0.95 -0.2 L 0.95 0 L -0.95 0 Z', f: '#E5A823', s: '#B8860B', w: 0.03 },
    { k: 'e', cx: 0, cy: -0.62, rx: 0.1, ry: 0.1, f: '#E53935' },
    { k: 'e', cx: -0.55, cy: -0.1, rx: 0.07, ry: 0.07, f: '#1E88E5' },
    { k: 'e', cx: 0.55, cy: -0.1, rx: 0.07, ry: 0.07, f: '#43A047' },
    { k: 'e', cx: -1.05, cy: -0.88, rx: 0.08, ry: 0.08, f: '#FFF3B0', s: '#B8860B', w: 0.02 },
    { k: 'e', cx: 0, cy: -1.12, rx: 0.08, ry: 0.08, f: '#FFF3B0', s: '#B8860B', w: 0.02 },
    { k: 'e', cx: 1.05, cy: -0.88, rx: 0.08, ry: 0.08, f: '#FFF3B0', s: '#B8860B', w: 0.02 },
  ],
  // 12 heart
  [
    { k: 'p', d: HEART, f: '#FF4D79', s: '#E0335E', w: 0.04 },
    { k: 'e', cx: -0.16, cy: -0.14, rx: 0.07, ry: 0.045, f: '#FFFFFF', o: 0.6 },
  ],
  // 13 blush
  [{ k: 'g', cx: 0, cy: 0, r: 0.6, c: '#FF4F81', a0: 0.6, a1: 0 }],
  // 14 freckles
  [
    { k: 'e', cx: -0.22, cy: 0.02, rx: 0.03, ry: 0.03, f: '#A0522D', o: 0.55 },
    { k: 'e', cx: -0.1, cy: -0.07, rx: 0.028, ry: 0.028, f: '#A0522D', o: 0.55 },
    { k: 'e', cx: 0.04, cy: 0, rx: 0.03, ry: 0.03, f: '#A0522D', o: 0.55 },
    { k: 'e', cx: 0.17, cy: -0.06, rx: 0.026, ry: 0.026, f: '#A0522D', o: 0.55 },
    { k: 'e', cx: 0.27, cy: 0.04, rx: 0.03, ry: 0.03, f: '#A0522D', o: 0.55 },
    { k: 'e', cx: -0.34, cy: -0.05, rx: 0.025, ry: 0.025, f: '#A0522D', o: 0.5 },
    { k: 'e', cx: -0.02, cy: 0.1, rx: 0.026, ry: 0.026, f: '#A0522D', o: 0.5 },
    { k: 'e', cx: 0.12, cy: 0.11, rx: 0.024, ry: 0.024, f: '#A0522D', o: 0.5 },
  ],
  // 15 hero mask (eye holes wind the opposite way so they cut out)
  [
    {
      k: 'p',
      d: 'M -1.25 -0.3 C -1.1 -0.62 -0.5 -0.55 0 -0.4 C 0.5 -0.55 1.1 -0.62 1.25 -0.3 C 1.35 0.05 1.15 0.55 0.75 0.62 C 0.35 0.68 0.12 0.35 0 0.3 C -0.12 0.35 -0.35 0.68 -0.75 0.62 C -1.15 0.55 -1.35 0.05 -1.25 -0.3 Z M -0.82 -0.05 C -0.9 0.1 -0.85 0.22 -0.7 0.3 C -0.5 0.4 -0.2 0.3 -0.2 0.05 C -0.2 -0.2 -0.62 -0.3 -0.82 -0.05 Z M 0.82 -0.05 C 0.62 -0.3 0.2 -0.2 0.2 0.05 C 0.2 0.3 0.5 0.4 0.7 0.3 C 0.85 0.22 0.9 0.1 0.82 -0.05 Z',
      f: '#D32F2F',
      s: '#7F1D1D',
      w: 0.04,
    },
  ],
  // 16 halo
  [
    { k: 'e', cx: 0, cy: 0, rx: 0.85, ry: 0.24, s: '#FFE082', w: 0.22, o: 0.28 },
    { k: 'e', cx: 0, cy: 0, rx: 0.85, ry: 0.24, s: '#FFD54F', w: 0.09 },
  ],
  // 17 sparkle
  [
    { k: 'g', cx: 0, cy: 0, r: 0.4, c: '#FFFFFF', a0: 0.5, a1: 0 },
    { k: 'p', d: STAR, f: '#FFFFFF' },
  ],
];

// ------------------------------------------------------------- pose tracking

/** Pose of one face, in the upright, mirrored-as-shown picture (preview px). */
export const POSE_LEN = 9;
// [visible 0..1, eye-mid x, eye-mid y, eye distance, roll (rad), x squash, nose y, mouth y, mouth open 0..1]
export const POSE_EMPTY = [0, 0, 0, 1, 0, 1, 0.95, 1.55, 0];

type Pt = { x: number; y: number };
/** The few fields of an ML Kit face this file reads (see react-native-vision-camera-face-detector). */
export type FaceLike = {
  bounds: { x: number; y: number; width: number; height: number };
  frameWidth: number;
  frameHeight: number;
  yawAngle: number;
  landmarks?: {
    LEFT_EYE?: Pt;
    RIGHT_EYE?: Pt;
    NOSE_BASE?: Pt;
    MOUTH_LEFT?: Pt;
    MOUTH_RIGHT?: Pt;
    MOUTH_BOTTOM?: Pt;
  };
};

function clampN(v: number, lo: number, hi: number): number {
  'worklet';
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Turns one detected face into a pose. ML Kit reports points in the upright
 * but un-mirrored picture; the front camera is shown mirrored, so x is flipped
 * here. Left/right labels are not trusted: the eyes are sorted by x instead.
 */
export function poseFromFace(face: FaceLike, mirrored: boolean, outW: number, outH: number): number[] {
  'worklet';
  const W = face.frameWidth;
  const H = face.frameHeight;
  // Normally the detector's picture and the rendered one have the same size;
  // scaling keeps the sprites on the face if they only differ in resolution.
  const kx = W > 0 && outW > 0 ? outW / W : 1;
  const ky = H > 0 && outH > 0 ? outH / H : 1;
  const px = (p: Pt) => (mirrored ? W - p.x : p.x) * kx;
  const py = (p: Pt) => p.y * ky;
  const lm = face.landmarks;
  const yaw = Math.abs(face.yawAngle || 0);
  const sx = clampN(Math.cos((yaw * Math.PI) / 180), 0.55, 1);
  if (lm && lm.LEFT_EYE && lm.RIGHT_EYE) {
    let ax = px(lm.LEFT_EYE);
    let ay = py(lm.LEFT_EYE);
    let bx = px(lm.RIGHT_EYE);
    let by = py(lm.RIGHT_EYE);
    if (ax > bx) {
      const tx = ax;
      const ty = ay;
      ax = bx;
      ay = by;
      bx = tx;
      by = ty;
    }
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 4) {
      const ex = (ax + bx) / 2;
      const ey = (ay + by) / 2;
      const ux = dx / d;
      const uy = dy / d;
      // Position of a landmark down the face, in eye-distance units.
      const down = (p: Pt) => ((px(p) - ex) * -uy + (py(p) - ey) * ux) / d;
      let noseY = 0.95;
      if (lm.NOSE_BASE) noseY = clampN(down(lm.NOSE_BASE), 0.5, 1.6);
      let mouthY = 1.55;
      let open = 0;
      if (lm.MOUTH_LEFT && lm.MOUTH_RIGHT) {
        mouthY = clampN((down(lm.MOUTH_LEFT) + down(lm.MOUTH_RIGHT)) / 2, 1.0, 2.4);
        if (lm.MOUTH_BOTTOM) open = clampN((down(lm.MOUTH_BOTTOM) - mouthY - 0.16) / 0.4, 0, 1);
      } else if (lm.MOUTH_BOTTOM) {
        mouthY = clampN(down(lm.MOUTH_BOTTOM) - 0.2, 1.0, 2.4);
      }
      return [1, ex, ey, d, Math.atan2(uy, ux), sx, noseY, mouthY, open];
    }
  }
  // No landmarks: place from the face box, upright.
  const bnd = face.bounds;
  const cx = (mirrored ? W - (bnd.x + bnd.width / 2) : bnd.x + bnd.width / 2) * kx;
  return [1, cx, (bnd.y + bnd.height * 0.38) * ky, Math.max(8, bnd.width * kx * 0.4), 0, sx, 0.95, 1.55, 0];
}

/** One smoothing step towards the latest detection. Returns a new state. */
export function stepPose(S: number[], T: number[]): number[] {
  'worklet';
  const out = S.slice();
  if (T[0] > 0.5) {
    if (S[0] < 0.05) {
      for (let i = 1; i < 9; i++) out[i] = T[i];
      out[0] = 0.5;
      return out;
    }
    const dist = Math.sqrt((T[1] - S[1]) * (T[1] - S[1]) + (T[2] - S[2]) * (T[2] - S[2])) / Math.max(S[3], 1);
    const a = clampN(0.3 + dist * 1.5, 0.3, 0.85);
    out[1] = S[1] + a * (T[1] - S[1]);
    out[2] = S[2] + a * (T[2] - S[2]);
    out[3] = S[3] + 0.35 * (T[3] - S[3]);
    let dr = T[4] - S[4];
    while (dr > Math.PI) dr -= 2 * Math.PI;
    while (dr < -Math.PI) dr += 2 * Math.PI;
    out[4] = S[4] + 0.45 * dr;
    out[5] = S[5] + 0.3 * (T[5] - S[5]);
    out[6] = S[6] + 0.25 * (T[6] - S[6]);
    out[7] = S[7] + 0.25 * (T[7] - S[7]);
    out[8] = S[8] + 0.5 * (T[8] - S[8]);
    out[0] = Math.min(1, S[0] + 0.34);
  } else {
    out[0] = Math.max(0, S[0] - 0.13);
  }
  return out;
}

// ------------------------------------------------------------- placements

/** [sprite, a, b, c, d, e, f, alpha]: x' = a x + c y + e, y' = b x + d y + f. */
export type Placement = number[];

function fract(x: number): number {
  'worklet';
  return x - Math.floor(x);
}

// Face matrix * local (translate, rotate, scale) matrix.
function put(out: Placement[], sprite: number, S: number[], lx: number, ly: number, lsx: number, lsy: number, lrot: number, alpha: number): void {
  'worklet';
  const d = S[3];
  const cr = Math.cos(S[4]);
  const sr = Math.sin(S[4]);
  const fa = cr * d * S[5];
  const fb = sr * d * S[5];
  const fc = -sr * d;
  const fd = cr * d;
  const cl = Math.cos(lrot);
  const sl = Math.sin(lrot);
  const la = cl * lsx;
  const lb = sl * lsx;
  const lc = -sl * lsy;
  const ld = cl * lsy;
  out.push([sprite, fa * la + fc * lb, fb * la + fd * lb, fa * lc + fc * ld, fb * lc + fd * ld, fa * lx + fc * ly + S[1], fb * lx + fd * ly + S[2], alpha * S[0]]);
}

/** The sprites to draw for effect `fx` (index into FACE_FX_IDS) at time `t` seconds. */
export function placeEffect(fx: number, S: number[], t: number): Placement[] {
  'worklet';
  const out: Placement[] = [];
  if (S[0] < 0.02) return out;
  const noseY = S[6];
  const mouthY = S[7];
  switch (fx) {
    case 0: {
      // dog
      const sway = Math.sin(t * 3.1) * 0.05;
      put(out, 0, S, -0.7, -1.0, 1, 1, 0.12 + sway, 1);
      put(out, 0, S, 0.7, -1.0, -1, 1, -0.12 - sway, 1);
      put(out, 1, S, 0, noseY - 0.02, 1, 1, 0, 1);
      if (S[8] > 0.25) put(out, 2, S, 0, mouthY + 0.02, 1, 0.5 + S[8] * 0.7, 0, 1);
      break;
    }
    case 1: {
      // cat
      put(out, 3, S, -0.8, -1.05, 1, 1, -0.28, 1);
      put(out, 3, S, 0.8, -1.05, -1, 1, 0.28, 1);
      put(out, 4, S, 0, noseY - 0.06, 1, 1, 0, 1);
      put(out, 5, S, -0.55, noseY + 0.12, 1, 1, 0, 1);
      put(out, 5, S, 0.55, noseY + 0.12, -1, 1, 0, 1);
      break;
    }
    case 2: {
      // bunny
      const sway = Math.sin(t * 2.4) * 0.05;
      put(out, 6, S, -0.55, -1.05, 1, 1, -0.1 + sway, 1);
      put(out, 6, S, 0.55, -1.05, -1, 1, 0.1 - sway, 1);
      put(out, 7, S, 0, noseY - 0.04, 1, 1, 0, 1);
      put(out, 8, S, 0, (noseY + mouthY) / 2 + 0.06, 1, 1, 0, 1);
      put(out, 5, S, -0.5, noseY + 0.1, 0.9, 1, 0, 1);
      put(out, 5, S, 0.5, noseY + 0.1, -0.9, 1, 0, 1);
      break;
    }
    case 3:
      put(out, 9, S, 0, 0.1, 1, 1, 0, 1);
      break;
    case 4:
      put(out, 10, S, 0, 0.02, 1, 1, 0, 1);
      break;
    case 5:
      put(out, 11, S, 0, -1.2 + Math.sin(t * 2.2) * 0.02, 1.1, 1.1, 0, 1);
      break;
    case 6: {
      // floating hearts
      for (let i = 0; i < 8; i++) {
        const ph = fract(t * 0.32 + i * 0.125 + (i % 3) * 0.07);
        const side = i % 2 === 0 ? -1 : 1;
        const lx = side * (0.75 + 0.6 * fract(i * 0.618)) + Math.sin(ph * 9.4 + i) * 0.14;
        const ly = 1.0 - ph * 3.4;
        const sc = 0.5 + 0.45 * fract(i * 0.37 + 0.2);
        const al = Math.sin(ph * Math.PI);
        put(out, 12, S, lx, ly, sc, sc, Math.sin(ph * 5 + i) * 0.4, al);
      }
      break;
    }
    case 7: {
      // sweet: blush, freckles
      put(out, 13, S, -0.92, noseY + 0.05, 1, 0.9, 0, 1);
      put(out, 13, S, 0.92, noseY + 0.05, 1, 0.9, 0, 1);
      put(out, 14, S, 0, noseY - 0.32, 1, 1, 0, 1);
      break;
    }
    case 8:
      put(out, 15, S, 0, 0.04, 1, 1, 0, 1);
      break;
    case 9: {
      // halo and sparkles
      put(out, 16, S, 0, -1.85 + Math.sin(t * 2) * 0.05, 1, 1, Math.sin(t * 1.5) * 0.04, 1);
      for (let i = 0; i < 4; i++) {
        const tw = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
        const sx = i < 2 ? -1 : 1;
        put(out, 17, S, sx * (0.95 + 0.4 * (i % 2)), -1.55 - 0.35 * (i % 2) + 0.3 * (i > 1 ? 1 : 0), 0.45 + tw * 0.4, 0.45 + tw * 0.4, tw, tw);
      }
      break;
    }
  }
  return out;
}

// ---------------------------------------------------- recording -> timeline

/** One detection while recording: [frame timestamp (ns), ...pose]. */
export type TrackSample = number[];

export type FxTimeline = {
  fps: number;
  /** Size of the picture the placements are expressed in (preview pixels). */
  w: number;
  h: number;
  sprites: Sprite[];
  /** Per output frame i (at i / fps seconds into the clip): the placements. */
  frames: Placement[][];
};

// How long after a frame is exposed its detection reaches the preview.
const DETECT_LATENCY_NS = 35e6;
// The saved file can look ahead: placements are moved this much earlier so the
// effect sits on the picture instead of trailing it.
const BAKE_LOOKAHEAD_NS = 45e6;

/**
 * Replays the recorded detections through the same smoothing the live preview
 * uses and returns the placements for every output frame. `t0Ns` is the camera
 * timestamp that corresponds to the first frame of the video file.
 */
export function buildFxTimeline(fx: number, samples: TrackSample[], t0Ns: number, seconds: number, w: number, h: number, fps: number): FxTimeline {
  const frames: Placement[][] = [];
  const count = Math.max(1, Math.min(Math.ceil(seconds * fps) + 1, 61 * fps));
  let S = POSE_EMPTY.slice();
  let T = POSE_EMPTY.slice();
  let next = 0;
  for (let i = 0; i < count; i++) {
    const tNs = t0Ns + (i / fps) * 1e9 + BAKE_LOOKAHEAD_NS;
    while (next < samples.length && samples[next][0] + DETECT_LATENCY_NS <= tNs) {
      T = samples[next].slice(1);
      next++;
    }
    // One smoothing step per output frame, as the live preview does per frame.
    S = stepPose(S, T);
    // JSON cannot carry NaN; drop any placement that is not a clean number.
    frames.push(placeEffect(fx, S, tNs / 1e9)
        .filter((p) => p.every((v) => Number.isFinite(v)))
        .map((p) => p.map((v) => Math.round(v * 1000) / 1000)),
    );
  }
  frames.push([]);
  return { fps, w, h, sprites: SPRITES, frames };
}
