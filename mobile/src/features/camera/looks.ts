// Camera looks: one fragment-shader grade (tone curve, white balance, split
// tone, fade, vignette, grain, bloom) plus the "beauty" skin smoothing.
//
// The grade is written ONCE, as a body in the GLSL ES 1.00 dialect that SkSL
// also accepts. Two wrappers turn it into a runnable shader:
//   * SkSL  -> the live Skia preview (FilteredCamera.tsx) and the thumbnails;
//   * GLSL  -> the native re-encode after recording (Media3, see
//              modules/flyp-video-filter), which receives this exact source
//              text from JS, so the posted file runs the same maths as the
//              preview.
// Both work on gamma-encoded RGB in 0..1 (what Skia and Media3's default SDR
// working space hand over).

export const LOOK_IDS = [
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
  'sunset',
  'neon',
  'dreamy',
  'fresh',
] as const;
export type LookId = (typeof LOOK_IDS)[number];

/** The uniforms, in the order the SkSL shader declares them (each a vec4). */
export const LOOK_UNIFORM_NAMES = ['uDim', 'uA', 'uBal', 'uSh', 'uHi', 'uFx', 'uBty', 'uT'] as const;
export type LookUniformName = (typeof LOOK_UNIFORM_NAMES)[number];

// uDim = (width, height, 1/width, 1/height)   set per frame by the renderer
// uA   = (exposure, S-curve amount, saturation, fade)
// uBal = (red gain, green gain, blue gain, mid-tone gamma)
// uSh  = (shadow tint r, g, b as signed offsets, vibrance)
// uHi  = (highlight tint r, g, b as signed offsets, black & white mix)
// uFx  = (vignette, grain, bloom, sharpen)
// uBty = (skin smoothing, skin brighten, 0, 0)
// uT   = (seconds, 0, 0, 0)   only drives the grain

const BODY = `
float lumaOf(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, vec3(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Soft YCbCr skin test: 1 on skin tones, 0 elsewhere.
float skinMask(vec3 c) {
  float cb = -0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b + 0.5;
  float cr = 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b + 0.5;
  float m = smoothstep(0.27, 0.32, cb) * (1.0 - smoothstep(0.49, 0.53, cb));
  m = m * smoothstep(0.50, 0.54, cr) * (1.0 - smoothstep(0.67, 0.72, cr));
  return m * smoothstep(0.10, 0.22, lumaOf(c));
}

// One edge-preserving tap: colour weighted by how close it is to the centre.
vec4 wtap(vec3 c, vec2 q) {
  vec3 t = tap(q);
  vec3 d = t - c;
  float w = exp(-dot(d, d) * 55.0);
  return vec4(t * w, w);
}

vec3 look(vec2 p) {
  vec3 c0 = tap(p);
  vec3 c = c0;
  float px = uDim.y * 0.0045;
  float skin = 0.0;

  if (uBty.x > 0.001 || uBty.y > 0.001 || uFx.w > 0.001) {
    skin = skinMask(c0);
  }

  // Beauty: bilateral-style smoothing, applied to skin tones only.
  if (uBty.x > 0.001) {
    float r1 = px;
    float r2 = px * 2.0;
    float dg = 0.7071;
    vec4 a = vec4(c0, 1.0);
    a += wtap(c0, p + vec2(r1, 0.0));
    a += wtap(c0, p + vec2(-r1, 0.0));
    a += wtap(c0, p + vec2(0.0, r1));
    a += wtap(c0, p + vec2(0.0, -r1));
    a += wtap(c0, p + vec2(r1 * dg, r1 * dg));
    a += wtap(c0, p + vec2(-r1 * dg, r1 * dg));
    a += wtap(c0, p + vec2(r1 * dg, -r1 * dg));
    a += wtap(c0, p + vec2(-r1 * dg, -r1 * dg));
    a += wtap(c0, p + vec2(r2, 0.0));
    a += wtap(c0, p + vec2(-r2, 0.0));
    a += wtap(c0, p + vec2(0.0, r2));
    a += wtap(c0, p + vec2(0.0, -r2));
    vec3 sm = a.rgb / a.a;
    c = mix(c, sm, uBty.x * 0.92 * skin);
  }
  if (uBty.y > 0.001) {
    c = c + skin * uBty.y * 0.07 * (1.0 - c);
  }

  // Sharpen (not on skin).
  if (uFx.w > 0.001) {
    float s1 = px * 0.8;
    vec3 b = (tap(p + vec2(s1, 0.0)) + tap(p + vec2(-s1, 0.0)) + tap(p + vec2(0.0, s1)) + tap(p + vec2(0.0, -s1))) * 0.25;
    c = c + (c0 - b) * uFx.w * (1.0 - skin);
  }

  // Bloom: a wide soft glow from the highlights.
  if (uFx.z > 0.001) {
    float w1 = px * 3.0;
    float w2 = px * 6.0;
    float dg2 = 0.7071;
    vec3 bl = tap(p + vec2(w1, 0.0)) + tap(p + vec2(-w1, 0.0)) + tap(p + vec2(0.0, w1)) + tap(p + vec2(0.0, -w1));
    bl += tap(p + vec2(w2 * dg2, w2 * dg2)) + tap(p + vec2(-w2 * dg2, w2 * dg2)) + tap(p + vec2(w2 * dg2, -w2 * dg2)) + tap(p + vec2(-w2 * dg2, -w2 * dg2));
    bl = bl * 0.125;
    float hi = smoothstep(0.45, 0.95, lumaOf(bl));
    c = mix(c, bl, uFx.z * 0.22) + bl * hi * uFx.z * 0.55;
  }

  // Grade.
  c = max(c, vec3(0.0));
  c = c * uA.x * uBal.rgb;
  c = clamp(c, 0.0, 1.0);
  c = pow(c, vec3(1.0 / max(uBal.w, 0.05)));
  vec3 curve = c * c * (3.0 - 2.0 * c);
  c = mix(c, curve, uA.y);
  float l = lumaOf(c);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float satNow = uA.z * (1.0 + uSh.w * (1.0 - (mx - mn)));
  c = mix(vec3(l), c, satNow);
  c = mix(c, vec3(lumaOf(c)), uHi.w);
  l = lumaOf(c);
  float sw = 1.0 - smoothstep(0.0, 0.55, l);
  float hw = smoothstep(0.45, 1.0, l);
  c = c + uSh.rgb * sw + uHi.rgb * hw;
  // Fade: lifted blacks, softened whites (the matte film look).
  c = mix(vec3(uA.w), vec3(1.0 - uA.w * 0.35), clamp(c, 0.0, 1.0));

  // Vignette (circular, so it is the same on a rotated or upright frame).
  vec2 q = (p - uDim.xy * 0.5) / (0.5 * length(uDim.xy));
  float vg = smoothstep(0.38, 1.0, length(q));
  c = c * (1.0 - uFx.x * vg);

  // Grain, strongest in the mid-tones.
  if (uFx.y > 0.001) {
    float n = hash12(p + vec2(uT.x * 61.0, uT.x * 37.0)) - 0.5;
    float lm = lumaOf(c);
    c = c + n * uFx.y * (0.45 + 0.55 * (1.0 - abs(2.0 * lm - 1.0)));
  }
  return clamp(c, 0.0, 1.0);
}
`;

