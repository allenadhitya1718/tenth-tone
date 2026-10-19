import { FilterMode, ImageFormat, MipmapMode, Skia, TileMode, type SkCanvas, type SkImage, type SkRuntimeEffect } from '@shopify/react-native-skia';

import { drawPlacements } from './fxDraw';
import { placeEffect } from './faceFx';
import { flattenUniforms, lookUniforms, skslSource, type LookId } from './looks';

// Strip thumbnails, rendered once on the JS thread with the very same shader
// and sprites as the live preview: a small painted portrait scene run through
// the look, or with the effect placed on its face. Each returns a PNG data
// URI, or null when Skia cannot draw (the strip then shows a plain disc).

export const THUMB = 112;

let effect: SkRuntimeEffect | null | undefined;
let sceneImage: SkImage | null | undefined;

function paint(color: string) {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(color));
  return p;
}

function drawScene(c: SkCanvas) {
  const sky = Skia.Paint();
  sky.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: 0, y: THUMB * 0.7 }, [Skia.Color('#5f9fe8'), Skia.Color('#f6d6a8')], null, TileMode.Clamp));
  c.drawRect(Skia.XYWHRect(0, 0, THUMB, THUMB), sky);
  c.drawRect(Skia.XYWHRect(0, THUMB * 0.68, THUMB, THUMB * 0.32), paint('#4a8a52'));
  c.drawOval(Skia.XYWHRect(-20, THUMB * 0.6, 90, 40), paint('#5d9b5f'));
  // shoulders, hair, face
  c.drawOval(Skia.XYWHRect(14, 84, 84, 60), paint('#d9525f'));
  c.drawOval(Skia.XYWHRect(28, 14, 56, 66), paint('#3b2a22'));
  c.drawOval(Skia.XYWHRect(31, 26, 50, 64), paint('#e3ae8a'));
  c.drawOval(Skia.XYWHRect(41, 49, 10, 6), paint('#2b2220'));
  c.drawOval(Skia.XYWHRect(61, 49, 10, 6), paint('#2b2220'));
  c.drawOval(Skia.XYWHRect(50, 72, 12, 5), paint('#b4504f'));
}

function scene(): SkImage | null {
  if (sceneImage !== undefined) return sceneImage;
  const s = Skia.Surface.Make(THUMB, THUMB);
  if (!s) {
    sceneImage = null;
    return null;
  }
  drawScene(s.getCanvas());
  sceneImage = s.makeImageSnapshot();
  return sceneImage;
}

function uri(img: SkImage): string {
  return `data:image/png;base64,${img.encodeToBase64(ImageFormat.PNG, 100)}`;
}

export function lookThumb(id: LookId): string | null {
  try {
    const src = scene();
    if (!src) return null;
    if (effect === undefined) effect = Skia.RuntimeEffect.Make(skslSource());
    const surf = Skia.Surface.Make(THUMB, THUMB);
    if (!surf) return null;
    const c = surf.getCanvas();
    if (id === 'normal' || !effect) {
      c.drawImage(src, 0, 0);
    } else {
      const u = flattenUniforms(lookUniforms(id, 0));
      u[0] = THUMB;
      u[1] = THUMB;
      u[2] = 1 / THUMB;
      u[3] = 1 / THUMB;
      const p = Skia.Paint();
      p.setShader(effect.makeShaderWithChildren(u, [src.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None)]));
      c.drawRect(Skia.XYWHRect(0, 0, THUMB, THUMB), p);
    }
    return uri(surf.makeImageSnapshot());
  } catch {
    return null;
  }
}

export function fxThumb(fx: number): string | null {
  try {
    const surf = Skia.Surface.Make(THUMB, THUMB);
    if (!surf) return null;
    const c = surf.getCanvas();
    drawScene(c);
    // eye midpoint (56, 52), eye distance 20
    const pose = [1, 56, 52, 20, 0, 1, 0.95, 1.55, fx === 0 ? 0.9 : 0.1];
    drawPlacements(c, placeEffect(fx, pose, 0.45));
    return uri(surf.makeImageSnapshot());
  } catch {
    return null;
  }
}
