import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import {
  ClipOp,
  ImageFormat,
  PaintStyle,
  Skia,
  TextAlign,
  TextDirection,
  type SkCanvas,
  type SkImage,
} from '@shopify/react-native-skia';

import type { LocalMedia } from '@/api/upload';

import type { CoverFit } from './HighlightCover';

// The cover editor's picture (owner, 15 Nov 2026: "an image editor for the
// cover images ... add text too"). Everything is kept as fractions of the
// frame, so the same edit draws the same picture on the phone's preview and
// in the full-size file that is posted, and survives a change of layout.

export type FilterId = 'none' | 'warm' | 'cool' | 'mono' | 'fade' | 'vivid' | 'vintage';
export const FILTERS: FilterId[] = ['none', 'warm', 'cool', 'mono', 'fade', 'vivid', 'vintage'];

export type TextLayer = {
  id: string;
  text: string;
  color: string;
  /** Font size as a fraction of the frame's width. */
  size: number;
  /** Centre, as fractions of the frame's width and height. */
  x: number;
  y: number;
  /** A coloured box behind the words (else plain words with a shadow). */
  box: boolean;
};

export type CoverEdit = {
  /** Photo offset from the centre, as fractions of the frame. */
  tx: number;
  ty: number;
  /** 1 = the photo just fills the frame. */
  zoom: number;
  /** Quarter turns clockwise. */
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
  /** -1..1, 0 = unchanged. */
  bright: number;
  contrast: number;
  sat: number;
  filter: FilterId;
  texts: TextLayer[];
};

export const NEW_EDIT: CoverEdit = {
  tx: 0,
  ty: 0,
  zoom: 1,
  rot: 0,
  flip: false,
  bright: 0,
  contrast: 0,
  sat: 0,
  filter: 'none',
  texts: [],
};

export const TEXT_COLORS = ['#ffffff', '#000000', '#ffc83d', '#1e56d6', '#ff4d6d', '#2ecc71'];

// ---------- colour ----------
type M = number[]; // 4x5, row-major; offsets are 0..1

const ID: M = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

function mul(a: M, b: M): M {
  // a after b, both as 5x5 with an implicit last row 0 0 0 0 1.
  const out: M = new Array(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? a[r * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += a[r * 5 + k] * b[k * 5 + c];
      out[r * 5 + c] = v;
    }
  }
  return out;
}

function saturation(s: number): M {
  const r = 0.2126 * (1 - s);
  const g = 0.7152 * (1 - s);
  const b = 0.0722 * (1 - s);
  return [r + s, g, b, 0, 0, r, g + s, b, 0, 0, r, g, b + s, 0, 0, 0, 0, 0, 1, 0];
}
function contrast(c: number): M {
  const o = 0.5 * (1 - c);
  return [c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0];
}
function brightness(b: number): M {
  return [1, 0, 0, 0, b, 0, 1, 0, 0, b, 0, 0, 1, 0, b, 0, 0, 0, 1, 0];
}
function channels(r: number, g: number, b: number, o = 0): M {
  return [r, 0, 0, 0, o, 0, g, 0, 0, 0, 0, 0, b, 0, -o, 0, 0, 0, 1, 0];
}

const FILTER_M: Record<FilterId, M> = {
  none: ID,
  warm: channels(1.08, 1.0, 0.88, 0.03),
  cool: channels(0.9, 1.0, 1.1, -0.02),
  mono: saturation(0),
  fade: mul(brightness(0.06), mul(contrast(0.82), saturation(0.75))),
  vivid: mul(contrast(1.12), saturation(1.45)),
  vintage: [0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0],
};

export function colorMatrix(e: Pick<CoverEdit, 'bright' | 'contrast' | 'sat' | 'filter'>): M {
  let m = FILTER_M[e.filter];
  m = mul(saturation(1 + e.sat), m);
  m = mul(contrast(1 + e.contrast * 0.5), m);
  m = mul(brightness(e.bright * 0.25), m);
  return m;
}

// ---------- geometry ----------
function photoScale(img: SkImage, e: CoverEdit, W: number, H: number) {
  const side = e.rot % 2 === 1;
  const iw = side ? img.height() : img.width();
  const ih = side ? img.width() : img.height();
  const s = Math.max(W / iw, H / ih) * e.zoom;
  return { s, dw: iw * s, dh: ih * s };
}

/** The offset kept so the photo always covers the whole frame. */
export function clampPan(img: SkImage, e: CoverEdit, W: number, H: number): { tx: number; ty: number } {
  const { dw, dh } = photoScale(img, e, W, H);
  const mx = Math.max(0, (dw - W) / 2) / W;
  const my = Math.max(0, (dh - H) / 2) / H;
  return { tx: Math.max(-mx, Math.min(mx, e.tx)), ty: Math.max(-my, Math.min(my, e.ty)) };
}

