/* === Agora live video helper === */
/* Loads Agora Web SDK on demand and exposes simple host/viewer helpers. */
(function () {
  // ⚠️ Replace this with YOUR Agora App ID from https://console.agora.io
  // For first-time setup, leave as the placeholder — the live screens
  // will then show a clear "configure Agora" message instead of crashing.
  const AGORA_APP_ID = window.AGORA_APP_ID || '';

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

  const Agora = {
    isConfigured() { return !!AGORA_APP_ID; },
    appId() { return AGORA_APP_ID; },
    fetchToken,

    // ─── HOST: publish your camera+mic to a channel ───
    async startHost({ channel, uid, videoEl, onError }) {
      if (!AGORA_APP_ID) throw new Error('AGORA_APP_ID not configured');
      const AgoraRTC = await loadSdk();
      AgoraRTC.setLogLevel(2);
      const client = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
      await client.setClientRole('host');
      // The uid is decided before the token is signed, because a token is
      // bound to one uid and Agora rejects any mismatch.
      const userId = uid || Math.floor(Math.random() * 100000);
      const token = await fetchToken(channel, userId, 'host');
      await client.join(AGORA_APP_ID, channel, token, userId);

      // Create + publish local tracks
      const [mic, cam] = await AgoraRTC.createMicrophoneAndCameraTracks(
        { encoderConfig: 'music_standard' },
        { encoderConfig: '480p_1', facingMode: 'user' }
      );
      cam.play(videoEl);
      await client.publish([mic, cam]);

      // Subscribe to remote users (viewers won't normally publish, but if a co-host joins)
      client.on('user-published', async (user, mediaType) => {
        try { await client.subscribe(user, mediaType); } catch (e) { onError && onError(e); }
      });

      return {
        client, mic, cam, userId,
        switchCamera: async () => {
          const facing = cam._mediaStreamTrack.getSettings().facingMode === 'user' ? 'environment' : 'user';
          await cam.setDevice({ facingMode: facing }).catch(() => {});
        },
        stop: async () => {
          try { await client.unpublish([mic, cam]); } catch (e) {}
          mic.close(); cam.close();
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
      const userId = uid || Math.floor(Math.random() * 100000);
      const token = await fetchToken(channel, userId, 'audience');
      await client.join(AGORA_APP_ID, channel, token, userId);

      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === 'video' && user.videoTrack && videoEl) user.videoTrack.play(videoEl);
        if (mediaType === 'audio' && user.audioTrack) user.audioTrack.play();
        onPlayers && onPlayers(client.remoteUsers);
      });
      client.on('user-unpublished', (user) => {
        onPlayers && onPlayers(client.remoteUsers);
      });

      // If the host already published before we joined, manually grab their tracks
      for (const user of client.remoteUsers) {
        if (user.hasVideo) await client.subscribe(user, 'video').then(() => user.videoTrack && videoEl && user.videoTrack.play(videoEl)).catch(() => {});
        if (user.hasAudio) await client.subscribe(user, 'audio').then(() => user.audioTrack && user.audioTrack.play()).catch(() => {});
      }

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
    async startCall({ channel, uid, withVideo, localVideoEl, remoteVideoEl, onRemote, onError }) {
      if (!AGORA_APP_ID) throw new Error('AGORA_APP_ID not configured');
      const AgoraRTC = await loadSdk();
      AgoraRTC.setLogLevel(2);
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      const userId = uid || Math.floor(Math.random() * 100000);
      // 'host' is the publishing role in both modes, and a call needs it on
      // BOTH sides — an 'audience' token cannot publish, so whoever got one
      // would join the channel able to hear and unable to be heard.
      const token = await fetchToken(channel, userId, 'host');
      await client.join(AGORA_APP_ID, channel, token, userId);

      let mic = null, cam = null;
      try {
        mic = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: 'speech_standard' });
        if (withVideo) {
          // A refused camera should still leave you an audio call rather than
          // no call at all, so this one failure is reported and swallowed.
          try {
            cam = await AgoraRTC.createCameraVideoTrack({ encoderConfig: '480p_1', facingMode: 'user' });
            if (localVideoEl) cam.play(localVideoEl);
          } catch (e) { onError && onError(e); cam = null; }
        }
        await client.publish(cam ? [mic, cam] : [mic]);
      } catch (e) {
        // We are already in the channel by this point. A denied microphone
        // would otherwise leave us joined, silent and billing, with no handle
        // for the caller to leave with — the caller only ever receives the
        // session object this function returns, and it is not returning one.
        if (cam) { try { cam.close(); } catch (e2) {} }
        if (mic) { try { mic.close(); } catch (e2) {} }
        await client.leave().catch(() => {});
        throw e;
      }

      // Remote audio tracks are held so the speaker setting can be applied to
      // them as they arrive — the other side usually publishes after we have
      // already joined, and a setting applied only at join time would be lost.
      const remoteAudio = new Set();
      // Tracked separately from audio so the caller can tell "they joined" from
      // "they are sending pictures". Unhiding the video surface on the strength
      // of an audio publish alone would black out the avatar screen for a video
      // call in which the other side has their camera off.
      const remoteVideo = new Set();
      let speakerOn = true;

      function applySpeakerTo(track) {
        // Web has no earpiece/loudspeaker switch: routing is decided by the
        // OS, and changing it needs a native audio plugin this app does not
        // ship. What IS controllable is the playback level, which is the
        // audible part of the difference. setVolume is synchronous and
        // cannot report failure, so the caller verifies by re-reading below.
        try { track.setVolume(speakerOn ? 100 : 40); return true; }
        catch (e) { onError && onError(e); return false; }
      }

      client.on('user-published', async (user, mediaType) => {
        try {
          await client.subscribe(user, mediaType);
          if (mediaType === 'audio' && user.audioTrack) {
            remoteAudio.add(user.audioTrack);
            applySpeakerTo(user.audioTrack);
            user.audioTrack.play();
          }
          if (mediaType === 'video' && user.videoTrack) {
            remoteVideo.add(user.videoTrack);
            if (remoteVideoEl) user.videoTrack.play(remoteVideoEl);
          }
          onRemote && onRemote(state());
        } catch (e) { onError && onError(e); }
      });
      client.on('user-unpublished', (user, mediaType) => {
        if (mediaType === 'audio' && user.audioTrack) remoteAudio.delete(user.audioTrack);
        if (mediaType === 'video' && user.videoTrack) remoteVideo.delete(user.videoTrack);
        onRemote && onRemote(state());
      });

      function state() {
        return { hasRemoteAudio: remoteAudio.size > 0, hasRemoteVideo: remoteVideo.size > 0 };
      }

      return {
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

        // Nothing to route until the other side is actually sending audio.
        canRouteAudio: () => remoteAudio.size > 0,
        hasRemoteVideo: () => remoteVideo.size > 0,
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
          return speakerOn;
        },

        stop: async () => {
          try { await client.unpublish(cam ? [mic, cam] : [mic]); } catch (e) {}
          if (mic) { try { mic.close(); } catch (e) {} }
          if (cam) { try { cam.close(); } catch (e) {} }
          remoteAudio.clear();
          remoteVideo.clear();
          await client.leave().catch(() => {});
        },
      };
    },
  };

  window.Agora = Agora;
})();
