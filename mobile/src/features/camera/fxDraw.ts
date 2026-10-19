import { PaintStyle, Skia, StrokeCap, StrokeJoin, TileMode, type SkCanvas, type SkPaint, type SkPath, type SkShader } from '@shopify/react-native-skia';

import { SPRITES, type Placement } from './faceFx';

// Draws face-effect placements with Skia. Runs in the camera's worklet runtime
// every frame, so paints, paths and gradient shaders are built once per
// runtime and kept on globalThis (a worklet runtime keeps its own globals, and
// a module-level variable would be copied, not shared, into the worklet).

type Cache = {
  fill: SkPaint;
  stroke: SkPaint;
  paths: Record<string, SkPath | null>;
  shaders: Record<string, SkShader>;
  colors: Record<string, Float32Array>;
};

function getCache(): Cache {
  'worklet';
  const g = globalThis as unknown as { __flypFx?: Cache };
  if (!g.__flypFx) {
    const fill = Skia.Paint();
    fill.setAntiAlias(true);
    fill.setStyle(PaintStyle.Fill);
    const stroke = Skia.Paint();
    stroke.setAntiAlias(true);
    stroke.setStyle(PaintStyle.Stroke);
    stroke.setStrokeCap(StrokeCap.Round);
    stroke.setStrokeJoin(StrokeJoin.Round);
    g.__flypFx = { fill, stroke, paths: {}, shaders: {}, colors: {} };
  }
  return g.__flypFx;
}

function colorOf(c: Cache, css: string): Float32Array {
  'worklet';
  let v = c.colors[css];
  if (!v) {
    v = Skia.Color(css);
    c.colors[css] = v;
  }
  return v;
}

/** Draws placements in the current canvas space (sprite units are scaled by each placement's matrix). */
export function drawPlacements(canvas: SkCanvas, placements: Placement[]): void {
  'worklet';
  const c = getCache();
  for (let n = 0; n < placements.length; n++) {
    const p = placements[n];
    const sprite = SPRITES[p[0]];
    if (!sprite) continue;
    const alpha = p[7];
    if (alpha <= 0.01) continue;
    canvas.save();
    canvas.concat([p[1], p[3], p[5], p[2], p[4], p[6], 0, 0, 1]);
    for (let i = 0; i < sprite.length; i++) {
      const op = sprite[i];
      if (op.k === 'g') {
        const key = p[0] + ':' + i;
        let sh = c.shaders[key];
        if (!sh) {
          const c0 = new Float32Array(colorOf(c, op.c));
          const c1 = new Float32Array(c0);
          c0[3] = op.a0;
          c1[3] = op.a1;
          sh = Skia.Shader.MakeRadialGradient(Skia.Point(op.cx, op.cy), op.r, [c0, c1], null, TileMode.Clamp);
          c.shaders[key] = sh;
        }
        c.fill.setShader(sh);
        c.fill.setAlphaf(alpha);
        canvas.drawCircle(op.cx, op.cy, op.r, c.fill);
        c.fill.setShader(null);
        continue;
      }
      let path: SkPath | null = null;
      if (op.k === 'p') {
        const key = p[0] + ':' + i;
        path = c.paths[key] ?? null;
        if (!path && !(key in c.paths)) {
          path = Skia.Path.MakeFromSVGString(op.d);
          c.paths[key] = path;
        }
        if (!path) continue;
      }
      const o = (op.o ?? 1) * alpha;
      if (op.f) {
        c.fill.setColor(colorOf(c, op.f));
        c.fill.setAlphaf(o);
        if (path) canvas.drawPath(path, c.fill);
        else if (op.k === 'e') canvas.drawOval(Skia.XYWHRect(op.cx - op.rx, op.cy - op.ry, op.rx * 2, op.ry * 2), c.fill);
      }
      if (op.s) {
        c.stroke.setColor(colorOf(c, op.s));
        c.stroke.setAlphaf(o);
        c.stroke.setStrokeWidth(op.w ?? 0.04);
        if (path) canvas.drawPath(path, c.stroke);
        else if (op.k === 'e') canvas.drawOval(Skia.XYWHRect(op.cx - op.rx, op.cy - op.ry, op.rx * 2, op.ry * 2), c.stroke);
      }
    }
    canvas.restore();
  }
}
