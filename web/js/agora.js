/* === Agora live video helper === */
/* Loads Agora Web SDK on demand and exposes simple host/viewer helpers. */
(function () {
  // ⚠️ Replace this with YOUR Agora App ID from https://console.agora.io
  // For first-time setup, leave as the placeholder — the live screens
  // will then show a clear "configure Agora" message instead of crashing.
  const AGORA_APP_ID = window.AGORA_APP_ID || '';

  // Agora ejects the earlier client when two join one channel with the same
  // uid. The old range was 0-99999, which collides about 5% of the time at a
  // hundred concurrent viewers and 63% at five hundred - and a viewer who
  // happens to draw the HOST's number ends the broadcast for everyone. A uid
  // is a 32-bit unsigned int, so use the range.
  function newUid() { return Math.floor(Math.random() * 2147483646) + 1; }

  // ── Real earpiece / loudspeaker routing ──
  // A WebView cannot do this: routing belongs to the OS. The call screen was
  // faking it by dropping the remote track's volume to 40% while the button
  // said "earpiece", so both settings came out of the loudspeaker - which is
  // exactly what testers reported. AudioRoutePlugin (Android, registered in
  // MainActivity) calls AudioManager.setSpeakerphoneOn, with
  // MODE_IN_COMMUNICATION, which is the part that makes the earpiece reachable
  // at all.
  //
  // Returns whether the OS actually honoured it: a connected headset or
  // Bluetooth device can refuse the switch, and the UI should show the truth
  // rather than what was asked for. Resolves null off-device, where the volume
  // fallback below is all there is.
  // ── Can this WebView put a call on the receiver by itself? ──
  // WebKit can route WebRTC audio to the receiver without native help: it
  // lists the built-in receiver and speaker as audio OUTPUT devices and
  // honours setSinkId() when its "expose speakers" setting is on - and
  // then it rebuilds its own audio unit coherently, which is exactly what
  // the audio-session fight in the plugin cannot do. Whether that is
  // available on a given iPhone is unknowable from here, so it is asked
  // once per call and written down. Never acted on.
  let sinkProbed = false;
  async function probeSinks() {
    if (sinkProbed) return;
    sinkProbed = true;
    try {
      const cap = window.Capacitor;
      const platform = cap && cap.getPlatform ? cap.getPlatform() : 'web';
      if (platform !== 'ios') return;
      const md = navigator.mediaDevices;
      let outs = [];
      try {
        const all = md && md.enumerateDevices ? await md.enumerateDevices() : [];
        outs = all.filter(d => d.kind === 'audiooutput')
          .map(d => ({ label: String(d.label || '').slice(0, 40), id: String(d.deviceId || '').slice(0, 12) }));
      } catch (e) { outs = [{ label: 'enumerate failed: ' + String((e && e.message) || e).slice(0, 60), id: '' }]; }
      if (window.API && window.API.logClient) {
        window.API.logClient('call_sink_probe', {
          setSinkId: typeof (window.HTMLMediaElement && HTMLMediaElement.prototype.setSinkId),
          selectAudioOutput: typeof (md && md.selectAudioOutput),
          ctxSink: typeof (window.AudioContext && AudioContext.prototype.setSinkId),
          outputs: outs.slice(0, 8),
        });
      }
    } catch (e) {}
  }

  async function routeAudio(on) {
    try {
      const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AudioRoute;
      if (!p || !p.setSpeaker) return null;
      const r = await p.setSpeaker({ on: !!on });
      return r && typeof r.speakerOn === 'boolean' ? r.speakerOn : null;
    } catch (e) { return null; }
  }

  // Named routes, for the picker: 'speaker' | 'earpiece' | 'bluetooth'.
  // Resolves to { route, speakerOn, hasBluetooth } or null where there is no
  // plugin (the web), so callers can hide what cannot be offered.
  async function readRoute() {
    try {
      const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AudioRoute;
      if (!p || !p.getRoute) return null;
      const r = await p.getRoute();
      return r && typeof r === 'object' ? r : null;
    } catch (e) { return null; }
  }
  async function applyRoute(route) {
    try {
      const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AudioRoute;
      if (!p || !p.setRoute) return null;
      const r = await p.setRoute({ route: String(route || 'speaker') });
      return r && typeof r === 'object' ? r : null;
    } catch (e) { return null; }
  }
  // ── Voice calls on iPhone, run by Apple's audio ──
  //
  // Six builds tried to move an iPhone call to the earpiece from inside the
  // WebView and lost the outgoing audio every time (sendBitrate 0 while the
  // microphone was plainly capturing). The seventh check closed the last
  // door: call_sink_probe on iOS 18.3 reported no setSinkId, no
  // selectAudioOutput and an EMPTY audiooutput list, so WebKit's own way to
  // choose the receiver is not available either. There is no web-side fix.
  //
  // So a VOICE call on iOS runs on Agora's native SDK instead, which owns
  // AVAudioSession and rebuilds its capture around a route change coherently.
  // Video calls stay on the web SDK - nobody holds a video call to their ear.
  //
  // Everything below is guarded: if the plugin is missing, or the join fails
  // for any reason, the caller falls through to the web path and the call
  // behaves exactly as it shipped in 1.4.20.
  function nativeCallPlugin() {
    try {
      const cap = window.Capacitor;
      if (!cap || !cap.getPlatform || cap.getPlatform() !== 'ios') return null;
      const p = cap.Plugins && cap.Plugins.AgoraCall;
      return (p && typeof p.join === 'function') ? p : null;
    } catch (e) { return null; }
  }

  async function releaseAudioRoute() {
    try {
      const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AudioRoute;
      if (p && p.reset) await p.reset();
    } catch (e) { /* leaving the mode set is not worth failing a hang-up over */ }
  }

  // ── One live call per client ──────────────────────────────────────────
  //
  // The call screen is the real guard; this is the net under it. A call
  // session is the only thing in this app holding an open microphone and a
  // billed channel, and losing one is silent: it goes on publishing with
  // nothing left holding a handle to stop it, and the next call the person
  // places is their second live one. A tester hit exactly that.
  //
  // Claiming a slot EVICTS, it never refuses. A refusal here could only ever
  // strand somebody who is not really in a call, and a stale slot must never
  // be able to block the next real one. The slot is taken before the first
  // await because a join takes seconds - token, channel, microphone prompt -
  // and two can overlap; `cancelled` is how a join that was superseded
  // mid-flight tears itself down on arrival instead of quietly becoming a
  // second publisher.
  let callSlot = null;

  function takeCallSlot() {
    const prev = callSlot;
    const slot = { cancelled: false, stop: null };
    callSlot = slot;
    if (prev) {
      prev.cancelled = true;               // for a join still in flight
      const stop = prev.stop;              // for one that already finished
      prev.stop = null;
      if (stop) Promise.resolve().then(stop).catch(() => {});
    }
    return slot;
  }

  function releaseCallSlot(slot) { if (callSlot === slot) callSlot = null; }

  let sdkPromise = null;
  function loadSdk() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      if (window.AgoraRTC) return resolve(window.AgoraRTC);
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.20.0/AgoraRTC_N-production.min.js';
      s.onload = () => resolve(window.AgoraRTC);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  // Asks the Edge Function to sign a token for this channel and uid. The
  // App Certificate lives only in that function, never here, so nobody can
  // read it out of the browser and use the account's minutes.
  async function fetchToken(channel, uid, role) {
    if (!window.SB) throw new Error('SDK not loaded');
    const c = await window.SB.client();
    const { data, error } = await c.functions.invoke('agora-token', {
      body: { channel: String(channel), uid, role },
    });
    if (error) {
      // The function returns a readable reason in the body; surface it
      // rather than the generic "non-2xx status code".
      let detail = '';
      try { detail = (await error.context.json()).error || ''; } catch (e) {}
      throw new Error(detail || error.message || 'could not get a live token');
    }
    if (!data || !data.token) throw new Error('token service returned nothing');
    return data.token;
  }

  // ── Warming a call up before it is answered ──
  //
  // Joining used to begin only once the row turned 'accepted', and then did
  // everything in series: sign a token (an Edge Function call), join the
  // channel, open the microphone, publish. Measured, the token alone is
  // 150-700 ms and the microphone another 200-500 ms, on top of the round
  // trip that told us the call was answered at all. That is the "3-5 seconds
  // of silence after I pick up".
  //
  // Neither the token nor the microphone depends on the answer, so they are
  // prepared while the phone is ringing and merely awaited when the call
  // connects. `mic` is opt-in and deliberately so: opening the microphone
  // lights the recording indicator, so it is warmed only for someone who has
  // already ACCEPTED - never on a phone that is only ringing.
  let warm = null;
  function prewarm(channel, opts) {
    if (!AGORA_APP_ID || !channel || !window.SB) return;
    const wantMic = !!(opts && opts.mic);
    if (warm && warm.channel === channel) {
      if (wantMic && !warm.micP) warmMic(warm);
      return;
    }
    dropWarm();
    const w = { channel: channel, uid: newUid(), tokenP: null, micP: null };
    warm = w;
    w.tokenP = fetchToken(channel, w.uid, 'host').catch(() => null);
    if (wantMic) warmMic(w);
  }
  function warmMic(w) {
    w.micP = loadSdk()
      .then(AgoraRTC => AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: 'speech_standard' }))
      .catch(() => null);
  }
  // Anything warmed and not used has to be closed, or the microphone stays
  // open on a call that never happened.
  function dropWarm() {
    const w = warm; warm = null;
    if (!w) return;
    if (w.micP) w.micP.then(t => { try { if (t) t.close(); } catch (e) {} }).catch(() => {});
  }
  function takeWarm(channel) {
    if (!warm || warm.channel !== channel) { dropWarm(); return null; }
    const w = warm; warm = null; return w;
  }

  const Agora = {
    isConfigured() { return !!AGORA_APP_ID; },
    appId() { return AGORA_APP_ID; },
    fetchToken,
    prewarm,
    dropWarm,

    // ─── HOST: publish your camera+mic to a channel ───
    async startHost({ channel, uid, videoEl, withVideo = true, onError }) {
      if (!AGORA_APP_ID) throw new Error('AGORA_APP_ID not configured');
      const AgoraRTC = await loadSdk();
      AgoraRTC.setLogLevel(2);
      const client = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
      await client.setClientRole('host');
      // The uid is decided before the token is signed, because a token is
      // bound to one uid and Agora rejects any mismatch.
      const userId = uid || newUid();
      const token = await fetchToken(channel, userId, 'host');
      await client.join(AGORA_APP_ID, channel, token, userId);

      // Registered BEFORE the devices are opened. Opening them shows a
      // permission prompt that can sit there as long as the person takes to
      // answer, and anything published inside that window fires at no listener
      // and is gone - the SDK does not replay it.
      client.on('user-published', async (user, mediaType) => {
        try { await client.subscribe(user, mediaType); } catch (e) { onError && onError(e); }
      });

      // We are already in the channel by this point, so a refused device has to
      // leave it again. The caller only ever receives the session object this
      // function returns, and on a throw it is not returning one - the client
      // would stay joined and billing with nothing to stop it with. This is the
      // failure startCall was fixed for; startHost still had it.
      let mic = null, cam = null;
      try {
        mic = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: 'music_standard' });
        // A background-only broadcast is audio over a still image, so it wants
        // the microphone and no camera at all. And when a camera IS wanted, a
        // refused one should still leave an audio broadcast rather than none:
        // createMicrophoneAndCameraTracks was all-or-nothing, so one covered
        // lens killed the entire stream.
        if (withVideo) {
          try {
            cam = await AgoraRTC.createCameraVideoTrack({ encoderConfig: '480p_1', facingMode: 'user' });
            if (videoEl) cam.play(videoEl);
          } catch (e) { onError && onError(e); cam = null; }
        }
        await client.publish(cam ? [mic, cam] : [mic]);
      } catch (e) {
        if (cam) { try { cam.close(); } catch (e2) {} }
        if (mic) { try { mic.close(); } catch (e2) {} }
        await client.leave().catch(() => {});
        throw e;
      }

      return {
        client, mic, cam, userId,
        hasCamera: () => !!cam,
        switchCamera: async () => {
          // setDevice takes a deviceId, not a constraints object - the old call
          // passed { facingMode } and failed into an empty .catch(), so the
          // button reported success and did nothing.
          if (!cam) return false;
          const want = cam._mediaStreamTrack.getSettings().facingMode === 'user' ? 'environment' : 'user';
          try {
            const cams = await AgoraRTC.getCameras();
            const next = cams.find(d => (d.label || '').toLowerCase().includes(want === 'user' ? 'front' : 'back'));
            if (!next) return false;
            await cam.setDevice(next.deviceId);
            return true;
          } catch (e) { onError && onError(e); return false; }
        },
        stop: async () => {
          try { await client.unpublish(cam ? [mic, cam] : [mic]); } catch (e) {}
          if (mic) { try { mic.close(); } catch (e) {} }
          if (cam) { try { cam.close(); } catch (e) {} }
          await client.leave().catch(() => {});
        },
      };
    },

    // ─── VIEWER: subscribe to a host's channel ───
    async startViewer({ channel, uid, videoEl, onPlayers }) {
      if (!AGORA_APP_ID) throw new Error('AGORA_APP_ID not configured');
      const AgoraRTC = await loadSdk();
      AgoraRTC.setLogLevel(2);
      const client = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
      await client.setClientRole('audience', { level: 1 });
      const userId = uid || newUid();
      const token = await fetchToken(channel, userId, 'audience');

      // Registered BEFORE join, not after. Agora emits 'user-published' for a
      // host who is ALREADY broadcasting as part of joining the channel - so
      // with the handler attached afterwards that event fired at nobody, and it
      // is never replayed. The sweep below was meant to cover exactly this, but
      // it ran the instant join() resolved, when client.remoteUsers is still
      // empty, so it swept nothing.
      //
      // Measured before this change: the viewer reached CONNECTED and could see
      // the host in remoteUsers with hasAudio true and hasVideo true, while
      // audioTrack and videoTrack were both undefined - subscribed to neither.
      // Every viewer got a black, silent screen for the whole broadcast.
      const subscribeTo = async (user, mediaType) => {
        try {
          await client.subscribe(user, mediaType);
          if (mediaType === 'video' && user.videoTrack && videoEl) user.videoTrack.play(videoEl);
          if (mediaType === 'audio' && user.audioTrack) user.audioTrack.play();
          onPlayers && onPlayers(client.remoteUsers);
        } catch (e) { /* the other stream type may still arrive */ }
      };

      client.on('user-published', (user, mediaType) => { subscribeTo(user, mediaType); });
      client.on('user-unpublished', () => { onPlayers && onPlayers(client.remoteUsers); });

      await client.join(AGORA_APP_ID, channel, token, userId);

      // Belt and braces for anything that still landed inside the join. Retried
      // rather than run once, because remoteUsers populates slightly after the
      // join resolves - a single pass is a race with the SDK's own bookkeeping.
      const sweep = async () => {
        for (const user of client.remoteUsers) {
          if (user.hasVideo && !user.videoTrack) await subscribeTo(user, 'video');
          if (user.hasAudio && !user.audioTrack) await subscribeTo(user, 'audio');
        }
      };
      await sweep();
      setTimeout(sweep, 600);
      setTimeout(sweep, 2000);

      return {
        client, userId,
        viewerCount: () => client.remoteUsers.length,
        stop: async () => { await client.leave().catch(() => {}); },
      };
    },

    // ─── 1:1 CALL: both sides publish and both sides subscribe ───
    //
    // Live streaming above is mode 'live', which splits everyone into hosts
    // and audience. A call is symmetric — nobody is the audience — so it
    // uses 'rtc', where every participant may publish. The signalling
    // (ringing, accept, decline, hang up) is ours and lives in the calls
    // table; this only carries the media once both sides have agreed.
    //
    // Every control it returns performs the change on the real track and
    // then reports what the track says AFTERWARDS. Nothing here returns the
    // value it was asked for. That is the whole point: the call screen used
    // to flip a CSS class and call it muted, so "muted" was a claim the UI
    // made rather than a fact about the microphone, and the two could
    // disagree with nothing to catch it.
    // ── The native voice session ──
    // Exposes exactly the shape V.call already reads from a web session, so
    // one call screen drives both. After a handover to video (enableVideo
    // below) every method forwards to the web session that replaced it, and
    // the screen never learns that the thing under it changed.
    async _startNativeCall({ channel, uid, token, onRemote, onError, onRouteChange }) {
      const p = nativeCallPlugin();
      if (!p) throw new Error('no native call plugin');
      let web = null;                       // set once video takes over
      let remotes = 0;
      let muted = false;
      let speakerOn = true;
      let stopped = false;
      let localEls = { local: null, remote: null };
      const subs = [];

      try {
        const r = await p.join({ appId: AGORA_APP_ID, channel: String(channel), token: token, uid: uid, speaker: true });
        if (!r || !r.joined) throw new Error('native join refused');
      } catch (e) {
        try { await p.leave(); } catch (x) {}
        throw e;
      }

      try {
        subs.push(await p.addListener('remoteChanged', (ev) => {
          if (web) return;
          remotes = (ev && ev.remotes) || 0;
          // The SAME shape the web session's state() reports - the call screen
          // reads these names off it, and a native session inventing its own
          // would leave the screen reading undefined and drawing nothing.
          onRemote && onRemote({ hasRemoteAudio: remotes > 0, hasRemoteVideo: false, remoteCount: remotes });
        }));
        subs.push(await p.addListener('callError', (ev) => {
          if (web) return;
          try { if (window.API && window.API.logClient) window.API.logClient('call_native_error', { code: (ev && ev.code) }); } catch (x) {}
        }));
      } catch (e) { /* events are a nicety; the call works without them */ }

      const dropSubs = () => {
        subs.forEach(h => { try { if (h && h.remove) h.remove(); } catch (e) {} });
        subs.length = 0;
      };

      const session = {
        native: true,
        isMuted: () => web ? web.isMuted() : muted,
        setMuted: async (on) => {
          if (web) return web.setMuted(on);
          try { const r = await p.setMuted({ muted: !!on }); muted = !!(r && r.muted); }
          catch (e) { onError && onError(e); }
          return muted;
        },

        // No camera on this path by definition - the screen reads these to
        // decide what the camera button offers, and enableVideo is what it
        // calls when somebody asks for video.
        hasCamera: () => web ? web.hasCamera() : false,
        isCameraOn: () => web ? web.isCameraOn() : false,
        setCameraOn: async (on) => web ? web.setCameraOn(on) : false,
        switchCamera: async () => { if (web) return web.switchCamera(); },
        hasRemoteVideo: () => web ? web.hasRemoteVideo() : false,
        canRouteAudio: () => web ? web.canRouteAudio() : remotes > 0,
        remoteCount: () => web ? web.remoteCount() : remotes,

        attachVideo: (localEl, remoteEl) => {
          localEls = { local: localEl, remote: remoteEl };
          if (web) web.attachVideo(localEl, remoteEl);
        },

        // ── A voice call becoming a video call ──
        // Video needs the WebView (the camera and the video elements live
        // there), so this hands the call over: a full web session is started
        // on the same channel, and only once it is up does the native one go.
        // Costs a few seconds of reconnect, which is the honest price and is
        // why it is not done for voice.
        enableVideo: async () => {
          if (web) return web.enableVideo();
          const ws = await Agora.startCall({
            channel: channel, withVideo: true,
            localVideoEl: localEls.local, remoteVideoEl: localEls.remote,
            onRemote: onRemote, onError: onError, onRouteChange: onRouteChange,
          });
          // startCall took the call slot, which already stopped the native
          // half through slot.stop; this is belt and braces and is safe twice.
          dropSubs();
          try { await p.leave(); } catch (e) {}
          web = ws;
          try { if (window.API && window.API.logClient) window.API.logClient('call_native_handover', { to: 'web' }); } catch (e) {}
          return true;
        },

        // Reading the route is safe while the SDK owns the session -
        // currentRoute is a read - so the picker still shows the truth,
        // including a Bluetooth device the SDK moved to by itself.
        getRoute: () => web ? web.getRoute() : readRoute(),
        setRoute: async (route) => {
          if (web) return web.setRoute(route);
          // The whole reason this path exists. The SDK moves the route AND
          // rebuilds its own capture around the move, which is exactly what
          // the WebView could not do. 'bluetooth' and 'auto' are "not the
          // loudspeaker" - iOS picks a connected device over the receiver on
          // its own, and refuses to leave one for the loudspeaker.
          try {
            const r = await p.setSpeaker({ on: String(route) === 'speaker' });
            speakerOn = !!(r && r.speakerOn);
          } catch (e) { onError && onError(e); }
          onRouteChange && onRouteChange(speakerOn);
          const now = await readRoute();
          return now || { route: speakerOn ? 'speaker' : 'earpiece', speakerOn: speakerOn };
        },
        isSpeakerOn: () => web ? web.isSpeakerOn() : speakerOn,
        setSpeakerOn: (on) => {
          if (web) return web.setSpeakerOn(on);
          speakerOn = !!on;
          p.setSpeaker({ on: speakerOn }).then(r => {
            const actual = !!(r && r.speakerOn);
            if (actual !== speakerOn) { speakerOn = actual; onRouteChange && onRouteChange(actual); }
          }).catch(() => {});
          return speakerOn;
        },

        audioStats: async () => {
          if (web) return web.audioStats();
          try { return await p.stats(); } catch (e) { return null; }
        },

        stop: async () => {
          if (stopped) return;
          stopped = true;
          dropSubs();
          if (web) { try { await web.stop(); } catch (e) {} return; }
          try { await p.leave(); } catch (e) {}
        },
      };
      return session;
    },

    async startCall({ channel, uid, withVideo, localVideoEl, remoteVideoEl, onRemote, onError, onRouteChange }) {
      if (!AGORA_APP_ID) throw new Error('AGORA_APP_ID not configured');
      // Before the first await, so two overlapping joins cannot each believe
      // they are the only one.
      const slot = takeCallSlot();
      // ── Where do the seconds go? ──
      // "Still 3-5 seconds before I hear anything after answering", reported
      // after a round of work that was supposed to fix exactly that. Nobody
      // has ever measured which step is slow - the SDK download, the token
      // (an Edge Function, so a cold start is possible), the channel join,
      // the audio route, opening the microphone, publishing, or simply
      // waiting for the other phone to publish. Each is timed now and the
      // whole breakdown goes into one line.
      const T0 = Date.now();
      const mark = {};
      const at = (k) => { mark[k] = Date.now() - T0; };

      // ── iPhone voice call: Apple's audio, not the WebView's ──
      // Tried FIRST, because everything below opens a microphone the native
      // SDK would then have to fight for. Anything at all going wrong falls
      // through to the web path underneath, which is what 1.4.20 shipped -
      // so the worst case here is today's behaviour, never worse.
      if (!withVideo && nativeCallPlugin()) {
        const wn = takeWarm(channel);
        // A prewarmed microphone is a WebView capture and must not be left
        // open: two owners of one microphone is the fault this replaces.
        if (wn && wn.micP) { wn.micP.then(t => { try { if (t) t.close(); } catch (e) {} }).catch(() => {}); }
        const nUid = uid || (wn && wn.uid) || newUid();
        let nToken = null;
        try {
          nToken = (wn && wn.uid === nUid && wn.tokenP) ? await wn.tokenP : null;
          if (!nToken) nToken = await fetchToken(channel, nUid, 'host');
          at('token');
          const ns = await Agora._startNativeCall({
            channel: channel, uid: nUid, token: nToken,
            onRemote: onRemote, onError: onError, onRouteChange: onRouteChange,
          });
          at('join');
          slot.stop = ns.stop;
          if (slot.cancelled) { try { await ns.stop(); } catch (e) {} throw new Error('call superseded'); }
          try {
            if (window.API && window.API.logClient) {
              window.API.logClient('call_native_join', { ok: true, token: mark.token, join: mark.join, warmToken: !!(wn && wn.tokenP) });
            }
          } catch (e) {}
          return ns;
        } catch (e) {
          if (String((e && e.message) || e) === 'call superseded') throw e;
          // Down to the web path. Recorded either way: this line is the only
          // way to learn from a Windows machine whether the native half ever
          // ran on the phone, and why it did not.
          try {
            if (window.API && window.API.logClient) {
              window.API.logClient('call_native_join', { ok: false, why: String((e && e.message) || e).slice(0, 120) });
            }
          } catch (x) {}
        }
      }

      const AgoraRTC = await loadSdk();
      at('sdk');
      AgoraRTC.setLogLevel(2);
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      // Whatever prewarm() got ready for THIS channel. The uid has to come
      // with the token: a token is signed for one uid and Agora rejects any
      // mismatch.
      const w = takeWarm(channel);
      const userId = uid || (w && w.uid) || newUid();
      // 'host' is the publishing role in both modes, and a call needs it on
      // BOTH sides — an 'audience' token cannot publish, so whoever got one
      // would join the channel able to hear and unable to be heard.
      let token = (w && w.uid === userId && w.tokenP) ? await w.tokenP : null;
      mark.warmToken = !!token;              // did the prewarm actually help?
      if (!token) token = await fetchToken(channel, userId, 'host');
      at('token');
      await client.join(AGORA_APP_ID, channel, token, userId);
      at('join');

      let mic = null, cam = null;
      // Put the phone in call mode BEFORE the microphone opens, and wait for
      // it. Doing it afterwards made the OS switch audio mode underneath a
      // running capture - a couple of silent seconds at the start of every
      // call while it recovered. No-op on the web.
      try { await routeAudio(true); } catch (e) {}
      at('route');
      try {
        if (w && w.micP) mic = await w.micP;      // opened while it rang
        mark.warmMic = !!mic;
        if (!mic) mic = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: 'speech_standard' });
        at('mic');
        if (withVideo) {
          // A refused camera should still leave you an audio call rather than
          // no call at all, so this one failure is reported and swallowed.
          try {
            cam = await AgoraRTC.createCameraVideoTrack({ encoderConfig: '480p_1', facingMode: 'user' });
            if (localVideoEl) cam.play(localVideoEl);
          } catch (e) { onError && onError(e); cam = null; }
        }
        await client.publish(cam ? [mic, cam] : [mic]);
        at('publish');
        // Reported NOW, not when the other side turns up. The first version
        // waited for their audio before writing anything, so a call where the
        // far end never published produced no measurement at all - which is
        // exactly when you most want to know how long our own half took.
        try {
          if (window.API && window.API.logClient) window.API.logClient('call_join_timing', mark);
        } catch (e) {}
        probeSinks();
        // Their audio arriving is a separate question, and it is the one a
        // person experiences as "when can I hear them". Timed from the same
        // zero, on its own line, once.
        (function timeFirstAudio() {
          let done = false;
          const finish = (ms) => {
            if (done) return;
            done = true;
            try {
              if (window.API && window.API.logClient) {
                window.API.logClient('call_first_audio', { ms, sdk: mark.sdk, join: mark.join, publish: mark.publish });
              }
            } catch (e) {}
          };
          const iv = setInterval(() => {
            // remoteAudio is declared below this block; everything between is
            // synchronous, but a reorder would make this a dead-zone throw
            // inside a timer - the kind of error that vanishes without trace.
            let n = 0;
            try { n = remoteAudio ? remoteAudio.size : 0; } catch (e) { return; }
            if (n === 0) return;
            clearInterval(iv);
            finish(Date.now() - T0);
          }, 250);
          setTimeout(() => { clearInterval(iv); finish(null); }, 20000);
        })();
      } catch (e) {
        // We are already in the channel by this point. A denied microphone
        // would otherwise leave us joined, silent and billing, with no handle
        // for the caller to leave with — the caller only ever receives the
        // session object this function returns, and it is not returning one.
        if (cam) { try { cam.close(); } catch (e2) {} }
        if (mic) { try { mic.close(); } catch (e2) {} }
        await client.leave().catch(() => {});
        releaseCallSlot(slot);
        throw e;
      }

      // Remote audio tracks are held so the speaker setting can be applied to
      // them as they arrive — the other side usually publishes after we have
      // already joined, and a setting applied only at join time would be lost.
      const remoteAudio = new Map();     // uid -> audio track
      // Tracked separately from audio so the caller can tell "they joined" from
      // "they are sending pictures". Unhiding the video surface on the strength
      // of an audio publish alone would black out the avatar screen for a video
      // call in which the other side has their camera off.
      // Keyed by uid rather than by track: when someone LEAVES, the SDK has
      // already dropped the track objects from their user record, so a set of
      // tracks could never be cleaned up - their picture stayed "on".
      const remoteVideo = new Map();     // uid -> video track
      // Starts on the LOUDSPEAKER deliberately: this is a social app opened in
      // the hand, not a phone raised to the ear, and a call that starts silent-
      // seeming because it is on the earpiece reads as broken.
      let speakerOn = true;
      // routeAudio(true) used to be called HERE - after the microphone was
      // already open. On a phone that means the OS switches audio mode
      // underneath a running capture, which is a couple of seconds of
      // silence at the start of every call. It now runs before the
      // microphone is created (see above), so the mode is settled first.

      // ── Remote pictures, one tile per person ──
      // A group call has several; each remote user's video plays into its
      // own tile inside the container the screen attaches (a 1:1 call is one
      // tile filling it). Keyed by Agora uid.
      function tileFor(uid) {
        if (!remoteVideoEl) return null;
        let t = remoteVideoEl.querySelector('[data-uid="' + uid + '"]');
        if (!t) {
          t = document.createElement('div');
          t.className = 'call-tile'; t.dataset.uid = String(uid);
          remoteVideoEl.appendChild(t);
        }
        remoteVideoEl.dataset.tiles = String(remoteVideoEl.querySelectorAll('.call-tile').length);
        return t;
      }
      function dropTile(uid) {
        if (!remoteVideoEl) return;
        const t = remoteVideoEl.querySelector('[data-uid="' + uid + '"]');
        if (t) t.remove();
        remoteVideoEl.dataset.tiles = String(remoteVideoEl.querySelectorAll('.call-tile').length);
      }
      function playRemoteVideo(user) {
        const t = tileFor(user.uid);
        if (t && user.videoTrack) { try { user.videoTrack.play(t); } catch (e) { onError && onError(e); } }
      }
      function forgetUser(user) {
        remoteAudio.delete(user.uid); remoteVideo.delete(user.uid); dropTile(user.uid);
      }

      function applySpeakerTo(track) {
        // Volume is the FALLBACK now, not the mechanism. On a device
        // routeAudio() moves the audio to the earpiece properly; in a browser
        // there is no routing to be had, so a level difference is still better
        // than a button that does nothing at all.
        try { track.setVolume(speakerOn ? 100 : 55); return true; }
        catch (e) { onError && onError(e); return false; }
      }

      client.on('user-published', async (user, mediaType) => {
        try {
          await client.subscribe(user, mediaType);
          if (mediaType === 'audio' && user.audioTrack) {
            remoteAudio.set(user.uid, user.audioTrack);
            applySpeakerTo(user.audioTrack);
            user.audioTrack.play();
          }
          if (mediaType === 'video' && user.videoTrack) {
            remoteVideo.set(user.uid, user.videoTrack);
            playRemoteVideo(user);
          }
          onRemote && onRemote(state());
        } catch (e) { onError && onError(e); }
      });
      client.on('user-unpublished', (user, mediaType) => {
        if (mediaType === 'audio') remoteAudio.delete(user.uid);
        if (mediaType === 'video') { remoteVideo.delete(user.uid); dropTile(user.uid); }
        onRemote && onRemote(state());
      });
      // Leaving the channel does not always come with an unpublish first;
      // without this a person who hung up kept their picture on the screen.
      client.on('user-left', (user) => {
        forgetUser(user);
        onRemote && onRemote(state());
      });

      // Catch-up sweep. 'user-published' could only be registered just now,
      // because its handler needs remoteAudio/remoteVideo declared above - but
      // we joined several hundred milliseconds ago, and opening the microphone
      // and camera took most of that. Anything the other side published inside
      // that window fired at no listener and is gone; the SDK does not replay
      // it. startViewer already does this sweep, and a call needs it MORE,
      // because here both sides publish: whoever answered first would be the
      // one nobody could hear.
      for (const user of client.remoteUsers) {
        try {
          if (user.hasAudio && !user.audioTrack) {
            await client.subscribe(user, 'audio');
            if (user.audioTrack) {
              remoteAudio.set(user.uid, user.audioTrack);
              applySpeakerTo(user.audioTrack);
              user.audioTrack.play();
            }
          }
          if (user.hasVideo && !user.videoTrack) {
            await client.subscribe(user, 'video');
            if (user.videoTrack) {
              remoteVideo.set(user.uid, user.videoTrack);
              playRemoteVideo(user);
            }
          }
        } catch (e) { onError && onError(e); }
      }
      if (client.remoteUsers.length) onRemote && onRemote(state());

      function state() {
        return { hasRemoteAudio: remoteAudio.size > 0, hasRemoteVideo: remoteVideo.size > 0, remoteCount: client.remoteUsers.length };
      }

      // Did the last route change cost us the outgoing audio?
      //
      // This gave up too early and never repaired anything. It read the stats
      // 1.6 s after the switch and returned the moment ONE reading looked
      // healthy - but Agora refreshes getLocalAudioStats about every two
      // seconds, so that first read is the PREVIOUS interval, from before the
      // switch, when audio was still flowing. The iPhone's log says exactly
      // that: call_route_after recorded sendBitrate 0 at 2.5 s and no
      // call_send_repair line was ever written.
      //
      // So: sample several times, and judge on the LAST readings rather than
      // the first. And record what was seen either way - a repair that
      // decides NOT to act was previously silent, which is how this hid.
      let repairing = false;
      // Observe only. Every repair attempted from here has hung the
      // WebView - 1.4.16 asked for a new getUserMedia, 1.4.19 called
      // setEnabled on the dead track - a synchronous wait inside WebKit
      // that no JavaScript timeout can interrupt. The readings stay, as
      // the record that finally made the failure legible; nothing acts.
      const REPAIR_SEND = false;
      async function recheckSend() {
        if (repairing || !mic) return;
        const sent = () => { try { return (client.getLocalAudioStats() || {}).sendBitrate || 0; } catch (e) { return -1; } };
        const reads = [];
        for (let i = 0; i < 3; i++) {
          await new Promise(res => setTimeout(res, 1200));
          if (!mic || repairing) return;
          reads.push(sent());
        }
        const muted = !!(mic && mic.muted);
        // Alive if EITHER of the last two readings carries traffic. A muted
        // microphone sends nothing by design and must never be "repaired".
        const alive = reads.slice(-2).some(v => v > 0);
        try {
          if (window.API && window.API.logClient) {
            window.API.logClient('call_send_check', { reads, muted, alive, acting: !alive && !muted && REPAIR_SEND, repair: REPAIR_SEND });
          }
        } catch (e) {}
        if (alive || muted || !REPAIR_SEND) return;
        repairing = true;
        const note = (ok, why) => {
          try {
            if (window.API && window.API.logClient) window.API.logClient('call_send_repair', { ok: !!ok, why: why || '' });
          } catch (e) {}
        };
        // NOTHING here may hang. The first version asked for a brand new
        // microphone (createMicrophoneAudioTrack -> getUserMedia) and the
        // phone's log shows what that costs: the repair ran once and worked
        // (22:24), and on the next route change it started and never finished -
        // no completion line, and the whole app stopped responding. Acquiring a
        // capture device while the audio unit is exactly the thing that just
        // broke is asking WebKit to answer from inside the fault. So:
        //   1. republish the track we ALREADY hold - no device acquisition;
        //   2. only if that does not restore the send, try a fresh one;
        //   3. every step on a timeout, so a wedged WebKit cannot take the
        //      interface down with it.
        const limit = (promise, ms, label) => Promise.race([
          Promise.resolve(promise),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms)),
        ]);
        // Budgeted, because the previous version could run for half a minute:
        // 9 s on the first attempt and 20 more on the second, while the person
        // sat in silence wondering whether to hang up. The log shows exactly
        // that - it decided to act and never reported back. A repair nobody
        // waits for is not a repair.
        const dead = mic;
        try {
          // (1) Cycle the track. Agora's own way to restart a capture, no
          // renegotiation and no getUserMedia - typically a few hundred ms.
          if (dead && dead.setEnabled) {
            try {
              await limit(dead.setEnabled(false), 1200, 'disable');
              await limit(dead.setEnabled(true), 1200, 'enable');
              await new Promise(res => setTimeout(res, 900));
              if (sent() > 0) { note(true, 'cycled the track'); return; }
            } catch (e) { /* fall through */ }
          }
          // (2) Republish it. Renegotiates, still no device request.
          try {
            await limit(client.unpublish([dead]), 1500, 'unpublish');
            await limit(client.publish([dead]), 1500, 'republish');
            await new Promise(res => setTimeout(res, 900));
            if (sent() > 0) { note(true, 'republished same track'); return; }
          } catch (e) { /* fall through */ }
          // (3) A new microphone, last and briefest. Asking WebKit for a
          // capture device while its audio unit is the broken thing is how
          // 1.4.16 froze the app, so this gets the shortest leash of all.
          const AgoraRTC = await limit(loadSdk(), 2000, 'sdk');
          const fresh = await limit(
            AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: 'speech_standard' }), 3000, 'getusermedia');
          if (dead && dead.muted && fresh.setMuted) { try { await fresh.setMuted(true); } catch (e) {} }
          try { await limit(client.unpublish([dead]), 1500, 'unpublish2'); } catch (e) {}
          mic = fresh;
          await limit(client.publish([fresh]), 2000, 'publish2');
          try { dead.close(); } catch (e) {}
          note(sent() > 0, 'new track');
        } catch (e) {
          note(false, String((e && e.message) || e).slice(0, 120));
        } finally {
          repairing = false;      // ALWAYS, so a failure never blocks the next try
        }
      }

      const session = {
        client, mic, userId,

        // setMuted keeps the track published and sends silence, rather than
        // unpublishing it. Unpublishing renegotiates the session, which takes
        // long enough to see and can fail; mute has to be instant.
        isMuted: () => !!(mic && mic.muted),
        setMuted: async (on) => {
          if (mic) await mic.setMuted(!!on);
          return !!(mic && mic.muted);
        },

        hasCamera: () => !!cam,
        isCameraOn: () => !!(cam && cam.enabled),
        setCameraOn: async (on) => {
          if (cam) await cam.setEnabled(!!on);
          return !!(cam && cam.enabled);
        },
        // Front/back. The live session had this; a video call did not.
        // setDevice takes a deviceId, not a constraints object.
        switchCamera: async () => {
          if (!cam) return false;
          const want = cam._mediaStreamTrack.getSettings().facingMode === 'user' ? 'environment' : 'user';
          const cams = await AgoraRTC.getCameras();
          const next = cams.find(d => (d.label || '').toLowerCase().includes(want === 'user' ? 'front' : 'back'));
          if (!next) return false;
          await cam.setDevice(next.deviceId);
          return true;
        },
        // A voice call turning into a video call: open the camera now and
        // publish it. On the far side this is an ordinary 'user-published'.
        enableVideo: async () => {
          if (cam) { if (!cam.enabled) await cam.setEnabled(true); return true; }
          const track = await AgoraRTC.createCameraVideoTrack({ encoderConfig: '480p_1', facingMode: 'user' });
          try { if (localVideoEl) track.play(localVideoEl); } catch (e) {}
          await client.publish(track);
          cam = track;
          return true;
        },

        // Nothing to route until the other side is actually sending audio.
        canRouteAudio: () => remoteAudio.size > 0,
        hasRemoteVideo: () => remoteVideo.size > 0,
        // Named routes for the picker (speaker / earpiece / bluetooth). null
        // where there is no plugin, so the UI falls back to the on/off toggle.
        getRoute: () => readRoute(),
        setRoute: async (route) => {
          // ── Nothing but the route ──
          // Six builds tried to save the outgoing audio across an iOS route
          // change from here: detect-and-repair (1.4.14-1.4.18), then a
          // deliberate unpublish/republish around the switch (1.4.19). The
          // phone's own numbers, one per build, are the verdict:
          //   1.4.17  sendLevel 142    sendBitrate 0   capture alive, encoder dead
          //   1.4.18  sendLevel 15480  sendBitrate 0   capture alive, encoder dead
          //   1.4.19  sendLevel 0      sendBitrate 0   capture dead as well - and
          //           the repair that followed never wrote its completion line,
          //           which is the "no button works" freeze.
          // Touching the microphone track after the switch made it worse;
          // touching it during the switch killed the capture too. So this
          // moves the route and does nothing else. On iOS the receiver is
          // not offered at all (the call screen hides it) until the WebView
          // can survive the move - see probeSinks() for the way back - and
          // the check below only records what it sees.
          const r = await applyRoute(route);
          if (r && typeof r.speakerOn === 'boolean') {
            speakerOn = r.speakerOn;
            remoteAudio.forEach(t => applySpeakerTo(t));
            onRouteChange && onRouteChange(speakerOn);
          }
          recheckSend();
          return r;
        },
        // A call that survives leaving its screen comes back to NEW video
        // elements; the tracks are still playing, they just need somewhere
        // to draw again.
        attachVideo: (localEl, remoteEl) => {
          localVideoEl = localEl || null; remoteVideoEl = remoteEl || null;
          try { if (cam && localVideoEl) cam.play(localVideoEl); } catch (e) {}
          if (remoteVideoEl) {
            remoteVideoEl.querySelectorAll('.call-tile').forEach(t => t.remove());
            client.remoteUsers.forEach(u => { if (u.videoTrack) playRemoteVideo(u); });
            remoteVideoEl.dataset.tiles = String(remoteVideoEl.querySelectorAll('.call-tile').length);
          }
        },
        remoteCount: () => client.remoteUsers.length,
        // Is audio actually moving, right now? Not "did the plugin say yes" -
        // the iPhone has twice reported success on a route change that killed
        // the call, and nothing recorded whether the media survived it. Read
        // straight off the SDK so a route change can be judged two seconds
        // later by what is still flowing.
        audioStats: () => {
          try {
            const l = client.getLocalAudioStats() || {};
            const r = client.getRemoteAudioStats() || {};
            const ids = Object.keys(r);
            const first = ids.length ? (r[ids[0]] || {}) : {};
            return {
              sendBitrate: Math.round(l.sendBitrate || 0),
              sendLevel: Math.round(((l.sendVolumeLevel || 0) * 100)) / 100,
              remotes: ids.length,
              recvBitrate: Math.round(first.receiveBitrate || 0),
              recvLevel: Math.round(((first.receiveLevel || 0) * 100)) / 100,
              micMuted: !!(mic && mic.muted),
            };
          } catch (e) { return null; }
        },
        isSpeakerOn: () => speakerOn,
        setSpeakerOn: (on) => {
          const wanted = !!on;
          const before = speakerOn;
          speakerOn = wanted;
          let applied = 0;
          remoteAudio.forEach(t => { if (applySpeakerTo(t)) applied++; });
          // Report the truth: if every track refused, the setting did not
          // take and the caller must not draw it as though it had.
          if (remoteAudio.size && !applied) speakerOn = before;
          // The real routing. Async, so the caller gets the volume answer
          // immediately and the OS answer corrects it a moment later - the
          // device is the authority, not us, because a headset or Bluetooth
          // connection can refuse the switch.
          routeAudio(speakerOn).then(actual => {
            if (typeof actual === 'boolean' && actual !== speakerOn) {
              speakerOn = actual;
              remoteAudio.forEach(t => applySpeakerTo(t));
              onRouteChange && onRouteChange(actual);
            }
          });
          return speakerOn;
        },

        stop: async () => {
          // Freed first, so a stop that stalls on any step below still leaves
          // the next call able to start.
          releaseCallSlot(slot);
          try { await client.unpublish(cam ? [mic, cam] : [mic]); } catch (e) {}
          if (mic) { try { mic.close(); } catch (e) {} }
          if (cam) { try { cam.close(); } catch (e) {} }
          remoteAudio.clear();
          remoteVideo.clear();
          // Put the device's audio mode back. Leaving it in
          // MODE_IN_COMMUNICATION makes every later sound on the phone behave
          // as though a call were still running.
          await releaseAudioRoute();
          await client.leave().catch(() => {});
        },
      };

      // Only now is there something that can be stopped from outside.
      slot.stop = session.stop;

      // Superseded while we were joining: the screen that asked for this call
      // is already gone, or another call has begun. Hand nothing back - and
      // above all leave nothing running.
      if (slot.cancelled) {
        try { await session.stop(); } catch (e) {}
        throw new Error('call superseded');
      }
      return session;
    },
  };

  window.Agora = Agora;
})();
