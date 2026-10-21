import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DevSettings, I18nManager, Platform } from 'react-native';

import ar from './locales/ar.json';
import en from './locales/en.json';
import hashtagsAr from './locales/features/hashtags.ar.json';
import hashtagsEn from './locales/features/hashtags.en.json';
import walkieAr from './locales/features/walkie.ar.json';
import walkieEn from './locales/features/walkie.en.json';
import callAr from './locales/features/call.ar.json';
import callEn from './locales/features/call.en.json';
import camera2Ar from './locales/features/camera2.ar.json';
import camera2En from './locales/features/camera2.en.json';
import notifyAr from './locales/features/notify.ar.json';
import notifyEn from './locales/features/notify.en.json';
import notifyZh from './locales/features/notify.zh.json';
import notifyHi from './locales/features/notify.hi.json';
import notifyUr from './locales/features/notify.ur.json';
import notifyFr from './locales/features/notify.fr.json';
import notifyEs from './locales/features/notify.es.json';
import notifyTr from './locales/features/notify.tr.json';
import notifyId from './locales/features/notify.id.json';
import chatAr from './locales/features/chat.ar.json';
import chatEn from './locales/features/chat.en.json';
import discoverAr from './locales/features/discover.ar.json';
import discoverEn from './locales/features/discover.en.json';
import liveAr from './locales/features/live.ar.json';
import liveEn from './locales/features/live.en.json';
import mapAr from './locales/features/map.ar.json';
import mapEn from './locales/features/map.en.json';
import settings2Ar from './locales/features/settings2.ar.json';
import settings2En from './locales/features/settings2.en.json';
import storiesAr from './locales/features/stories.ar.json';
import storiesEn from './locales/features/stories.en.json';
import ugcAr from './locales/features/ugc.ar.json';
import ugcEn from './locales/features/ugc.en.json';
import ugcZh from './locales/features/ugc.zh.json';
import ugcHi from './locales/features/ugc.hi.json';
import ugcUr from './locales/features/ugc.ur.json';
import ugcFr from './locales/features/ugc.fr.json';
import ugcEs from './locales/features/ugc.es.json';
import ugcTr from './locales/features/ugc.tr.json';
import ugcId from './locales/features/ugc.id.json';
import fix4En from './locales/features/fix4.en.json';
import fix4Ar from './locales/features/fix4.ar.json';
import fix4Zh from './locales/features/fix4.zh.json';
import fix4Hi from './locales/features/fix4.hi.json';
import fix4Ur from './locales/features/fix4.ur.json';
import fix4Fr from './locales/features/fix4.fr.json';
import fix4Es from './locales/features/fix4.es.json';
import fix4Tr from './locales/features/fix4.tr.json';
import fix4Id from './locales/features/fix4.id.json';
import gifAr from './locales/features/gif.ar.json';
import gifEn from './locales/features/gif.en.json';
import gifZh from './locales/features/gif.zh.json';
import gifHi from './locales/features/gif.hi.json';
import gifUr from './locales/features/gif.ur.json';
import gifFr from './locales/features/gif.fr.json';
import gifEs from './locales/features/gif.es.json';
import gifTr from './locales/features/gif.tr.json';
import gifId from './locales/features/gif.id.json';
import presenceAr from './locales/features/presence.ar.json';
import presenceEn from './locales/features/presence.en.json';
import presenceZh from './locales/features/presence.zh.json';
import presenceHi from './locales/features/presence.hi.json';
import presenceUr from './locales/features/presence.ur.json';
import presenceFr from './locales/features/presence.fr.json';
import presenceEs from './locales/features/presence.es.json';
import presenceTr from './locales/features/presence.tr.json';
import presenceId from './locales/features/presence.id.json';
import storyReplyAr from './locales/features/storyReply.ar.json';
import storyReplyEn from './locales/features/storyReply.en.json';
import storyReplyZh from './locales/features/storyReply.zh.json';
import storyReplyHi from './locales/features/storyReply.hi.json';
import storyReplyUr from './locales/features/storyReply.ur.json';
import storyReplyFr from './locales/features/storyReply.fr.json';
import storyReplyEs from './locales/features/storyReply.es.json';
import storyReplyTr from './locales/features/storyReply.tr.json';
import storyReplyId from './locales/features/storyReply.id.json';
import callLogAr from './locales/features/callLog.ar.json';
import callLogEn from './locales/features/callLog.en.json';
import callLogZh from './locales/features/callLog.zh.json';
import callLogHi from './locales/features/callLog.hi.json';
import callLogUr from './locales/features/callLog.ur.json';
import callLogFr from './locales/features/callLog.fr.json';
import callLogEs from './locales/features/callLog.es.json';
import callLogTr from './locales/features/callLog.tr.json';
import callLogId from './locales/features/callLog.id.json';
import chatThemeAr from './locales/features/chatTheme.ar.json';
import chatThemeEn from './locales/features/chatTheme.en.json';
import chatThemeZh from './locales/features/chatTheme.zh.json';
import chatThemeHi from './locales/features/chatTheme.hi.json';
import chatThemeUr from './locales/features/chatTheme.ur.json';
import chatThemeFr from './locales/features/chatTheme.fr.json';
import chatThemeEs from './locales/features/chatTheme.es.json';
import chatThemeTr from './locales/features/chatTheme.tr.json';
import chatThemeId from './locales/features/chatTheme.id.json';
import groupInfoAr from './locales/features/groupInfo.ar.json';
import groupInfoEn from './locales/features/groupInfo.en.json';
import groupInfoZh from './locales/features/groupInfo.zh.json';
import groupInfoHi from './locales/features/groupInfo.hi.json';
import groupInfoUr from './locales/features/groupInfo.ur.json';
import groupInfoFr from './locales/features/groupInfo.fr.json';
import groupInfoEs from './locales/features/groupInfo.es.json';
import groupInfoTr from './locales/features/groupInfo.tr.json';
import groupInfoId from './locales/features/groupInfo.id.json';
import sendToAr from './locales/features/sendto.ar.json';
import sendToEn from './locales/features/sendto.en.json';
import sendToZh from './locales/features/sendto.zh.json';
import sendToHi from './locales/features/sendto.hi.json';
import sendToUr from './locales/features/sendto.ur.json';
import sendToFr from './locales/features/sendto.fr.json';
import sendToEs from './locales/features/sendto.es.json';
import sendToTr from './locales/features/sendto.tr.json';
import sendToId from './locales/features/sendto.id.json';
import polishAr from './locales/features/polish.ar.json';
import polishEn from './locales/features/polish.en.json';
import polishZh from './locales/features/polish.zh.json';
import polishHi from './locales/features/polish.hi.json';
import polishUr from './locales/features/polish.ur.json';
import polishFr from './locales/features/polish.fr.json';
import polishEs from './locales/features/polish.es.json';
import polishTr from './locales/features/polish.tr.json';
import polishId from './locales/features/polish.id.json';
import zh from './locales/zh.json';
import hi from './locales/hi.json';
import ur from './locales/ur.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import tr from './locales/tr.json';
import id from './locales/id.json';
import chatZh from './locales/features/chat.zh.json';
import chatHi from './locales/features/chat.hi.json';
import chatUr from './locales/features/chat.ur.json';
import chatFr from './locales/features/chat.fr.json';
import chatEs from './locales/features/chat.es.json';
import chatTr from './locales/features/chat.tr.json';
import chatId from './locales/features/chat.id.json';
import discoverZh from './locales/features/discover.zh.json';
import discoverHi from './locales/features/discover.hi.json';
import discoverUr from './locales/features/discover.ur.json';
import discoverFr from './locales/features/discover.fr.json';
import discoverEs from './locales/features/discover.es.json';
import discoverTr from './locales/features/discover.tr.json';
import discoverId from './locales/features/discover.id.json';
import liveZh from './locales/features/live.zh.json';
import liveHi from './locales/features/live.hi.json';
import liveUr from './locales/features/live.ur.json';
import liveFr from './locales/features/live.fr.json';
import liveEs from './locales/features/live.es.json';
import liveTr from './locales/features/live.tr.json';
import liveId from './locales/features/live.id.json';
import mapZh from './locales/features/map.zh.json';
import mapHi from './locales/features/map.hi.json';
import mapUr from './locales/features/map.ur.json';
import mapFr from './locales/features/map.fr.json';
import mapEs from './locales/features/map.es.json';
import mapTr from './locales/features/map.tr.json';
import mapId from './locales/features/map.id.json';
import settings2Zh from './locales/features/settings2.zh.json';
import settings2Hi from './locales/features/settings2.hi.json';
import settings2Ur from './locales/features/settings2.ur.json';
import settings2Fr from './locales/features/settings2.fr.json';
import settings2Es from './locales/features/settings2.es.json';
import settings2Tr from './locales/features/settings2.tr.json';
import settings2Id from './locales/features/settings2.id.json';
import storiesZh from './locales/features/stories.zh.json';
import storiesHi from './locales/features/stories.hi.json';
import storiesUr from './locales/features/stories.ur.json';
import storiesFr from './locales/features/stories.fr.json';
import storiesEs from './locales/features/stories.es.json';
import storiesTr from './locales/features/stories.tr.json';
import storiesId from './locales/features/stories.id.json';
import hashtagsZh from './locales/features/hashtags.zh.json';
import hashtagsHi from './locales/features/hashtags.hi.json';
import hashtagsUr from './locales/features/hashtags.ur.json';
import hashtagsFr from './locales/features/hashtags.fr.json';
import hashtagsEs from './locales/features/hashtags.es.json';
import hashtagsTr from './locales/features/hashtags.tr.json';
import hashtagsId from './locales/features/hashtags.id.json';
import walkieZh from './locales/features/walkie.zh.json';
import walkieHi from './locales/features/walkie.hi.json';
import walkieUr from './locales/features/walkie.ur.json';
import walkieFr from './locales/features/walkie.fr.json';
import walkieEs from './locales/features/walkie.es.json';
import walkieTr from './locales/features/walkie.tr.json';
import walkieId from './locales/features/walkie.id.json';
import callZh from './locales/features/call.zh.json';
import callHi from './locales/features/call.hi.json';
import callUr from './locales/features/call.ur.json';
import callFr from './locales/features/call.fr.json';
import callEs from './locales/features/call.es.json';
import callTr from './locales/features/call.tr.json';
import callId from './locales/features/call.id.json';
import camera2Zh from './locales/features/camera2.zh.json';
import camera2Hi from './locales/features/camera2.hi.json';
import camera2Ur from './locales/features/camera2.ur.json';
import camera2Fr from './locales/features/camera2.fr.json';
import camera2Es from './locales/features/camera2.es.json';
import camera2Tr from './locales/features/camera2.tr.json';
import camera2Id from './locales/features/camera2.id.json';
import placeAr from './locales/features/place.ar.json';
import placeEn from './locales/features/place.en.json';
import placeZh from './locales/features/place.zh.json';
import placeHi from './locales/features/place.hi.json';
import placeUr from './locales/features/place.ur.json';
import placeFr from './locales/features/place.fr.json';
import placeEs from './locales/features/place.es.json';
import placeTr from './locales/features/place.tr.json';
import placeId from './locales/features/place.id.json';
import draftsAr from './locales/features/drafts.ar.json';
import draftsEn from './locales/features/drafts.en.json';
import draftsZh from './locales/features/drafts.zh.json';
import draftsHi from './locales/features/drafts.hi.json';
import draftsUr from './locales/features/drafts.ur.json';
import draftsFr from './locales/features/drafts.fr.json';
import draftsEs from './locales/features/drafts.es.json';
import draftsTr from './locales/features/drafts.tr.json';
import draftsId from './locales/features/drafts.id.json';

