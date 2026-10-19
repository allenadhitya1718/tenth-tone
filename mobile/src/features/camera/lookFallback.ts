import { FilterMode, MipmapMode, Skia, TileMode } from '@shopify/react-native-skia';

import { flattenUniforms, lookUniforms, skslSource, type LookId } from './looks';

// Binaries without the shader export (iOS, or an older Android build running
// a newer JS bundle) can only bake a 4x5 colour matrix. This fits the closest
// matrix to the colour part of a look by running a grid of colours through the
// real shader. The spatial parts (vignette, grain, glow, skin smoothing) are
// not part of a matrix, so on those binaries the file only gets the colour
// grade.

const N = 6;

function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    [m[i], m[p]] = [m[p], m[i]];
    const d = m[i][i] || 1e-9;
    for (let r = i + 1; r < n; r++) {
      const f = m[r][i] / d;
      for (let c = i; c <= n; c++) m[r][c] -= f * m[i][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i][n];
    for (let c = i + 1; c < n; c++) s -= m[i][c] * x[c];
    x[i] = s / (m[i][i] || 1e-9);
  }
  return x;
}

/** A 4x5 colour matrix (Skia layout, offsets 0..1) approximating the look, or null if Skia cannot run it. */
export function fitLookMatrix(id: LookId): number[] | null {
  if (id === 'normal') return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
  try {
    const eff = Skia.RuntimeEffect.Make(skslSource());
    const count = N * N * N;
    const src = Skia.Surface.Make(count, 1);
    const dst = Skia.Surface.Make(count, 1);
    if (!eff || !src || !dst) return null;
    const sc = src.getCanvas();
    const colors: number[][] = [];
    let i = 0;
    for (let r = 0; r < N; r++) {
      for (let g = 0; g < N; g++) {
        for (let b = 0; b < N; b++) {
          const rgb = [r / (N - 1), g / (N - 1), b / (N - 1)];
          colors.push(rgb);
          const p = Skia.Paint();
          p.setColor(Float32Array.of(rgb[0], rgb[1], rgb[2], 1));
          sc.drawRect(Skia.XYWHRect(i, 0, 1, 1), p);
          i++;
        }
      }
    }
    const u = lookUniforms(id, 0);
    // Colour grade only.
    u.uFx = [0, 0, 0, 0];
    u.uDim = [count, 1, 1 / count, 1];
    const flat = flattenUniforms(u);
    const p = Skia.Paint();
    p.setShader(eff.makeShaderWithChildren(flat, [src.makeImageSnapshot().makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None)]));
    dst.getCanvas().drawRect(Skia.XYWHRect(0, 0, count, 1), p);
    const px = dst.makeImageSnapshot().readPixels(0, 0);
    if (!px) return null;
    const scale = px instanceof Uint8Array ? 255 : 1;
    // Least squares per output channel on [r, g, b, 1].
    const ata = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    const atb = [0, 1, 2].map(() => [0, 0, 0, 0]);
    for (let k = 0; k < count; k++) {
      const f = [colors[k][0], colors[k][1], colors[k][2], 1];
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) ata[a][b] += f[a] * f[b];
        for (let ch = 0; ch < 3; ch++) atb[ch][a] += f[a] * (px[k * 4 + ch] / scale);
      }
    }
    const w = [0, 1, 2].map((ch) => solve(ata, atb[ch]));
    return [...w[0].slice(0, 3), 0, w[0][3], ...w[1].slice(0, 3), 0, w[1][3], ...w[2].slice(0, 3), 0, w[2][3], 0, 0, 0, 1, 0];
  } catch {
    return null;
  }
}
