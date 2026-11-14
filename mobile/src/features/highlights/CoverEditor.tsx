/* eslint-disable react-hooks/refs -- the gesture handlers (runOnJS) read refs only when a finger moves, never while rendering; the drawing records where each text is for those taps. */
import { Ionicons } from '@expo/vector-icons';
import { Canvas, Picture, Skia, type SkImage } from '@shopify/react-native-skia';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { LocalMedia } from '@/api/upload';
import { showAlert } from '@/components/Dialog';
import { reportError } from '@/lib/errorReport';

import {
  clampPan,
  type CoverEdit,
  drawCover,
  FILTERS,
  loadSkImage,
  NEW_EDIT,
  prepareLocalPhoto,
  renderCoverFile,
  TEXT_COLORS,
  type TextBounds,
  type TextLayer,
} from './coverEdit';
import { COVER_ASPECT, type CoverFit } from './HighlightCover';

// The cover editor (owner, 15 Nov 2026): after a photo is picked it opens
// full screen, in the shape of the chosen layout. Drag to move the photo,
// pinch to zoom, turn or flip it, pick a filter, adjust the light and add
// words. Done saves a new picture; Cancel (or Back) leaves the cover as it
// was, asking first when something was changed.

type Tool = 'crop' | 'filters' | 'adjust' | 'text';
const TOOLS: { k: Tool; icon: keyof typeof Ionicons.glyphMap }[] = [
  { k: 'crop', icon: 'crop-outline' },
  { k: 'filters', icon: 'color-filter-outline' },
  { k: 'adjust', icon: 'options-outline' },
  { k: 'text', icon: 'text-outline' },
];

let nextId = 1;

