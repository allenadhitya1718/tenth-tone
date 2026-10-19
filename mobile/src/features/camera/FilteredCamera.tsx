import { FilterMode, MipmapMode, Skia, TileMode, type SkCanvas, type SkImage, type SkPaint, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { AsyncRunner, CameraDevice, CameraOutput, Constraint, Frame } from 'react-native-vision-camera';
import { SkiaCamera, type SkiaOnFrameState } from 'react-native-vision-camera-skia';
import type { FaceDetector } from 'react-native-vision-camera-face-detector';
import { createSynchronizable, scheduleOnRN, type Synchronizable } from 'react-native-worklets';

import { drawPlacements } from './fxDraw';
import { placeEffect, POSE_EMPTY, poseFromFace, stepPose, type FaceLike } from './faceFx';
import { flattenUniforms, isNeutral, lookUniforms, skslSource, type LookId } from './looks';

// The live preview: every camera frame goes through Skia, where one fragment
// shader applies the look (and beauty smoothing) and, when a face effect is on,
// the tracked face's sprites are drawn on top. The same shader source and the
// same sprite data are replayed by the native export after recording, so the
// posted file matches what was shown (see videoFilter.ts).
//
// Loaded lazily by CameraScreen so builds without Skia never import it.

// Preview 16:9 at 720p: Skia copies each rendered frame back to the CPU for
// the canvas, and 1080p of that per frame is too much for mid-range phones.
// The recording itself still comes from the 1080p video output.
const PREVIEW_RESOLUTION = { width: 720, height: 1280 };

const SKSL = skslSource();
// Face detection runs on every Nth frame on a separate thread; the pose is
// smoothed on every frame in between.
const DETECT_EVERY = 3;
// This many detector exceptions in a row switch the face path off.
const MAX_DETECT_ERRORS = 4;

export type FxRecorder = {
  /** True while a recording is running: detections are then logged. */
  on: Synchronizable<boolean>;
  /** Camera timestamp (ns) of the newest frame the preview has seen. */
  lastTs: Synchronizable<number>;
  /** Size of the upright picture the placements are expressed in. */
  dims: Synchronizable<number[]>;
  samples: number[][];
  push: (sample: number[]) => void;
  /** Call right before starting the recorder. */
  begin: () => void;
  /** Call when the recorder reports that it started. */
  started: () => void;
  /** Stops logging; `t0` is the camera timestamp of the first video frame (estimated). */
  end: () => { samples: number[][]; t0: number; w: number; h: number };
};

export function createFxRecorder(): FxRecorder {
  const on = createSynchronizable(false);
  const lastTs = createSynchronizable(0);
  const dims = createSynchronizable<number[]>([720, 1280]);
  const samples: number[][] = [];
  let t0a = 0;
  let t0b = 0;
  return {
    on,
    lastTs,
    dims,
    samples,
    push: (s) => {
      samples.push(s);
    },
    begin: () => {
      samples.length = 0;
      t0a = lastTs.getBlocking();
      t0b = 0;
      on.setBlocking(true);
    },
    started: () => {
      t0b = lastTs.getBlocking();
    },
    end: () => {
      on.setBlocking(false);
      // The first video frame was captured between the start request and the
      // recorder's "started" event: take the middle.
      const t0 = t0b > 0 && t0a > 0 ? (t0a + t0b) / 2 : t0a || t0b;
      const [w, h] = dims.getBlocking();
      return { samples: samples.slice(), t0, w, h };
    },
  };
}

type LookCache = { tried: boolean; eff: SkRuntimeEffect | null; paint: SkPaint };

/** Draws the camera frame through the look shader. Returns false when the shader is unavailable. */
function drawLooked(canvas: SkCanvas, tex: SkImage, uniforms: number[], seconds: number): boolean {
  'worklet';
  const g = globalThis as unknown as { __flypLook?: LookCache };
  let c = g.__flypLook;
  if (!c) {
    c = { tried: false, eff: null, paint: Skia.Paint() };
    g.__flypLook = c;
  }
  if (!c.tried) {
    c.tried = true;
    c.eff = Skia.RuntimeEffect.Make(SKSL);
  }
  if (!c.eff) {
    canvas.drawImage(tex, 0, 0);
    return false;
  }
  const w = tex.width();
  const h = tex.height();
  const u = uniforms.slice();
  u[0] = w;
  u[1] = h;
  u[2] = 1 / w;
  u[3] = 1 / h;
  u[28] = seconds;
  const img = tex.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);
  c.paint.setShader(c.eff.makeShaderWithChildren(u, [img]));
  canvas.drawRect(Skia.XYWHRect(0, 0, w, h), c.paint);
  c.paint.setShader(null);
  return true;
}

