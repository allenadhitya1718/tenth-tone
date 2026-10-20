import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, I18nManager, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  type Recorder,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  useVideoOutput,
} from 'react-native-vision-camera';

import { Alert } from '@/components/Dialog';
import { Button } from '@/components/ui';
import { NEW_STORY_HREF } from '@/features/stories/StoryTray';

import { buildFxTimeline, FACE_FX_IDS, type FaceFxId } from './faceFx';
import { faceFxAvailable } from './faceSupport';
import { isNeutral, LOOK_IDS, lookSpec, TINTS, type LookId } from './looks';
import { bakeColorMatrix, bakeLook, filtersAvailable, shaderBakeAvailable } from './videoFilter';

// Required only when this build has the filter module: they pull in Skia, whose
// native side an older binary (or an OTA update on one) does not have.
type FilteredModule = typeof import('./FilteredCamera');
const FilteredMod: FilteredModule | null = filtersAvailable
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./FilteredCamera')
  : null;
const FilteredCamera = FilteredMod?.default ?? null;
// The ML Kit face detector is a separate native module: only loaded when it exists.
const FaceCamera: typeof import('./FaceCamera').default | null =
  FilteredMod && faceFxAvailable
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./FaceCamera').default
    : null;
const Thumbs: typeof import('./thumbs') | null = FilteredMod
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./thumbs')
  : null;

const MAX_SECONDS = 60;
const BIT_RATE = 6_000_000;
// The front sensor is softer, so it gets more bits to keep what detail there
// is. 7 Mbps * 60 s is ~53 MB, still under the 60 MB upload ceiling.
const FRONT_BIT_RATE = 7_000_000;
// If the Skia preview has not delivered a frame by then, fall back a step.
const SKIA_FIRST_FRAME_MS = 4000;
// Strip geometry, also used by getItemLayout so scrollToIndex is exact.
const ITEM_WIDTH = 62;
const ITEM_GAP = 14;
// A horizontal swipe on the preview this far (or this fast) changes the look.
const SWIPE_DISTANCE = 50;
const SWIPE_VELOCITY = 500;
const FX_FPS = 30;
const BEAUTY_DEFAULT = 0.6;
const SLIDER_WIDTH = 180;

type StripItem = { key: string; kind: 'none' } | { key: string; kind: 'fx'; id: FaceFxId; index: number } | { key: string; kind: 'look'; id: LookId };

// One strip: None, then the face effects (when this build can put them in the
// file), then the colour looks.
const STRIP: StripItem[] = [
  { key: 'none', kind: 'none' },
  ...(faceFxAvailable ? FACE_FX_IDS.map((id, index): StripItem => ({ key: `fx:${id}`, kind: 'fx', id, index })) : []),
  ...LOOK_IDS.filter((id) => id !== 'normal').map((id): StripItem => ({ key: `look:${id}`, kind: 'look', id })),
];