// Each feature keeps its strings in its own namespace file
// (locales/features/<name>.<lang>.json, top-level key = the namespace), so
// features can be worked on without editing one shared file.
const AR = { ...ar, ...chatAr, ...discoverAr, ...liveAr, ...mapAr, ...settings2Ar, ...storiesAr, ...hashtagsAr, ...walkieAr, ...callAr, ...camera2Ar, ...notifyAr, ...draftsAr, ...placeAr, ...ugcAr, ...fix4Ar, ...polishAr, ...gifAr, ...sendToAr, ...groupInfoAr, ...chatThemeAr, ...callLogAr, ...storyReplyAr, ...presenceAr };
const EN = { ...en, ...chatEn, ...discoverEn, ...liveEn, ...mapEn, ...settings2En, ...storiesEn, ...hashtagsEn, ...walkieEn, ...callEn, ...camera2En, ...notifyEn, ...draftsEn, ...placeEn, ...ugcEn, ...fix4En, ...polishEn, ...gifEn, ...sendToEn, ...groupInfoEn, ...chatThemeEn, ...callLogEn, ...storyReplyEn, ...presenceEn };
const ZH = { ...zh, ...chatZh, ...discoverZh, ...liveZh, ...mapZh, ...settings2Zh, ...storiesZh, ...notifyZh, ...hashtagsZh, ...walkieZh, ...callZh, ...camera2Zh, ...draftsZh, ...placeZh, ...ugcZh, ...fix4Zh, ...polishZh, ...gifZh, ...sendToZh, ...groupInfoZh, ...chatThemeZh, ...callLogZh, ...storyReplyZh, ...presenceZh };
const HI = { ...hi, ...chatHi, ...discoverHi, ...liveHi, ...mapHi, ...settings2Hi, ...storiesHi, ...notifyHi, ...hashtagsHi, ...walkieHi, ...callHi, ...camera2Hi, ...draftsHi, ...placeHi, ...ugcHi, ...fix4Hi, ...polishHi, ...gifHi, ...sendToHi, ...groupInfoHi, ...chatThemeHi, ...callLogHi, ...storyReplyHi, ...presenceHi };
const UR = { ...ur, ...chatUr, ...discoverUr, ...liveUr, ...mapUr, ...settings2Ur, ...storiesUr, ...notifyUr, ...hashtagsUr, ...walkieUr, ...callUr, ...camera2Ur, ...draftsUr, ...placeUr, ...ugcUr, ...fix4Ur, ...polishUr, ...gifUr, ...sendToUr, ...groupInfoUr, ...chatThemeUr, ...callLogUr, ...storyReplyUr, ...presenceUr };
const FR = { ...fr, ...chatFr, ...discoverFr, ...liveFr, ...mapFr, ...settings2Fr, ...storiesFr, ...notifyFr, ...hashtagsFr, ...walkieFr, ...callFr, ...camera2Fr, ...draftsFr, ...placeFr, ...ugcFr, ...fix4Fr, ...polishFr, ...gifFr, ...sendToFr, ...groupInfoFr, ...chatThemeFr, ...callLogFr, ...storyReplyFr, ...presenceFr };
const ES = { ...es, ...chatEs, ...discoverEs, ...liveEs, ...mapEs, ...settings2Es, ...storiesEs, ...notifyEs, ...hashtagsEs, ...walkieEs, ...callEs, ...camera2Es, ...draftsEs, ...placeEs, ...ugcEs, ...fix4Es, ...polishEs, ...gifEs, ...sendToEs, ...groupInfoEs, ...chatThemeEs, ...callLogEs, ...storyReplyEs, ...presenceEs };
const TR = { ...tr, ...chatTr, ...discoverTr, ...liveTr, ...mapTr, ...settings2Tr, ...storiesTr, ...notifyTr, ...hashtagsTr, ...walkieTr, ...callTr, ...camera2Tr, ...draftsTr, ...placeTr, ...ugcTr, ...fix4Tr, ...polishTr, ...gifTr, ...sendToTr, ...groupInfoTr, ...chatThemeTr, ...callLogTr, ...storyReplyTr, ...presenceTr };
const ID = { ...id, ...chatId, ...discoverId, ...liveId, ...mapId, ...settings2Id, ...storiesId, ...notifyId, ...hashtagsId, ...walkieId, ...callId, ...camera2Id, ...draftsId, ...placeId, ...ugcId, ...fix4Id, ...polishId, ...gifId, ...sendToId, ...groupInfoId, ...chatThemeId, ...callLogId, ...storyReplyId, ...presenceId };

