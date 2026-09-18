/* === Supabase data access layer === */
(function () {
  if (!window.SB) { console.warn('SB not ready, db.js loaded too early'); return; }

  const API = {};

  async function client() { return await window.SB.client(); }

  // Our own user id, read from the locally stored session.
  //
  // This used to call SB.getUser(), which asks the auth server to re-validate
  // the token and costs a full round trip — measured at 206-289ms. uid() is
  // called by 119 functions in this file, almost always as the FIRST thing
  // they do, so nearly every read in the app was paying that before it even
  // issued its real query. fetchFeed spent ~230ms learning who you are and
  // another ~230ms fetching the feed. It roughly doubled the latency of the
  // whole app.
  //
  // getSession() reads the JWT already held in local storage (~1ms) and the
  // id is the token's own `sub` claim — the same value getUser() returns.
  //
  // This is not a weakening of security. The id is only used to BUILD
  // queries; it is never what authorises them. Postgres derives auth.uid()
  // from the JWT itself on every request and RLS enforces that, so a client
  // that lied here would simply get nothing back.
  async function uid() {
    try {
      const s = await window.SB.getSession();
      return (s && s.user && s.user.id) || null;
    } catch (e) { return null; }
  }

  // =====================================================================
  //  Read cache
  //
  //  Nothing was cached. Every screen re-queried on every visit, and the
  //  router rebuilds a view from scratch each time you navigate to it, so
  //  going home -> profile -> home re-fetched the entire feed. Measured
  //  round trip to Supabase is ~227ms and fetchFeed alone costs four or
  //  five of them, which is where "it loads again every time" came from.
  //
  //  This is deliberately a CLIENT cache, not Redis. The browser talks to
  //  Supabase directly — there is no server tier for Redis to sit in, and
  //  adding one would put an extra hop in front of every miss. It also
  //  could not be shared safely: RLS decides row visibility per user, so
  //  one shared server-side cache is a way to serve one account's rows to
  //  another.
  //
  //  Two modes:
  //    cached(...)  - within TTL, return the stored value and make no call.
  //    swr(...)     - return the stored value immediately AND refresh in
  //                   the background, so the screen is instant but still
  //                   converges on the truth. Used for anything that
  //                   changes while you are looking at it.
  // =====================================================================
  const _cache = new Map();          // key -> { at, data }
  const _inflight = new Map();       // key -> Promise, so N callers share one call
  let _cacheOwner = null;            // whose data this is

  // ── Surviving an app restart ──
  //
  // The cache above lives in memory, which is wiped the moment the app is
  // closed — so opening the app fresh was always slow again, however much
  // had been cached while using it. These write a copy to the device's own
  // storage and read it back on the next launch, so the first screen can be
  // drawn immediately from what was there last time while the real answer is
  // fetched behind it.
  //
  // Only a few keys are worth keeping, and only for a day. Everything is
  // stamped with whose data it is and erased on sign-out, so one account's
  // conversations can never be shown to whoever opens the app next.
  // ── Bumped to v2 when media moved to Cloudflare R2 ──
  // The persisted feed holds fully-formed video URLs, and every one written
  // before that migration points at a Supabase file that has since been
  // deleted. A device carrying that cache would show a feed of broken videos
  // for up to PERSIST_MAX_AGE — a full day — with nothing on screen
  // suggesting an app restart would help.
  //
  // Changing the key sidesteps it completely: the new build looks for a name
  // the old one never wrote, finds nothing, and fetches fresh.
  //
  // Bump this again on any change that alters the SHAPE or the meaning of
  // cached values. Stale-but-valid data is what PERSIST_MAX_AGE is for;
  // this is for data that is no longer true.
  // v3: feed rows now carry liked / saved / following / saves_count from
  // the feed call itself (0084). A v2 feed lacks them, and the app would
  // spend the first launch fetching each one separately again.
  const PERSIST_KEY = 'tt-cache-v3';

  // Cleared rather than left behind: localStorage is a small shared quota, and
  // an abandoned 400KB blob nothing will ever read again is pure waste.
  ['tt-cache-v1', 'tt-cache-v2'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  const PERSIST_PREFIXES = ['chats', 'feed:', 'profile:', 'uservideos:'];
  const PERSIST_MAX_CHARS = 400000;   // ~400KB; storage is small and shared
  const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

  const _persistable = (k) => PERSIST_PREFIXES.some(p => k.indexOf(p) === 0);

  function clearPersisted() {
    try { localStorage.removeItem(PERSIST_KEY); } catch (e) {}
  }

  function savePersisted() {
    try {
      if (!_cacheOwner) return;
      const out = {};
      for (const [k, v] of _cache.entries()) if (_persistable(k)) out[k] = v;
      if (!Object.keys(out).length) return;
      const payload = JSON.stringify({ owner: _cacheOwner, at: Date.now(), data: out });
      // Better to keep nothing than to fill the device's storage quota and
      // start throwing on every write.
      if (payload.length > PERSIST_MAX_CHARS) return;
      localStorage.setItem(PERSIST_KEY, payload);
    } catch (e) { /* private mode, or quota full — the cache is optional */ }
  }

  function loadPersisted(owner) {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Belongs to someone else, or is too old to be worth showing.
      if (!parsed || parsed.owner !== owner || (Date.now() - parsed.at) > PERSIST_MAX_AGE) {
        clearPersisted();
        return;
      }
      Object.keys(parsed.data || {}).forEach(k => {
        const e = parsed.data[k];
        // Kept with its ORIGINAL timestamp, so it is honestly old: swr()
        // paints it at once and refreshes immediately, and cached() treats
        // it as expired and fetches properly. Nothing is passed off as fresh.
        if (e && 'data' in e) _cache.set(k, { at: e.at || 0, data: e.data });
      });
    } catch (e) { clearPersisted(); }
  }

  // Written when the app is backgrounded or closed rather than on every
  // change, so normal use never pays for the copying.
  try {
    window.addEventListener('pagehide', savePersisted);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') savePersisted();
    });
  } catch (e) {}

  // The cache must never survive a change of account.
  //
  // Deliberately getSession, not getUser: getUser re-validates the token
  // against the server and costs a full round trip, so using it here made
  // every cache HIT pay ~230ms and the cache saved nothing at all.
  // getSession reads the stored session locally and returns in about 0ms.
  async function _assertOwner() {
    let me = null;
    try {
      const s = await window.SB.getSession();
      me = (s && s.user && s.user.id) || null;
    } catch (e) { me = null; }
    if (me !== _cacheOwner) {
      _cache.clear(); _inflight.clear();
      _cacheOwner = me;
      // A new signed-in user gets their own saved copy back; signing out
      // wipes what was stored so nothing is left on the device.
      if (me) loadPersisted(me); else clearPersisted();
    }
  }

  function _fresh(entry, ttl) {
    return entry && (Date.now() - entry.at) < ttl;
  }

  async function cached(key, ttl, fn) {
    await _assertOwner();
    const hit = _cache.get(key);
    if (_fresh(hit, ttl)) return hit.data;
    if (_inflight.has(key)) return _inflight.get(key);   // collapse duplicate calls
    const p = (async () => {
      try {
        const data = await fn();
        _cache.set(key, { at: Date.now(), data });
        return data;
      } finally { _inflight.delete(key); }
    })();
    _inflight.set(key, p);
    return p;
  }

  // Stale-while-revalidate. onFresh fires only if the refreshed result
  // differs from what was handed back, so a caller can repaint without
  // flickering on every navigation.
  async function swr(key, ttl, fn, onFresh) {
    await _assertOwner();
    const hit = _cache.get(key);
    if (hit) {
      if (!_fresh(hit, ttl) && !_inflight.has(key)) {
        const p = (async () => {
          try {
            const data = await fn();
            const changed = JSON.stringify(data) !== JSON.stringify(hit.data);
            _cache.set(key, { at: Date.now(), data });
            if (changed && typeof onFresh === 'function') { try { onFresh(data); } catch (e) {} }
            return data;
          } catch (e) { return hit.data; }
          finally { _inflight.delete(key); }
        })();
        _inflight.set(key, p);
      }
      return hit.data;
    }
    return cached(key, ttl, fn);
  }

  // Drops every key starting with the given prefix. Called after a write so
  // the next read cannot serve something the user just changed.
  function invalidate(prefix) {
    if (!prefix) { _cache.clear(); return; }
    for (const k of Array.from(_cache.keys())) {
      if (k.indexOf(prefix) === 0) _cache.delete(k);
    }
  }

  // Edits cached entries in place instead of dropping them.
  //
  // Liking a video only changes that video's own flags, so throwing away the
  // whole cached feed would force a fresh four-or-five round trip fetch after
  // every single tap — the cache would stop helping exactly the people using
  // the app most. This rewrites the affected rows and leaves the rest alone.
  function patchCached(prefix, mutate) {
    for (const [k, entry] of _cache.entries()) {
      if (k.indexOf(prefix) !== 0 || !entry) continue;
      try { mutate(entry.data); } catch (e) { _cache.delete(k); }
    }
  }

  // Reflects a like/save toggle onto every cached copy of that video.
  function _patchVideoFlag(videoId, field, value) {
    const apply = (rows) => {
      if (!Array.isArray(rows)) return;
      rows.forEach(r => { if (r && r.id === videoId) r[field] = value; });
    };
    patchCached('feed:', apply);
  }

  // Same idea for a counter. Without it the cached page still holds the old
  // number, so scrolling away and back showed the save undone.
  function _patchVideoCount(videoId, field, delta) {
    const apply = (rows) => {
      if (!Array.isArray(rows)) return;
      rows.forEach(r => {
        if (r && r.id === videoId) r[field] = Math.max(0, (Number(r[field]) || 0) + delta);
      });
    };
    patchCached('feed:', apply);
  }

  API.invalidate = invalidate;
  API.patchCached = patchCached;
  API.clearCache = () => { _cache.clear(); _inflight.clear(); clearPersisted(); };
  // Signing out must not leave the previous account's data behind — not in
  // memory, and not in the copy written to the device.
  try {
    if (window.SB && typeof window.SB.onAuthChange === 'function') {
      window.SB.onAuthChange((event) => {
        if (event === 'SIGNED_OUT') { _cacheOwner = null; API.clearCache(); }
        else { _cache.clear(); _inflight.clear(); _cacheOwner = null; }
      });
    }
  } catch (e) {}

  // =====================================================================
  //  Cloudflare R2 uploads
  //
  //  Supabase Storage enforced the upload quota itself: the INSERT into
  //  storage.objects was refused by a Postgres policy, so even someone
  //  talking to the storage API directly with the public key got nothing.
  //
  //  R2 has no policies and no database, so that gate had to be rebuilt as
  //  the media-upload Edge Function. The R2 credentials live only there,
  //  which means asking it is the only way to put a byte in the bucket, and
  //  it runs the same within_upload_quota() check on the way past.
  //
  //  Three steps: ask for a signed URL, PUT the bytes straight to R2 (they
  //  never pass through Supabase, which is the point), then confirm so the
  //  server can measure what actually landed and record it.
  // =====================================================================

  // Deliberate refusals from the gate, as opposed to something being broken.
  // These must NEVER fall back to Supabase: the server said no, and quietly
  // succeeding against the other backend would show the person an upload the
  // quota had just declined.
  const R2_REFUSALS = new Set([
    'quota_exceeded', 'file_too_large', 'too_many_pending',
    'bad_extension', 'bad_content_type', 'bad_size',
  ]);

  async function r2Call(body) {
    const c = await client();
    const { data, error } = await c.functions.invoke('media-upload', { body });
    if (error) {
      // The function puts a readable reason in the body; the SDK only reports
      // "non-2xx status code" unless you dig it out.
      let payload = null;
      try { payload = await error.context.json(); } catch (e) {}
      const code = (payload && payload.error) || '';
      if (R2_REFUSALS.has(code)) {
        const refusal = new Error(code);
        refusal.refused = true;
        refusal.payload = payload;
        throw refusal;
      }
      throw new Error(code || error.message || 'upload service unavailable');
    }
    return data;
  }

  // Returns the public URL on success.
  //
  // Returns NULL when R2 is switched off, or when the service is unreachable
  // and the caller should use its existing Supabase path instead. A null is
  // "not applicable", never "refused" - anything the gate deliberately
  // declined is thrown, so it reaches the person as a real message rather
  // than being retried somewhere that might answer differently.
  API.uploadMedia = async (file, { bucket = 'videos', ext, contentType } = {}) => {
    if (!(window.TT_CONFIG && window.TT_CONFIG.r2Uploads)) return null;
    if (!file || !file.size) return null;

    // Base type only. MediaRecorder reports the codecs it chose, so a recorded
    // clip's file.type is 'video/mp4;codecs=avc1.42001f,mp4a.40.2' - and the
    // sign endpoint matches the whitelist exactly, so every camera publish came
    // back bad_content_type. Fixed on the server too, which repairs installed
    // builds; this keeps the signed type and the uploaded bytes agreeing.
    const type = String(contentType || file.type || 'application/octet-stream')
      .split(';')[0].trim().toLowerCase();
    const extension = (ext || (file.name || '').split('.').pop() || '').toLowerCase();
    if (!extension) return null;

    let sig;
    try {
      sig = await r2Call({ action: 'sign', bucket, ext: extension, contentType: type, size: file.size });
    } catch (e) {
      if (e && e.refused) throw e;
      console.warn('R2 sign failed, using Supabase:', e && e.message);
      return null;
    }
    if (!sig || !sig.uploadUrl) return null;

    // Every header the sign step returned was part of the signature, so they
    // have to go back byte for byte - except content-length. That is a
    // forbidden header name: the browser sets it from the body itself and
    // will not let us. Its value is the same number either way, so the
    // signature still matches; we simply must not send it by hand.
    const headers = Object.assign({}, sig.headers || {});
    delete headers['content-length'];
    delete headers['Content-Length'];

    const put = await fetch(sig.uploadUrl, { method: 'PUT', headers, body: file });
    if (!put.ok) {
      // Past this point the bytes may be in the bucket behind an unconfirmed
      // ledger row. The reconcile job sweeps those, so nothing is orphaned -
      // but the upload has failed and must not quietly retry against Supabase,
      // or one clip would end up stored in both places.
      throw new Error('upload failed (' + put.status + ')');
    }

    // The size recorded in the ledger comes from R2 during this call, not from
    // us. Retried once because the bytes are already stored: losing the race
    // here would leave a real object behind an unconfirmed row for the sweeper.
    let done;
    try {
      done = await r2Call({ action: 'confirm', id: sig.id });
    } catch (e) {
      if (e && e.refused) throw e;
      await new Promise(r => setTimeout(r, 800));
      done = await r2Call({ action: 'confirm', id: sig.id });
    }

    return (done && done.publicUrl) || sig.publicUrl;
  };

  // Give the bytes back when the last thing pointing at them is deleted.
  //
  // Deleting the row used to be the whole story. The object stayed in R2 and
  // stayed publicly fetchable for ever, because the bucket is served from a
  // public base with no authentication of any kind - so a person who deleted a
  // post was told it was gone while the file kept working for anyone who had
  // ever seen the URL. That is a deletion claim the app could not honour.
  //
  // The decision about whether an object may actually go is NOT made here. The
  // Edge Function re-derives ownership and checks every column in the app that
  // can hold a media URL, and refuses on any doubt. All this does is name the
  // URLs a delete just orphaned; being wrong about that changes nothing,
  // because a URL something still uses comes back refused.
  //
  // Two rules about WHEN, and both matter:
  //
  //   AFTER the row delete, never before. The reference check counts the video
  //   itself, so cleaning up first would find the post still pointing at its
  //   own file and refuse every single time.
  //
  //   Never awaited, never throws. The post IS deleted the moment the row
  //   goes; whether the bytes were collected is a separate question with its
  //   own fallback (media-reconcile, hourly), and a failed cleanup must never
  //   turn a delete that worked into an error on screen.
  function releaseMedia(urls) {
    const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
    for (const url of list) {
      // The server decides what is and is not an R2 object: a Supabase-era URL
      // answers `skipped`, not an error. So nothing here has to know which
      // storage backend a given post happened to be published to, which is
      // just as well - posts from both eras are live at the same time.
      r2Call({ action: 'delete', url }).catch((e) => {
        console.warn('media cleanup:', (e && e.message) || e);
      });
    }
  }

  // ---------- Videos ----------
  // Grabs a still for the feed/grid/share-card poster. V.publish never made
  // one, so `thumbnail: thumbnail_url || video_url` wrote the MP4's own URL
  // into the thumbnail column of every video ever published - which is why
  // share cards render a blank cover and posters never load. The codebase
  // already carries three workarounds for the symptom (a <video> swap in
  // notifications, an endsWith('.mp4') guard on the grid) without fixing it.
  //
  // Drawn only after 'seeked': on loadedmetadata the dimensions are known but
  // no frame has been decoded, so the canvas comes out empty. Every failure
  // path resolves null and the caller falls back to video_url, because a
  // missing poster must never hold up a publish.
  function posterFromVideo(file) {
    return new Promise((resolve) => {
      let settled = false;
      const url = URL.createObjectURL(file);
      const v = Object.assign(document.createElement('video'), {
        src: url, muted: true, playsInline: true, preload: 'auto',
      });
      v.setAttribute('playsinline', '');
      // Off-screen with NO size of its own, so its layout box is the clip's
      // displayed size - orientation applied. The capture below reads that.
      v.style.cssText = 'position:fixed;left:-99999px;top:0;width:auto;height:auto;max-width:none;max-height:none;';
      const cleanup = () => {
        clearTimeout(timer);
        try { URL.revokeObjectURL(url); } catch (e) {}
        try { v.remove(); } catch (e) {}
      };
      const done = (val) => { if (!settled) { settled = true; cleanup(); resolve(val); } };
      const timer = setTimeout(() => done(null), 8000);
      v.onerror = () => done(null);
      v.onloadedmetadata = () => {
        // A little way in: frame 0 of a phone clip is often black or half-exposed.
        const d = isFinite(v.duration) ? v.duration : 0;
        const target = d > 0.2 ? Math.min(d * 0.1, 1.0) : 0;
        // iOS will not decode a frame for a video that has never played, so
        // seeking alone gave an empty canvas and every clip uploaded from an
        // iPhone ended up with a blank tile. Playing muted and inline for a
        // moment forces the decode; then seek, capture, and stop.
        //
        // play() is allowed here because the element is muted and playsInline.
        // If it is refused anyway the catch falls through to a plain seek,
        // which is exactly the old behaviour - so this cannot be worse than
        // what it replaces.
        const seek = () => { try { v.currentTime = target; } catch (e) { done(null); } };
        const p = v.play();
        if (p && typeof p.then === 'function') {
          p.then(() => { try { v.pause(); } catch (e) {} seek(); }).catch(seek);
        } else {
          seek();
        }
      };
      v.onseeked = () => {
        try {
          let w = v.videoWidth, h = v.videoHeight;
          if (!w || !h) return done(null);
          // A phone clip carries its orientation as metadata. Some engines
          // report videoWidth/videoHeight from the stored frame, BEFORE that
          // rotation is applied - so a portrait clip came back as 1280x720,
          // its poster was drawn landscape, and the feed stretched a 720x405
          // still over a portrait screen. That is the "low resolution" people
          // saw while a reel loaded. The element's layout box is always the
          // displayed orientation; when the two disagree, the box is right.
          const lw = v.clientWidth, lh = v.clientHeight;
          if (lw > 0 && lh > 0 && (lw > lh) !== (w > h)) { const t = w; w = h; h = t; }
          const scale = Math.min(720 / w, 1280 / h, 1);
          const c = Object.assign(document.createElement('canvas'), {
            width: Math.max(2, Math.round(w * scale)),
            height: Math.max(2, Math.round(h * scale)),
          });
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          c.toBlob(b => done(b && b.size ? b : null), 'image/jpeg', 0.8);
        } catch (e) { done(null); }
      };
      document.body.appendChild(v);
    });
  }

  API.publishVideo = async ({ file, thumbnail_url, description, music, sound_id = null, privacy = 'public', is_draft = false, allow_comments = true, allow_saving = true }) => {
    const c = await client();
    const userId = await uid();
    if (!userId) throw new Error('not signed in');

    // ── Screening, before a single byte is uploaded ──
    // The caption and three sampled frames go in ONE call (moderation.js,
    // and 0066 for why). Refused here means nothing is stored and nothing is
    // written, which is the whole reason this sits above the upload rather
    // than below it. Unreachable means ALLOWED - the verdict then carries a
    // queue entry instead, attached once the row exists.
    //
    // Drafts are screened too. A draft becomes a post with one tap and the
    // check costs nothing, so skipping them would be a hole with a button on it.
    // Started here, awaited just above the insert. It runs CONCURRENTLY with
    // the upload instead of in front of it, which costs nothing in safety: the
    // clip becomes visible at the videos insert, not at the upload, and that
    // insert is still gated on the verdict. Nothing blocked is ever published.
    //
    // What it buys is the wait. An image scan is ~3-6s and the upload is
    // 5.2-6.3s; run in sequence that is a ~10s publish, run together it stays
    // at the upload's own time. The frames are read from the File in parallel
    // with it being uploaded, which is safe - both are independent reads.
    //
    // The cost of a block moves rather than disappearing: the bytes are
    // already in R2 by then, so a refused clip leaves an orphaned object that
    // counts against the storage ceiling, and against the author's quota. Same
    // leak already recorded for deletions in 0068, and blocks are rare.
    //
    // .catch here, not at the await: if the upload throws first nothing would
    // consume this promise and the browser would log an unhandled rejection.
    let verdict = null;
    const screening = window.Moderation
      ? window.Moderation.checkVideo(file, description).catch(() => null)
      : null;

    let video_url = null;
    if (file) {
      // Skipped entirely on the R2 path, because it is asked and answered
      // twice: media-upload runs upload_quota_status() itself before it will
      // sign anything, AND compares the declared size against the ceiling — so
      // an oversized file is refused before a byte moves either way. Doing it
      // here as well cost a full Supabase round trip on every upload for an
      // answer we were about to get anyway. Measured: sign 1.3-3.0s, PUT to
      // Cloudflare 0.45s, confirm 1.8s — the round trips ARE the upload time,
      // so removing a whole one is worth more than it looks.
      //
      // On the Supabase path it is still the only pre-flight check there is.
      const r2on = !!(window.TT_CONFIG && window.TT_CONFIG.r2Uploads);
      if (!r2on) {
        const q = await API.uploadQuota();
        if (q && !q.allowed) throw new Error(API.quotaMessage(q));
        if (q && q.max_video_bytes && file.size > q.max_video_bytes) {
          throw new Error('حجم الملف كبير جدًا (الحد الأقصى ' + Math.floor(q.max_video_bytes / 1048576) + ' ميجابايت)');
        }
      }
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();

      // R2 first when it is switched on. Null means "not applicable" - either
      // off, or the service could not be reached - so the original Supabase
      // path below still runs. A refusal throws and never reaches it.
      video_url = await API.uploadMedia(file, { bucket: 'videos', ext });

      const path = `${userId}/${Date.now()}.${ext}`;
      // A year, not an hour. The path carries a timestamp and is never reused,
      // so the bytes at a given URL can never change — which makes a short TTL
      // pure waste: at 3600 a phone re-downloaded the same clip every hour it
      // was watched, and every one of those came out of the egress allowance.
      // It also decides how well a CDN can hold the file once one is in front.
      if (!video_url) {
        const { error: upErr } = await c.storage.from('videos')
          .upload(path, file, { cacheControl: '31536000', upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = c.storage.from('videos').getPublicUrl(path);
        video_url = pub.publicUrl;
      }
    }

    // Poster, uploaded the same two ways the clip is. media-upload already
    // allows jpg in the videos bucket.
    let poster_url = thumbnail_url || null;
    if (!poster_url && file && String(file.type || '').startsWith('video/')) {
      try {
        const blob = await posterFromVideo(file);
        if (blob) {
          const pf = new File([blob], 'poster.jpg', { type: 'image/jpeg' });
          poster_url = await API.uploadMedia(pf, { bucket: 'videos', ext: 'jpg', contentType: 'image/jpeg' });
          if (!poster_url) {
            const ppath = `${userId}/${Date.now()}-poster.jpg`;
            const { error: pErr } = await c.storage.from('videos')
              .upload(ppath, pf, { cacheControl: '31536000', upsert: false, contentType: 'image/jpeg' });
            if (!pErr) {
              const { data: ppub } = c.storage.from('videos').getPublicUrl(ppath);
              poster_url = (ppub && ppub.publicUrl) || null;
            }
          }
        }
      } catch (e) { console.warn('poster:', e && e.message); }
    }

    // The gate. Everything above this line is reversible - bytes with no row
    // pointing at them - and nothing above it is visible to anyone.
    if (screening) {
      verdict = await screening;
      if (verdict && verdict.blocked) throw new Error(verdict.message || 'لا يمكن نشر هذا المحتوى');
    }

    const { data, error } = await c.from('videos').insert({
      user_id: userId, description: description || '', music: music || null,
      sound_id, video_url, thumbnail: poster_url || video_url, privacy, is_draft,
      allow_comments, allow_saving,
    }).select().single();
    if (error) throw error;

    // Not awaited, and it cannot throw: filing the queue entry is bookkeeping,
    // and a post that has already succeeded must never fail behind it.
    if (verdict && data && data.id) window.Moderation.attach(verdict, 'video', data.id);

    // Every public post gets an original sound others can reuse - the loop
    // that makes a short-video app work. Skipped when the user picked an
    // existing sound, and for drafts.
    //
    // ── And skipped for anything that is not public. ──
    // This line is a privacy fix, not a feature decision.
    //
    // `sounds` is readable by everyone, signed in or not (0008: `for select to
    // authenticated, anon using (true)`), and createOriginalSound copies the
    // VIDEO'S OWN URL into sounds.audio_url — there is no separate audio file,
    // the browser just plays the mp4's audio track. So publishing a private
    // clip also published its media URL to a table anyone could read with the
    // public anon key, and the media itself is served from a public bucket
    // with no auth. `videos` RLS hid the row; the sound row handed the file
    // straight back. That was the whole privacy hole, reachable by a stranger
    // with no account and one HTTP request.
    //
    // Nothing is lost: a sound exists so OTHER people can make videos with it,
    // and nobody can reach a private or followers-only clip to reuse it
    // anyway. 0079 adds the same rule in RLS, because a client-side check is
    // not a control - this one just stops writing the row in the first place.
    if (!sound_id && !is_draft && privacy === 'public' && data && data.id) {
      try {
        const snd = await API.createOriginalSound({
          videoId: data.id,
          title: 'صوت أصلي',
          coverUrl: poster_url || null,
          audioUrl: video_url || null,
        });
        if (snd && snd.id) {
          await c.from('videos').update({ sound_id: snd.id }).eq('id', data.id);
          data.sound_id = snd.id;
        }
      } catch (e) { console.warn('original sound:', e); } // never block a post
    }
    return data;
  };

  const _fetchFeedRaw = async ({ tab = 'foryou', limit = 20, offset = 0 } = {}) => {
    const c = await client();
    let data = [];

    if (tab === 'foryou') {
      try {
        const p_user_id = await uid();
        const { data: rpcData, error: rpcErr } = await c.rpc('fetch_fyp_feed', { p_limit: limit, p_offset: offset, p_user_id });
        if (!rpcErr && rpcData && rpcData.length) {
          data = rpcData.map(r => ({
            id: r.id,
            description: r.description,
            music: r.music,
            sound_id: r.sound_id,
            video_url: r.video_url,
            thumbnail: r.thumbnail,
            privacy: r.privacy,
            likes_count: r.likes_count,
            comments_count: r.comments_count,
            shares_count: r.shares_count,
            views_count: r.views_count,
            created_at: r.created_at,
            user: {
              id: r.user_id,
              name: r.user_name,
              handle: r.user_handle,
              avatar_url: r.user_avatar_url,
              verified: r.user_verified,
            },
            // Since 0084 the function answers these itself, so the feed is
            // ONE round trip instead of three plus one per creator. Left
            // undefined when an older function is still installed; the
            // lookups below then fill them in as before.
            saves_count: (typeof r.saves_count === 'number') ? r.saves_count : undefined,
            liked:       (typeof r.liked === 'boolean') ? r.liked : undefined,
            saved:       (typeof r.saved === 'boolean') ? r.saved : undefined,
            following:   (typeof r.following === 'boolean') ? r.following : undefined,
          }));
        }
      } catch (err) {
        console.warn('FYP RPC fallback to standard query:', err);
      }
    }

    if (!data.length) {
      let q = c.from('videos').select(`
        id, description, music, sound_id, video_url, thumbnail, privacy,
        likes_count, comments_count, shares_count, saves_count, views_count, created_at,
        user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url, verified )
      `).eq('is_draft', false).eq('privacy', 'public').order('created_at', { ascending: false });

      if (tab === 'following') {
        const me = await uid();
        if (!me) return [];
        const { data: f } = await c.from('follows').select('followed_id').eq('follower_id', me);
        const ids = (f || []).map(r => r.followed_id);
        if (!ids.length) return [];
        q = q.in('user_id', ids);
      }

      const { data: fetched, error } = await q.range(offset, offset + limit - 1);
      if (error) throw error;
      data = fetched || [];
    }

    // fetch_fyp_feed's return signature lists likes, comments, shares and
    // views - but not saves. Every row off the RPC therefore arrived with
    // saves_count undefined, the feed rendered 0, and the optimistic +1 from
    // tapping save was wiped by the next repaint: saving a clip appeared to
    // do nothing. The column exists on videos and is kept correct by the
    // tr_saves_count trigger, so read it directly rather than waiting on a
    // migration to widen the RPC.
    //
    // Everything below only runs for rows the function did not answer - the
    // plain query fallback, or a database still on the pre-0084 function -
    // and then all of it runs AT ONCE rather than one lookup after another.
    // Measured: each of these waits 0.2-1.0 s on the API from a phone, and
    // nothing can be drawn until they are all back.
    const me = await uid();
    const lookups = [];
    if (data && data.length && data.some(v => v.saves_count == null)) {
      lookups.push((async () => {
        try {
          const missing = data.filter(v => v.saves_count == null).map(v => v.id);
          const { data: counts } = await c.from('videos').select('id, saves_count').in('id', missing);
          const bySaves = new Map((counts || []).map(r => [r.id, r.saves_count]));
          data.forEach(v => { if (v.saves_count == null) v.saves_count = bySaves.get(v.id) || 0; });
        } catch (e) {
          data.forEach(v => { if (v.saves_count == null) v.saves_count = 0; });
        }
      })());
    }

    // Mark which videos current user already liked / saved
    if (me && data && data.length && data.some(v => v.liked == null || v.saved == null)) {
      lookups.push((async () => {
        const ids = data.map(v => v.id);
        const [{ data: likes }, { data: saves }] = await Promise.all([
          c.from('likes').select('video_id').eq('user_id', me).in('video_id', ids),
          c.from('saves').select('video_id').eq('user_id', me).in('video_id', ids),
        ]);
        const likeSet = new Set((likes || []).map(r => r.video_id));
        const saveSet = new Set((saves || []).map(r => r.video_id));
        data.forEach(v => {
          if (v.liked == null) v.liked = likeSet.has(v.id);
          if (v.saved == null) v.saved = saveSet.has(v.id);
        });
      })());
    }

    // Which of these creators I follow - one query for the whole page. The
    // feed used to ask once PER CARD after it had drawn (isFollowing), so a
    // page of twenty clips cost up to twenty more trips before every Follow
    // button was right.
    if (me && data && data.length && data.some(v => v.following == null)) {
      lookups.push((async () => {
        try {
          const creators = Array.from(new Set(data.filter(v => v.following == null && v.user && v.user.id).map(v => v.user.id)));
          if (!creators.length) return;
          const { data: rows } = await c.from('follows').select('followed_id').eq('follower_id', me).in('followed_id', creators);
          const followed = new Set((rows || []).map(r => r.followed_id));
          data.forEach(v => { if (v.following == null && v.user) v.following = followed.has(v.user.id); });
        } catch (e) { /* the per-card lookup still exists as a last resort */ }
      })());
    }
    if (lookups.length) await Promise.all(lookups);
    if (!me && data) data.forEach(v => { if (v.liked == null) v.liked = false; if (v.saved == null) v.saved = false; });
    return data || [];
  };

  // The feed is the most expensive read in the app — four or five round
  // trips — and the one you return to most, so it gets stale-while-
  // revalidate: the cached page paints instantly and a refresh runs behind
  // it. Pass onFresh to repaint if the refreshed feed actually differs.
  //
  // Only page one is cached. Paging further is always live, or the cache
  // key would have to track scroll position to no benefit.
  API.fetchFeed = async (opts = {}) => {
    const { tab = 'foryou', limit = 20, offset = 0, onFresh, cachedOk = false } = opts;
    if (offset > 0) return _fetchFeedRaw({ tab, limit, offset });
    // cachedOk: whatever is cached will do, however old. The comments
    // screen draws the feed as scenery under its sheet, and that used to
    // cost a full feed call whenever the cache was over 30 s old. It still
    // fetches when nothing is cached at all - a cold deep link straight
    // into comments.
    return swr('feed:' + tab + ':' + limit, cachedOk ? Infinity : 30000,
      () => _fetchFeedRaw({ tab, limit, offset }), onFresh);
  };

  // ---------- Original sounds ----------
  // An "original sound" is the audio of someone's own video. No licensing is
  // involved, which is why this is the only kind of sound the app creates.

  // audioUrl points at the origin video file. Browsers happily play just the
  // audio track of an mp4 through an <audio> element, so this makes the sound
  // playable without extracting a separate audio file.
  API.createOriginalSound = async ({ videoId, title, coverUrl = null, duration = 30, audioUrl = null }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { data: prof } = await c.from('profiles').select('name, handle').eq('id', me).maybeSingle();
    const author = (prof && (prof.name || prof.handle)) || '';
    const { data, error } = await c.from('sounds').insert({
      title: title || 'صوت أصلي',
      author_name: author,
      cover_url: coverUrl,
      audio_url: audioUrl,
      duration: Math.max(1, Math.round(duration || 30)),
      created_by: me,
      origin_video_id: videoId || null,
      is_original: true,
    }).select().single();
    if (error) throw error;
    return data;
  };

  API.fetchSound = async (soundId) => {
    const c = await client();
    // The creator join needs sounds.created_by, added in migration 0023. Fall
    // back to a plain read so the page still works before that is applied.
    const withCreator = await c.from('sounds')
      .select('*, creator:profiles!sounds_created_by_fkey ( id, name, handle, avatar_url )')
      .eq('id', soundId).maybeSingle();
    if (!withCreator.error) return withCreator.data || null;
    const { data, error } = await c.from('sounds').select('*').eq('id', soundId).maybeSingle();
    if (error) throw error;
    return data || null;
  };

  API.fetchSoundVideos = async (soundId, limit = 60) => {
    const c = await client();
    const { data, error } = await c.from('videos')
      .select('id, description, thumbnail, video_url, likes_count, created_at')
      .eq('sound_id', soundId).eq('is_draft', false).eq('is_hidden', false)
      .order('likes_count', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  };

  API.isSoundFavorited = async (soundId) => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { count } = await c.from('sound_favorites')
      .select('*', { count: 'exact', head: true }).eq('user_id', me).eq('sound_id', soundId);
    return (count || 0) > 0;
  };

  API.favoriteSound = async (soundId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('sound_favorites').insert({ user_id: me, sound_id: soundId });
    if (error && error.code !== '23505') throw error;
  };

  API.unfavoriteSound = async (soundId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('sound_favorites').delete().eq('user_id', me).eq('sound_id', soundId);
    if (error) throw error;
  };

  API.fetchSounds = async () => {
    const c = await client();
    const { data, error } = await c.from('sounds').select('*').order('usage_count', { ascending: false }).limit(50);
    if (error && error.code !== 'PGRST116') return [];
    return data || [];
  };

  // Trending hashtags for Discover — real counts, maintained by the
  // sync_hashtags trigger (0016_live_chat_hashtags.sql).
  // ---------- Hashtags ----------
  // Lookups go through the video_hashtags join table (migration 0025), so a
  // tag match is exact and indexed. The old path was a LIKE over captions,
  // which also matched #travelling when you asked for #travel.
  API.fetchHashtag = async (tag) => {
    const c = await client();
    const clean = String(tag || '').replace(/^#/, '').toLowerCase();
    const { data } = await c.from('hashtags').select('*').eq('tag', clean).maybeSingle();
    return data || { tag: clean, usage_count: 0 };
  };

  API.fetchHashtagVideos = async (tag, limit = 60) => {
    const c = await client();
    const clean = String(tag || '').replace(/^#/, '').toLowerCase();
    const link = await c.from('video_hashtags').select('video_id').eq('tag', clean).limit(limit);
    if (link.error) {
      // Before 0025 is applied there is no join table - fall back to the old
      // caption search so the page still works.
      const { data } = await c.from('videos')
        .select('id, description, thumbnail, video_url, likes_count, created_at')
        .ilike('description', '%#' + clean + '%').eq('is_draft', false).limit(limit);
      return data || [];
    }
    const ids = (link.data || []).map(r => r.video_id);
    if (!ids.length) return [];
    const { data, error } = await c.from('videos')
      .select('id, description, thumbnail, video_url, likes_count, views_count, created_at')
      .in('id', ids).eq('is_draft', false).eq('is_hidden', false)
      .order('likes_count', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  API.fetchTrendingHashtags = async (limit = 8) => {
    const c = await client();
    const { data, error } = await c.from('hashtags')
      .select('tag, usage_count').order('usage_count', { ascending: false }).limit(limit);
    if (error) return [];
    return data || [];
  };

  // Suggested creators for Discover (most-followed, excluding yourself and
  // anyone either of you has blocked).
  //
  // This is where the bug was most visible: the row is ordered by follower
  // count, so a blocked account with a large following sat near the top of
  // Discover permanently, no matter how many times you blocked them.
  API.fetchSuggestedProfiles = async (limit = 12) => {
    const c = await client();
    const { data, error } = await c.rpc('suggested_profiles', { p_limit: limit });
    if (!error) return data || [];
    console.warn('suggested_profiles unavailable (is 0065 applied?):', error.message);
    const me = await uid();
    let q = c.from('profiles')
      .select('id, name, handle, avatar_url, bio, verified, followers_count')
      .order('followers_count', { ascending: false }).limit(limit);
    if (me) q = q.neq('id', me);
    const r = await q;
    if (r.error) return [];
    return _withoutBlocked(r.data || []);
  };

  // Popular videos grid on Discover — most-engaged public videos.
  API.fetchPopularVideos = async (limit = 12) => {
    const c = await client();
    const { data, error } = await c.from('videos').select(`
      id, description, thumbnail, video_url, likes_count, comments_count, views_count, created_at,
      user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url )
    `).eq('is_draft', false).eq('privacy', 'public').eq('is_hidden', false)
      .order('likes_count', { ascending: false }).limit(limit);
    if (error) return [];
    return data || [];
  };

  // Videos the given user liked — backs the "Liked" tab on a profile.
  API.fetchLikedVideos = async (userId) => {
    const c = await client();
    const target = userId || await uid();
    if (!target) return [];
    const { data, error } = await c.from('likes').select(`
      created_at,
      video:videos!likes_video_id_fkey (
        id, description, thumbnail, video_url, likes_count, created_at,
        user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url )
      )
    `).eq('user_id', target).order('created_at', { ascending: false }).limit(60);
    if (error) throw error;
    return (data || []).map(r => r.video).filter(Boolean);
  };

  // Videos the current user saved — backs the "Saved" tab. Saves are
  // private, so this is always the signed-in user's own list.
  API.fetchSavedVideos = async () => {
    const c = await client(); const me = await uid();
    if (!me) return [];
    const { data, error } = await c.from('saves').select(`
      created_at,
      video:videos!saves_video_id_fkey (
        id, description, thumbnail, video_url, likes_count, created_at,
        user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url )
      )
    `).eq('user_id', me).order('created_at', { ascending: false }).limit(60);
    if (error) throw error;
    return (data || []).map(r => r.video).filter(Boolean);
  };

  // People you can share a video to: existing DM threads first, then
  // people you follow. Replaces the fake contacts list on the share screen.
  // Who you can send something to, in the order you are most likely to want.
  //
  // This used to return only the accounts you follow, so someone who follows
  // you but whom you have not followed back could not be sent anything, and
  // the list came back in whatever order the database produced — the person
  // you message constantly sat at the bottom.
  //
  // Order is: people you have messaged most recently, then mutuals, then
  // everyone else. Recency comes from existing conversations rather than a
  // new "recently shared" table — the people you last talked to are the ones
  // you are about to share with, and it needs no extra schema.
  API.fetchShareTargets = async () => {
    const c = await client(); const me = await uid();
    if (!me) return [];

    const [followingRes, followerRes] = await Promise.all([
      c.from('follows').select('profile:profiles!follows_followed_id_fkey ( id, name, handle, avatar_url )')
        .eq('follower_id', me).limit(200),
      c.from('follows').select('profile:profiles!follows_follower_id_fkey ( id, name, handle, avatar_url )')
        .eq('followed_id', me).limit(200),
    ]);

    const following = (followingRes.data || []).map(r => r.profile).filter(Boolean);
    const followers = (followerRes.data || []).map(r => r.profile).filter(Boolean);

    const followingIds = new Set(following.map(p => p.id));
    const byId = new Map();
    following.forEach(p => byId.set(p.id, { ...p, _mutual: false }));
    followers.forEach(p => {
      if (byId.has(p.id)) byId.get(p.id)._mutual = true;      // both directions
      else byId.set(p.id, { ...p, _mutual: false });
    });

    // Recency from existing DM threads. Best effort — an ordering nicety
    // should never be the reason the share sheet comes back empty.
    const recency = new Map();
    try {
      const chats = await API.fetchChats();
      (chats || []).forEach((ch, i) => {
        if (ch.type === 'group') return;
        const other = (ch.others || [])[0];
        if (!other || recency.has(other.id)) return;
        recency.set(other.id, i);                              // fetchChats is newest-first
      });
    } catch (e) { console.warn('share target recency unavailable:', e); }

    const rank = (p) => {
      if (recency.has(p.id)) return [0, recency.get(p.id)];    // talked to recently
      if (p._mutual) return [1, 0];                            // follow each other
      if (followingIds.has(p.id)) return [2, 0];               // you follow them
      return [3, 0];                                           // they follow you
    };

    return Array.from(byId.values()).sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || (a.name || '').localeCompare(b.name || '');
    });
  };

  // Actually sends a video to the chosen people as a DM containing its
  // deep link. The share screen previously just showed "Sent ✓" and did
  // nothing. Returns the number of recipients successfully sent to.
  // Sends any link to a set of people as a DM. Split out of shareVideoTo so
  // a profile can be shared the same way a video is, through the same screen,
  // rather than a profile only ever being copyable to the clipboard.
  API.shareLinkTo = async (link, userIds) => {
    if (!link || !userIds || !userIds.length) return 0;
    // Sent in parallel. This used to be a sequential for-await loop, so each
    // recipient cost two round trips one after another — sharing to ten
    // people meant twenty in a row, around four seconds of the person
    // watching a "sending..." label for work the network could have done at
    // once. Recipients are independent, so there is no reason to queue them.
    //
    // allSettled rather than all: one failed recipient must not abandon the
    // rest, and the count returned is what actually got through.
    const results = await Promise.allSettled(userIds.map(async (userId) => {
      const chatId = await API.openOrCreateDm(userId);
      await API.sendMessage({ chatId, text: link });
    }));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.warn('share to', userIds[i], 'failed:', r.reason && r.reason.message);
      }
    });
    return results.filter(r => r.status === 'fulfilled').length;
  };

  API.shareVideoTo = async (videoId, userIds) => {
    if (!videoId || !userIds || !userIds.length) return 0;
    const link = (window.DeepLink && window.DeepLink.videoLink(videoId)) || String(videoId);
    const sent = await API.shareLinkTo(link, userIds);
    // Only a video has a share counter to bump.
    if (sent) { try { await API.countShare(videoId); } catch (e) {} }
    return sent;
  };

  API.shareProfileTo = async (userId, userIds) => {
    if (!userId || !userIds || !userIds.length) return 0;
    const link = (window.DeepLink && window.DeepLink.profileLink(userId)) || String(userId);
    return API.shareLinkTo(link, userIds);
  };

  // Increments a video's share counter.
  API.countShare = async (videoId) => {
    const c = await client();
    const { error } = await c.rpc('increment_share_count', { p_video_id: videoId });
    if (error) console.warn('countShare failed:', error.message);
  };

  // ---------- People search ----------
  //
  // Everyone who looks up a person goes through _searchPeople, so blocking is
  // applied in ONE place rather than being remembered at each call site.
  //
  // The old query was `.or(name.ilike, handle.ilike)` straight against
  // profiles. That gets one direction of blocking for free from 0054's row
  // policy — the person who blocked you is hidden from you — and misses the
  // other completely: someone YOU blocked kept coming back in your own
  // results. search_profiles (0065) filters both directions in the database.
  //
  // Why the RPC and not a stricter policy: the Blocked Users screen has to
  // keep seeing the people you blocked, or you could never unblock them, and
  // a row policy cannot tell the two situations apart. The long comment at
  // the top of 0065 has the full reasoning.
  // The people YOU have blocked, cached for a minute.
  //
  // Only that direction, because the `blocks read own` policy (0004) is
  // `auth.uid() = blocker_id` — the rows where someone blocked YOU are not
  // readable from here and asking for them would return an empty half. That
  // direction needs no help anyway: 0054 hides those profiles from you at the
  // policy level, so they are already absent from anything that joins
  // profiles.
  const _blockedIds = async () => {
    try {
      return await cached('blockedids', 60000, async () => {
        const c = await client(); const me = await uid();
        if (!me) return [];
        const { data } = await c.from('blocks').select('blocked_id').eq('blocker_id', me);
        return (data || []).map(r => r.blocked_id);
      });
    } catch (e) { return []; }
  };

  // Only ever used to patch up a fallback path. This is a cosmetic filter and
  // is written down as one: it covers the window between shipping this build
  // and running 0065, and nothing that has to HOLD is resting on it.
  const _withoutBlocked = async (rows) => {
    if (!rows || !rows.length) return rows || [];
    const ids = new Set(await _blockedIds());
    if (!ids.size) return rows;
    return rows.filter(r => r && !ids.has(r.id));
  };

  const _searchPeople = async (query, limit) => {
    const q = String(query || '').trim();
    if (!q) return [];
    const c = await client();
    const { data, error } = await c.rpc('search_profiles', { p_query: q, p_limit: limit });
    if (!error) return data || [];
    console.warn('search_profiles unavailable (is 0065 applied?):', error.message);
    const term = `%${q.replace(/[%_]/g, '\\$&')}%`;
    const r = await c.from('profiles')
      .select('id, name, handle, avatar_url, bio, verified, followers_count')
      .or(`name.ilike.${term},handle.ilike.${term}`).limit(limit);
    return _withoutBlocked(r.data || []);
  };

  API.searchAll = async (query) => {
    const c = await client();
    const term = `%${query.replace(/[%_]/g, '\\$&')}%`;
    // Hashtags are searched as first-class results. Discover advertises
    // trending tags on its own front page, and typing one of them found the
    // ACCOUNT with a similar name and never the tag - so '#city', with six
    // videos behind it, was reachable by tapping a trending chip and by no
    // other route. The leading '#' is stripped so both '#city' and 'city'
    // work.
    const tagTerm = `%${query.replace(/^#/, '').replace(/[%_]/g, '\$&')}%`;
    const [profiles, videosRes, soundsRes, tagsRes] = await Promise.all([
      _searchPeople(query, 20),
      c.from('videos').select('id, description, thumbnail, video_url, likes_count, created_at, user:profiles!videos_user_id_fkey(id,name,handle,avatar_url)').ilike('description', term).eq('is_draft', false).limit(20),
      c.from('sounds').select('*').or(`title.ilike.${term},author_name.ilike.${term}`).limit(20),
      c.from('hashtags').select('tag, usage_count').ilike('tag', tagTerm).order('usage_count', { ascending: false }).limit(12),
    ]);
    return {
      hashtags: (tagsRes && tagsRes.data) || [],
      profiles: profiles || [],
      // Videos already obey blocking: can_see_posts_of (0049) refuses across
      // a block in either direction, and the videos policy goes through it.
      videos: videosRes.data || [],
      sounds: soundsRes.data || [],
    };
  };

  // Single video by id — used by deep links (/v/<id>) to pin a shared
  // video to the top of the feed.
  API.fetchVideo = async (videoId) => {
    const c = await client();
    const { data, error } = await c.from('videos').select(`
      id, description, music, sound_id, video_url, thumbnail, privacy,
      likes_count, comments_count, shares_count, views_count, created_at,
      user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url, verified )
    `).eq('id', videoId).maybeSingle();
    if (error) throw error;
    return data || null;
  };

  // Your own drafts. The publish screen has always offered "حفظ كمسودة" and
  // the row was written correctly with is_draft = true — but nothing ever read
  // it back. fetchUserVideos() filters is_draft = false, so a saved draft
  // disappeared the moment it was saved, with no list, no route and no way to
  // reach it again. The button did not fail; it swallowed the work.
  //
  // Not cached: you arrive here straight after saving one, and a stale list
  // would look exactly like the bug this fixes.
  API.fetchDrafts = async () => {
    const me = await uid();
    if (!me) return [];
    const c = await client();
    const { data, error } = await c.from('videos')
      .select('id, description, thumbnail, video_url, likes_count, created_at')
      .eq('user_id', me).eq('is_draft', true).eq('is_archived', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  // Turning a draft into a post. Only flips the flag — the file, the caption
  // and the sound were all settled when the draft was saved.
  API.publishDraft = async (videoId) => {
    const c = await client();
    const { data, error } = await c.from('videos')
      .update({ is_draft: false }).eq('id', videoId).select('id');
    if (error) throw error;
    if (!data || !data.length) throw new Error('تعذر نشر المسودة');
    invalidate('uservideos:');
    invalidate('feed:');
    return true;
  };

  API.fetchUserVideos = async (userId) => {
    if (!userId) return [];
    return cached('uservideos:' + userId, 60000, async () => {
      const c = await client();
      // Pinned videos sit at the top of the grid, newest first within each group.
      const { data, error } = await c.from('videos')
        .select('id, description, thumbnail, video_url, likes_count, created_at, is_pinned')
        .eq('user_id', userId).eq('is_draft', false).eq('is_archived', false)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    });
  };

  // Pin / unpin one of your own videos. The 3-per-user cap is enforced by a
  // database trigger, so this surfaces that error rather than guessing.
  API.setVideoPinned = async (videoId, pinned) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('videos')
      .update({ is_pinned: !!pinned }).eq('id', videoId).eq('user_id', me);
    if (error) {
      if (/pin limit reached/i.test(error.message || '')) throw new Error('يمكنك تثبيت 3 فيديوهات كحد أقصى');
      throw error;
    }
  };

  // ---------- Likes / Saves ----------
  API.like = async (videoId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('likes').insert({ user_id: me, video_id: videoId });
    if (error && error.code !== '23505') throw error;
    // Removed: `await c.rpc('noop')`. It was left here as a placeholder and
    // did nothing except spend a whole round trip on every like — the counts
    // it referred to are maintained by a database trigger.
    _patchVideoFlag(videoId, 'liked', true);
    return true;
  };

  API.unlike = async (videoId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('likes').delete().eq('user_id', me).eq('video_id', videoId);
    if (error) throw error;
    _patchVideoFlag(videoId, 'liked', false);
    return true;
  };

  API.save = async (videoId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('saves').upsert({ user_id: me, video_id: videoId });
    if (error) throw error;
    _patchVideoFlag(videoId, 'saved', true);
    _patchVideoCount(videoId, 'saves_count', 1);
    invalidate('savedvideos');
    return true;
  };

  API.unsave = async (videoId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('saves').delete().eq('user_id', me).eq('video_id', videoId);
    if (error) throw error;
    _patchVideoFlag(videoId, 'saved', false);
    _patchVideoCount(videoId, 'saves_count', -1);
    invalidate('savedvideos');
    return true;
  };

  // ---------- Comments ----------
  API.fetchComments = async (videoId) => {
    const c = await client(); const me = await uid();
    const { data, error } = await c.from('comments').select(`
      id, text, likes_count, created_at, user_id,
      user:profiles!comments_user_id_fkey ( id, name, handle, avatar_url )
    `).eq('video_id', videoId).order('created_at', { ascending: false });
    if (error) throw error;
    let rows = data || [];
    if (!me) return rows;

    // Hidden words and Restrict are per-viewer, so they are applied here
    // rather than in a database policy.
    try {
      const [words, restricted] = await Promise.all([
        API.fetchHiddenWords(),
        API.fetchRestricted(),
      ]);
      const restrictedIds = new Set((restricted || []).map(r => r && r.id).filter(Boolean));
      if (restrictedIds.size) {
        // A restricted person still sees their own comment, so it looks
        // normal to them - that is the whole point of Restrict.
        rows = rows.filter(r => !restrictedIds.has(r.user_id) || r.user_id === me);
      }
      if ((words || []).length) {
        const list = words.map(w => String(w).toLowerCase());
        rows = rows.filter(r => {
          const t = String(r.text || '').toLowerCase();
          return !list.some(w => w && t.includes(w));
        });
      }
    } catch (e) { /* filters are best-effort - never hide the whole thread */ }

    // Which of these you have liked. One query for the whole thread, keyed on
    // the ids actually being rendered, rather than a request per row.
    try {
      const ids = rows.map(r => r.id).filter(Boolean);
      if (ids.length) {
        const { data: mine } = await c.from('comment_likes')
          .select('comment_id').eq('user_id', me).in('comment_id', ids);
        const liked = new Set((mine || []).map(r => r.comment_id));
        rows = rows.map(r => Object.assign({}, r, { liked: liked.has(r.id) }));
      }
    } catch (e) { /* the thread still renders; hearts just start empty */ }
    return rows;
  };

  // ── Liking a comment ──
  // comments.likes_count is maintained by a trigger (0072), so nothing here
  // touches it; re-reading the row would race the trigger anyway. The screen
  // paints optimistically and reverts on failure, the same as video likes.
  API.likeComment = async (commentId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('comment_likes').insert({ comment_id: commentId, user_id: me });
    // Liking twice is not an error worth surfacing - the end state is what the
    // person asked for either way.
    if (error && error.code !== '23505') throw error;
  };

  API.unlikeComment = async (commentId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('comment_likes')
      .delete().eq('comment_id', commentId).eq('user_id', me);
    if (error) throw error;
  };

  // A verdict that lands after the row is already in the database. Used by the
  // comment paths, which insert first so the author is not left watching a
  // frozen box for the length of a model call.
  //
  // Best-effort by design, in both halves. If the delete is refused the comment
  // simply stands - the same fail-open promise moderation makes everywhere
  // else, and far better than a half-removed comment. The DOM removal and the
  // toast are what the author actually perceives, so they run whether or not
  // the delete succeeded.
  async function withdraw(c, table, id, selector, message) {
    try {
      await c.from(table).delete().eq('id', id);
    } catch (e) {
      console.warn('[Moderation] could not withdraw', table, id, e && e.message);
    }
    try {
      if (selector) document.querySelectorAll(selector).forEach(n => n.remove());
      if (window.H && window.H.toast) window.H.toast(message || 'لا يمكن نشر هذا التعليق');
    } catch (e) { /* nothing left to do */ }
  }

  API.postComment = async (videoId, text) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');

    // Comments are the highest-volume public surface in the app, so this is the
    // check that earns its keep. It runs ALONGSIDE the insert rather than in
    // front of it.
    //
    // It used to be awaited first, on the assumption - written into the comment
    // that was here - that it ran "normally well under a second". Measured
    // against Gemini it is 1.3-2.7s, so posting a comment froze the box for
    // roughly two and a half seconds: the most-used action in the app, and the
    // place the gap to Instagram shows most.
    //
    // The exposure that trades away is smaller than it looks. Screening first
    // only kept a violating comment private until the insert finished; now it
    // is visible from the insert until the verdict lands, on the order of a
    // second. In exchange the author sees their comment at insert speed. A
    // blocked comment is withdrawn, removed from the open sheet, and its author
    // told - the same outcome, arriving a moment later.
    const screening = window.Moderation
      ? window.Moderation.checkText('comment', text).catch(() => null)
      : null;

    const { data, error } = await c.from('comments').insert({ video_id: videoId, user_id: me, text }).select(`
      id, text, likes_count, created_at,
      user:profiles!comments_user_id_fkey ( id, name, handle, avatar_url )
    `).single();
    if (error) throw error;

    // Deliberately not awaited: the caller gets its row now.
    if (screening) screening.then(verdict => {
      if (!verdict || !data || !data.id) return;
      if (!verdict.blocked) { window.Moderation.attach(verdict, 'comment', data.id); return; }
      withdraw(c, 'comments', data.id, '.comment-row[data-comment-id="' + data.id + '"]', verdict.message);
    });
    return data;
  };

  API.deleteComment = async (id) => {
    const c = await client();
    const { error } = await c.from('comments').delete().eq('id', id);
    if (error) throw error;
  };

  // ---------- Follows ----------
  // Returns 'following' or 'requested'. A private account turns a follow into
  // a request, so the caller must render the button from what came back rather
  // than assuming it worked.
  // Every write below drops the keys it could have made stale. A cache that
  // keeps serving the old answer after you act on it is worse than no cache:
  // it turns a slow app into one that looks broken.
  function _invalidateFollowGraph(otherId) {
    invalidate('profile:' + otherId);       // their follower count moved
    invalidate('isfollowing:' + otherId);   // the button's own state
    invalidate('following:');
    invalidate('followers:');
    invalidate('sharetargets:');
    invalidate('feed:');                    // the Following tab composition changed
  }

  API.follow = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    if (me === userId) return 'following';
    const { data, error } = await c.rpc('follow_or_request', { p_target: userId });
    if (!error) { _invalidateFollowGraph(userId); if (me) invalidate('profile:' + me); return data || 'following'; }
    // Before 0030 the function does not exist; the plain insert still works.
    if (error.code === 'PGRST202' || /function .*follow_or_request/i.test(error.message || '')) {
      const { error: e2 } = await c.from('follows').insert({ follower_id: me, followed_id: userId });
      if (e2 && e2.code !== '23505') throw e2;
      _invalidateFollowGraph(userId); invalidate('profile:' + me);
      return 'following';
    }
    throw error;
  };

  API.hasRequestedFollow = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { data, error } = await c.from('follow_requests')
      .select('target_id').eq('requester_id', me).eq('target_id', userId).maybeSingle();
    if (error) return false;
    return !!data;
  };

  API.cancelFollowRequest = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('follow_requests')
      .delete().eq('requester_id', me).eq('target_id', userId);
    if (error) throw error;
  };

  API.fetchFollowRequests = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('follow_requests')
      .select('requester_id, created_at, profiles:profiles!follow_requests_requester_id_fkey(id,name,handle,avatar_url,verified)')
      .eq('target_id', me).order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(r => r.profiles ? Object.assign({}, r.profiles, { requested_at: r.created_at }) : null).filter(Boolean);
  };

  API.countFollowRequests = async () => {
    const c = await client(); const me = await uid(); if (!me) return 0;
    const { count, error } = await c.from('follow_requests')
      .select('*', { count: 'exact', head: true }).eq('target_id', me);
    if (error) return 0;
    return count || 0;
  };

  API.approveFollowRequest = async (requesterId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.rpc('approve_follow_request', { p_requester: requesterId });
    if (error) throw error;
  };

  API.declineFollowRequest = async (requesterId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('follow_requests')
      .delete().eq('requester_id', requesterId).eq('target_id', me);
    if (error) throw error;
  };

  API.unfollow = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('follows').delete().eq('follower_id', me).eq('followed_id', userId);
    if (error) throw error;
    _invalidateFollowGraph(userId);
    invalidate('profile:' + me);
    return true;
  };

  API.isFollowing = async (userId) => {
    if (!userId) return false;
    return cached('isfollowing:' + userId, 60000, async () => {
      const c = await client(); const me = await uid(); if (!me) return false;
      const { data, error } = await c.from('follows').select('followed_id').eq('follower_id', me).eq('followed_id', userId).maybeSingle();
      if (error) return false;
      return !!data;
    });
  };

  // Goes through list_followers (0055) rather than querying follows directly.
  //
  // 0054 made a follow row visible only when both people in it are visible to
  // you, which is stricter than intended: a private account following a
  // PUBLIC one vanished from that public account's follower list, so a
  // profile could read "1 follower" above an empty list.
  //
  // A row policy cannot fix that — it sees one row and cannot know whose list
  // is being asked for. The function takes the subject explicitly, checks
  // once whether you may see THAT person's lists, and returns them.
  API.fetchFollowers = async (userId) => {
    if (!userId) return [];
    return cached('followers:' + userId, 60000, async () => {
      const c = await client();
      const { data, error } = await c.rpc('list_followers', { p_user: userId });
      if (error) throw error;
      return data || [];
    });
  };

  // Same reasoning as fetchFollowers above — see 0055.
  API.fetchFollowing = async (userId) => {
    if (!userId) return [];
    return cached('following:' + userId, 60000, async () => {
      const c = await client();
      const { data, error } = await c.rpc('list_following', { p_user: userId });
      if (error) throw error;
      return data || [];
    });
  };

  // ---------- Profile by id ----------
  // Gender / country live in their own table because
  // public.profiles is world-readable (anon included) - see migration 0022.
  API.fetchMyPrivateDetails = async () => {
    const c = await client(); const me = await uid(); if (!me) return null;
    const { data, error } = await c.from('user_private').select('*').eq('user_id', me).maybeSingle();
    if (error) throw error;
    return data || null;
  };

  // ---------- Age ----------
  // The birthday is written once at signup and cannot be edited afterwards
  // (a database trigger enforces that), because it is what the 18+ location
  // gate reads.
  API.saveBirthDate = async (isoDate) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('user_private')
      .upsert({ user_id: me, birth_date: isoDate }, { onConflict: 'user_id' });
    if (error) {
      if (/minimum age/i.test(error.message || '')) {
        throw new Error('يجب أن يكون عمرك 13 عامًا على الأقل');
      }
      if (/cannot be changed/i.test(error.message || '')) {
        throw new Error('لا يمكن تغيير تاريخ الميلاد');
      }
      throw error;
    }
  };

  API.getMyBirthDate = async () => {
    const c = await client(); const me = await uid(); if (!me) return null;
    const { data, error } = await c.from('user_private')
      .select('birth_date').eq('user_id', me).maybeSingle();
    if (error) return null;
    return (data && data.birth_date) || null;
  };

  API.isAdult = async () => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { data, error } = await c.rpc('is_adult', { p_user: me });
    if (error) return false;   // migration not applied yet - treat as not proven
    return data === true;
  };

  API.saveMyPrivateDetails = async ({ gender = null, country = null }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('user_private')
      .upsert({ user_id: me, gender, country }, { onConflict: 'user_id' });
    if (error) throw error;
  };

  // Opened constantly (every profile visit, every follow re-read) and it
  // barely changes, so a short TTL removes most of those round trips.
  API.fetchProfile = async (userId) => {
    if (!userId) return null;
    return cached('profile:' + userId, 60000, async () => {
      const c = await client();
      const { data, error } = await c.from('profiles').select('*').eq('id', userId).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    });
  };

  // Used by the new-message picker and the in-list search on followers /
  // following. Shares _searchPeople with the main search screen so a blocked
  // account cannot reappear through the one that was forgotten.
  API.searchProfiles = async (q) => _searchPeople(q, 30);

  // ---------- Chats ----------
  // Details for ONE chat (title + photo + members). V.chat only ever fetched
  // messages, so the header name/avatar were never populated outside demo mode.
  API.fetchChatInfo = async (chatId) => {
    const c = await client(); const me = await uid();
    const [{ data: chat }, { data: members }] = await Promise.all([
      c.from('chats').select('id, type, name, photo_url').eq('id', chatId).maybeSingle(),
      c.from('chat_members').select('user_id, profiles:profiles!chat_members_user_id_fkey(id, name, handle, avatar_url)').eq('chat_id', chatId),
    ]);
    const others = (members || []).filter(m => m.user_id !== me).map(m => m.profiles).filter(Boolean);
    const isGroup = chat && chat.type === 'group';
    return {
      id: chatId,
      type: (chat && chat.type) || 'dm',
      others,
      memberCount: (members || []).length,
      title: isGroup ? ((chat && chat.name) || 'مجموعة') : ((others[0] && others[0].name) || (others[0] && others[0].handle) || 'محادثة'),
      photo: isGroup ? ((chat && chat.photo_url) || '') : ((others[0] && others[0].avatar_url) || ''),
    };
  };

  const _fetchChatsRaw = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data: memberships } = await c.from('chat_members').select('chat_id').eq('user_id', me);
    const chatIds = (memberships || []).map(r => r.chat_id);
    if (!chatIds.length) return [];

    // All five reads go out together.
    //
    // This used to be three sequential steps after the membership lookup —
    // the chat/message/member batch, then unread counts, then request flags —
    // and each step costs a full round trip. Measured, the inbox took 765ms
    // against a 158ms baseline for the simplest possible query: roughly four
    // trips in a row, three of which were waiting on nothing.
    //
    // Neither RPC depends on the other reads; they only need chatIds, which
    // we already have. Issued together this is two trips instead of four.
    //
    // The RPCs are wrapped so one missing function cannot take the inbox down
    // with it: without 0041 there are no unread marks, without 0043 nothing
    // is a request, and the conversation list still loads either way.
    //
    // The blocked-id lookup rides along in the same batch for the same
    // reason: it is needed to filter the list below, and it depends on
    // nothing here, so making it wait would put back one of the round trips
    // this batch exists to remove.
    const [
      { data: chats }, { data: lastMsgs }, { data: members },
      unreadRes, flagsRes, blockedList,
    ] = await Promise.all([
      c.from('chats').select('id, type, name, photo_url, created_by, created_at').in('id', chatIds),
      c.from('messages').select('chat_id, text, type, from_user_id, created_at').in('chat_id', chatIds).order('created_at', { ascending: false }),
      c.from('chat_members').select('chat_id, user_id, profiles:profiles!chat_members_user_id_fkey(id, name, handle, avatar_url)').in('chat_id', chatIds),
      c.rpc('chat_unread_counts').then(r => r, e => ({ error: e })),
      c.rpc('chat_request_flags').then(r => r, e => ({ error: e })),
      _blockedIds(),
    ]);

    // Latest message per chat
    const lastByChat = {};
    (lastMsgs || []).forEach(m => { if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = m; });
    // Members per chat (excluding me — for DM display)
    const membersByChat = {};
    (members || []).forEach(m => {
      (membersByChat[m.chat_id] = membersByChat[m.chat_id] || []).push(m);
    });

    const unreadByChat = {};
    if (unreadRes && unreadRes.error) console.warn('unread counts unavailable (is 0041 applied?):', unreadRes.error);
    else (unreadRes && unreadRes.data || []).forEach(r => { unreadByChat[r.chat_id] = r.unread_count; });

    const requestByChat = {};
    if (flagsRes && flagsRes.error) console.warn('request flags unavailable (is 0043 applied?):', flagsRes.error);
    else (flagsRes && flagsRes.data || []).forEach(r => { requestByChat[r.chat_id] = !!r.is_request; });

    // Direct conversations with someone you have blocked drop out of the
    // inbox. 0049 already stops the messages — may_message_in_chat refuses
    // the insert — but the thread itself stayed in the list, so blocking
    // someone left their conversation sitting in your inbox looking live.
    //
    // Deliberately DMs only, matching 0049's decision to leave groups alone:
    // blocking one person should not remove you from a group other people are
    // still in. This one is a display choice about your own inbox, not a
    // boundary anyone is protected by, which is why it is fine for it to live
    // in the client while search moved to the server.
    const blocked = new Set(blockedList || []);

    return (chats || []).filter(c => {
      if (c.type === 'group' || !blocked.size) return true;
      const others = (membersByChat[c.id] || []).filter(m => m.user_id !== me);
      return !others.some(m => blocked.has(m.user_id));
    }).map(c => {
      const others = (membersByChat[c.id] || []).filter(m => m.user_id !== me).map(m => m.profiles);
      const last = lastByChat[c.id];
      return {
        ...c,
        others,
        last_message: last,
        unread_count: unreadByChat[c.id] || 0,
        is_request: !!requestByChat[c.id],
        // An empty display name is falsy, so this used to fall through to the
        // literal word "Chat". Try the handle before giving up.
        title: c.type === 'group'
          ? (c.name || 'مجموعة')
          : ((others[0] && others[0].name) || (others[0] && others[0].handle) || 'محادثة'),
        avatar: c.type === 'group' ? c.photo_url : (others[0] && others[0].avatar_url),
      };
    }).sort((a, b) => new Date((b.last_message && b.last_message.created_at) || b.created_at) - new Date((a.last_message && a.last_message.created_at) || a.created_at));
  };

  // The inbox is opened constantly and this read costs several round trips
  // (memberships, chats, last messages, members, unread counts, request
  // flags). Served from the notepad first, refreshed behind — pass onFresh
  // to repaint when the refresh finds something new.
  API.fetchChats = async (opts = {}) =>
    swr('chats', 20000, _fetchChatsRaw, opts.onFresh);

  // Stamps "you have seen everything up to now" on your own membership row.
  // Called when a chat is opened; safe to call when 0041 is not applied yet.
  // When did the OTHER person last open this conversation? Backs the "Seen"
  // line under your own last message. The data has existed since 0041 and
  // nothing was showing it.
  //
  // Returns null for a group (there is no single other person) or when the
  // read state cannot be read, so the caller simply shows nothing.
  API.fetchOtherLastRead = async (chatId) => {
    try {
      const c = await client(); const me = await uid();
      if (!me || !chatId) return null;
      const { data, error } = await c.from('chat_members')
        .select('user_id, last_read_at')
        .eq('chat_id', chatId).neq('user_id', me);
      if (error || !data || data.length !== 1) return null;   // group, or unreadable
      return data[0].last_read_at || null;
    } catch (e) { return null; }
  };

  API.markChatRead = async (chatId) => {
    try {
      const c = await client(); const me = await uid();
      if (!me || !chatId) return;
      await c.rpc('mark_chat_read', { p_chat_id: chatId });
      invalidate('chats');   // the unread dot has gone
    } catch (e) { console.warn('mark_chat_read:', e); }
  };

  // Accepting moves a request into the inbox proper. Declining removes you
  // from the conversation — deliberately silent, so a stranger learns nothing.
  API.acceptChatRequest = async (chatId) => {
    const c = await client(); const me = await uid();
    if (!me || !chatId) return;
    const { error } = await c.rpc('accept_chat_request', { p_chat_id: chatId });
    if (error) throw error;
    invalidate('chats');
  };

  API.declineChatRequest = async (chatId) => {
    const c = await client(); const me = await uid();
    if (!me || !chatId) return;
    const { error } = await c.rpc('decline_chat_request', { p_chat_id: chatId });
    if (error) throw error;
    invalidate('chats');
  };

  // One conversation per pair, decided in one statement by the database.
  //
  // This used to read the DMs it could see and create one if it found none -
  // a read, then a write, with nothing underneath to stop two of them. Two
  // people pressing Message at the same moment each saw no chat and each made
  // one, and then there were two conversations with the same person. It is
  // not theoretical: five such pairs existed, and every twin was created in
  // the SAME MINUTE as its sibling. 0093 merged them, gave a DM a key made of
  // its two members with a unique index over it, and put find-or-create in
  // open_or_create_dm, which runs as the definer - so it also cannot be
  // fooled by a chat the caller happens not to be allowed to see.
  API.openOrCreateDm = async (otherUserId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    if (otherUserId === me) throw new Error('cannot DM yourself');
    const { data, error } = await c.rpc('open_or_create_dm', { p_other: otherUserId });
    if (error) throw error;
    if (!data) throw new Error('could not open the conversation');
    return data;
  };

  API.createGroup = async ({ name, memberIds, photoFile }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');

    // NOT SCREENED, for the same reason as direct messages: a private group's
    // name and photo are private content, and the unpaid Gemini tier trains on
    // what it is sent. See the note in sendMessage. moderate-content refuses
    // kind 'group' outright as well.

    let photo_url = null;
    if (photoFile) {
      const ext = (photoFile.name.split('.').pop() || 'png').toLowerCase();
      const path = `${me}/group-${Date.now()}.${ext}`;
      // Immutable path, so a year rather than the one-hour default.
      const { error: upErr } = await c.storage.from('group-photos').upload(path, photoFile, { upsert: true, cacheControl: '31536000' });
      if (upErr) throw upErr;
      const { data: pub } = c.storage.from('group-photos').getPublicUrl(path);
      photo_url = pub.publicUrl;
    }

    const { data: chat, error: e1 } = await c.from('chats').insert({ type: 'group', name, photo_url, created_by: me }).select('id').single();
    if (e1) throw e1;

    const ids = Array.from(new Set([me, ...memberIds]));
    const rows = ids.map(u => ({ chat_id: chat.id, user_id: u, role: u === me ? 'owner' : 'member' }));
    const { error: e2 } = await c.from('chat_members').insert(rows);
    if (e2) throw e2;
    return chat.id;
  };

  // The reply target and the reactions are embedded rather than fetched per
  // message — a thread of 100 would otherwise be 200 extra round trips.
  // The reply target is addressed by its COLUMN (reply_to_id), not by a
  // foreign-key constraint name.
  //
  // This first read `messages!messages_reply_to_id_fkey`, guessing what
  // Postgres would name the self-reference. It is not called that, so every
  // fetch failed with "could not find a relationship between 'messages' and
  // 'messages'" and quietly fell back to the reply-less query — chat worked,
  // but replies and reactions silently did nothing at all. Naming the column
  // avoids depending on a generated constraint name entirely.
  const MSG_SELECT_FULL = `
      id, type, text, attachment_url, from_user_id, created_at, reply_to_id,
      from:profiles!messages_from_user_id_fkey ( id, name, avatar_url ),
      reply_to:reply_to_id (
        id, type, text, attachment_url, from_user_id,
        from:profiles!messages_from_user_id_fkey ( id, name )
      ),
      reactions:message_reactions ( user_id, emoji )
  `;
  const MSG_SELECT_BASIC = `
      id, type, text, attachment_url, from_user_id, created_at,
      from:profiles!messages_from_user_id_fkey ( id, name, avatar_url )
  `;

  API.fetchMessages = async (chatId, limit = 100) => {
    const c = await client();
    // NEWEST first, then reversed for display.
    //
    // This asked for the OLDEST hundred: ascending order with a limit. In any
    // conversation longer than the limit that means the most recent messages
    // are never fetched at all - opening the chat showed history and nothing
    // since. A real one: 117 messages, so 17 were invisible, and a voice note
    // sent into it produced a notification and an inbox preview (both of which
    // read the latest row by other routes) and then "nothing at all" in the
    // thread. It would have done the same to every text message, quietly, for
    // as long as that chat has been over a hundred messages long.
    //
    // catchUp() in the chat screen calls this too, so the safety net that is
    // supposed to recover messages a dropped websocket missed was re-reading
    // the same old hundred and finding nothing new, every time.
    const q = (sel) => c.from('messages').select(sel)
      .eq('chat_id', chatId).order('created_at', { ascending: false }).limit(limit);

    let { data, error } = await q(MSG_SELECT_FULL);
    if (error) {
      // Falls back when 0042 has not been applied — the reply column and the
      // reactions table simply are not there yet. The thread still loads,
      // just without replies or reactions, rather than failing outright.
      console.warn('messages: replies/reactions unavailable (is 0042 applied?)', error);
      ({ data, error } = await q(MSG_SELECT_BASIC));
      if (error) throw error;
    }
    // Back into reading order. The caller appends in sequence and every
    // consumer assumes oldest-to-newest.
    return (data || []).slice().reverse();
  };

  // Returns the emoji now standing, or null when the reaction was cleared.
  // Deleting your own message. The database has allowed this since 0018
  // ("messages delete own", using auth.uid() = from_user_id) — there was
  // simply no function and no UI, so the capability sat unused and people
  // could not take back something they had sent.
  //
  // The attachment is deliberately left in storage. Deriving its path from the
  // signed URL means parsing a URL to reconstruct a key, and getting that
  // wrong deletes somebody else's file. An orphaned attachment costs a little
  // space; a wrong delete costs data.
  API.deleteMessage = async (messageId) => {
    const c = await client();
    // .select() so the result says WHAT was deleted. Deleting a row the policy
    // hides does not raise — it removes nothing and reports success, so a
    // caller that only checks `error` would report a message as deleted while
    // it is still there, and it would reappear on the next load. Verified:
    // account B deleting account A's message lands here with zero rows.
    const { data, error } = await c.from('messages').delete().eq('id', messageId).select('id');
    if (error) throw error;
    if (!data || !data.length) throw new Error('لا يمكنك حذف هذه الرسالة');
    invalidate('chats');   // the preview line and the ordering both change
    return true;
  };

  API.toggleMessageReaction = async (messageId, emoji) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { data, error } = await c.rpc('toggle_message_reaction', {
      p_message_id: messageId, p_emoji: emoji,
    });
    if (error) throw error;
    return data || null;
  };

  API.sendMessage = async ({ chatId, text, type = 'text', file, replyToId = null }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');

    // ── A private conversation: NOT screened ──
    // Nothing in this function calls Moderation, and that is the whole point.
    // The provider is Gemini on its UNPAID tier, whose terms say Google may use
    // submitted content to improve their products and that "human reviewers may
    // read, annotate, and process" it. Sending people's private conversations
    // through that is a worse trade than the abuse it would catch — especially
    // when blocking and reporting already cover DMs, and Apple's Guideline 1.2
    // is about content users ENCOUNTER, not private correspondence between two
    // people who chose to talk.
    //
    // Removed at the CALL SITE on purpose. A `private: true` flag in the body
    // would still put the message on the wire to a server that has to be
    // trusted to drop it; not calling is the only version of this that cannot
    // regress silently. moderate-content ALSO refuses kind 'message' before it
    // builds a prompt — see PRIVATE_KINDS in its index.ts — which is what covers
    // a build already on a tester's phone that still sends one.
    //
    // Public surfaces are untouched and still screened: video captions and
    // frames, comments, live titles and covers, profile text and avatars.
    //
    // It also removes a ~400ms wait from every single message, which testers
    // reported as chat being slow.
    //
    // Revisit only if this moves to a paid tier, where Google states prompts
    // are not used to improve their products.

    const row = { chat_id: chatId, from_user_id: me, type, text };
    // Only sent when set, so this still works against a database without
    // 0042 applied — an unknown column would otherwise reject every message.
    if (replyToId) row.reply_to_id = replyToId;
    if (file) {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      // Sender's id FIRST, then the chat. This is not cosmetic: the storage
      // policy for chat-media is
      //   (storage.foldername(name))[1] = auth.uid()::text
      // so a path beginning with the chat id fails that check on every single
      // upload. Chat attachments — photos, videos, voice notes, files — have
      // never once succeeded; they returned "new row violates row-level
      // security policy" and the message went out with no attachment.
      //
      // user_uploads_today() reads the same first segment to count a person's
      // daily bytes, so chat media was also invisible to the quota. Owner-first
      // fixes both at once, and keeps the chat id in the filename so an object
      // can still be traced back to its conversation.
      const path = `${me}/${chatId}/${Date.now()}.${ext}`;
      const q = await API.uploadQuota();
      if (q && !q.allowed) throw new Error(API.quotaMessage(q));
      // Immutable path, so a year rather than the one-hour default.
      const { error: upErr } = await c.storage.from('chat-media').upload(path, file, { cacheControl: '31536000' });
      if (upErr) throw upErr;
      // Checked rather than assumed: without a SELECT policy on the bucket this
      // returns null, and reading .signedUrl off it threw "Cannot read
      // properties of null" — which looks like a client bug and is actually a
      // missing database policy.
      const { data: signed, error: signErr } = await c.storage
        .from('chat-media').createSignedUrl(path, 60 * 60 * 24 * 7);
      if (signErr || !signed || !signed.signedUrl) {
        throw new Error('تعذر تجهيز المرفق — تحقق من صلاحيات التخزين');
      }
      row.attachment_url = signed.signedUrl;
    }
    const { data, error } = await c.from('messages').insert(row).select().single();
    if (error) throw error;
    invalidate('chats');   // the preview line and the ordering both moved
    return data;
  };

  API.subscribeToMessages = (chatId, cb) => {
    let channel = null;
    (async () => {
      const c = await client();
      channel = c.channel(`messages:${chatId}`).on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}`,
      }, payload => cb(payload.new)).subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  };

  // ---------- Calls (signalling) ----------
  // Agora carries the audio/video, but it cannot make a phone ring. These
  // functions are that missing half: they tell the other person a call is
  // coming and let either side accept, decline or hang up. All of it works
  // without an Agora App ID.

  // ---------- Inbox, live ----------
  // Every new message in any chat this person belongs to - row-level
  // security filters the stream to member chats, so no filter is needed
  // here. The inbox refetches and repaints on each one, so a preview and an
  // unread dot move without the chat being opened; the tab badge does the
  // same. Reported: "only after I enter the chat can I see the new message".
  API.subscribeToInbox = (cb) => {
    let channel = null;
    (async () => {
      const c = await client(); const me = await uid(); if (!me) return;
      // Unique per subscription: the inbox screen AND the nav badge both call
      // this, and two channels with the same topic name make supabase-js
      // reject the second - so one of them silently never fired, which is why
      // the preview did not move until the chat was opened.
      channel = c.channel('inbox:' + me + ':' + Math.random().toString(36).slice(2)).on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
      }, payload => { invalidate('chats'); try { cb(payload.new); } catch (e) {} }).subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  };
  // Unread messages across all chats, for the tab badge.
  API.countUnreadChats = async () => {
    try {
      const c = await client(); const me = await uid(); if (!me) return 0;
      const { data, error } = await c.rpc('chat_unread_counts');
      if (error || !Array.isArray(data)) return 0;
      return data.reduce((n, r) => n + (Number(r.unread_count) || 0), 0);
    } catch (e) { return 0; }
  };
  API.startCall = async ({ calleeId, kind = 'audio', chatId = null }) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    if (calleeId === me) throw new Error('cannot call yourself');
    // Both sides need the same channel name, so settle it up front.
    const channel = 'call_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const { data, error } = await c.from('calls')
      .insert({ caller_id: me, callee_id: calleeId, kind, chat_id: chatId, channel, status: 'ringing' })
      .select().single();
    if (error) throw error;
    return data;
  };

  async function _setCallStatus(callId, status, extra) {
    const c = await client();
    const patch = Object.assign({ status }, extra || {});
    const { data, error } = await c.from('calls').update(patch).eq('id', callId).select().maybeSingle();
    if (error) throw error;
    return data;
  }

  API.acceptCall  = (callId) => _setCallStatus(callId, 'accepted', { answered_at: new Date().toISOString() });
  API.declineCall = (callId) => _setCallStatus(callId, 'declined', { ended_at: new Date().toISOString() });
  API.endCall     = (callId) => _setCallStatus(callId, 'ended',    { ended_at: new Date().toISOString() });
  API.missCall    = (callId) => _setCallStatus(callId, 'missed',   { ended_at: new Date().toISOString() });
  // A voice call turned into a video call, by either side. The other side's
  // screen hears about it through subscribeToCall; the call record in the
  // chat reads the kind at the end.
  API.setCallKind = async (callId, kind) => {
    const c = await client();
    const { data, error } = await c.from('calls').update({ kind }).eq('id', callId).select().maybeSingle();
    if (error) throw error;
    return data;
  };

  // ── Group calls (0092) ──
  // An invite is a calls row pointing at the ROOT call: the invitee's phone
  // rings like a direct call, and accepting opens a screen that joins the
  // root's channel. Membership (call_members) is written by triggers on
  // calls; the client writes only its own "I left" and its Agora uid.
  API.inviteToCall = async ({ root, userId }) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { data, error } = await c.from('calls')
      .insert({ caller_id: me, callee_id: userId, kind: root.kind, channel: root.channel, root_id: root.id, status: 'ringing' })
      .select().single();
    if (error) throw error;
    return data;
  };
  // The inviter giving up on a ring nobody answered - only while it is STILL
  // ringing, or an answered invite would be flagged missed.
  API.missCallIfRinging = async (callId) => {
    const c = await client();
    const { error } = await c.from('calls')
      .update({ status: 'missed', ended_at: new Date().toISOString() })
      .eq('id', callId).eq('status', 'ringing');
    if (error) throw error;
  };
  API.fetchCallMembers = async (channel) => {
    const c = await client();
    const { data, error } = await c.from('call_members')
      .select('*, profile:profiles!call_members_user_id_fkey ( id, name, handle, avatar_url )')
      .eq('channel', channel).order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  };
  // Every change to who is in the channel. Unique topic per subscription
  // (see subscribeToInbox for why).
  API.subscribeToCallMembers = (channel, cb) => {
    let ch = null;
    (async () => {
      const c = await client();
      ch = c.channel('call_members:' + channel + ':' + Math.random().toString(36).slice(2)).on('postgres_changes', {
        event: '*', schema: 'public', table: 'call_members', filter: `channel=eq.${channel}`,
      }, payload => cb(payload.new || payload.old)).subscribe();
    })();
    return () => { if (ch) ch.unsubscribe(); };
  };
  // "I left." True when there was a membership row to leave; false for a
  // call older than 0092, which the screen then ends the old way.
  API.leaveCall = async (channel) => {
    const c = await client();
    const { data, error } = await c.rpc('leave_call', { p_channel: channel });
    if (error) throw error;
    return !!data;
  };
  // So a tile can one day be labelled with a name. Never worth an error.
  API.setMyAgoraUid = async (channel, agoraUid) => {
    try {
      const c = await client(); const me = await uid(); if (!me) return;
      await c.from('call_members').update({ agora_uid: agoraUid }).eq('channel', channel).eq('user_id', me);
    } catch (e) {}
  };

  // Any call still ringing for me right now (e.g. the app was reopened
  // mid-ring, or the realtime event was missed).
  API.fetchIncomingCall = async () => {
    const c = await client(); const me = await uid(); if (!me) return null;
    const cutoff = new Date(Date.now() - 60000).toISOString(); // ignore stale rings
    const { data } = await c.from('calls')
      .select('*, caller:profiles!calls_caller_id_fkey ( id, name, handle, avatar_url )')
      .eq('callee_id', me).eq('status', 'ringing').gte('created_at', cutoff)
      .order('created_at', { ascending: false }).limit(1);
    return (data && data[0]) || null;
  };

  API.fetchCall = async (callId) => {
    const c = await client();
    const { data } = await c.from('calls')
      .select('*, caller:profiles!calls_caller_id_fkey ( id, name, handle, avatar_url ), callee:profiles!calls_callee_id_fkey ( id, name, handle, avatar_url )')
      .eq('id', callId).maybeSingle();
    return data || null;
  };

  // Fires when somebody calls me.
  API.subscribeToIncomingCalls = (cb) => {
    let channel = null;
    (async () => {
      const c = await client(); const me = await uid(); if (!me) return;
      channel = c.channel('calls:incoming:' + me).on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${me}`,
      }, payload => cb(payload.new)).subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  };

  // Fires when THIS call changes - answered, declined, hung up.
  API.subscribeToCall = (callId, cb) => {
    let channel = null;
    (async () => {
      const c = await client();
      channel = c.channel('calls:one:' + callId).on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}`,
      }, payload => cb(payload.new)).subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  };

  API.addGroupMembers = async (chatId, userIds) => {
    const c = await client();
    const rows = userIds.map(u => ({ chat_id: chatId, user_id: u, role: 'member' }));
    const { error } = await c.from('chat_members').insert(rows);
    if (error) throw error;
  };
  API.removeGroupMember = async (chatId, userId) => {
    const c = await client();
    const { error } = await c.from('chat_members').delete().eq('chat_id', chatId).eq('user_id', userId);
    if (error) throw error;
  };

  // ---------- Notifications ----------
  // Activity, not messages. A direct message already announces itself in the
  // inbox with its own unread mark, so repeating it here meant every chat was
  // reported twice and the genuinely one-off events — a follow, a follow
  // request, a security notice — were buried under chatter. Instagram draws
  // the same line: DMs live in the inbox, everything else in activity.
  // 'live' is included: someone you follow starting a broadcast is exactly
  // the kind of one-off event this feed is for. 'message' stays out — a DM
  // already announces itself in the inbox.
  // 'follow_request' belongs here. textFor and destinationFor both handle it,
  // and 0053 added it to the type constraint specifically so the row could
  // exist - but it was never added to this filter, so every follow request was
  // written, never fetched and never counted. A private account's only route to
  // a pending request was four levels deep in Settings.
  const ACTIVITY_TYPES = ['like', 'comment', 'follow', 'mention', 'system', 'live', 'follow_request'];

  API.fetchNotifications = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('notifications').select(`
      id, type, payload, read_at, created_at,
      actor:profiles!notifications_actor_id_fkey ( id, name, avatar_url )
    `).eq('user_id', me).in('type', ACTIVITY_TYPES)
      .order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
  };

  // Nothing ever set read_at, so the unread badge could only ever grow.
  API.markNotificationsRead = async (ids) => {
    const c = await client(); const me = await uid(); if (!me) return 0;
    let q = c.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', me).is('read_at', null);
    if (Array.isArray(ids) && ids.length) q = q.in('id', ids);
    const { data, error } = await q.select('id');
    if (error) throw error;
    return (data || []).length;
  };

  API.countUnreadNotifications = async () => {
    const c = await client(); const me = await uid(); if (!me) return 0;
    const { count, error } = await c.from('notifications')
      .select('*', { count: 'exact', head: true })
      // Same filter as the list above, or the bell would count messages the
      // notifications screen does not show — a badge you cannot clear by
      // opening it.
      .eq('user_id', me).in('type', ACTIVITY_TYPES).is('read_at', null);
    if (error) return 0;
    return count || 0;
  };

  // ---------- Handles ----------
  // Is this @handle free? Used while typing on signup so a clash is found
  // before the account is created rather than as a failed insert afterwards.
  //
  // Not authoritative — two people typing the same name at once will both be
  // told it is free. The unique index on profiles.handle is what actually
  // decides, and one of them gets an error. This only spares the common case.
  API.isHandleAvailable = async (handle) => {
    const h = String(handle || '').trim().toLowerCase();
    if (h.length < 3) return false;
    const c = await client();
    const { data, error } = await c.from('profiles').select('id').eq('handle', h).limit(1);
    if (error) throw error;
    return !(data && data.length);
  };

  API.fetchProfileByHandle = async (handle) => {
    const c = await client();
    const { data, error } = await c.from('profiles')
      .select('id, name, handle, avatar_url, verified, is_private')
      .ilike('handle', String(handle || '').trim())
      .maybeSingle();
    if (error) return null;
    return data;
  };

  // Typeahead for the @ picker while composing.
  API.searchHandles = async (prefix, limit = 8) => {
    const c = await client();
    const { data, error } = await c.rpc('search_handles', { p_prefix: prefix, p_limit: limit });
    if (!error) return data || [];
    // Before 0035 the function does not exist; fall back to a plain query.
    const r = await c.from('profiles')
      .select('id, handle, name, avatar_url, verified')
      .ilike('handle', prefix + '%').limit(limit);
    return r.data || [];
  };

  // ---------- Support ----------
  API.createSupportTicket = async ({ category, subject, message }) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('support_tickets').insert({
      user_id: me,
      category: category || 'other',
      subject: subject || null,
      message: message,
      app_version: (window.TT_CONFIG && window.TT_CONFIG.appVersion) || 'unknown',
      device: (navigator.userAgent || '').slice(0, 200),
    });
    if (error) {
      if (/too many reports/i.test(error.message || '')) {
        throw new Error('أرسلت بلاغات كثيرة، حاول لاحقًا');
      }
      throw error;
    }
  };

  API.fetchMySupportTickets = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('support_tickets')
      .select('*').eq('user_id', me).order('created_at', { ascending: false }).limit(20);
    if (error) return [];
    return data || [];
  };

  // ---------- Upload quotas ----------
  // Neither storage provider offers a hard spending cap, so the ceiling is
  // enforced here and in a storage policy. This call is only for showing the
  // reason - the policy is what actually stops the upload.
  API.uploadQuota = async () => {
    const c = await client(); const me = await uid(); if (!me) return null;
    const { data, error } = await c.rpc('upload_quota_status');
    if (error) return null;   // migration not applied yet - do not block uploads
    return data;
  };

  API.quotaMessage = (q) => {
    if (!q || q.allowed) return '';
    if (q.reason === 'daily_count') {
      return 'وصلت إلى حد الرفع اليومي (' + q.uploads_limit + '). حاول غدًا.';
    }
    if (q.reason === 'daily_bytes') {
      return 'وصلت إلى حد الحجم اليومي. حاول غدًا.';
    }
    if (q.reason === 'global_full') {
      return 'التخزين ممتلئ مؤقتًا. حاول لاحقًا.';
    }
    return 'تعذر الرفع الآن';
  };

  API.fetchAppLimits = async () => {
    const c = await client();
    const { data, error } = await c.from('app_limits').select('*').eq('id', 1).maybeSingle();
    if (error) return null;
    return data;
  };

  API.updateAppLimits = async (fields) => {
    const c = await client();
    const { error } = await c.from('app_limits').update(fields).eq('id', 1);
    if (error) throw error;
  };

  // ---------- Archive ----------
  // Archiving is the author hiding their own post. It is deliberately not the
  // same flag as is_hidden, which is moderation taking something down.
  API.setVideoArchived = async (videoId, archived) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('videos')
      .update({ is_archived: !!archived }).eq('id', videoId).eq('user_id', me);
    if (error) throw error;
  };

  API.fetchArchivedVideos = async () => {
    const c = await client(); const me = await uid();
    if (!me) return [];
    const { data, error } = await c.from('videos')
      .select('id, description, thumbnail, video_url, likes_count, created_at')
      .eq('user_id', me).eq('is_archived', true).eq('is_draft', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  // ---------- Close friends ----------
  API.fetchCloseFriends = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('close_friends')
      .select('friend_id, profiles:profiles!close_friends_friend_id_fkey(id,name,handle,avatar_url)')
      .eq('user_id', me);
    if (error) throw error;
    return (data || []).map(r => r.profiles).filter(Boolean);
  };

  API.addCloseFriend = async (friendId) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('close_friends').insert({ user_id: me, friend_id: friendId });
    if (error && error.code !== '23505') throw error;
  };

  API.removeCloseFriend = async (friendId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('close_friends')
      .delete().eq('user_id', me).eq('friend_id', friendId);
    if (error) throw error;
  };

  // ---------- Download your data ----------
  API.requestDataExport = async () => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('data_export_requests').insert({ user_id: me });
    // A unique index allows only one pending request, so a second tap is a
    // no-op rather than an error the user has to read.
    if (error && error.code !== '23505') throw error;
  };

  API.fetchDataExports = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('data_export_requests')
      .select('*').eq('user_id', me).order('requested_at', { ascending: false }).limit(10);
    if (error) throw error;
    return data || [];
  };

  // ---------- Your activity ----------
  // What you did, not what was done to you - that is the notifications screen.
  API.fetchMyLikedVideos = async (limit = 60) => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('likes')
      .select('created_at, videos:videos!likes_video_id_fkey(id, thumbnail, description, likes_count)')
      .eq('user_id', me).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(r => r.videos ? Object.assign({}, r.videos, { acted_at: r.created_at }) : null).filter(Boolean);
  };

  API.fetchMyComments = async (limit = 60) => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('comments')
      .select('id, text, created_at, video_id')
      .eq('user_id', me).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  };

  API.deleteMyComment = async (id) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('comments').delete().eq('id', id).eq('user_id', me);
    if (error) throw error;
  };

  API.countMyContent = async () => {
    const c = await client(); const me = await uid();
    if (!me) return { posts: 0, likes: 0, comments: 0, archived: 0 };
    const one = async (t, extra) => {
      let q = c.from(t).select('*', { count: 'exact', head: true }).eq('user_id', me);
      if (extra) q = extra(q);
      const { count } = await q;
      return count || 0;
    };
    const [posts, likes, comments, archived] = await Promise.all([
      one('videos', q => q.eq('is_draft', false).eq('is_archived', false)),
      one('likes'),
      one('comments'),
      one('videos', q => q.eq('is_archived', true)),
    ]);
    return { posts, likes, comments, archived };
  };

  // ---------- Moderation tools (hidden words / restrict / mute) ----------

  API.fetchHiddenWords = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('hidden_words').select('word').eq('user_id', me);
    if (error) return [];
    return (data || []).map(r => r.word);
  };

  API.addHiddenWord = async (word) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const w = String(word || '').trim().toLowerCase();
    if (!w) return;
    const { error } = await c.from('hidden_words').insert({ user_id: me, word: w });
    if (error && error.code !== '23505') throw error;
  };

  API.removeHiddenWord = async (word) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('hidden_words')
      .delete().eq('user_id', me).eq('word', String(word).trim().toLowerCase());
    if (error) throw error;
  };

  API.fetchRestricted = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('restricted_users')
      .select('restricted_id, profiles:profiles!restricted_users_restricted_id_fkey(id,name,handle,avatar_url)')
      .eq('user_id', me);
    if (error) return [];
    return (data || []).map(r => r.profiles).filter(Boolean);
  };

  API.restrictUser = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('restricted_users').insert({ user_id: me, restricted_id: targetId });
    if (error && error.code !== '23505') throw error;
  };

  API.unrestrictUser = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('restricted_users')
      .delete().eq('user_id', me).eq('restricted_id', targetId);
    if (error) throw error;
  };

  API.isRestricted = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { count } = await c.from('restricted_users')
      .select('*', { count: 'exact', head: true }).eq('user_id', me).eq('restricted_id', targetId);
    return (count || 0) > 0;
  };

  API.fetchMuted = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('muted_users')
      .select('muted_id, profiles:profiles!muted_users_muted_id_fkey(id,name,handle,avatar_url)')
      .eq('user_id', me);
    if (error) return [];
    return (data || []).map(r => r.profiles).filter(Boolean);
  };

  API.muteUser = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('muted_users').insert({ user_id: me, muted_id: targetId });
    if (error && error.code !== '23505') throw error;
  };

  API.unmuteUser = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('muted_users').delete().eq('user_id', me).eq('muted_id', targetId);
    if (error) throw error;
  };

  API.isMuted = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { count } = await c.from('muted_users')
      .select('*', { count: 'exact', head: true }).eq('user_id', me).eq('muted_id', targetId);
    return (count || 0) > 0;
  };

  // ---------- User settings ----------
  // Every toggle on the Settings screen used to call an empty function.
  // These read and write real rows; the database enforces them (0027).

  const SETTINGS_DEFAULTS = {
    notif_likes: true, notif_comments: true, notif_follows: true,
    notif_messages: true, notif_live: true, notif_gifts: true,
    who_can_message: 'everyone', who_can_comment: 'everyone', who_can_tag: 'everyone',
    autoplay: true, data_saver: false,
  };

  API.fetchUserSettings = async () => cached('usersettings', 300000, async () => {
    const c = await client(); const me = await uid();
    if (!me) return { ...SETTINGS_DEFAULTS };
    const { data, error } = await c.from('user_settings').select('*').eq('user_id', me).maybeSingle();
    if (error) return { ...SETTINGS_DEFAULTS };   // table not there yet -> defaults
    return { ...SETTINGS_DEFAULTS, ...(data || {}) };
  });

  API.updateUserSettings = async (patch) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('user_settings')
      .upsert({ user_id: me, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    // Or the settings screen would keep showing the value you just changed.
    invalidate('usersettings');
  };

  // Can I open a DM with this person? Honours their "who can message me"
  // choice and any block they have on me.
  API.canMessage = async (targetId) => {
    const c = await client(); const me = await uid();
    if (!me) return false;
    const { data, error } = await c.rpc('may_message', { p_target: targetId, p_actor: me });
    if (error) return true;   // function not deployed yet - do not block the user
    return data !== false;
  };

  // ---------- Sessions / login alerts ----------
  function describeDevice() {
    const ua = navigator.userAgent || '';
    const browser =
      /Edg\//.test(ua) ? 'Edge' :
      /OPR\//.test(ua) ? 'Opera' :
      /Chrome\//.test(ua) ? 'Chrome' :
      /Safari\//.test(ua) ? 'Safari' :
      /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
    const os =
      /Android/.test(ua) ? 'Android' :
      /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
      /Windows/.test(ua) ? 'Windows' :
      /Mac OS X/.test(ua) ? 'macOS' :
      /Linux/.test(ua) ? 'Linux' : 'Unknown';
    // No connector WORD, in either language. This value is written to the
    // database, so whatever it says is frozen at signin time and no later
    // translation pass can reach it - rows already stored keep whichever
    // language was current when they were written, forever. An earlier attempt
    // to fix "Chrome on Windows" appearing inside Arabic sentences swapped the
    // word for 'على' and made the mirror-image bug in English, permanently.
    //
    // A separator has no language, reads correctly in both, and needs no
    // dictionary entry. Rows written before this keep their old wording until
    // those sessions expire.
    return { device: browser + ' · ' + os, platform: /Android|iPhone|iPad|iPod/.test(ua) ? 'mobile' : 'web' };
  }

  // ---------- Client logs ----------
  // One line from the phone at a point that matters (migration 0088). Best
  // effort: never throws, never awaited by the caller, so a log that fails
  // cannot fail the thing it was logging. Read from the database, by admins.
  API.logClient = (kind, detail) => {
    (async () => {
      try {
        const c = await client(); const me = await uid(); if (!me) return;
        // The version goes in every line. Reading these logs meant guessing
        // which build a phone was on, and a fix that "did not work" is a very
        // different thing from a fix that was never installed.
        const base = detail && typeof detail === 'object' ? detail : { value: String(detail == null ? '' : detail).slice(0, 500) };
        let ver = '';
        try { ver = (window.TT_CONFIG && window.TT_CONFIG.appVersion) || ''; } catch (e) {}
        await c.from('client_logs').insert({
          user_id: me, kind: String(kind).slice(0, 60),
          detail: Object.assign({ v: ver }, base),
          ua: String(navigator.userAgent || '').slice(0, 200),
        });
      } catch (e) { /* a log is never worth an error */ }
    })();
  };

  // ---------- Push tokens ----------
  // One row per (account, device token). Upserted on every registration, so
  // a token that already exists just refreshes its language and time; the
  // primary key is (user_id, token). Removed on sign-out by push.js.
  API.savePushToken = async (token, platform, lang) => {
    const c = await client(); const me = await uid(); if (!me || !token) return;
    const row = { user_id: me, token: String(token), platform: platform === 'ios' || platform === 'android' ? platform : 'web', lang: lang === 'en' ? 'en' : 'ar', updated_at: new Date().toISOString() };
    const { error } = await c.from('push_tokens').upsert(row, { onConflict: 'user_id,token' });
    if (error) throw error;
  };
  API.removePushToken = async (token) => {
    const c = await client(); const me = await uid(); if (!me || !token) return;
    await c.from('push_tokens').delete().eq('user_id', me).eq('token', String(token));
  };
  API.recordSession = async () => {
    const c = await client(); const me = await uid();
    if (!me) return null;
    const d = describeDevice();
    const { data, error } = await c.rpc('record_session', { p_device: d.device, p_platform: d.platform });
    if (error) return null;   // migration not applied yet
    // Kept so the devices list can mark which row you are reading it on.
    try { if (data) localStorage.setItem('tt-session-id', data); } catch (e) {}
    return data;
  };

  API.fetchMySessions = async () => {
    const c = await client(); const me = await uid();
    if (!me) return [];
    const { data, error } = await c.from('user_sessions')
      .select('*').eq('user_id', me).order('last_seen', { ascending: false });
    if (error) return [];
    return data || [];
  };

  API.revokeSession = async (id) => {
    const c = await client(); const me = await uid();
    if (!me) return;
    const { error } = await c.from('user_sessions').delete().eq('id', id).eq('user_id', me);
    if (error) throw error;
  };

  // ---------- Locations ----------
  API.upsertLocation = async ({ lat, lng, accuracy, sharing_enabled = true, visibility = 'friends' }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('user_locations').upsert({
      user_id: me, lat, lng, accuracy, sharing_enabled, visibility, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  };

  // Reading the two flags the settings screen needs, so the switch can show
  // the stored state instead of always starting at off.
  API.fetchMyLocationSettings = async () => {
    const c = await client(); const me = await uid();
    if (!me) return { sharing_enabled: false, visibility: 'friends' };
    const { data, error } = await c.from('user_locations')
      .select('sharing_enabled, visibility').eq('user_id', me).maybeSingle();
    // A failed read is not consent withdrawn. Collapsing the two meant a
    // transient error silently revoked sharing - and, with the map fix above,
    // would silently disable it for someone who had turned it on.
    if (error) throw error;
    if (!data) return { sharing_enabled: false, visibility: 'friends' };
    return { sharing_enabled: !!data.sharing_enabled, visibility: data.visibility || 'friends' };
  };

  // The master switch. Setting visibility alone left sharing_enabled false,
  // which the read policy requires - so the switch reported success while
  // nobody could actually see you.
  API.setLocationSharing = async (on) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    if (!on) return API.stopSharingLocation();
    const current = await API.fetchMyLocationSettings();
    const { error } = await c.from('user_locations').upsert({
      user_id: me,
      sharing_enabled: true,
      // 'none' would contradict the switch being on, so fall back to friends.
      visibility: current.visibility === 'none' ? 'friends' : current.visibility,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
  };

  API.setLocationVisibility = async (visibility) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    if (visibility === 'none') return API.stopSharingLocation();
    const { error } = await c.from('user_locations').upsert({ user_id: me, visibility, updated_at: new Date().toISOString() });
    if (error) throw error;
  };

  // Clears the stored coordinates rather than only flipping a flag - a
  // position nobody can see is still a position being kept.
  API.stopSharingLocation = async () => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.rpc('stop_sharing_location');
    if (!error) return;
    // Before 0032 the function does not exist; blank the row directly.
    await c.from('user_locations').upsert({
      user_id: me, visibility: 'none', sharing_enabled: false,
      lat: null, lng: null, accuracy: null, updated_at: new Date().toISOString(),
    });
  };

  API.fetchFriendLocations = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    // Get who I follow
    const { data: f } = await c.from('follows').select('followed_id').eq('follower_id', me);
    const ids = (f || []).map(r => r.followed_id);
    if (!ids.length) return [];
    const { data, error } = await c.from('user_locations').select(`
      user_id, lat, lng, updated_at, visibility, sharing_enabled,
      profiles:profiles!user_locations_user_id_fkey ( id, name, handle, avatar_url )
    `).in('user_id', ids).eq('sharing_enabled', true)
      .gt('updated_at', new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString());
    if (error) throw error;
    // A row with no coordinates is someone who has stopped sharing.
    return (data || []).filter(r => r.lat != null && r.lng != null);
  };

  API.subscribeToFriendLocations = (cb) => {
    let channel = null;
    (async () => {
      const c = await client();
      channel = c.channel('friend-locations').on('postgres_changes', {
        event: '*', schema: 'public', table: 'user_locations',
      }, payload => cb(payload)).subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  };

  // Viewer count and stream status. All three fail soft: without 0046 the
  // stream still plays, the count just stays where it started.
  API.joinLiveStream = async (liveId) => {
    try {
      const c = await client();
      const { data } = await c.rpc('join_live_stream', { p_live_id: liveId });
      return data || 0;
    } catch (e) { console.warn('joinLiveStream (is 0046 applied?):', e); return 0; }
  };

  API.leaveLiveStream = async (liveId) => {
    try {
      const c = await client();
      const { data } = await c.rpc('leave_live_stream', { p_live_id: liveId });
      return data || 0;
    } catch (e) { return 0; }
  };

  // Watches the stream row itself, so the viewer count moves and viewers are
  // told when the host ends the broadcast instead of staring at a frozen frame.
  API.subscribeToLiveStream = (liveId, cb) => {
    let channel = null;
    (async () => {
      const c = await client();
      channel = c.channel('live:one:' + liveId).on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'live_streams', filter: `id=eq.${liveId}`,
      }, payload => cb(payload.new)).subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  };

  // ── Live reactions ──
  // Deliberately NOT stored. A heart is worth something for the two seconds it
  // floats up the screen and nothing at all afterwards, and a table would mean
  // a write per tap on the busiest screen in the app — for data nobody ever
  // reads back. Sent over a realtime broadcast channel instead: ephemeral, and
  // it needs no migration or RLS policy.
  //
  // One channel does both directions. `self: false` means a sender does not
  // receive their own reaction back, because the tap already floats a heart
  // locally and echoing it would double every one.
  API.joinLiveReactions = async (liveId, onReaction) => {
    const c = await client();
    const ch = c.channel('live:react:' + liveId, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'react' }, (msg) => {
      const p = (msg && msg.payload) || {};
      // Capped: this string is put straight into the DOM as text by the live
      // screen, and it arrives from another client.
      const emoji = typeof p.emoji === 'string' ? p.emoji.slice(0, 8) : '❤️';
      try { onReaction(emoji); } catch (e) {}
    });
    await new Promise((resolve) => {
      let settled = false;
      ch.subscribe((status) => {
        if (settled) return;
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          settled = true; resolve(status);
        }
      });
      // Never leave the caller waiting on a channel that will not come up.
      setTimeout(() => { if (!settled) { settled = true; resolve('TIMED_OUT'); } }, 6000);
    });
    return {
      send: (emoji) => {
        try {
          return ch.send({
            type: 'broadcast', event: 'react',
            payload: { emoji: String(emoji || '❤️').slice(0, 8) },
          }).catch(() => {});
        } catch (e) { return Promise.resolve(); }
      },
      stop: () => { try { ch.unsubscribe(); } catch (e) {} },
    };
  };

  API.subscribeToLiveComments = async (liveStreamId, cb) => {
    const c = await client();
    const ch = c.channel('live-comments-' + liveStreamId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_comments', filter: `live_stream_id=eq.${liveStreamId}` },
        (payload) => cb(payload.new))
      .subscribe();
    return () => { try { c.removeChannel(ch); } catch (e) {} };
  };

  // privacy is REQUIRED to be sent, and this is why:
  //
  // live_streams.privacy exists (0004), defaults to 'public', and the RLS
  // policy on that table honours it correctly. But this function never sent
  // the column — the setup screen's Public / Friends / Private chooser wrote
  // its answer into a plain JavaScript variable (window._ttLiveMeta) and
  // nothing carried it to the database.
  //
  // So every stream was public regardless. Someone could pick "Private",
  // broadcast believing only they could see it, and be visible to anyone at
  // all, including signed-out visitors. A privacy control that is ignored is
  // worse than not offering one.
  // Cover image for a live broadcast. A camera stream stored no thumbnail at
  // all, so it appeared as a blank tile in the live grid — the grid renders
  // `l.thumbnail || l.bg` and both were null. The frame is grabbed from the
  // host's own preview the instant they go live.
  //
  // Filed under the videos bucket because its policy is exactly what is needed
  // here: public read, and writes allowed only where the first path segment is
  // the uploader's id. Failure returns null rather than throwing — a missing
  // cover must never stop somebody going live.
  API.uploadLiveThumbnail = async (blob) => {
    if (!blob) return null;

    // Screened before upload, and a refusal THROWS rather than returning null
    // - the same distinction uploadMedia() draws between "the service is
    // broken" (null, fall through) and "the server said no" (throw).
    //
    // The one caller, the go-live button in views.js, catches around this and
    // continues without a cover, which is exactly the behaviour wanted: the
    // objectionable image is never stored, and nobody is stopped from
    // broadcasting over a still frame.
    if (window.Moderation) {
      const verdict = await window.Moderation.checkImage('live_cover', blob);
      if (verdict.blocked) {
        const refusal = new Error(verdict.message || 'لا يمكن استخدام هذه الصورة');
        refusal.refused = true;
        throw refusal;
      }
    }

    try {
      const c = await client();
      const me = await uid();
      if (!me) return null;
      const viaR2 = await API.uploadMedia(blob, { bucket: 'videos', ext: 'jpg', contentType: 'image/jpeg' });
      if (viaR2) return viaR2;

      const path = `${me}/live-${Date.now()}.jpg`;
      const { error } = await c.storage.from('videos')
        .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
      if (error) { console.warn('live thumbnail upload failed:', error.message); return null; }
      const { data: pub } = c.storage.from('videos').getPublicUrl(path);
      return (pub && pub.publicUrl) || null;
    } catch (e) {
      console.warn('live thumbnail:', e && e.message);
      return null;
    }
  };

  API.startLive = async ({ title, thumbnail, privacy = 'public' }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    // Guard the value rather than trusting the caller: an unrecognised
    // string would be rejected by the column's check constraint and lose the
    // whole broadcast, and defaulting to 'public' on a typo is the wrong way
    // to fail for a privacy setting.
    const p = ['public', 'friends', 'private'].indexOf(privacy) !== -1 ? privacy : 'private';

    // The title is the one part of a live stream screened up front - the cover
    // was handled by uploadLiveThumbnail above, and the video itself cannot be,
    // which 0066 says plainly. A running stream is covered by reporting and the
    // admin kill switch in web/js/admin.js.
    let verdict = null;
    if (window.Moderation && title) {
      verdict = await window.Moderation.checkText('live_title', title);
      if (verdict.blocked) throw new Error(verdict.message || 'لا يمكن استخدام هذا العنوان');
    }

    const { data, error } = await c.from('live_streams')
      .insert({ host_id: me, title, thumbnail, status: 'live', privacy: p })
      .select().single();
    if (error) throw error;
    if (verdict && data && data.id) window.Moderation.attach(verdict, 'live_stream', data.id);
    return data;
  };

  API.endLive = async (id) => {
    const c = await client();
    const { error } = await c.from('live_streams').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  };

  // The list card reads host.avatar while the stream screen reads
  // host.avatar_url, so both names are returned rather than changing two
  // screens over a key.
  function shapeHost(p) {
    if (!p) return null;
    return { id: p.id, name: p.name, handle: p.handle, avatar_url: p.avatar_url, avatar: p.avatar_url };
  }

  API.fetchLiveStreams = async () => {
    const c = await client();
    const { data, error } = await c
      .from('live_streams')
      .select('id, title, thumbnail, viewer_count, status, started_at, host:profiles!live_streams_host_id_fkey (id, name, handle, avatar_url)')
      .eq('status', 'live')
      .order('viewer_count', { ascending: false })
      .limit(60);
    if (error) throw error;
    return (data || []).map(r => Object.assign({}, r, { host: shapeHost(r.host) }));
  };

  API.fetchLiveStream = async (id) => {
    const c = await client();
    const { data, error } = await c
      .from('live_streams')
      .select('id, title, thumbnail, viewer_count, status, started_at, ended_at, host:profiles!live_streams_host_id_fkey (id, name, handle, avatar_url)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return Object.assign({}, data, { host: shapeHost(data.host) });
  };

  // Oldest first, so the chat reads top to bottom the way it is rendered.
  // Only the tail matters on a busy stream.
  API.fetchLiveComments = async (liveStreamId, limit = 40) => {
    const c = await client();
    const { data, error } = await c
      .from('live_comments')
      .select('id, text, created_at, user:profiles!live_comments_user_id_fkey (id, name, handle, avatar_url)')
      .eq('live_stream_id', liveStreamId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).reverse();
  };

  API.postLiveComment = async (liveStreamId, text) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const body = String(text || '').trim();
    if (!body) throw new Error('empty comment');
    // Matches the column constraint, so an over-long comment fails here with
    // a readable message instead of a database error.
    if (body.length > 500) throw new Error('التعليق طويل جدًا');

    // Screened and blockable, never queued: live chat is ephemeral and arrives
    // in bursts, and filing a report for every borderline line would bury the
    // reports that matter within minutes of the first busy stream.
    // Alongside the insert, for the reason given at postComment - and more so
    // here. A two-second pause between pressing send and seeing your own line
    // appear is unusable in a live chat that is scrolling past.
    const screening = window.Moderation
      ? window.Moderation.checkText('live_comment', body).catch(() => null)
      : null;

    const { data, error } = await c.from('live_comments')
      .insert({ live_stream_id: liveStreamId, user_id: me, text: body })
      .select('id, text, created_at')
      .single();
    if (error) throw error;

    if (screening) screening.then(verdict => {
      if (verdict && verdict.blocked && data && data.id) {
        withdraw(c, 'live_comments', data.id, null, verdict.message);
      }
    });
    return data;
  };

  // ---------- Reports ----------
  API.report = async ({ targetType, targetId, reason }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('reports').insert({ reporter_id: me, target_type: targetType, target_id: targetId, reason });
    if (error) throw error;
  };

  // ---------- Community Guidelines agreement (required before first publish) ----------
  API.hasAcceptedGuidelines = async () => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { data, error } = await c.from('profiles').select('guidelines_accepted_at').eq('id', me).single();
    if (error) return false;
    return !!(data && data.guidelines_accepted_at);
  };

  API.acceptGuidelines = async () => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.rpc('accept_guidelines');
    if (error) throw error;
  };

  // ---------- Interested / Not interested feedback (negative signal for the feed algorithm) ----------
  API.setVideoFeedback = async (videoId, feedback) => {
    if (!videoId || typeof videoId !== 'string' || videoId.length < 10) return;
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.rpc('set_video_feedback', { p_video_id: videoId, p_feedback: feedback });
    if (error) throw error;
  };

  // ---------- Engagement tracking (feeds the personalized FYP algorithm) ----------
  API.trackEngagement = async ({ videoId, watchMs = 0, loopCount = 0, completionPct = 0 }) => {
    if (!videoId || typeof videoId !== 'string' || videoId.length < 10) return; // skip mock/placeholder ids
    const c = await client();
    const me = await uid();
    if (!me) return; // only signed-in users build a preference profile
    const { error } = await c.rpc('track_engagement', {
      p_video_id: videoId,
      p_watch_ms: Math.round(watchMs),
      p_loop_count: loopCount,
      p_completion_pct: Math.max(0, Math.min(1, completionPct)),
    });
    if (error) console.warn('trackEngagement failed:', error.message);
  };

  // ============================================================
  // ===== WALKIE-TALKIE — live audio broadcast in chat =========
  // Uses Supabase Realtime broadcast channel (not Postgres changes).
  // Sender streams audio chunks as base64; receivers reconstruct
  // and play in real time. Sub-500ms latency typical.
  // ============================================================
  API.openWalkieChannel = (chatId, { onChunk, onSpeakerChange }) => {
    let channel = null;
    let cleanup = () => {};
    (async () => {
      const c = await client();
      const me = await uid();
      channel = c.channel(`walkie:${chatId}`, { config: { broadcast: { ack: false } } });
      channel
        .on('broadcast', { event: 'audio' }, ({ payload }) => {
          if (!payload || payload.from === me) return;
          onChunk && onChunk(payload);
        })
        .on('broadcast', { event: 'talking' }, ({ payload }) => {
          if (!payload || payload.from === me) return;
          onSpeakerChange && onSpeakerChange(payload);
        })
        .subscribe();
      cleanup = () => { try { channel.unsubscribe(); } catch (e) {} };
    })();
    return {
      // Send one chunk of audio
      sendChunk: async ({ data, mime, seq }) => {
        if (!channel) return;
        const me = await uid();
        await channel.send({ type: 'broadcast', event: 'audio', payload: { from: me, data, mime, seq, t: Date.now() } });
      },
      // Notify everyone that someone started/stopped talking
      sendTalking: async (isTalking, name) => {
        if (!channel) return;
        const me = await uid();
        await channel.send({ type: 'broadcast', event: 'talking', payload: { from: me, isTalking, name, t: Date.now() } });
      },
      close: () => cleanup(),
    };
  };

  // ============================================================
  // ===================== LOCATION PERMITS =======================
  // A → asks B for location → B approves/denies → A can track until revoked
  // ============================================================
  API.requestLocationPermit = async (targetUserId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { data, error } = await c.from('location_permits')
      .upsert({ requester_id: me, target_id: targetUserId, status: 'pending' }, { onConflict: 'requester_id,target_id' })
      .select().single();
    if (error) throw error;
    return data;
  };

  API.respondToLocationPermit = async (permitId, decision /* 'approved' | 'denied' */) => {
    const c = await client();
    const { error } = await c.from('location_permits')
      .update({ status: decision, responded_at: new Date().toISOString() })
      .eq('id', permitId);
    if (error) throw error;
  };

  API.revokeLocationPermit = async (targetUserId) => {
    const c = await client(); const me = await uid();
    const { error } = await c.from('location_permits')
      .update({ status: 'revoked', responded_at: new Date().toISOString() })
      .or(`and(requester_id.eq.${me},target_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},target_id.eq.${me})`);
    if (error) throw error;
  };

  API.fetchPermitStatus = async (targetUserId) => {
    const c = await client(); const me = await uid(); if (!me) return null;
    const { data } = await c.from('location_permits')
      .select('id,status')
      .eq('requester_id', me).eq('target_id', targetUserId)
      .maybeSingle();
    return data;
  };

  API.fetchIncomingPermits = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('location_permits')
      .select('id, status, created_at, requester:profiles!location_permits_requester_id_fkey(id,name,handle,avatar_url)')
      .eq('target_id', me)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  API.fetchTrackedLocations = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    // Get permits I own that are approved
    const { data: permits } = await c.from('location_permits')
      .select('target_id')
      .eq('requester_id', me)
      .eq('status', 'approved');
    const ids = (permits || []).map(p => p.target_id);
    if (!ids.length) return [];
    const { data, error } = await c.from('user_locations')
      .select('user_id, lat, lng, updated_at, profiles:profiles!user_locations_user_id_fkey(id,name,handle,avatar_url)')
      .in('user_id', ids);
    if (error) throw error;
    return data || [];
  };

  // ============================================================
  // ============================ BLOCKS ==========================
  // ============================================================
  // Blocking changes who may appear in the inbox, in search and in the
  // suggested row, and all three are cached. Without this the person you
  // just blocked stayed on screen until the cache aged out, which reads as
  // the block not having worked.
  // Blocking also severs the follow in both directions — 0049 does that with
  // a trigger, so it happens on the server whether or not the app knows — and
  // the follower/following lists are cached for a minute. Drop them too, or
  // the counts and the lists disagree with the database until they age out.
  const _forgetBlockCaches = () => {
    invalidate('blockedids');
    invalidate('chats');
    invalidate('followers:');
    invalidate('following:');
    invalidate('isfollowing:');
    invalidate('feed:');
  };

  API.blockUser = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('blocks').insert({ blocker_id: me, blocked_id: userId });
    if (error && error.code !== '23505') throw error;

    // Apple 1.2 asks that blocking "also notify the developer of the
    // inappropriate content" - not merely hide it. A block is a moderation
    // signal, so it goes into the same reports queue an explicit report does,
    // and gets acted on the same way.
    //
    // Deliberately best-effort: the block itself has already been written and
    // the person is already protected. Failing here would undo nothing and
    // would report a working block as broken.
    try {
      const { error: rErr } = await c.from('reports').insert({
        reporter_id: me,
        target_type: 'user',
        target_id: userId,
        reason: 'حظر المستخدم — بلاغ تلقائي',
      });
      if (rErr) console.warn('block filed, report did not:', rErr.message);
    } catch (e) {
      console.warn('block filed, report did not:', e && e.message);
    }

    _forgetBlockCaches();
  };
  API.unblockUser = async (userId) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    if (!userId) throw new Error('no user given');
    const { error } = await c.from('blocks').delete().eq('blocker_id', me).eq('blocked_id', userId);
    if (error) throw error;
    _forgetBlockCaches();
  };

  // The list behind Settings → Blocked users.
  //
  // The old version joined profiles from blocks and dropped anything that
  // came back null. Under 0054 a profile is hidden from anyone its owner has
  // blocked, so if someone you blocked had ALSO blocked you, their profile
  // read as null and `.filter(Boolean)` quietly removed them from the list —
  // the only screen from which they could be unblocked. The block became
  // permanent from your side, with no error anywhere to explain it.
  //
  // list_blocked (0065) is SECURITY DEFINER for exactly this: it returns only
  // rows you created yourself by blocking someone, so it can see past that
  // policy without giving anything else away.
  API.fetchBlocked = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.rpc('list_blocked');
    if (!error) return data || [];
    console.warn('list_blocked unavailable (is 0065 applied?):', error.message);
    // Pre-0065 fallback. Keeps a row for a mutual block rather than dropping
    // it, so the Unblock button still has an id to work with even when the
    // name and photo cannot be read.
    const r = await c.from('blocks')
      .select('blocked_id, created_at, profiles:profiles!blocks_blocked_id_fkey(id,name,handle,avatar_url)')
      .eq('blocker_id', me).order('created_at', { ascending: false });
    if (r.error) throw r.error;
    return (r.data || []).map(row => Object.assign(
      { id: row.blocked_id, name: '', handle: '', avatar_url: '', blocked_at: row.created_at },
      row.profiles || {}
    ));
  };

  // ============================================================
  // ============== SELF-SERVICE (wallet, privacy, deletion) ======
  // ============================================================
  // Fetch full profile incl. is_private (so settings can show the toggle correctly)
  API.fetchMySettings = async () => {
    const c = await client(); const me = await uid(); if (!me) return {};
    const { data, error } = await c.from('profiles').select('id, name, handle, is_private, verified').eq('id', me).maybeSingle();
    if (error) throw error;
    return data || {};
  };

  API.setPrivate = async (isPrivate) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('profiles').update({ is_private: !!isPrivate }).eq('id', me);
    if (error) throw error;
  };


  // ---------- Account status ----------
  // Deactivate hides the account and destroys nothing. Deletion is scheduled
  // 30 days out and cancelled by signing back in, so the warning we show is
  // actually true.
  API.fetchAccountStatus = async () => {
    const c = await client(); const me = await uid();
    if (!me) return null;
    const { data, error } = await c.rpc('my_account_status');
    if (error) return null;   // migration not applied yet
    return data;
  };

  API.deactivateAccount = async () => {
    const c = await client();
    const { error } = await c.rpc('deactivate_account');
    if (error) throw error;
    try { await window.SB.signOut(); } catch (e) {}
  };

  API.reactivateAccount = async () => {
    const c = await client();
    const { error } = await c.rpc('reactivate_account');
    if (error) throw error;
  };

  API.scheduleAccountDeletion = async () => {
    const c = await client();
    const { data, error } = await c.rpc('schedule_account_deletion');
    if (error) throw error;
    try { await window.SB.signOut(); } catch (e) {}
    return data;
  };

  API.cancelAccountDeletion = async () => {
    const c = await client();
    const { error } = await c.rpc('cancel_account_deletion');
    if (error) throw error;
  };

  API.selfDeleteAccount = async () => {
    const c = await client();
    const { error } = await c.rpc('self_delete_account');
    if (error) throw error;
    try { await window.SB.signOut(); } catch (e) {}
  };

  // ============================================================
  // ============== ADMIN ENDPOINTS (require is_admin) ============
  // ============================================================
  API.adminCheckIsAdmin = async () => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { data } = await c.from('profiles').select('is_admin').eq('id', me).maybeSingle();
    return !!(data && data.is_admin);
  };

  API.adminStats = async () => {
    const c = await client();
    const { data, error } = await c.rpc('admin_stats');
    if (error) throw error;
    return data;
  };

  API.adminFetchUsers = async ({ search = '', status = '' } = {}) => {
    const c = await client();
    let q = c.from('profiles').select('id, name, handle, avatar_url, verified, is_admin, banned_until, followers_count, created_at').order('created_at', { ascending: false }).limit(200);
    if (search) {
      const term = `%${search.replace(/[%_]/g, '\\$&')}%`;
      q = q.or(`name.ilike.${term},handle.ilike.${term}`);
    }
    const { data, error } = await q;
    if (error) throw error;
    let users = data || [];
    if (status === 'active') users = users.filter(u => !u.banned_until);
    if (status === 'banned') users = users.filter(u => u.banned_until && new Date(u.banned_until) > new Date());
    if (status === 'admin') users = users.filter(u => u.is_admin);
    return users;
  };

  API.adminBanUser = async (userId, days) => {
    const c = await client();
    const until = days === null ? null : new Date(Date.now() + days * 86400000).toISOString();
    const { error } = await c.from('profiles').update({ banned_until: until }).eq('id', userId);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: until ? 'ban_user' : 'unban_user', target_type: 'user', target_id: userId, payload: { until } });
  };

  API.adminToggleAdmin = async (userId, makeAdmin) => {
    const c = await client();
    const { error } = await c.from('profiles').update({ is_admin: !!makeAdmin }).eq('id', userId);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: makeAdmin ? 'grant_admin' : 'revoke_admin', target_type: 'user', target_id: userId });
  };

  // Full detail blob for the admin edit-user modal (profile + wallet + recent videos/logs)
  API.adminFetchUserDetail = async (userId) => {
    const c = await client();
    const { data, error } = await c.rpc('admin_user_detail', { p_user_id: userId });
    if (error) throw error;
    return data || {};
  };

  // Patch a user's profile (admin only). Accepts: { name, handle, bio, verified, avatar_url }
  API.adminUpdateProfile = async (userId, patch) => {
    const c = await client();
    const allowed = ['name', 'handle', 'bio', 'verified', 'avatar_url'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if (!Object.keys(clean).length) return;
    const { error } = await c.from('profiles').update(clean).eq('id', userId);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'update_profile', target_type: 'user', target_id: userId, payload: clean });
  };

  // ---------- Admin: support desk ----------
  API.adminFetchTickets = async (status = 'all') => {
    const c = await client();
    let q = c.from('support_tickets')
      .select('*, profiles:profiles!support_tickets_user_id_fkey(id,name,handle,avatar_url)')
      .order('created_at', { ascending: false }).limit(200);
    if (status !== 'all') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  API.adminReplyTicket = async (id, reply, status = 'resolved') => {
    const c = await client(); const me = await uid();
    const { error } = await c.from('support_tickets').update({
      admin_reply: reply,
      status,
      replied_at: new Date().toISOString(),
      replied_by: me,
    }).eq('id', id);
    if (error) throw error;
  };

  API.adminSetTicketStatus = async (id, status) => {
    const c = await client();
    const { error } = await c.from('support_tickets').update({ status }).eq('id', id);
    if (error) throw error;
  };

  // ---------- Admin: data export requests ----------
  API.adminFetchExports = async () => {
    const c = await client();
    const { data, error } = await c.from('data_export_requests')
      .select('*, profiles:profiles!data_export_requests_user_id_fkey(id,name,handle,avatar_url)')
      .order('requested_at', { ascending: false }).limit(200);
    if (error) throw error;
    return data || [];
  };

  API.adminCompleteExport = async (id, fileUrl) => {
    const c = await client();
    const { error } = await c.from('data_export_requests').update({
      status: 'ready', file_url: fileUrl, completed_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  };

  API.adminFailExport = async (id) => {
    const c = await client();
    const { error } = await c.from('data_export_requests')
      .update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  };

  // ---------- Admin: deletion queue ----------
  API.adminPendingDeletions = async () => {
    const c = await client();
    const { data, error } = await c.rpc('admin_pending_deletions');
    if (error) throw error;
    return data || [];
  };

  API.adminCancelDeletion = async (userId) => {
    const c = await client();
    const { error } = await c.rpc('admin_cancel_deletion', { p_user: userId });
    if (error) throw error;
  };

  // ---------- Admin: storage and limits ----------
  API.adminStorageOverview = async () => {
    const c = await client();
    const { data, error } = await c.rpc('admin_storage_overview');
    if (error) throw error;
    return data;
  };

  API.adminQueueCounts = async () => {
    const c = await client();
    const { data, error } = await c.rpc('admin_queue_counts');
    if (error) return null;   // migration not applied yet
    return data;
  };

  API.adminGrowth = async (days = 30) => {
    const c = await client();
    const { data, error } = await c.rpc('admin_growth', { p_days: days });
    if (error) return [];
    return data || [];
  };

  // ---------- Admin: live locations ----------
  // Only rows that are actually being shared, so the page reflects what other
  // people can really see rather than every row in the table.
  API.adminFetchLocations = async () => {
    const c = await client();
    const { data, error } = await c.from('user_locations')
      .select('user_id, lat, lng, visibility, sharing_enabled, updated_at, profiles:profiles!user_locations_user_id_fkey(id,name,handle,avatar_url)')
      .eq('sharing_enabled', true)
      .order('updated_at', { ascending: false }).limit(200);
    if (error) throw error;
    return (data || []).filter(r => r.lat != null && r.lng != null);
  };

  // Adjust wallet balance by `delta` (positive or negative). Goes through SECURITY DEFINER RPC.
  API.adminAdjustWallet = async (userId, delta, reason) => {
    const c = await client();
    const { data, error } = await c.rpc('admin_adjust_wallet', { p_user_id: userId, p_delta: delta, p_reason: reason || null });
    if (error) throw error;
    return data; // new balance
  };

  // Hard-delete a user (cascades to videos, wallet, etc. via FK on delete cascade)
  API.adminDeleteUser = async (userId) => {
    const c = await client();
    // Removes the login, which cascades to the profile and everything under
    // it. Deleting the profile directly left the email registered forever,
    // so the person could never sign up again. The function writes its own
    // admin_logs entry.
    const { error } = await c.rpc('admin_delete_user', { p_user: userId });
    if (!error) return;
    // Before 0039 the function does not exist; fall back to the old path so
    // the button still works on a database that has not been migrated yet.
    if (!/does not exist|Could not find/i.test(error.message || '')) throw error;
    const { error: e2 } = await c.from('profiles').delete().eq('id', userId);
    if (e2) throw e2;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'delete_user', target_type: 'user', target_id: userId });
  };

  API.adminFetchVideos = async ({ status = 'all', search = '' } = {}) => {
    const c = await client();
    let q = c.from('videos').select(`
      id, description, thumbnail, video_url, privacy, likes_count, comments_count, views_count, is_draft, created_at,
      user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url )
    `).order('created_at', { ascending: false }).limit(200);
    if (status === 'published') q = q.eq('is_draft', false);
    if (status === 'draft') q = q.eq('is_draft', true);
    if (search) q = q.ilike('description', `%${search}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  // Deleting your own post. Needs 0068 applied; before that the delete
  // removes nothing and this reports it honestly rather than claiming success.
  //
  // The file goes too, which it did not use to. 0068 deliberately left the
  // bytes in R2 and recorded why: a delete path that could remove the wrong
  // file is worse than paying for orphans. That is still true, and it is the
  // Edge Function's problem rather than this one's - it refuses unless the
  // object is yours and nothing anywhere still references it. What changed is
  // the other side of the trade: those orphans are not just bytes on a bill,
  // they are world-readable copies of something a person asked to delete.
  API.deleteVideo = async (videoId) => {
    const c = await client();

    // Read the URLs while the row that holds them still exists. Nothing else
    // in the app records which objects belonged to which post, so there is no
    // second chance at this - but a failure here costs only the cleanup, never
    // the delete, so it stays inside its own try.
    let media = [];
    try {
      const { data: v } = await c.from('videos')
        .select('video_url, thumbnail').eq('id', videoId).maybeSingle();
      if (v) media = [v.video_url, v.thumbnail];
    } catch (e) {}

    // .select() so a policy-blocked delete is distinguishable from a real one:
    // deleting a row you may not delete removes nothing and raises nothing.
    const { data, error } = await c.from('videos').delete().eq('id', videoId).select('id');
    if (error) throw error;
    if (!data || !data.length) throw new Error('لا يمكنك حذف هذا المقطع');

    // Only past the two guards above, and only ever on a delete that really
    // happened. A refused delete leaves the post standing, and its file with it.
    releaseMedia(media);

    invalidate('feed:');
    invalidate('uservideos:');
    return true;
  };

  // Same shape as deleteVideo, and the same order for the same reasons: read
  // the URLs while the row exists, release the bytes only once it does not.
  //
  // The object belongs to the person who posted it, not to the admin running
  // this, so the Edge Function's ownership check passes here on `is_admin()`
  // rather than on a matching user_id. It reads that flag as the CALLER, so
  // this cannot be used to delete somebody's media by claiming to be staff.
  API.adminDeleteVideo = async (videoId) => {
    const c = await client();

    let media = [];
    try {
      const { data: v } = await c.from('videos')
        .select('video_url, thumbnail').eq('id', videoId).maybeSingle();
      if (v) media = [v.video_url, v.thumbnail];
    } catch (e) {}

    const { error } = await c.from('videos').delete().eq('id', videoId);
    if (error) throw error;
    releaseMedia(media);
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'delete_video', target_type: 'video', target_id: videoId });
  };

  API.adminFetchComments = async ({ search = '' } = {}) => {
    const c = await client();
    let q = c.from('comments').select(`
      id, text, video_id, created_at,
      user:profiles!comments_user_id_fkey ( id, name, handle, avatar_url )
    `).order('created_at', { ascending: false }).limit(200);
    if (search) q = q.ilike('text', `%${search}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  API.adminDeleteComment = async (commentId) => {
    const c = await client();
    const { error } = await c.from('comments').delete().eq('id', commentId);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'delete_comment', target_type: 'comment', target_id: commentId });
  };

  API.adminFetchReports = async ({ status = 'pending', target_type = '' } = {}) => {
    const c = await client();
    let q = c.from('reports').select(`
      id, target_type, target_id, reason, status, action_taken, created_at, resolved_at,
      reporter:profiles!reports_reporter_id_fkey ( id, name, handle, avatar_url )
    `).order('created_at', { ascending: false }).limit(200);
    if (status) q = q.eq('status', status);
    if (target_type) q = q.eq('target_type', target_type);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  API.adminResolveReport = async (id, { action, status = 'resolved' }) => {
    const c = await client();

    // If dismissing as a false report, reverse any auto-hide that report may have triggered.
    if (status === 'dismissed') {
      const { data: report } = await c.from('reports').select('target_type, target_id').eq('id', id).single();
      if (report && (report.target_type === 'video' || report.target_type === 'comment')) {
        try { await c.rpc('admin_unhide_content', { p_target_type: report.target_type, p_target_id: report.target_id }); }
        catch (e) { console.warn('admin_unhide_content failed:', e.message); }
      }
    }

    const { error } = await c.from('reports').update({ status, action_taken: action || null, resolved_by: await uid(), resolved_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'resolve_report', target_type: 'report', target_id: id, payload: { action } });
  };

  API.adminFetchLiveStreams = async () => {
    const c = await client();
    const { data, error } = await c.from('live_streams').select(`
      id, title, thumbnail, viewer_count, started_at, status, ended_at,
      host:profiles!live_streams_host_id_fkey ( id, name, handle, avatar_url )
    `).order('started_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
  };

  API.adminEndLive = async (id) => {
    const c = await client();
    const { error } = await c.from('live_streams').update({ status: 'banned', ended_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'end_live', target_type: 'live_stream', target_id: id });
  };

  API.adminFetchLogs = async ({ limit = 100 } = {}) => {
    const c = await client();
    const { data, error } = await c.from('admin_logs').select(`
      id, action, target_type, target_id, payload, ip, created_at,
      admin:profiles!admin_logs_admin_id_fkey ( id, name, avatar_url )
    `).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  };

  // Ads
  API.adminFetchAds = async () => {
    const c = await client();
    const { data, error } = await c.from('ads').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  API.adminCreateAd = async (row) => {
    const c = await client(); const me = await uid();
    const { data, error } = await c.from('ads').insert({ ...row, created_by: me }).select().single();
    if (error) throw error;
    return data;
  };

  API.adminUpdateAd = async (id, patch) => {
    const c = await client();
    const { error } = await c.from('ads').update(patch).eq('id', id);
    if (error) throw error;
  };

  API.adminDeleteAd = async (id) => {
    const c = await client();
    const { error } = await c.from('ads').delete().eq('id', id);
    if (error) throw error;
  };

  // Notifications composer
  API.adminBroadcastNotification = async ({ title, body, target = {} }) => {
    const c = await client();
    let q = c.from('profiles').select('id');
    if (target.region) q = q.ilike('bio', `%${target.region}%`);
    const { data: targets } = await q.limit(10000);
    const rows = (targets || []).map(t => ({
      user_id: t.id,
      type: 'system',
      payload: { title, body },
    }));
    if (!rows.length) return 0;
    // Insert in chunks of 1000
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const { error } = await c.from('notifications').insert(chunk);
      if (error) throw error;
      inserted += chunk.length;
    }
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'broadcast_notification', target_type: 'system', target_id: null, payload: { title, count: inserted } });
    return inserted;
  };

  window.API = API;
})();