const DECLS = LOOK_UNIFORM_NAMES.map((n) => `uniform vec4 ${n};`).join('\n');

/** SkSL for the Skia preview. One child shader `src` is the camera frame. */
export function skslSource(): string {
  const body = BODY.replace(/\bvec([234])\b/g, 'float$1');
  const decls = DECLS.replace(/\bvec([234])\b/g, 'float$1');
  return `uniform shader src;
${decls}
float3 tap(float2 q) {
  return src.eval(q).rgb;
}
${body}
half4 main(float2 xy) {
  return half4(half3(look(xy)), 1.0);
}
`;
}

/** GLSL ES 1.00 fragment shader for the Media3 export. */
export function glslFragmentSource(): string {
  return `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTexSampler;
varying vec2 vTexSamplingCoord;
${DECLS}
vec3 tap(vec2 q) {
  return texture2D(uTexSampler, q * uDim.zw).rgb;
}
${BODY}
void main() {
  vec2 p = vTexSamplingCoord * uDim.xy;
  gl_FragColor = vec4(look(p), 1.0);
}
`;
}

/**
 * GLSL ES 1.00 fragment shader for the native fx camera (modules/flyp-fx-camera):
 * the same look body, but the picture is the camera's external OES texture,
 * sampled through the per-output texture matrix CameraX provides (so every tap
 * lands on the right texel whatever the sensor rotation or crop). uDim is the
 * size of the rendered buffer. The skin-smoothing radius follows the long side,
 * because that buffer is the sensor's (landscape) orientation, not the upright one.
 */
export function glslOesFragmentSource(): string {
  const body = BODY.replace('float px = uDim.y * 0.0045;', 'float px = max(uDim.x, uDim.y) * 0.0045;');
  return `#extension GL_OES_EGL_image_external : require
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform samplerExternalOES uTexSampler;
uniform mat4 uTexMat;
varying vec2 vTexSamplingCoord;
${DECLS}
vec3 tap(vec2 q) {
  return texture2D(uTexSampler, (uTexMat * vec4(q * uDim.zw, 0.0, 1.0)).xy).rgb;
}
${body}
void main() {
  vec2 p = vTexSamplingCoord * uDim.xy;
  gl_FragColor = vec4(look(p), 1.0);
}
`;
}

