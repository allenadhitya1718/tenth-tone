/* === Video Compression Pipeline ===
 * Compresses a video File to ≤720p / ≤8Mbps before upload.
 * Strategy (in priority order):
 *   1. MediaRecorder re-encode  — works on all Capacitor/Chromium runtimes
 *   2. Pass-through             — if file is already small enough, skip compression
 *
 * Usage:
 *   const check = await window.Compress.validate(file);        // { ok, reason, duration }
 *   const result = await window.Compress.video(file, { onProgress });
 *   // result: { file: File, originalSize, compressedSize, skipped: bool }
 */
window.Compress = (function () {

  const MAX_SIZE_BYTES     = 50 * 1024 * 1024;   // skip compression if under 50 MB
  const TARGET_WIDTH       = 720;                  // max long-edge px
  const TARGET_HEIGHT      = 1280;
  const TARGET_BITRATE     = 2_500_000;           // 2.5 Mbps video
  const AUDIO_BITRATE      = 128_000;             // 128 kbps audio

  const MAX_UPLOAD_BYTES   = 60 * 1024 * 1024;    // hard reject above 60 MB (raw, pre-compression);
                                                 // matches the storage bucket cap set in 0031
  const MAX_DURATION_SECS  = 90;                  // hard reject above 1.5 minutes

  // Reads video duration without fully decoding the file.
  function readDuration(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const d = v.duration;
        URL.revokeObjectURL(url);
        resolve(isFinite(d) ? d : null);
      };
      v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الفيديو')); };
      v.src = url;
    });
  }

  // Validates a chosen file against size/duration limits before compression/upload.
  // Returns { ok: true, duration } or { ok: false, reason: 'size' | 'duration' | 'read-error', message }
  async function validate(file) {
    if (!file) return { ok: false, reason: 'read-error', message: 'لم يتم اختيار ملف' };

    if (file.size > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        reason: 'size',
        message: `حجم الملف كبير جدًا (الحد الأقصى ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} ميجابايت)`,
      };
    }

    if (!file.type.startsWith('video/')) {
      return { ok: true, duration: null };
    }

    try {
      const duration = await readDuration(file);
      if (duration != null && duration > MAX_DURATION_SECS) {
        return {
          ok: false,
          reason: 'duration',
          message: `مدة الفيديو طويلة جدًا (الحد الأقصى ${MAX_DURATION_SECS} ثانية)`,
        };
      }
      return { ok: true, duration };
    } catch (e) {
      // Can't read duration — let it through, upload/compress step will surface any real failure
      return { ok: true, duration: null };
    }
  }

  function pickMime() {
    const candidates = [
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const m of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  function scaleDimensions(vw, vh) {
    const ratio = Math.min(TARGET_WIDTH / vw, TARGET_HEIGHT / vh, 1);
    return {
      w: Math.round(vw * ratio / 2) * 2,   // keep even (required by most codecs)
      h: Math.round(vh * ratio / 2) * 2,
    };
  }

  async function compressViaMediaRecorder(file, onProgress) {
    return new Promise((resolve, reject) => {
      const src = URL.createObjectURL(file);
      const video = Object.assign(document.createElement('video'), {
        src, muted: true, playsInline: true,
      });
      video.setAttribute('playsinline', '');

      video.onloadedmetadata = () => {
        const { w, h } = scaleDimensions(video.videoWidth || 720, video.videoHeight || 1280);

        const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = canvas.getContext('2d');

        // Capture canvas stream at 30 fps
        const canvasStream = canvas.captureStream(30);

        // Try to add audio from the source video
        let audioStream = null;
        try {
          audioStream = video.captureStream ? video.captureStream(30) : null;
          if (audioStream) {
            audioStream.getAudioTracks().forEach(t => canvasStream.addTrack(t));
          }
        } catch (_) { /* audio capture not available — video-only */ }

        const mimeType = pickMime();
        let recorder;
        try {
          const opts = { videoBitsPerSecond: TARGET_BITRATE };
          if (mimeType) opts.mimeType = mimeType;
          if (audioStream) opts.audioBitsPerSecond = AUDIO_BITRATE;
          recorder = new MediaRecorder(canvasStream, opts);
        } catch (e) {
          URL.revokeObjectURL(src);
          reject(e);
          return;
        }

        const chunks = [];
        recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

        recorder.onstop = () => {
          URL.revokeObjectURL(src);
          const ext = (mimeType || '').includes('mp4') ? 'mp4' : 'webm';
          const type = mimeType || ('video/' + ext);
          const blob = new Blob(chunks, { type });
          const name = file.name.replace(/\.[^.]+$/, '') + '-compressed.' + ext;
          resolve(new File([blob], name, { type }));
        };

        recorder.onerror = e => {
          URL.revokeObjectURL(src);
          reject(e.error || new Error('MediaRecorder error'));
        };

        recorder.start();

        let rafId;
        function drawFrame() {
          ctx.drawImage(video, 0, 0, w, h);
          if (onProgress && video.duration) {
            onProgress(Math.min(video.currentTime / video.duration, 0.99));
          }
          rafId = requestAnimationFrame(drawFrame);
        }

        video.onended = () => {
          cancelAnimationFrame(rafId);
          recorder.stop();
          canvasStream.getTracks().forEach(t => t.stop());
        };

        video.onerror = () => {
          cancelAnimationFrame(rafId);
          try { recorder.stop(); } catch (_) {}
          URL.revokeObjectURL(src);
          reject(new Error('Video load error during compression'));
        };

        video.play().then(() => {
          drawFrame();
        }).catch(e => {
          URL.revokeObjectURL(src);
          reject(e);
        });
      };

      video.onerror = () => {
        URL.revokeObjectURL(src);
        reject(new Error('Failed to load video for compression'));
      };

      video.load();
    });
  }

  async function video(file, { onProgress } = {}) {
    if (!file || !file.type.startsWith('video/')) {
      // Not a video (e.g. image) — pass through unchanged
      return { file, originalSize: file.size, compressedSize: file.size, skipped: true, reason: 'not-video' };
    }

    if (file.size <= MAX_SIZE_BYTES) {
      // Already small enough — skip
      return { file, originalSize: file.size, compressedSize: file.size, skipped: true, reason: 'small-enough' };
    }

    if (!window.MediaRecorder) {
      // Runtime doesn't support MediaRecorder
      return { file, originalSize: file.size, compressedSize: file.size, skipped: true, reason: 'no-mediarecorder' };
    }

    try {
      const compressed = await compressViaMediaRecorder(file, onProgress);
      if (onProgress) onProgress(1);

      // Sanity check: if compression made it larger, use original
      if (compressed.size >= file.size) {
        return { file, originalSize: file.size, compressedSize: file.size, skipped: true, reason: 'no-gain' };
      }

      return {
        file: compressed,
        originalSize: file.size,
        compressedSize: compressed.size,
        skipped: false,
        reason: 'compressed',
      };
    } catch (err) {
      console.warn('[Compress] compression failed, using original:', err);
      return { file, originalSize: file.size, compressedSize: file.size, skipped: true, reason: 'error', err };
    }
  }

  // ── Trim ──
  // Re-encodes only the selected range, reusing the same canvas +
  // MediaRecorder path as compression. Runs in real time: trimming 8 seconds
  // takes about 8 seconds, because the browser has no way to cut an encoded
  // video without decoding it.
  function trim(file, startSec, endSec, { onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const src = URL.createObjectURL(file);
      const video = Object.assign(document.createElement('video'), {
        src, muted: false, playsInline: true,
      });
      video.setAttribute('playsinline', '');

      const cleanup = () => { try { URL.revokeObjectURL(src); } catch (_) {} };

      video.onloadedmetadata = () => {
        const total = video.duration || 0;
        const from = Math.max(0, Math.min(startSec || 0, total));
        const to = Math.min(total, Math.max(from + 0.2, endSec == null ? total : endSec));
        const span = to - from;

        const { w, h } = scaleDimensions(video.videoWidth || 720, video.videoHeight || 1280);
        const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = canvas.getContext('2d');
        const canvasStream = canvas.captureStream(30);

        try {
          const a = video.captureStream ? video.captureStream(30) : null;
          if (a) a.getAudioTracks().forEach(t => canvasStream.addTrack(t));
        } catch (_) { /* video-only */ }

        const mimeType = pickMime();
        let recorder;
        try {
          const opts = { videoBitsPerSecond: TARGET_BITRATE };
          if (mimeType) opts.mimeType = mimeType;
          recorder = new MediaRecorder(canvasStream, opts);
        } catch (e) { cleanup(); reject(e); return; }

        const chunks = [];
        let rafId = null;
        let stopped = false;

        recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = () => {
          cleanup();
          const ext = (mimeType || '').includes('mp4') ? 'mp4' : 'webm';
          const type = mimeType || ('video/' + ext);
          const blob = new Blob(chunks, { type });
          const name = file.name.replace(/\.[^.]+$/, '') + '-trimmed.' + ext;
          resolve(new File([blob], name, { type }));
        };
        recorder.onerror = e => { cleanup(); reject(e.error || new Error('MediaRecorder error')); };

        function finish() {
          if (stopped) return;
          stopped = true;
          if (rafId) cancelAnimationFrame(rafId);
          try { video.pause(); } catch (_) {}
          try { recorder.stop(); } catch (_) {}
          canvasStream.getTracks().forEach(t => t.stop());
        }

        function draw() {
          if (stopped) return;
          ctx.drawImage(video, 0, 0, w, h);
          if (onProgress && span > 0) {
            onProgress(Math.max(0, Math.min((video.currentTime - from) / span, 0.99)));
          }
          if (video.currentTime >= to) { finish(); return; }
          rafId = requestAnimationFrame(draw);
        }

        video.onended = finish;
        video.onerror = () => { finish(); cleanup(); reject(new Error('Video load error during trim')); };

        video.onseeked = () => {
          video.onseeked = null;
          recorder.start();
          video.play().then(draw).catch(err => { cleanup(); reject(err); });
        };
        video.currentTime = from;
      };

      video.onerror = () => { cleanup(); reject(new Error('تعذر قراءة الفيديو')); };
    });
  }

  return { video, validate, trim, readDuration, MAX_UPLOAD_BYTES, MAX_DURATION_SECS };
})();
