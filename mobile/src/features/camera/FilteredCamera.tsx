import { Skia } from '@shopify/react-native-skia';
import { useCallback, useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { CameraDevice, CameraOutput, Constraint } from 'react-native-vision-camera';
import { SkiaCamera } from 'react-native-vision-camera-skia';
import { scheduleOnRN } from 'react-native-worklets';

import type { ColorMatrix } from './filters';

type Props = {
  style: StyleProp<ViewStyle>;
  device: CameraDevice;
  isActive: boolean;
  outputs: CameraOutput[];
  constraints: Constraint[];
  zoom: number;
  torch: boolean;
  matrix: ColorMatrix;
  onError: (e: Error) => void;
  /** Called once, on the JS thread, after the first frame went through Skia. */
  onFirstFrame?: () => void;
};

// Preview 16:9 at 720p: Skia copies each rendered frame back to the CPU for
// the canvas, and 1080p of that per frame is too much for mid-range phones.
// The recording itself still comes from the 1080p video output.
const PREVIEW_RESOLUTION = { width: 720, height: 1280 };

// The live preview for any filter other than Normal. Frames go through Skia
// with the same colour matrix the export bakes into the file afterwards.
// Loaded lazily by CameraScreen so builds without Skia never import it.
export default function FilteredCamera({ style, device, isActive, outputs, constraints, zoom, torch, matrix, onError, onFirstFrame }: Props) {
  // A shared value, so changing filters only swaps a number array on the
  // frame thread instead of reconfiguring the camera session.
  const m = useSharedValue<number[]>([...matrix]);
  useEffect(() => {
    m.value = [...matrix];
  }, [m, matrix]);

  // Frames arrive on the camera thread; tell JS once that the pipeline works so
  // CameraScreen can fall back to the plain preview if it never does.
  const first = useSharedValue(false);
  const cb = useRef(onFirstFrame);
  useEffect(() => {
    cb.current = onFirstFrame;
  }, [onFirstFrame]);
  const notifyFirstFrame = useCallback(() => cb.current?.(), []);

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
      // CameraX on some LIMITED-level phones (seen on a Redmi M2010J19SI:
      // "PRIVATE format with resolution 1280x720 is not supported for
      // ImageAnalysis"), which left the preview permanently black. YUV is the
      // format ImageAnalysis is guaranteed to support at 720p with video.
      pixelFormat="yuv"
      targetResolution={PREVIEW_RESOLUTION}
      onError={onError}
      onFrame={(frame, render) => {
        'worklet';
        render(({ canvas, frameTexture }) => {
          const paint = Skia.Paint();
          paint.setColorFilter(Skia.ColorFilter.MakeMatrix(m.value));
          canvas.drawImage(frameTexture, 0, 0, paint);
        });
        frame.dispose();
        if (!first.value) {
          first.value = true;
          scheduleOnRN(notifyFirstFrame);
        }
      }}
    />
  );
}
