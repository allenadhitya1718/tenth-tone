/* === Content screening (server-side, Google Gemini) ===
 *
 * The thin browser end of the `moderate-content` Edge Function. Everything of
 * consequence — the API key, the thresholds, the decision, the audit row —
 * lives on the server. This file only gathers what is about to be written,
 * asks, and reports the answer. Nothing here is a secret and nothing here is
 * authoritative.
 *
 * Read supabase/migrations/0066_content_moderation.sql for why any of this
 * exists; the short version is that every other defence in the app is reactive
 * and needs five people to have already seen the thing.
 *
 * ── Not the same as nsfw-check.js ──
 * NSFWCheck runs a TensorFlow model on the phone and only knows about nudity.
 * It stays exactly where it is, in the upload screen, and it is still the first
 * thing an obviously pornographic clip hits — it costs nothing and it never
 * leaves the device. This layer is the wider net behind it: violence, self
 * harm, hate, threats, illegal activity, and every one of those in TEXT too,
 * which the on-device model cannot see at all.
 *
 * ── Everything here fails open ──
 * A thrown error, a timeout, an undeployed function, a signed-out session:
 * blocked is false and the write proceeds. That is a deliberate promise, not
 * defensive habit. The server records the gap and it surfaces in the admin
 * dashboard as scans_unavailable_24h.
 *
 * ── Usage ──
 *   const v = await Moderation.checkText('comment', text);
 *   if (v.blocked) throw new Error(v.message);
 *   ... write the row ...
 *   Moderation.attach(v, 'comment', row.id);
 */