// Every language the app offers (client note 14). `native` is the name in
// its own script, `english` the name shown beside it for anyone who cannot
// read that script; `rtl` drives the layout direction.
export const LANGUAGES = [
  { code: 'ar', native: 'العربية', english: 'Arabic', rtl: true },
  { code: 'en', native: 'English', english: 'English', rtl: false },
  { code: 'zh', native: '简体中文', english: 'Chinese', rtl: false },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', rtl: false },
  { code: 'ur', native: 'اردو', english: 'Urdu', rtl: true },
  { code: 'fr', native: 'Français', english: 'French', rtl: false },
  { code: 'es', native: 'Español', english: 'Spanish', rtl: false },
  { code: 'tr', native: 'Türkçe', english: 'Turkish', rtl: false },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian', rtl: false },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];

const KEY = 'tt-lang';
// The app is authored in Arabic and, like the web app, starts there.
const DEFAULT_LANG: LangCode = 'ar';

const isRtl = (code: string) => LANGUAGES.find((l) => l.code === code)?.rtl ?? false;

async function storedLanguage(): Promise<LangCode> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (LANGUAGES.some((l) => l.code === v)) return v as LangCode;
  } catch {}
  return DEFAULT_LANG;
}

// React Native only reads the layout direction at startup, so a change of
// direction needs a reload. Returns true when one is under way.
//
// One reload per change, never a loop: on Android forceRTL is stored and
// read when the app process starts, and a development reload (DevSettings)
// keeps the process, so the direction can still be wrong afterwards. The
// attempted direction is remembered; if it did not take, the app carries on
// and the next full start applies it.
const RELOAD_KEY = 'tt-dir-reload';

