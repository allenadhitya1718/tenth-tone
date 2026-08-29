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
  };

  window.Agora = Agora;
})();