window.Moderation = (function () {

  // Longer than the Edge Function's own budget, so a slow-but-successful scan
  // is not thrown away by the browser a second before the answer arrives.
  const TIMEOUT_TEXT = 12000;
  const TIMEOUT_IMAGE = 25000;

  // Downscaled hard before anything leaves the phone. The model does not need
  // a 4K frame to recognise what it is looking at, and three full-size frames
  // would be several megabytes of base64 out of a Saudi mobile data plan on
  // every single upload.
  const MAX_DIM = 512;
  const JPEG_QUALITY = 0.8;
  const VIDEO_FRAMES = 3;

  // ── Circuit breaker ──
  // A build can reach a phone before `moderate-content` is deployed, or the
  // function can be down. Without this, every post would spend its full
  // timeout discovering that again. Three consecutive failures and the layer
  // steps aside for ten minutes.
  //
  // This is a UX guard, not a security one: it only ever causes MORE content
  // to be allowed, which is already what a failure does.
  let consecutiveFailures = 0;
  let mutedUntil = 0;
  const FAILURE_LIMIT = 3;
  const MUTE_MS = 10 * 60 * 1000;

  const PASS = { blocked: false, message: null, eventId: null, attach: false, target: null };

  function enabled() {
    if (window.TT_CONFIG && window.TT_CONFIG.aiModeration === false) return false;
    return Date.now() >= mutedUntil;
  }

  function noteFailure() {
    consecutiveFailures++;
    if (consecutiveFailures >= FAILURE_LIMIT) {
      mutedUntil = Date.now() + MUTE_MS;
      consecutiveFailures = 0;
      console.warn('[Moderation] repeated failures — standing down for 10 minutes');
    }
  }

  // ── Ask the server ──
  async function ask({ kind, text, images }) {
    if (!enabled()) return PASS;
    if (!text && (!images || !images.length)) return PASS;

    try {
      const c = await window.SB.client();
      if (!c) return PASS;

      const budget = (images && images.length) ? TIMEOUT_IMAGE : TIMEOUT_TEXT;
      const call = c.functions.invoke('moderate-content', {
        body: { kind, text: text || '', images: images || [] },
      });

      // functions.invoke has no timeout of its own, and a request that never
      // settles would leave the person staring at a spinner for ever. The
      // losing promise is abandoned rather than cancelled — harmless, since the
      // server has already logged whatever it decided.
      const timer = new Promise(resolve =>
        setTimeout(() => resolve({ data: null, error: new Error('moderation timeout') }), budget));

      const { data, error } = await Promise.race([call, timer]);

      if (error || !data) {
        noteFailure();
        console.warn('[Moderation] unavailable, allowing:', error && error.message);
        return PASS;
      }

      consecutiveFailures = 0;

      return {
        blocked: data.decision === 'block',
        message: data.message || null,
        eventId: data.eventId || null,
        attach: !!data.attach,
        target: data.target || null,
      };
    } catch (e) {
      noteFailure();
      console.warn('[Moderation] threw, allowing:', e && e.message);
      return PASS;
    }
  }

  // ── Turn an image File/Blob into a small JPEG data URI ──
  // Data URIs rather than URLs on purpose: it means an avatar can be refused
  // BEFORE its bytes are ever written to storage, so a rejected image leaves
  // nothing behind to clean up and never sits in a public bucket, however
  // briefly.
  function shrinkImage(file) {
    return new Promise(resolve => {
      let url = null;
      try {
        url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const scale = Math.min(1, MAX_DIM / Math.max(img.width || 1, img.height || 1));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round((img.width || MAX_DIM) * scale));
            canvas.height = Math.max(1, Math.round((img.height || MAX_DIM) * scale));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
          } catch (e) { resolve(null); }
          finally { if (url) URL.revokeObjectURL(url); }
        };
        img.onerror = () => { if (url) URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      } catch (e) {
        if (url) URL.revokeObjectURL(url);
        resolve(null);
      }
    });
  }

  // ── Sample frames out of a video ──
  // Evenly spaced, same technique nsfw-check.js already uses on the same file a
  // moment earlier. Three, not thirty: this is a sample and the header of 0066
  // says so in as many words. Something objectionable that appears only between
  // these frames is not caught here, and reporting remains the backstop for it.
  function videoFrames(file, count) {
    return new Promise(resolve => {
      const frames = [];
      let url = null;
      let video = null;

      function done() {
        try { if (video) { video.removeAttribute('src'); video.load(); } } catch (e) {}
        if (url) URL.revokeObjectURL(url);
        resolve(frames);
      }

      try {
        url = URL.createObjectURL(file);
        video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';

        // A video that will not decode must not hang the upload. Nothing here
        // is allowed to leave the promise unsettled.
        const bail = setTimeout(done, 12000);

        video.onerror = () => { clearTimeout(bail); done(); };
        video.onloadeddata = async () => {
          try {
            const duration = video.duration;
            if (!duration || !isFinite(duration)) { clearTimeout(bail); return done(); }

            for (let i = 1; i <= count; i++) {
              const t = (duration * i) / (count + 1);
              const shot = await grab(video, t);
              if (shot) frames.push(shot);
            }
          } catch (e) { /* whatever we managed to grab is what gets sent */ }
          clearTimeout(bail);
          done();
        };

        video.src = url;
      } catch (e) { done(); }
    });
  }

  function grab(video, t) {
    return new Promise(resolve => {
      let settled = false;
      function finish(v) { if (!settled) { settled = true; resolve(v); } }

      // A seek that never fires `seeked` — a truncated file, an unsupported
      // codec — would otherwise stall the whole publish.
      const bail = setTimeout(() => finish(null), 4000);

      function onSeeked() {
        video.removeEventListener('seeked', onSeeked);
        clearTimeout(bail);
        try {
          const w = video.videoWidth || MAX_DIM;
          const h = video.videoHeight || MAX_DIM;
          const scale = Math.min(1, MAX_DIM / Math.max(w, h));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        } catch (e) { finish(null); }
      }

      video.addEventListener('seeked', onSeeked);
      try { video.currentTime = t; } catch (e) { clearTimeout(bail); finish(null); }
    });
  }

  // Declared as closures rather than as methods on the returned object, for the
  // same reason supabase.js does it: a call site that ever writes
  // `const { checkText } = window.Moderation` would silently lose `this`, and
  // the failure mode of THIS module is "everything is allowed", which is the
  // hardest kind of bug to notice.

  // Text only — comments, captions, bios, titles, messages.
  async function checkText(kind, text) {
    const body = String(text || '').trim();
    if (!body) return PASS;
    return await ask({ kind, text: body });
  }

  // One image, with optional accompanying text — avatars, group photos, live
  // covers. Takes the File itself so the refusal happens before upload.
  async function checkImage(kind, file, text) {
    if (!file) return await checkText(kind, text);
    if (!enabled()) return PASS;
    const shot = await shrinkImage(file);
    if (!shot) return await checkText(kind, text);
    return await ask({ kind, text: text || '', images: [shot] });
  }

  // A video and its description in ONE request: the caption and three sampled
  // frames are a single call, which matters because the free Gemini tier is
  // capped per day and a per-frame call would burn it four times as fast.
  async function checkVideo(file, description) {
    if (!enabled()) return PASS;
    let frames = [];
    if (file) {
      try { frames = await videoFrames(file, VIDEO_FRAMES); }
      catch (e) { frames = []; }
    }
    // No frames extracted is not a failure — the description is still worth
    // screening, and the on-device NSFWCheck has already seen the file.
    return await ask({ kind: 'video', text: description || '', images: frames });
  }

  // ── Close the loop ──
  // Called after the row exists. Only a 'review' or an unscanned publish has
  // anything to attach; everything else is a no-op. Deliberately swallows every
  // error: this is bookkeeping, and a post that succeeded must never fail
  // afterwards because the queue entry could not be filed.
  async function attach(verdict, targetType, targetId) {
    try {
      if (!verdict || !verdict.attach || !verdict.eventId || !targetId) return null;
      const c = await window.SB.client();
      if (!c) return null;
      const { data, error } = await c.rpc('moderation_attach_target', {
        p_event_id: verdict.eventId,
        p_target_type: targetType || verdict.target,
        p_target_id: targetId,
      });
      if (error) { console.warn('[Moderation] attach failed:', error.message); return null; }
      return data || null;
    } catch (e) {
      console.warn('[Moderation] attach threw:', e && e.message);
      return null;
    }
  }

  return { enabled, checkText, checkImage, checkVideo, attach };
})();