// The recording screen. Client notes covered here:
//   3  zoom (pinch and 1x/2x chips) and 1080p at a real bitrate instead of
//      the WebView's ~720p MediaRecorder. Looks and face effects: the preview
//      runs through Skia (a colour/beauty shader plus sprites anchored to an
//      ML Kit face), and the same shader and sprite timeline are replayed into
//      the file by a native re-encode right after recording (videoFilter.ts).
//   19 double tap anywhere flips front/back.
//   20 a short vibration when recording starts (and stops).
export function CameraScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const cam = useCameraPermission();
  const mic = useMicrophonePermission();
  const [position, setPosition] = useState<'back' | 'front'>('back');
  const device = useCameraDevice(position);
  const [focused, setFocused] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [torch, setTorch] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<Recorder | null>(null);
  // Set while a recorder is being created/started. A second tap in that gap
  // used to start a second recording and crash the app natively
  // ("A recording is already in progress").
  const starting = useRef(false);
  const [look, setLook] = useState<LookId>('normal');
  const [fx, setFx] = useState<FaceFxId | null>(null);
  const [beautyOn, setBeautyOn] = useState(false);
  const [beautyAmt, setBeautyAmt] = useState(BEAUTY_DEFAULT);
  const beauty = beautyOn ? beautyAmt : 0;
  const [showFilters, setShowFilters] = useState(false);
  const [baking, setBaking] = useState(false);
  const strip = useRef<FlatList<StripItem>>(null);
  // The look's / effect's name fades in at the centre for a moment when it
  // changes, the way Instagram's camera announces a pick.
  const nameOpacity = useSharedValue(0);
  const nameStyle = useAnimatedStyle(() => ({ opacity: nameOpacity.value }));
  const [flashName, setFlashName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  // Fallback ladder: face effects -> looks only -> the plain camera.
  const [faceFailed, setFaceFailed] = useState(false);
  const [skiaFailed, setSkiaFailed] = useState(false);
  const gotFirstFrame = useRef(false);

  const wantsSkia = FilteredCamera != null && (look !== 'normal' || beauty > 0 || fx != null);
  const filtered = wantsSkia && !skiaFailed;
  const useFace = filtered && FaceCamera != null && !faceFailed;
  // The recorder that logs face detections for the export, one per screen.
  const fxRec = useMemo(() => FilteredMod?.createFxRecorder() ?? null, []);
  // What the file must carry, fixed when recording starts (the UI is locked while recording).
  const recordedLook = useRef<{ look: LookId; beauty: number; fx: FaceFxId | null } | null>(null);

  // 1080p, H.264 at ~6 Mbps: sharp on a phone screen, and the upload stays
  // well under the 60 MB ceiling for a 60 s clip.
  const bitRate = position === 'front' ? FRONT_BIT_RATE : BIT_RATE;
  const video = useVideoOutput({ enableAudio: true, targetBitRate: bitRate, fileType: 'mp4' });
  const constraints = useMemo(
    () => [
      { resolutionBias: video },
      { fps: 30 },
      // No stabilization: on this class of phone it is electronic, crops the
      // frame and scales the rest back up, which made the preview soft.
      { videoStabilizationMode: 'off' as const },
      { previewStabilizationMode: 'off' as const },
    ],
    [video],
  );

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const say = useCallback(
    (text: string) => {
      setNotice(text);
    },
    [setNotice],
  );
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(id);
  }, [notice]);

  // Face effects that cannot run are dropped with a visible message, never
  // silently: the strip would otherwise promise something the file lacks.
  const fxRef = useRef(fx);
  useEffect(() => {
    fxRef.current = fx;
  }, [fx]);
  const dropFx = useCallback(() => {
    if (fxRef.current == null) return;
    fxRef.current = null;
    setFx(null);
    say(t('camera2.fxUnavailable'));
  }, [say, t]);

  // A step down the ladder when the picture cannot be produced. Never while a
  // recording is running (swapping the camera would end it).
  const degrade = useCallback(() => {
    if (recorder.current || starting.current) return;
    if (useFace) setFaceFailed(true);
    else setSkiaFailed(true);
    dropFx();
  }, [useFace, dropFx]);
  const faceFailedNow = useCallback(() => {
    if (recorder.current || starting.current) return;
    setFaceFailed(true);
    dropFx();
  }, [dropFx]);
  const shaderFailedNow = useCallback(() => {
    if (recorder.current || starting.current) return;
    setSkiaFailed(true);
    dropFx();
  }, [dropFx]);

  const deviceId = device?.id;
  useEffect(() => {
    if (!filtered || !focused || !deviceId) return;
    gotFirstFrame.current = false;
    const id = setTimeout(() => {
      if (!gotFirstFrame.current) degrade();
    }, SKIA_FIRST_FRAME_MS);
    return () => clearTimeout(id);
  }, [filtered, focused, deviceId, useFace, degrade]);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  // Strip thumbnails: drawn once, one per tick so the UI never stalls.
  const thumbsStarted = useRef(false);
  useEffect(() => {
    if (!showFilters || thumbsStarted.current || !Thumbs) return;
    thumbsStarted.current = true;
    const items = STRIP.filter((i) => i.kind !== 'none');
    let n = 0;
    let handle: ReturnType<typeof setTimeout>;
    const next = () => {
      const item = items[n++];
      if (!item) return;
      const uri = item.kind === 'look' ? Thumbs.lookThumb(item.id) : item.kind === 'fx' ? Thumbs.fxThumb(item.index) : null;
      if (uri) setThumbs((m) => ({ ...m, [item.key]: uri }));
      handle = setTimeout(next, 16);
    };
    handle = setTimeout(next, 60);
    return () => clearTimeout(handle);
  }, [showFilters]);

  const minZoom = device?.minZoom ?? 1;
  const maxZoom = Math.min(device?.maxZoom ?? 8, 10);
  const clampZoom = (z: number) => Math.max(minZoom, Math.min(maxZoom, z));

  const flip = useCallback(() => {
    // Switching lenses mid-recording would end the recorder's session.
    if (recording) return;
    void Haptics.selectionAsync();
    setPosition((p) => (p === 'back' ? 'front' : 'back'));
    setZoom(1);
    setTorch(false);
  }, [recording]);

  const announce = useCallback(
    (name: string) => {
      setFlashName(name);
      nameOpacity.set(withSequence(withTiming(1, { duration: 140 }), withDelay(650, withTiming(0, { duration: 320 }))));
    },
    [nameOpacity],
  );

  const selectLook = useCallback(
    (id: LookId) => {
      if (id === look) return;
      void Haptics.selectionAsync();
      setLook(id);
      announce(t(`camera2.filter.${id}`));
    },
    [look, announce, t],
  );

  const selectFx = useCallback(
    (id: FaceFxId | null) => {
      if (id === fx) return;
      void Haptics.selectionAsync();
      setFx(id);
      if (id) announce(t(`camera2.fx.${id}`));
    },
    [fx, announce, t],
  );

  const pick = useCallback(
    (item: StripItem) => {
      if (recording || baking) return;
      if (item.kind === 'none') {
        if (look !== 'normal' || fx != null) void Haptics.selectionAsync();
        setLook('normal');
        setFx(null);
      } else if (item.kind === 'look') {
        // Tapping the active look again switches it off.
        if (item.id === look) {
          void Haptics.selectionAsync();
          setLook('normal');
        } else selectLook(item.id);
      } else if (item.id === fx) selectFx(null);
      else selectFx(item.id);
    },
    [recording, baking, look, fx, selectLook, selectFx],
  );

  // Keep the last picked thumbnail centred in the strip.
  const stripFocus = fx && !recording ? `fx:${fx}` : look !== 'normal' ? `look:${look}` : 'none';
  useEffect(() => {
    if (!showFilters) return;
    const i = STRIP.findIndex((s) => s.key === stripFocus);
    if (i >= 0) strip.current?.scrollToIndex({ index: Math.min(i, STRIP.length - 1), viewPosition: 0.5, animated: true });
  }, [stripFocus, showFilters]);

  // Swipe left for the next look, right for the previous (mirrored in RTL,
  // where the strip runs the other way). Stops at either end like Instagram.
  const stepLook = useCallback(
    (dx: number, vx: number) => {
      if (recording || baking || !FilteredCamera) return;
      if (Math.abs(dx) < SWIPE_DISTANCE && Math.abs(vx) < SWIPE_VELOCITY) return;
      const towardsNext = (dx < 0) !== I18nManager.isRTL;
      const i = LOOK_IDS.indexOf(look) + (towardsNext ? 1 : -1);
      if (i < 0 || i >= LOOK_IDS.length) return;
      selectLook(LOOK_IDS[i]);
    },
    [recording, baking, look, selectLook],
  );

  const gestures = useMemo(() => {
    // scaleChange is the ratio since the previous event, so the zoom follows
    // the fingers without remembering where the pinch began.
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onChange((e) => setZoom((z) => Math.max(minZoom, Math.min(maxZoom, z * e.scaleChange))));
    const doubleTap = Gesture.Tap().numberOfTaps(2).runOnJS(true).onEnd(flip);
    // One finger and clearly horizontal, so it never fights the pinch or a
    // vertical drag.
    const swipe = Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .activeOffsetX([-20, 20])
      .failOffsetY([-25, 25])
      .onEnd((e) => stepLook(e.translationX, e.velocityX));
    return Gesture.Simultaneous(pinch, doubleTap, swipe);
  }, [flip, minZoom, maxZoom, stepLook]);

  // Normal goes straight to publish. Anything else is re-encoded first so the
  // uploaded file carries the look and the effect the preview showed.
  async function finishRecording(uri: string) {
    const rl = recordedLook.current;
    recordedLook.current = null;
    const log = fxRec?.end();
    if (!rl || (isNeutral(rl.look, rl.beauty) && rl.fx == null)) {
      router.push({ pathname: '/publish', params: { uri } });
      return;
    }
    setBaking(true);
    try {
      let baked: string;
      if (shaderBakeAvailable) {
        let timeline = null;
        if (rl.fx != null && log && log.samples.length > 0) {
          const last = log.samples[log.samples.length - 1][0];
          const secs = Math.min(MAX_SECONDS + 1, Math.max(1, (last - log.t0) / 1e9 + 1.5));
          timeline = buildFxTimeline(FACE_FX_IDS.indexOf(rl.fx), log.samples, log.t0, secs, log.w, log.h, FX_FPS);
        }
        baked = await bakeLook(uri, isNeutral(rl.look, rl.beauty) ? null : lookSpec(rl.look, rl.beauty), timeline, bitRate);
      } else {
        // Older binary or iOS: the closest colour matrix to the look (no
        // vignette, grain, glow or skin smoothing, and no face effects).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fitted = (require('./lookFallback') as typeof import('./lookFallback')).fitLookMatrix(rl.look);
        if (!fitted) throw new Error('look unavailable');
        baked = await bakeColorMatrix(uri, fitted, bitRate);
      }
      router.push({ pathname: '/publish', params: { uri: baked, filter: rl.look, beauty: rl.beauty > 0 ? '1' : '0', fx: rl.fx ?? '' } });
    } catch (e) {
      Alert.alert(t('camera2.applyFailed'), (e as Error).message, [
        { text: t('camera2.cancel'), style: 'cancel' },
        { text: t('camera2.postWithout'), onPress: () => router.push({ pathname: '/publish', params: { uri } }) },
      ]);
    } finally {
      setBaking(false);
    }
  }

  async function start() {
    if (starting.current || recorder.current) return;
    starting.current = true;
    try {
      const rec = await video.createRecorder({ maxDuration: MAX_SECONDS });
      recorder.current = rec;
      // The file must carry whatever is on screen now, also when the preview had
      // to fall back to the plain camera (the export does not need Skia).
      const faceLogged = useFace && fx != null;
      recordedLook.current = wantsSkia ? { look, beauty, fx: faceLogged ? fx : null } : null;
      if (faceLogged) fxRec?.begin();
      await rec.startRecording(
        (path) => {
          setRecording(false);
          recorder.current = null;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          void finishRecording(path.startsWith('file://') ? path : `file://${path}`);
        },
        (err) => {
          setRecording(false);
          recorder.current = null;
          fxRec?.end();
          Alert.alert(t('camera.recordFailed'), err.message);
        },
      );
      if (faceLogged) fxRec?.started();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSeconds(0);
      setRecording(true);
    } catch (e) {
      recorder.current = null;
      fxRec?.end();
      Alert.alert(t('camera.recordFailed'), (e as Error).message);
    } finally {
      starting.current = false;
    }
  }

  async function stop() {
    try {
      await recorder.current?.stopRecording();
    } catch (e) {
      Alert.alert(t('camera.recordFailed'), (e as Error).message);
    }
  }

  async function pickFromGallery() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: MAX_SECONDS,
      quality: 1,
    });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    router.push({
      pathname: '/publish',
      params: { uri: a.uri, mime: a.mimeType ?? 'video/mp4', size: String(a.fileSize ?? '') },
    });
  }

  if (!cam.hasPermission || !mic.hasPermission) {
    const blocked = (!cam.hasPermission && !cam.canRequestPermission) || (!mic.hasPermission && !mic.canRequestPermission);
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Ionicons name="videocam-outline" size={54} color="#fff" />
        <Text style={styles.permTitle}>{t('camera.permTitle')}</Text>
        <Text style={styles.permText}>{t('camera.permText')}</Text>
        <Button
          title={t(blocked ? 'camera.openSettings' : 'camera.allow')}
          style={{ alignSelf: 'stretch', marginHorizontal: 32 }}
          onPress={async () => {
            if (blocked) return Linking.openSettings();
            if (!cam.hasPermission) await cam.requestPermission();
            if (!mic.hasPermission) await mic.requestPermission();
          }}
        />
        <CloseButton top={insets.top} />
      </View>
    );
  }

  const stripItems = faceFailed || skiaFailed ? STRIP.filter((i) => i.kind !== 'fx') : STRIP;
  const chips = [minZoom < 1 ? 0.5 : null, 1, 2].filter((z): z is number => z != null && z <= maxZoom);
  const Cam = useFace ? FaceCamera : FilteredCamera;
  const fxIndex = fx ? FACE_FX_IDS.indexOf(fx) : -1;

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gestures}>
        <View style={StyleSheet.absoluteFill}>
          {device && filtered && Cam && fxRec ? (
            <Cam
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={focused}
              outputs={[video]}
              constraints={constraints}
              zoom={zoom}
              torch={torch}
              look={look}
              beauty={beauty}
              fx={fxIndex}
              rec={fxRec}
              onFirstFrame={() => {
                gotFirstFrame.current = true;
              }}
              onShaderFail={shaderFailedNow}
              onFaceFail={faceFailedNow}
              onError={(e) => {
                console.warn('camera:', e.message);
                // "Camera is not active" fires on every session restart and is
                // harmless; anything else before a first frame is fatal for Skia.
                if (!gotFirstFrame.current && !/not active/i.test(e.message)) degrade();
              }}
            />
          ) : device ? (
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={focused}
              outputs={[video]}
              // Pick the capture format for the 1080p video, not the preview:
              // left to itself the camera ran a 1600x1200 4:3 preview that was
              // stretched over the tall screen and looked soft.
              constraints={constraints}
              zoom={zoom}
              torchMode={torch ? 'on' : 'off'}
              resizeMode="cover"
              onError={(e) => console.warn('camera:', e.message)}
            />
          ) : null}
          {device && wantsSkia && skiaFailed && look !== 'normal' ? (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: TINTS[look] }]} />
          ) : null}
        </View>
      </GestureDetector>

      {FilteredCamera && flashName ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, nameStyle]}>
          <Text style={styles.flashName}>{flashName}</Text>
        </Animated.View>
      ) : null}

      {notice ? (
        <View pointerEvents="none" style={[styles.notice, { top: insets.top + 64 }]} accessibilityLiveRegion="polite">
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      <CloseButton top={insets.top} disabled={recording || baking} />

      {recording ? (
        <View style={[styles.timer, { top: insets.top + 14 }]}>
          <View style={styles.recDot} />
          <Text style={styles.timerText}>
            {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
          </Text>
        </View>
      ) : null}

      <View style={[styles.sideTools, { top: insets.top + 12 }]}>
        <Tool icon="camera-reverse-outline" label={t('camera.flip')} onPress={flip} disabled={recording} />
        {position === 'back' && device?.hasTorch ? (
          <Tool icon={torch ? 'flash' : 'flash-off'} label={t('camera.flash')} onPress={() => setTorch((v) => !v)} />
        ) : null}
        {FilteredCamera ? (
          <>
            <Tool
              icon={showFilters ? 'color-filter' : 'color-filter-outline'}
              label={t('camera2.effects')}
              onPress={() => setShowFilters((v) => !v)}
              disabled={recording}
            />
            <Tool
              icon={beautyOn ? 'sparkles' : 'sparkles-outline'}
              label={t('camera2.beauty')}
              onPress={() => {
                void Haptics.selectionAsync();
                setBeautyOn((v) => !v);
              }}
              disabled={recording}
            />
          </>
        ) : null}
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 18 }]}>
        {FilteredCamera && beautyOn && !recording ? <BeautySlider value={beautyAmt} onChange={setBeautyAmt} label={t('camera2.beautyAmount')} /> : null}
        {FilteredCamera && showFilters && !recording ? (
          <FlatList
            ref={strip}
            data={stripItems}
            keyExtractor={(item) => item.key}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            style={styles.stripWrap}
            extraData={stripFocus + look + String(fx) + Object.keys(thumbs).length}
            getItemLayout={(_, index) => ({ length: ITEM_WIDTH + ITEM_GAP, offset: 16 + index * (ITEM_WIDTH + ITEM_GAP), index })}
            onScrollToIndexFailed={() => {}}
            ItemSeparatorComponent={StripGap}
            renderItem={({ item }) => {
              const on = item.kind === 'none' ? look === 'normal' && fx == null : item.kind === 'fx' ? item.id === fx : item.id === look;
              const name = item.kind === 'none' ? t('camera2.none') : item.kind === 'fx' ? t(`camera2.fx.${item.id}`) : t(`camera2.filter.${item.id}`);
              const uri = thumbs[item.key];
              return (
                <Pressable onPress={() => pick(item)} style={styles.filterItem} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={name}>
                  <View style={[styles.swatch, on && styles.swatchOn]}>
                    {item.kind === 'none' ? (
                      <View style={styles.swatchNone}>
                        <Ionicons name="close" size={26} color="#fff" />
                      </View>
                    ) : uri ? (
                      <Image source={{ uri }} style={styles.swatchImage} />
                    ) : (
                      <View style={styles.swatchNone} />
                    )}
                  </View>
                  <Text style={[styles.filterText, on && styles.filterTextOn]} numberOfLines={1}>
                    {name}
                  </Text>
                </Pressable>
              );
            }}
          />
        ) : null}
        <View style={styles.chips}>
          {chips.map((z) => {
            const on = Math.abs(zoom - z) < 0.05;
            return (
              <Pressable
                key={z}
                onPress={() => setZoom(clampZoom(z))}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityLabel={`${z}x`}
              >
                <Text style={[styles.chipText, on && { color: '#111' }]}>{on ? `${zoom.toFixed(1).replace(/\.0$/, '')}x` : `${z}x`}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.row}>
          <Pressable onPress={pickFromGallery} disabled={recording} style={styles.side} accessibilityRole="button" accessibilityLabel={t('camera.upload')}>
            <Ionicons name="images-outline" size={30} color="#fff" style={{ opacity: recording ? 0.3 : 1 }} />
            <Text style={styles.sideText}>{t('camera.upload')}</Text>
          </Pressable>
          <Pressable
            onPress={recording ? stop : start}
            disabled={baking}
            style={styles.recOuter}
            accessibilityRole="button"
            accessibilityLabel={t(recording ? 'camera.stop' : 'camera.record')}
          >
            <View style={[styles.recInner, recording && styles.recInnerOn]} />
          </Pressable>
          <View style={styles.side} />
        </View>
        <Text style={styles.hint}>{t('camera.hint')}</Text>
        {/* Video | Story, like Instagram's mode switch. Story hands over to
            the story composer (it picks a photo or a clip); filters and
            recording here are untouched. Hidden while recording. */}
        {!recording && !baking ? (
          <View style={styles.modes} accessibilityRole="tablist" accessibilityLabel={t('stories.modeA11y')}>
            <View style={styles.mode} accessibilityRole="tab" accessibilityState={{ selected: true }}>
              <Text style={[styles.modeText, styles.modeTextOn]}>{t('stories.modeVideo')}</Text>
              <View style={styles.modeDot} />
            </View>
            <Pressable
              onPress={() => router.replace(NEW_STORY_HREF)}
              hitSlop={10}
              style={styles.mode}
              accessibilityRole="tab"
              accessibilityState={{ selected: false }}
            >
              <Text style={styles.modeText}>{t('stories.modeStory')}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {baking ? (
        <View style={[StyleSheet.absoluteFill, styles.center, styles.baking]}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.bakingText}>{t('camera2.applying')}</Text>
        </View>
      ) : null}
    </View>
  );
}

// A simple horizontal slider (the track is always left to right, whatever the
// language, so the value maps to a physical position).
function BeautySlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .onBegin((e) => onChange(Math.max(0, Math.min(1, (e.x - 12) / SLIDER_WIDTH))))
        .onUpdate((e) => onChange(Math.max(0, Math.min(1, (e.x - 12) / SLIDER_WIDTH)))),
    [onChange],
  );
  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.sliderHit}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(Math.max(0, Math.min(1, value + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1))))}
      >
        <View style={styles.sliderTrack}>
          <View style={[styles.sliderFill, { width: value * SLIDER_WIDTH }]} />
        </View>
        <View style={[styles.sliderThumb, { left: value * SLIDER_WIDTH + 12 - 11 }]} />
      </View>
    </GestureDetector>
  );
}