export function CoverEditor({
  source,
  initial,
  fit,
  onCancel,
  onDone,
}: {
  /** null = closed. */
  source: string | null;
  initial: CoverEdit;
  fit: CoverFit;
  onCancel: () => void;
  onDone: (media: LocalMedia, edit: CoverEdit, img: SkImage) => void;
}) {
  const { t } = useTranslation();
  const { width: sw, height: sh } = useWindowDimensions();
  const [img, setImg] = useState<SkImage | null>(null);
  const [failed, setFailed] = useState(false);
  const [edit, setEdit] = useState<CoverEdit>(initial);
  const [tool, setTool] = useState<Tool>('crop');
  const [selected, setSelected] = useState<string | null>(null);
  const [typing, setTyping] = useState<{ id: string; text: string } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [saving, setSaving] = useState(false);

  // A new photo (or the editor opening again) starts from its own edit.
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (openFor !== source) {
    setOpenFor(source);
    setEdit(initial);
    setTool('crop');
    setSelected(null);
    setTyping(null);
    setConfirmLeave(false);
    setImg(null);
    setFailed(false);
  }
  useEffect(() => {
    if (!source) return;
    let live = true;
    loadSkImage(source)
      .then((i) => {
        if (!live) return;
        if (i) setImg(i);
        else setFailed(true);
      })
      .catch((e) => {
        reportError('handled', e, false, 'cover-editor-load');
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [source]);

  // The frame: the layout's shape, as big as fits above the tools.
  const [aw, ah] = COVER_ASPECT[fit];
  const maxW = sw - 32;
  const maxH = Math.max(220, sh * 0.52);
  const W = Math.round(Math.min(maxW, (maxH * aw) / ah));
  const H = Math.round((W * ah) / aw);

  const bounds = useRef<TextBounds[]>([]);
  const picture = useMemo(() => {
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, W, H));
    bounds.current = drawCover(c, img, edit, W, H, selected);
    return rec.finishRecordingAsPicture();
  }, [img, edit, W, H, selected]);

  const dirty = JSON.stringify(edit) !== JSON.stringify(initial);
  const leave = () => {
    if (saving) return;
    if (dirty) setConfirmLeave(true);
    else onCancel();
  };

  const patch = (p: Partial<CoverEdit>) =>
    setEdit((e) => {
      const n = { ...e, ...p };
      return img ? { ...n, ...clampPan(img, n, W, H) } : n;
    });
  const patchText = (id: string, p: Partial<TextLayer>) =>
    setEdit((e) => ({ ...e, texts: e.texts.map((x) => (x.id === id ? { ...x, ...p } : x)) }));

  const hit = (x: number, y: number) => {
    for (let i = bounds.current.length - 1; i >= 0; i--) {
      const b = bounds.current[i];
      if (x >= b.x - 8 && x <= b.x + b.w + 8 && y >= b.y - 8 && y <= b.y + b.h + 8) return b.id;
    }
    return null;
  };

  // Gestures: on a text they move or size that text; elsewhere the photo.
  const drag = useRef<{ target: string | 'photo'; x: number; y: number } | null>(null);
  const pinch = useRef<{ target: string | 'photo'; v: number } | null>(null);
  const editRef = useRef(edit);
  editRef.current = edit;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .minDistance(4)
      .averageTouches(true)
      .onStart((e) => {
        const id = hit(e.x - e.translationX, e.y - e.translationY);
        const cur = editRef.current;
        if (id) {
          const tl = cur.texts.find((x) => x.id === id)!;
          setSelected(id);
          drag.current = { target: id, x: tl.x, y: tl.y };
        } else {
          drag.current = { target: 'photo', x: cur.tx, y: cur.ty };
        }
      })
      .onUpdate((e) => {
        const d = drag.current;
        if (!d) return;
        const nx = d.x + e.translationX / W;
        const ny = d.y + e.translationY / H;
        if (d.target === 'photo') patch({ tx: nx, ty: ny });
        else patchText(d.target, { x: Math.max(0.05, Math.min(0.95, nx)), y: Math.max(0.05, Math.min(0.95, ny)) });
      })
      .onFinalize(() => {
        drag.current = null;
      });
    const zoom = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        const cur = editRef.current;
        const sel = selectedRef.current ? cur.texts.find((x) => x.id === selectedRef.current) : null;
        pinch.current = sel ? { target: sel.id, v: sel.size } : { target: 'photo', v: cur.zoom };
      })
      .onUpdate((e) => {
        const p = pinch.current;
        if (!p) return;
        if (p.target === 'photo') patch({ zoom: Math.max(1, Math.min(5, p.v * e.scale)) });
        else patchText(p.target, { size: Math.max(0.035, Math.min(0.25, p.v * e.scale)) });
      })
      .onFinalize(() => {
        pinch.current = null;
      });
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => {
        const id = hit(e.x, e.y);
        if (!id) {
          setSelected(null);
          return;
        }
        if (id === selectedRef.current) {
          const tl = editRef.current.texts.find((x) => x.id === id);
          if (tl) setTyping({ id, text: tl.text });
        } else {
          setSelected(id);
          setTool('text');
        }
      });
    return Gesture.Exclusive(Gesture.Simultaneous(pan, zoom), tap);
    // The handlers read the latest state through refs; W and H change the maths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H, img]);

  const addText = () => {
    const id = `t${nextId++}`;
    setTyping({ id, text: '' });
    setTool('text');
  };
  const finishTyping = () => {
    if (!typing) return;
    const text = typing.text.trim();
    const exists = edit.texts.some((x) => x.id === typing.id);
    if (!text) {
      if (exists) setEdit((e) => ({ ...e, texts: e.texts.filter((x) => x.id !== typing.id) }));
      setSelected(null);
    } else if (exists) {
      patchText(typing.id, { text });
      setSelected(typing.id);
    } else {
      setEdit((e) => ({
        ...e,
        texts: [...e.texts, { id: typing.id, text, color: '#ffffff', size: 0.09, x: 0.5, y: 0.5, box: false }],
      }));
      setSelected(typing.id);
    }
    setTyping(null);
  };
  const sel = edit.texts.find((x) => x.id === selected) ?? null;

  const done = async () => {
    if (!img || saving) return;
    setSaving(true);
    try {
      const media = await renderCoverFile(img, edit, fit);
      onDone(media, edit, img);
    } catch (e) {
      reportError('handled', e, true, 'cover-editor-save');
      showAlert(t('live.errors.title'), t('coverEditor.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={!!source} animationType="slide" onRequestClose={() => (typing ? finishTyping() : confirmLeave ? setConfirmLeave(false) : leave())}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <View style={styles.top}>
            <Pressable onPress={leave} hitSlop={10} accessibilityRole="button" style={styles.topBtn}>
              <Text style={styles.topText}>{t('coverEditor.cancel')}</Text>
            </Pressable>
            <Text style={styles.title}>{t('coverEditor.title')}</Text>
            <Pressable onPress={() => void done()} disabled={!img || saving} hitSlop={10} accessibilityRole="button" style={styles.topBtn}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={[styles.topText, styles.doneText, !img && { opacity: 0.4 }]}>{t('coverEditor.done')}</Text>}
            </Pressable>
          </View>

          <View style={styles.stage}>
            {failed ? (
              <Text style={styles.failed}>{t('coverEditor.loadFailed')}</Text>
            ) : !img ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <GestureDetector gesture={gesture}>
                <View style={{ width: W, height: H }} accessibilityLabel={t('coverEditor.frameLabel')}>
                  <Canvas style={{ width: W, height: H }}>
                    <Picture picture={picture} />
                  </Canvas>
                </View>
              </GestureDetector>
            )}
          </View>

          <View style={styles.panel}>
            {tool === 'crop' ? (
              <View style={styles.row}>
                <ToolButton icon="refresh-outline" label={t('coverEditor.rotate')} onPress={() => patch({ rot: (((edit.rot + 1) % 4) as CoverEdit['rot']) })} />
                <ToolButton icon="swap-horizontal-outline" label={t('coverEditor.flip')} onPress={() => patch({ flip: !edit.flip })} />
                <ToolButton icon="scan-outline" label={t('coverEditor.fitPhoto')} onPress={() => patch({ zoom: 1, tx: 0, ty: 0, rot: 0, flip: false })} />
              </View>
            ) : tool === 'filters' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {FILTERS.map((f) => (
                  <Pressable
                    key={f}
                    onPress={() => patch({ filter: f })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: edit.filter === f }}
                    style={[styles.chip, edit.filter === f && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, edit.filter === f && styles.chipTextOn]}>{t(`coverEditor.f_${f}`)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : tool === 'adjust' ? (
              <View style={{ gap: 10 }}>
                <Slider label={t('coverEditor.brightness')} value={edit.bright} onChange={(v) => patch({ bright: v })} />
                <Slider label={t('coverEditor.contrast')} value={edit.contrast} onChange={(v) => patch({ contrast: v })} />
                <Slider label={t('coverEditor.saturation')} value={edit.sat} onChange={(v) => patch({ sat: v })} />
              </View>
            ) : sel ? (
              <View style={{ gap: 10 }}>
                <View style={styles.row}>
                  {TEXT_COLORS.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => patchText(sel.id, { color: c })}
                      accessibilityRole="radio"
                      accessibilityLabel={c}
                      accessibilityState={{ selected: sel.color === c }}
                      style={[styles.swatch, { backgroundColor: c }, sel.color === c && styles.swatchOn]}
                      hitSlop={4}
                    />
                  ))}
                </View>
                <View style={styles.row}>
                  <ToolButton icon="create-outline" label={t('coverEditor.editText')} onPress={() => setTyping({ id: sel.id, text: sel.text })} />
                  <ToolButton
                    icon={sel.box ? 'square' : 'square-outline'}
                    label={t('coverEditor.box')}
                    onPress={() => patchText(sel.id, { box: !sel.box })}
                    on={sel.box}
                  />
                  <ToolButton
                    icon="trash-outline"
                    label={t('coverEditor.deleteText')}
                    onPress={() => {
                      setEdit((e) => ({ ...e, texts: e.texts.filter((x) => x.id !== sel.id) }));
                      setSelected(null);
                    }}
                  />
                </View>
                <Text style={styles.hint}>{t('coverEditor.textHint')}</Text>
              </View>
            ) : (
              <View style={{ gap: 10, alignItems: 'center' }}>
                <Pressable onPress={addText} style={styles.addText} accessibilityRole="button">
                  <Ionicons name="add" size={20} color="#fff" />
                  <Text style={styles.addTextLabel}>{t('coverEditor.addText')}</Text>
                </Pressable>
                {edit.texts.length ? <Text style={styles.hint}>{t('coverEditor.tapToSelect')}</Text> : null}
              </View>
            )}
            {tool === 'crop' ? <Text style={[styles.hint, { marginTop: 10 }]}>{t('coverEditor.moveHint')}</Text> : null}
          </View>

          <View style={styles.tools} accessibilityRole="tablist">
            {TOOLS.map(({ k, icon }) => (
              <Pressable
                key={k}
                onPress={() => {
                  setTool(k);
                  if (k !== 'text') setSelected(null);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: tool === k }}
                style={styles.toolTab}
              >
                <Ionicons name={icon} size={22} color={tool === k ? '#fff' : 'rgba(255,255,255,0.55)'} />
                <Text style={[styles.toolLabel, tool === k && { color: '#fff' }]}>{t(`coverEditor.tool_${k}`)}</Text>
              </Pressable>
            ))}
          </View>

          {typing ? (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.typing}>
              <Pressable style={StyleSheet.absoluteFill} onPress={finishTyping} accessibilityLabel={t('coverEditor.done')} />
              <TextInput
                value={typing.text}
                onChangeText={(v) => setTyping({ ...typing, text: v.slice(0, 80) })}
                autoFocus
                multiline
                placeholder={t('coverEditor.textPh')}
                placeholderTextColor="rgba(255,255,255,0.5)"
                style={styles.typingInput}
                maxLength={80}
              />
              <Pressable onPress={finishTyping} style={styles.typingDone} accessibilityRole="button">
                <Text style={styles.addTextLabel}>{t('coverEditor.done')}</Text>
              </Pressable>
            </KeyboardAvoidingView>
          ) : null}

          {confirmLeave ? (
            <View style={styles.confirmWrap}>
              <View style={styles.confirm}>
                <Text style={styles.confirmTitle}>{t('coverEditor.discardTitle')}</Text>
                <Text style={styles.confirmBody}>{t('coverEditor.discardBody')}</Text>
                <View style={styles.confirmRow}>
                  <Pressable onPress={() => setConfirmLeave(false)} style={styles.confirmBtn} accessibilityRole="button">
                    <Text style={styles.confirmKeep}>{t('coverEditor.keep')}</Text>
                  </Pressable>
                  <Pressable onPress={onCancel} style={styles.confirmBtn} accessibilityRole="button">
                    <Text style={styles.confirmDiscard}>{t('coverEditor.discard')}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ToolButton({ icon, label, onPress, on }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; on?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.toolBtn, on && styles.chipOn]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color="#fff" />
      <Text style={styles.toolBtnText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** -1..1 with 0 in the middle. Drag or tap along it; double-tap resets. */
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(1);
  const set = (x: number) => onChange(Math.max(-1, Math.min(1, (x / w) * 2 - 1)));
  const g = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin((e) => set(e.x))
      .onUpdate((e) => set(e.x));
    const reset = Gesture.Tap()
      .numberOfTaps(2)
      .runOnJS(true)
      .onEnd(() => onChange(0));
    return Gesture.Exclusive(reset, pan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, onChange]);
  const pct = (value + 1) / 2;
  return (
    <View
      style={styles.slider}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: `${Math.round(value * 100)}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(Math.max(-1, Math.min(1, value + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1))))}
    >
      <View style={styles.sliderHead}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderValue}>{value > 0 ? `+${Math.round(value * 100)}` : Math.round(value * 100)}</Text>
      </View>
      <GestureDetector gesture={g}>
        <View style={styles.trackHit} onLayout={(e) => setW(Math.max(1, e.nativeEvent.layout.width))}>
          <View style={styles.track} />
          <View style={[styles.trackMid]} />
          <View style={[styles.knob, { left: pct * w - 11 }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

// ---------- the makers' side ----------

export type CoverPick = {
  /** The file that is posted (edited, or as picked). */
  media: LocalMedia | null;
  /** The photo before editing and the edit, to edit again or redo for a new layout. */
  source: string | null;
  edit: CoverEdit;
  img: SkImage | null;
};

const EMPTY: CoverPick = { media: null, source: null, edit: NEW_EDIT, img: null };

/** The cover's photo, the layout and the editor, for the highlight and voice
 *  clip makers. `fallbackUri` is the default cover (live / profile photo). */
export function useCoverEditing(fallbackUri: string | null, failTitle: string) {
  const { t } = useTranslation();
  const [fit, setFitState] = useState<CoverFit>('square');
  const [pick, setPick] = useState<CoverPick>(EMPTY);
  const [editing, setEditing] = useState<{ source: string; edit: CoverEdit } | null>(null);
  const [rendering, setRendering] = useState(false);

  async function choosePhoto() {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      const src = await prepareLocalPhoto(a.uri, a.width, a.height);
      setEditing({ source: src, edit: NEW_EDIT });
    } catch (e) {
      reportError('handled', e, false, 'cover-pick');
      showAlert(failTitle, t('live.highlight.coverPickFailed'));
    }
  }

  /** Edit the cover shown now: the edited photo again, or the default one. */
  function editCurrent() {
    if (pick.source) setEditing({ source: pick.source, edit: pick.edit });
    else if (fallbackUri) setEditing({ source: fallbackUri, edit: NEW_EDIT });
  }

  // A new layout redraws an edited photo in the new shape (same edit).
  async function setFit(f: CoverFit) {
    setFitState(f);
    if (!pick.img) return;
    setRendering(true);
    try {
      const media = await renderCoverFile(pick.img, pick.edit, f);
      setPick((p) => ({ ...p, media }));
    } catch (e) {
      reportError('handled', e, false, 'cover-refit');
    } finally {
      setRendering(false);
    }
  }

  const editor = (
    <CoverEditor
      source={editing?.source ?? null}
      initial={editing?.edit ?? NEW_EDIT}
      fit={fit}
      onCancel={() => setEditing(null)}
      onDone={(media, edit, img) => {
        setPick({ media, source: editing!.source, edit, img });
        setEditing(null);
      }}
    />
  );

  return {
    fit,
    setFit,
    cover: pick.media,
    /** What to show: the posted file, else the default cover. */
    shownUri: pick.media?.uri ?? fallbackUri,
    canEdit: !!(pick.source || fallbackUri),
    choosePhoto,
    editCurrent,
    reset: () => setPick(EMPTY),
    rendering,
    editor,
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000421' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
  topBtn: { minWidth: 64, paddingVertical: 8 },
  topText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  doneText: { color: '#5b8cff', fontWeight: '800', textAlign: 'right' },
  title: { color: '#fff', fontSize: 16, fontWeight: '800' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  failed: { color: '#fff', textAlign: 'center', paddingHorizontal: 32 },
  panel: { minHeight: 132, paddingHorizontal: 16, paddingTop: 12, justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  toolBtn: { alignItems: 'center', gap: 4, minWidth: 84, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  toolBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 12.5, textAlign: 'center' },
  chips: { gap: 8, paddingHorizontal: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1.5, borderColor: 'transparent' },
  chipOn: { borderColor: '#5b8cff', backgroundColor: 'rgba(91,140,255,0.2)' },
  chipText: { color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' },
  swatchOn: { borderColor: '#5b8cff', borderWidth: 3 },
  addText: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1e56d6', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999 },
  addTextLabel: { color: '#fff', fontWeight: '800', fontSize: 15 },
  tools: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.15)', paddingTop: 6 },
  toolTab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 6 },
  toolLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 11.5, fontWeight: '700' },
  slider: { gap: 4 },
  sliderHead: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderLabel: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sliderValue: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontVariant: ['tabular-nums'] },
  trackHit: { height: 28, justifyContent: 'center', direction: 'ltr' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  trackMid: { position: 'absolute', left: '50%', width: 2, height: 12, marginLeft: -1, backgroundColor: 'rgba(255,255,255,0.6)' },
  knob: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  typing: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  typingInput: { color: '#fff', fontSize: 28, fontWeight: '800', textAlign: 'center', minWidth: 200, maxWidth: '100%' },
  typingDone: { marginTop: 24, backgroundColor: '#1e56d6', paddingHorizontal: 24, paddingVertical: 11, borderRadius: 999 },
  confirmWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  confirm: { backgroundColor: '#121c4a', borderRadius: 16, padding: 20, width: '100%', maxWidth: 360, gap: 8 },
  confirmTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  confirmBody: { color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 20 },
  confirmRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  confirmBtn: { paddingHorizontal: 12, paddingVertical: 10 },
  confirmKeep: { color: '#fff', fontWeight: '700' },
  confirmDiscard: { color: '#ff4d6d', fontWeight: '800' },
});