export const GLSL_VERTEX_SOURCE = `attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main() {
  gl_Position = aFramePosition;
  vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5;
}
`;

type Vec3 = readonly [number, number, number];

type LookParams = {
  exposure?: number;
  /** 0 = none, 1 = strong S-curve, negative flattens. */
  curve?: number;
  saturation?: number;
  vibrance?: number;
  fade?: number;
  /** Warm (+) / cool (-). */
  temp?: number;
  /** Magenta (+) / green (-). */
  tint?: number;
  /** >1 brightens the mid-tones. */
  gamma?: number;
  shadow?: Vec3;
  high?: Vec3;
  bw?: number;
  vignette?: number;
  grain?: number;
  bloom?: number;
  sharpen?: number;
};

// Colour balance as channel gains renormalised to keep the grey's luma, so a
// warm/cool shift moves the hue of the light and not the exposure.
function balance(temp: number, tint: number): [number, number, number] {
  const r = 1 + temp + tint * 0.5;
  const g = 1 - tint;
  const b = 1 - temp + tint * 0.5;
  const k = 1 / (0.2126 * r + 0.7152 * g + 0.0722 * b);
  return [r * k, g * k, b * k];
}

const LOOKS: Record<LookId, LookParams> = {
  normal: {},
  // Bright, clean pop with cool shadows (Clarendon-style).
  crisp: { exposure: 1.03, curve: 0.3, saturation: 1.1, vibrance: 0.3, temp: -0.02, shadow: [-0.012, 0.004, 0.028], high: [0.012, 0.008, 0], vignette: 0.12, sharpen: 0.3 },
  // Golden-hour glow: honey light, a soft bloom, warm shadows.
  golden: { exposure: 1.02, curve: 0.12, saturation: 1.1, fade: 0.015, temp: 0.1, tint: 0.01, gamma: 1.06, shadow: [0.03, 0.012, -0.01], high: [0.045, 0.025, -0.03], bloom: 0.25, vignette: 0.14 },
  // Cool and airy.
  breeze: { exposure: 1.07, curve: 0.06, saturation: 0.92, fade: 0.025, temp: -0.08, gamma: 1.1, shadow: [-0.01, 0.015, 0.04], high: [-0.01, 0.005, 0.02] },
  // Faded film: milky blacks, teal shadows, creamy highlights, grain.
  film: { curve: 0.1, saturation: 0.78, fade: 0.085, temp: 0.03, shadow: [-0.02, 0.018, 0.035], high: [0.04, 0.02, -0.03], grain: 0.075, vignette: 0.18 },
  // Moody and dark with a cold cast.
  dusk: { exposure: 0.94, curve: 0.4, saturation: 0.78, temp: -0.05, gamma: 0.96, shadow: [-0.01, 0, 0.045], high: [0.02, 0, 0.03], vignette: 0.38, grain: 0.03 },
  // Powdery pink pastel with a dreamy glow.
  pastel: { exposure: 1.03, curve: -0.15, saturation: 0.8, fade: 0.07, tint: 0.05, gamma: 1.12, shadow: [0.03, 0, 0.03], high: [0.02, 0, 0.015], bloom: 0.3 },
  // 70s print: warm, plum shadows, grain and a dark rim.
  retro: { curve: 0.16, saturation: 0.86, fade: 0.06, temp: 0.09, shadow: [0.05, 0.01, -0.02], high: [0.06, 0.03, -0.05], grain: 0.09, vignette: 0.3 },
  // Teal and orange.
  cinema: { curve: 0.32, saturation: 1.02, shadow: [-0.035, 0.015, 0.05], high: [0.06, 0.025, -0.04], vignette: 0.2 },
  // Strong, rich colour.
  vivid: { exposure: 1.03, curve: 0.22, saturation: 1.3, vibrance: 0.4 },
  // Soft black and white.
  silver: { curve: 0.06, fade: 0.05, bw: 1, vignette: 0.15, grain: 0.04 },
  // Deep, contrasty black and white with grain.
  ink: { exposure: 1.02, curve: 0.55, bw: 1, vignette: 0.3, grain: 0.08 },
  // Magenta-orange evening light.
  sunset: { curve: 0.2, saturation: 1.14, temp: 0.12, tint: 0.04, shadow: [0.05, -0.015, 0.04], high: [0.07, 0.03, -0.04], bloom: 0.15, vignette: 0.2 },
  // Night city: blue and magenta, punchy, glowing.
  neon: { exposure: 0.97, curve: 0.45, saturation: 1.3, temp: -0.06, tint: 0.06, shadow: [0.02, -0.02, 0.07], high: [0.04, -0.01, 0.06], bloom: 0.4, vignette: 0.35 },
  // Soft-focus glow.
  dreamy: { exposure: 1.04, curve: -0.1, saturation: 0.95, fade: 0.05, temp: 0.02, gamma: 1.1, high: [0.03, 0.02, 0.02], bloom: 0.6 },
  // Clean green-teal, bright.
  fresh: { exposure: 1.05, curve: 0.15, saturation: 1.1, vibrance: 0.3, temp: -0.02, tint: -0.05, shadow: [-0.01, 0.02, 0.01], high: [0, 0.02, 0.01], sharpen: 0.15 },
};

