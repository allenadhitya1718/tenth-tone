import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { forwardRef, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

import { SPRITES } from './faceFx';
import { glslOesFragmentSource, isNeutral, nativeUniforms, type LookId } from './looks';

// The native fx camera (Android, modules/flyp-fx-camera): CameraX with ONE GPU
// pass that draws the look, the beauty smoothing and the face sprites, and
// feeds both the live preview and the video encoder. The recorded file is the
// very picture that was shown, so nothing is re-encoded afterwards.
//
// Everything here is optional at runtime: an older binary, iOS, or a JS bundle
// running on a build without the module simply has `fxCameraAvailable === false`
// and CameraScreen uses the VisionCamera + Skia path instead.

const PROTOCOL = 1;

type NativeModule = { protocol?: number };
const mod = requireOptionalNativeModule<NativeModule>('FlypFxCamera');

export const fxCameraAvailable: boolean = Platform.OS === 'android' && mod != null && mod.protocol === PROTOCOL;

export type FxCameraReady = { facing: 'front' | 'back'; minZoom: number; maxZoom: number; hasTorch: boolean };
export type FxCameraError = { code: string; message: string; fatal: boolean };
export type FxCameraRecording = { ok: boolean; path: string; durationMs: number; message?: string };

export type FxCameraHandle = {
  /** Starts recording; resolves (with the file path) once the recorder is running. The finished file arrives through onRecordingFinished. */
  startRecording: (maxSeconds: number) => Promise<string>;
  stopRecording: () => void;
};

type NativeEvent<T> = { nativeEvent: T };

type NativeProps = {
  ref?: Ref<NativeViewHandle>;
  style?: StyleProp<ViewStyle>;
  facing: 'front' | 'back';
  torch: boolean;
  zoom: number;
  active: boolean;
  bitRate: number;
  lookFragment: string | null;
  lookUniforms: number[] | null;
  fxIndex: number;
  spritesJson: string | null;
  onReady?: (e: NativeEvent<FxCameraReady>) => void;
  onFirstFrame?: (e: NativeEvent<object>) => void;
  onError?: (e: NativeEvent<FxCameraError>) => void;
  onFacesCount?: (e: NativeEvent<{ count: number }>) => void;
  onRecordingFinished?: (e: NativeEvent<FxCameraRecording>) => void;
};

type NativeViewHandle = {
  startRecording: (maxSeconds: number) => Promise<string>;
  stopRecording: () => Promise<void>;
};

const NativeView = fxCameraAvailable ? requireNativeView<NativeProps>('FlypFxCamera') : null;

// The look shader and the sprite art never change at runtime: built once.
let fragment: string | null = null;
let spritesJson: string | null = null;

export type FxCameraProps = {
  style?: StyleProp<ViewStyle>;
  facing: 'front' | 'back';
  torch: boolean;
  zoom: number;
  active: boolean;
  bitRate: number;
  look: LookId;
  beauty: number;
  /** Index into FACE_FX_IDS, -1 for none. */
  fx: number;
  onReady?: (r: FxCameraReady) => void;
  onFirstFrame?: () => void;
  onError?: (e: FxCameraError) => void;
  onFacesCount?: (n: number) => void;
  onRecordingFinished?: (r: FxCameraRecording) => void;
};

export const FxCamera = forwardRef<FxCameraHandle, FxCameraProps>(function FxCamera(props, ref) {
  const native = useRef<NativeViewHandle | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      startRecording: (maxSeconds) => {
        if (!native.current) return Promise.reject(new Error('camera not mounted'));
        return native.current.startRecording(maxSeconds);
      },
      stopRecording: () => {
        void native.current?.stopRecording();
      },
    }),
    [],
  );

  const neutral = isNeutral(props.look, props.beauty);
  const uniforms = useMemo(() => (neutral ? null : nativeUniforms(props.look, props.beauty)), [neutral, props.look, props.beauty]);
  // The shader is sent even for Normal, so it is compiled once up front and switching to a look never stalls.
  if (fragment == null) fragment = glslOesFragmentSource();
  if (spritesJson == null) spritesJson = JSON.stringify(SPRITES);

  if (!NativeView) return null;
  return (
    <NativeView
      // The ref is the native view instance, which carries startRecording / stopRecording.
      ref={native}
      style={props.style}
      facing={props.facing}
      torch={props.torch}
      zoom={props.zoom}
      active={props.active}
      bitRate={props.bitRate}
      lookFragment={fragment}
      lookUniforms={uniforms}
      fxIndex={props.fx}
      spritesJson={spritesJson}
      onReady={(e) => props.onReady?.(e.nativeEvent)}
      onFirstFrame={() => props.onFirstFrame?.()}
      onError={(e) => props.onError?.(e.nativeEvent)}
      onFacesCount={(e) => props.onFacesCount?.(e.nativeEvent.count)}
      onRecordingFinished={(e) => props.onRecordingFinished?.(e.nativeEvent)}
    />
  );
});