function StripGap() {
  return <View style={{ width: ITEM_GAP }} />;
}

function CloseButton({ top, disabled }: { top: number; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={() => router.back()}
      disabled={disabled}
      style={[styles.close, { top: top + 10, opacity: disabled ? 0.3 : 1 }]}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t('legal.close')}
    >
      <Ionicons name="close" size={30} color="#fff" />
    </Pressable>
  );
}

function Tool({ icon, label, onPress, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={styles.tool} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={28} color="#fff" style={{ opacity: disabled ? 0.3 : 1 }} />
      <Text style={styles.toolText}>{label}</Text>
    </Pressable>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 } as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  permTitle: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', paddingHorizontal: 32 },
  permText: { color: '#c9cee0', fontSize: 15, textAlign: 'center', paddingHorizontal: 32, lineHeight: 22, marginBottom: 10 },
  close: { position: 'absolute', start: 14 },
  timer: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff2d55' },
  timerText: { color: '#fff', fontWeight: '800', fontSize: 15, fontVariant: ['tabular-nums'] },
  sideTools: { position: 'absolute', end: 12, gap: 20, alignItems: 'center' },
  tool: { alignItems: 'center', gap: 2 },
  toolText: { color: '#fff', fontSize: 11, fontWeight: '600', ...shadow },
  bottom: { position: 'absolute', bottom: 0, start: 0, end: 0, alignItems: 'center', gap: 14 },
  chips: { flexDirection: 'row', gap: 8, backgroundColor: 'rgba(0,0,0,0.35)', padding: 4, borderRadius: 999 },
  chip: { minWidth: 40, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  chipOn: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: 34 },
  side: { width: 64, alignItems: 'center', gap: 2 },
  sideText: { color: '#fff', fontSize: 11, fontWeight: '600', ...shadow },
  recOuter: { width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  recInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#ff2d55' },
  recInnerOn: { width: 32, height: 32, borderRadius: 8 },
  hint: { color: 'rgba(255,255,255,0.75)', fontSize: 12, ...shadow },
  modes: { flexDirection: 'row', gap: 26, marginTop: -4 },
  mode: { alignItems: 'center', gap: 4, minHeight: 28 },
  modeText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '700', ...shadow },
  modeTextOn: { color: '#fff', fontWeight: '800' },
  modeDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#fff' },
  stripWrap: { alignSelf: 'stretch', flexGrow: 0 },
  strip: { paddingHorizontal: 16 },
  filterItem: { alignItems: 'center', width: ITEM_WIDTH, gap: 4 },
  swatch: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  swatchOn: { borderWidth: 3, borderColor: '#fff', transform: [{ scale: 1.08 }] },
  swatchImage: { width: '100%', height: '100%' },
  swatchNone: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(40,40,48,0.85)' },
  notice: { position: 'absolute', alignSelf: 'center', maxWidth: '80%', backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  noticeText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  sliderHit: { direction: 'ltr', width: SLIDER_WIDTH + 24, height: 36, justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: 12 },
  sliderTrack: { width: SLIDER_WIDTH, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  sliderFill: { height: 4, backgroundColor: '#fff' },
  sliderThumb: { position: 'absolute', top: 7, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  flashName: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: 0.5, textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 10 },
  filterText: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600', ...shadow },
  filterTextOn: { color: '#fff', fontWeight: '800' },
  baking: { backgroundColor: 'rgba(0,0,0,0.6)' },
  bakingText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
