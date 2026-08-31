/* === On-device nudity check (NSFWJS) ===
 * Runs entirely in the browser — no server, no account, no cost.
 * Checks a chosen video/image BEFORE it's uploaded and flags it if
 * it looks like nudity/pornographic content.
 *
 * Usage:
 *   const result = await window.NSFWCheck.checkFile(file);
 *   // result: { flagged: bool, reason: string|null }
 *
 * Note: this is a client-side safety net, not a server-enforced
 * guarantee — see 0015_ai_moderation.sql for the reactive
 * (report-based) system that backstops anything that gets through.
 */
window.NSFWCheck = (function () {

  // Flag if any sampled frame scores above these thresholds.
  // "Sexy" (swimwear/lingerie-type images) gets a looser threshold
  // than outright Porn/Hentai to avoid over-blocking normal content.
  const THRESHOLDS = { Porn: 0.7, Hentai: 0.7, Sexy: 0.85 };
  const SAMPLE_COUNT = 4; // frames checked per video (evenly spaced)

  let libsPromise = null;
  function loadLibs() {
    if (libsPromise) return libsPromise;
    libsPromise = (async () => {
      if (!window.tf) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
      if (!window.nsfwjs) await loadScript('https://cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist/browser/nsfwjs.min.js');
    })();
    return libsPromise;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('تعذر تحميل مكتبة الفحص'));
      document.head.appendChild(s);
    });
  }

  // Self-hosted model (web/nsfw-model/) instead of NSFWJS's default model
  // host — the default host is known to be unreliable (see the project's
  // own README recommendation to self-host for production).
  const MODEL_URL = 'nsfw-model/mobilenet_v2/model.json';

  let modelPromise = null;
  function loadModel() {
    if (modelPromise) return modelPromise;
    modelPromise = loadLibs().then(() => window.nsfwjs.load(MODEL_URL));
    return modelPromise;
  }

  function evaluatePredictions(predictions) {
    for (const p of predictions) {
      const threshold = THRESHOLDS[p.className];
      if (threshold != null && p.probability >= threshold) {
        return { flagged: true, reason: 'يبدو أن هذا المحتوى يحتوي على مواد غير لائقة ولا يمكن نشره' };
      }
    }
    return { flagged: false, reason: null };
  }

  function grabFrame(video, t) {
    return new Promise((resolve, reject) => {
      function onSeeked() {
        video.removeEventListener('seeked', onSeeked);
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 224;
        canvas.height = video.videoHeight || 224;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      }
      video.addEventListener('seeked', onSeeked);
      video.currentTime = t;
    });
  }

  async function checkVideo(file) {
    const model = await loadModel();
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    try {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error('تعذر قراءة الفيديو للفحص'));
      });

      const duration = video.duration || 0;
      const timestamps = [];
      for (let i = 1; i <= SAMPLE_COUNT; i++) {
        timestamps.push((duration * i) / (SAMPLE_COUNT + 1));
      }

      for (const t of timestamps) {
        const canvas = await grabFrame(video, t);
        const predictions = await model.classify(canvas);
        const result = evaluatePredictions(predictions);
        if (result.flagged) return result;
      }

      return { flagged: false, reason: null };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function checkImage(file) {
    const model = await loadModel();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;

    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('تعذر قراءة الصورة للفحص'));
      });
      const predictions = await model.classify(img);
      return evaluatePredictions(predictions);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Checks a video or image File. Fails open (returns not-flagged) if the
  // check itself errors out — a broken check shouldn't block legitimate
  // uploads; the reactive report system remains the backstop either way.
  async function checkFile(file) {
    if (!file) return { flagged: false, reason: null };
    try {
      if (file.type.startsWith('video/')) return await checkVideo(file);
      if (file.type.startsWith('image/')) return await checkImage(file);
      return { flagged: false, reason: null };
    } catch (err) {
      console.warn('[NSFWCheck] check failed, allowing upload:', err);
      return { flagged: false, reason: null };
    }
  }

  // Starts the download and the TensorFlow warm-up without checking
  // anything. Measured cost of a cold checkFile(): 12.8 SECONDS, nearly all of
  // it fetching and initialising the model rather than looking at the video.
  // Called when the camera screen opens, that happens while the person is
  // still filming, and by the time they stop it is already in memory.
  //
  // Safe to call repeatedly: loadModel() memoises, so extra calls return the
  // same promise. Failures are swallowed — a warm-up that fails must not break
  // the screen, and checkFile() will simply pay the cost later.
  function warmUp() {
    try { loadModel().catch(() => {}); } catch (e) {}
  }

  return { checkFile, warmUp };
})();