export type FilteredProps = {
  style: StyleProp<ViewStyle>;
  device: CameraDevice;
  isActive: boolean;
  outputs: CameraOutput[];
  constraints: Constraint[];
  zoom: number;
  torch: boolean;
  look: LookId;
  /** Beauty strength 0..1, 0 = off. */
  beauty: number;
  /** Index into FACE_FX_IDS, or -1. Needs `detector` and `runner`. */
  fx: number;
  detector?: FaceDetector | null;
  runner?: AsyncRunner | null;
  rec: FxRecorder;
  onError: (e: Error) => void;
  /** Called once, on the JS thread, after the first frame went through Skia. */
  onFirstFrame?: () => void;
  /** The look shader could not be compiled or drawn: the preview is unfiltered. */
  onShaderFail?: () => void;
  /** Face detection keeps failing: effects are off, looks still work. */
  onFaceFail?: () => void;
};

export default function FilteredCamera({
  style,
  device,
  isActive,
  outputs,
  constraints,
  zoom,
  torch,
  look,
  beauty,
  fx,
  detector,
  runner,
  rec,
  onError,
  onFirstFrame,
  onShaderFail,
  onFaceFail,
}: FilteredProps) {
  // Values the frame thread reads. Plain shared values would be written
  // asynchronously from another runtime; synchronizables are read directly.
  const uni = useMemo(() => createSynchronizable<number[]>(flattenUniforms(lookUniforms('normal', 0))), []);
  const lookOn = useMemo(() => createSynchronizable(false), []);
  const fxSel = useMemo(() => createSynchronizable(-1), []);
  const target = useMemo(() => createSynchronizable<number[]>(POSE_EMPTY), []);
  const first = useMemo(() => createSynchronizable(false), []);
  const shaderFailed = useMemo(() => createSynchronizable(false), []);
  const faceErrors = useMemo(() => createSynchronizable(0), []);
  const faceOff = useMemo(() => createSynchronizable(false), []);

  useEffect(() => {
    uni.setBlocking(flattenUniforms(lookUniforms(look, beauty)));
    lookOn.setBlocking(!isNeutral(look, beauty));
  }, [uni, lookOn, look, beauty]);
  useEffect(() => {
    fxSel.setBlocking(fx);
    if (fx < 0) target.setBlocking(POSE_EMPTY);
  }, [fxSel, target, fx]);

  const cbFirst = useRef(onFirstFrame);
  const cbShader = useRef(onShaderFail);
  const cbFace = useRef(onFaceFail);
  useEffect(() => {
    cbFirst.current = onFirstFrame;
    cbShader.current = onShaderFail;
    cbFace.current = onFaceFail;
  }, [onFirstFrame, onShaderFail, onFaceFail]);
  const notifyFirstFrame = useCallback(() => cbFirst.current?.(), []);
  const notifyShaderFail = useCallback(() => cbShader.current?.(), []);
  const notifyFaceFail = useCallback(() => cbFace.current?.(), []);

  const onFrame = useMemo(() => {
    // Only these leave the closure: the worklet must not capture the whole
    // recorder (it also holds plain functions that cannot cross runtimes).
    const { on: recOn, lastTs, dims, push } = rec;
    return (frame: Frame, render: (onDraw: (state: SkiaOnFrameState) => void) => void) => {
      'worklet';
      const ts = frame.timestamp;
      const orientation = frame.orientation;
      const mirrored = frame.isMirrored;
      const landscape = orientation === 'left' || orientation === 'right';
      const outW = landscape ? frame.height : frame.width;
      const outH = landscape ? frame.width : frame.height;
      lastTs.setBlocking(ts);
      const seconds = (ts / 1e9) % 3600;
      const fxIdx = fxSel.getBlocking();
      const useLook = lookOn.getBlocking();
      const uniforms = uni.getBlocking();
      const g = globalThis as unknown as { __flypPose?: number[]; __flypN?: number };

      render(({ canvas, frameTexture }) => {
        let ok = true;
        if (useLook) ok = drawLooked(canvas, frameTexture, uniforms, seconds);
        else canvas.drawImage(frameTexture, 0, 0);
        if (!ok && !shaderFailed.getBlocking()) {
          shaderFailed.setBlocking(true);
          scheduleOnRN(notifyShaderFail);
        }
        if (fxIdx >= 0) {
          try {
            let S = g.__flypPose ?? POSE_EMPTY;
            S = stepPose(S, target.getBlocking());
            g.__flypPose = S;
            const placements = placeEffect(fxIdx, S, seconds);
            if (placements.length > 0) {
              // The canvas is set up for the raw sensor buffer (rotated, and
              // mirrored for the front camera). Undo that, so sprites are
              // drawn in the upright picture the face tracker reports in.
              const rotation = orientation === 'left' ? 270 : orientation === 'right' ? 90 : orientation === 'down' ? 180 : 0;
              const counter = (360 - rotation) % 360;
              canvas.save();
              canvas.translate(landscape ? outH / 2 : outW / 2, landscape ? outW / 2 : outH / 2);
              canvas.rotate(-counter, 0, 0);
              if (mirrored) canvas.scale(-1, 1);
              canvas.translate(-outW / 2, -outH / 2);
              drawPlacements(canvas, placements);
              canvas.restore();
            }
          } catch (e) {
            console.warn('face effect draw failed', String(e));
          }
        }
      });

      if (!first.getBlocking()) {
        first.setBlocking(true);
        dims.setBlocking([outW, outH]);
        scheduleOnRN(notifyFirstFrame);
      }

      // Face detection on a throttled cadence, off this thread.
      let handled = false;
      if (fxIdx >= 0 && detector != null && runner != null && !faceOff.getBlocking()) {
        const n = (g.__flypN ?? 0) + 1;
        g.__flypN = n;
        if (n % DETECT_EVERY === 0) {
          try {
            handled = runner.runAsync(() => {
            'worklet';
            try {
              const faces = detector.detectFaces(frame);
              let best: FaceLike | null = null;
              let bestArea = 0;
              for (let i = 0; i < faces.length; i++) {
                const b = faces[i].bounds;
                const area = b.width * b.height;
                if (area > bestArea) {
                  bestArea = area;
                  best = faces[i] as unknown as FaceLike;
                }
              }
              const pose = best ? poseFromFace(best, mirrored, outW, outH) : POSE_EMPTY;
              target.setBlocking(pose);
              faceErrors.setBlocking(0);
              if (recOn.getBlocking()) scheduleOnRN(push, [ts, ...pose]);
            } catch (e) {
              console.warn('face detection failed', String(e));
              const errs = faceErrors.getBlocking() + 1;
              faceErrors.setBlocking(errs);
              if (errs >= MAX_DETECT_ERRORS) {
                faceOff.setBlocking(true);
                target.setBlocking(POSE_EMPTY);
                scheduleOnRN(notifyFaceFail);
              }
            } finally {
              frame.dispose();
            }
            });
          } catch (e) {
            console.warn('face detection could not start', String(e));
          }
        }
      }
      // When the async task took the frame it disposes it itself.
      if (!handled) frame.dispose();
    };
  }, [rec, uni, lookOn, fxSel, target, first, shaderFailed, faceErrors, faceOff, detector, runner, notifyFirstFrame, notifyShaderFail, notifyFaceFail]);

  return (
    <SkiaCamera
      style={style}
      device={device}
      isActive={isActive}
      outputs={outputs}
      constraints={constraints}
      zoom={zoom}
      torchMode={torch ? 'on' : 'off'}
      // CPU-readable YUV_420_888. The default ('native' = PRIVATE) is refused by
      // CameraX on some LIMITED-level phones ("PRIVATE format with resolution
      // 1280x720 is not supported for ImageAnalysis"), which left the preview
      // permanently black. YUV is also what ML Kit reads for face detection.
      pixelFormat="yuv"
      targetResolution={PREVIEW_RESOLUTION}
      onError={onError}
      onFrame={onFrame}
    />
  );
}