export type TextBounds = { id: string; x: number; y: number; w: number; h: number };

const RTL = /[֐-ࣿיִ-ﻼ]/;

function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

/** Draws the edit into a W x H canvas. Returns where each text is (for taps). */
export function drawCover(canvas: SkCanvas, img: SkImage | null, e: CoverEdit, W: number, H: number, selectedId?: string | null): TextBounds[] {
  const bg = Skia.Paint();
  bg.setColor(Skia.Color('#000421'));
  canvas.drawRect(Skia.XYWHRect(0, 0, W, H), bg);

  if (img) {
    const { s } = photoScale(img, e, W, H);
    const { tx, ty } = clampPan(img, e, W, H);
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setColorFilter(Skia.ColorFilter.MakeMatrix(colorMatrix(e)));
    canvas.save();
    canvas.clipRect(Skia.XYWHRect(0, 0, W, H), ClipOp.Intersect, true);
    canvas.translate(W / 2 + tx * W, H / 2 + ty * H);
    canvas.rotate(e.rot * 90, 0, 0);
    canvas.scale(e.flip ? -s : s, s);
    canvas.drawImage(img, -img.width() / 2, -img.height() / 2, p);
    canvas.restore();
  }

  const bounds: TextBounds[] = [];
  for (const t of e.texts) {
    if (!t.text.trim()) continue;
    const fontSize = t.size * W;
    const textColor = t.box ? (isLight(t.color) ? '#000000' : '#ffffff') : t.color;
    const builder = Skia.ParagraphBuilder.Make({
      textAlign: TextAlign.Center,
      textDirection: RTL.test(t.text) ? TextDirection.RTL : TextDirection.LTR,
    });
    builder
      .pushStyle({
        color: Skia.Color(textColor),
        fontSize,
        fontStyle: { weight: 800 },
        shadows: t.box ? [] : [{ color: Skia.Color('rgba(0,0,0,0.55)'), offset: { x: 0, y: fontSize * 0.04 }, blurRadius: fontSize * 0.12 }],
      })
      .addText(t.text)
      .pop();
    const para = builder.build();
    const maxW = W * 0.9;
    para.layout(maxW);
    const w = Math.min(maxW, para.getLongestLine());
    const h = para.getHeight();
    const cx = t.x * W;
    const cy = t.y * H;
    const pad = fontSize * 0.3;
    const box = { id: t.id, x: cx - w / 2 - pad, y: cy - h / 2 - pad * 0.6, w: w + pad * 2, h: h + pad * 1.2 };
    if (t.box) {
      const bp = Skia.Paint();
      bp.setAntiAlias(true);
      bp.setColor(Skia.Color(t.color));
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(box.x, box.y, box.w, box.h), fontSize * 0.35, fontSize * 0.35), bp);
    }
    para.paint(canvas, cx - maxW / 2, cy - h / 2);
    if (t.id === selectedId) {
      const sp = Skia.Paint();
      sp.setAntiAlias(true);
      sp.setStyle(PaintStyle.Stroke);
      sp.setStrokeWidth(2);
      sp.setColor(Skia.Color('#ffffff'));
      sp.setPathEffect(Skia.PathEffect.MakeDash([8, 6], 0));
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8), 8, 8), sp);
    }
    bounds.push(box);
  }
  return bounds;
}

// ---------- files ----------

/** A photo from the phone, upright (EXIF turned into pixels) and at most
 *  2048 px on its long side, so the editor stays quick. */
export async function prepareLocalPhoto(uri: string, width?: number, height?: number): Promise<string> {
  const long = Math.max(width ?? 0, height ?? 0);
  const ctx = ImageManipulator.manipulate(uri);
  if (long > 2048) ctx.resize(width! >= height! ? { width: 2048 } : { height: 2048 });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  return out.uri;
}

export async function loadSkImage(uri: string): Promise<SkImage | null> {
  const data = await Skia.Data.fromURI(uri);
  return Skia.Image.MakeImageFromEncoded(data);
}

const OUT: Record<CoverFit, [number, number]> = {
  square: [1080, 1080],
  tall: [1080, 1440],
  wide: [1600, 900],
  full: [1080, 1920],
};

/** The finished cover as a JPEG on the phone, ready to upload. */
export async function renderCoverFile(img: SkImage, e: CoverEdit, fit: CoverFit): Promise<LocalMedia> {
  const [W, H] = OUT[fit];
  const surface = Skia.Surface.Make(W, H);
  if (!surface) throw new Error('surface');
  drawCover(surface.getCanvas(), img, e, W, H, null);
  surface.flush();
  const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 90);
  const file = new File(Paths.cache, `cover-${Date.now()}.jpg`);
  await file.write(bytes);
  return { uri: file.uri, mimeType: 'image/jpeg', size: bytes.length, name: 'cover.jpg' };
}