async function applyDirection(code: string): Promise<boolean> {
  const rtl = isRtl(code);
  const want = rtl ? 'rtl' : 'ltr';
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') document.documentElement.dir = want;
    return false;
  }
  if (I18nManager.isRTL === rtl) {
    AsyncStorage.removeItem(RELOAD_KEY).catch(() => {});
    return false;
  }
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  let tried: string | null = null;
  try {
    tried = await AsyncStorage.getItem(RELOAD_KEY);
  } catch {}
  if (tried === want) return false;
  try {
    await AsyncStorage.setItem(RELOAD_KEY, want);
  } catch {}
  try {
    await Updates.reloadAsync();
  } catch {
    // expo-updates cannot reload a development build served by Metro.
    DevSettings.reload();
  }
  return true;
}

export async function initI18n() {
  const lng = await storedLanguage();
  await i18n.use(initReactI18next).init({
    resources: {
      ar: { translation: AR },
      en: { translation: EN },
      zh: { translation: ZH },
      hi: { translation: HI },
      ur: { translation: UR },
      fr: { translation: FR },
      es: { translation: ES },
      tr: { translation: TR },
      id: { translation: ID },
    },
    lng,
    // A key missing from any language (e.g. a feature added later and not
    // yet translated) shows in English.
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return { lng, reloading: await applyDirection(lng) };
}

export async function setLanguage(code: LangCode) {
  try {
    await AsyncStorage.setItem(KEY, code);
  } catch {}
  await i18n.changeLanguage(code);
  // A deliberate switch always gets its own reload attempt.
  await AsyncStorage.removeItem(RELOAD_KEY).catch(() => {});
  await applyDirection(code);
}

export const languageIsRtl = isRtl;
export default i18n;
