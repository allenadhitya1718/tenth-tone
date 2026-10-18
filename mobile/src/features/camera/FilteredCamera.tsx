import { Skia } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { CameraDevice, CameraOutput, Constraint } from 'react-native-vision-camera';
import { SkiaCamera } from 'react-native-vision-camera-skia';

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
};

// Preview 16:9 at 720p: Skia copies each rendered frame back to the CPU for
// the canvas, and 1080p of that per frame is too much for mid-range phones.
// The recording itself still comes from the 1080p video output.
const PREVIEW_RESOLUTION = { width: 720, height: 1280 };

// The live preview for any filter other than Normal. Frames go through Skia
// with the same colour matrix the export bakes into the file afterwards.
// Loaded lazily by CameraScreen so builds without Skia never import it.
export default function FilteredCamera({ style, device, isActive, outputs, constraints, zoom, torch, matrix, onError }: Props) {
  // A shared value, so changing filters only swaps a number array on the
  // frame thread instead of reconfiguring the camera session.
  const m = useSharedValue<number[]>([...matrix]);
  useEffect(() => {
    m.value = [...matrix];
  }, [m, matrix]);

  return (
    <SkiaCamera
      style={style}
      device={device}
      isActive={isActive}
      outputs={outputs}
      constraints={constraints}
      zoom={zoom}
      torchMode={torch ? 'on' : 'off'}
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
      }}
    />
  );
}