export type LookUniforms = Record<LookUniformName, number[]>;

/** Beauty strength is 0..1; 0 means off. */
export function lookUniforms(id: LookId, beauty: number): LookUniforms {
  const p = LOOKS[id];
  const [r, g, b] = balance(p.temp ?? 0, p.tint ?? 0);
  const sh = p.shadow ?? [0, 0, 0];
  const hi = p.high ?? [0, 0, 0];
  return {
    uDim: [1, 1, 1, 1],
    uA: [p.exposure ?? 1, p.curve ?? 0, p.saturation ?? 1, p.fade ?? 0],
    uBal: [r, g, b, p.gamma ?? 1],
    uSh: [sh[0], sh[1], sh[2], p.vibrance ?? 0],
    uHi: [hi[0], hi[1], hi[2], p.bw ?? 0],
    uFx: [p.vignette ?? 0, p.grain ?? 0, p.bloom ?? 0, p.sharpen ?? 0],
    uBty: [beauty, beauty * 0.8, 0, 0],
    uT: [0, 0, 0, 0],
  };
}

/** The uniforms the native fx camera takes (all but uDim and uT, which it sets itself), flat, in this order. */
export const NATIVE_UNIFORM_NAMES = ['uA', 'uBal', 'uSh', 'uHi', 'uFx', 'uBty'] as const;

export function nativeUniforms(id: LookId, beauty: number): number[] {
  const u = lookUniforms(id, beauty);
  const out: number[] = [];
  for (const n of NATIVE_UNIFORM_NAMES) for (const v of u[n]) out.push(v);
  return out;
}

/** Flat array in LOOK_UNIFORM_NAMES order, as Skia's makeShader wants it. */
export function flattenUniforms(u: LookUniforms): number[] {
  const out: number[] = [];
  for (const n of LOOK_UNIFORM_NAMES) for (const v of u[n]) out.push(v);
  return out;
}

/** True when the shader would change nothing (Normal with no beauty). */
export function isNeutral(id: LookId, beauty: number): boolean {
  return id === 'normal' && beauty <= 0.001;
}

/** Everything the native export needs to reproduce a look. */
export type LookSpec = {
  fragment: string;
  vertex: string;
  /** All uniforms except uDim (frame size) and uT (time), which native sets. */
  uniforms: Partial<Record<LookUniformName, number[]>>;
};

export function lookSpec(id: LookId, beauty: number): LookSpec {
  const u = lookUniforms(id, beauty);
  const uniforms: Partial<Record<LookUniformName, number[]>> = {};
  for (const n of LOOK_UNIFORM_NAMES) if (n !== 'uDim' && n !== 'uT') uniforms[n] = u[n];
  return { fragment: glslFragmentSource(), vertex: GLSL_VERTEX_SOURCE, uniforms };
}

/** A flat colour laid over the plain camera picture when the Skia preview is unavailable (it only hints at the look). */
export const TINTS: Record<LookId, string> = {
  normal: 'rgba(0,0,0,0)',
  crisp: 'rgba(120,170,255,0.10)',
  golden: 'rgba(255,190,110,0.22)',
  breeze: 'rgba(150,200,255,0.20)',
  film: 'rgba(200,190,150,0.22)',
  dusk: 'rgba(40,50,110,0.28)',
  pastel: 'rgba(255,200,225,0.24)',
  retro: 'rgba(210,160,100,0.26)',
  cinema: 'rgba(40,120,150,0.20)',
  vivid: 'rgba(255,80,120,0.10)',
  silver: 'rgba(160,160,170,0.35)',
  ink: 'rgba(40,40,40,0.38)',
  sunset: 'rgba(255,120,110,0.26)',
  neon: 'rgba(120,60,255,0.26)',
  dreamy: 'rgba(255,235,245,0.26)',
  fresh: 'rgba(120,230,190,0.20)',
};
