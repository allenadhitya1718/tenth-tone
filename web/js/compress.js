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

  const TARGET_WIDTH       = 720;                  // max long-edge px
  const TARGET_HEIGHT      = 1280;

  // 1.4 Mbps at 720x1280. The previous 2.5 Mbps was set for 1080p and never
  // actually ran (see SKIP_FLOOR_BYTES below), so in practice clips uploaded
  // at whatever the phone recorded — measured at ~2.9 Mbps and 1080x1920,
  // about 5 MB for a 14-second clip. At 720x1280 the frame carries 55% fewer
  // pixels, so 1.4 Mbps holds similar visible quality on a phone screen and
  // roughly halves the file.
  //
  // Bandwidth is the real cost on a video app — storage is capped at 9 GB by
  // 0031 and sits at 147 MB, while egress has no cap at all.
  // Lowered from 1.4 to 1.1 Mbps. Instagram delivers roughly 0.7-1.3 Mbps,
  // but it gets there with adaptive streaming and server-side multi-pass
  // encoding; a single-pass browser encode at the bottom of that range looks
  // visibly worse. 1.1 sits inside their range with room for one file to
  // serve every connection, since we store one rendition, not a ladder.
  const TARGET_BITRATE     = 1_100_000;           // 1.1 Mbps video
  const AUDIO_BITRATE      = 128_000;             // 128 kbps audio

  // Used only when a file's duration cannot be read. Nothing this pipeline
  // produces for a clip worth compressing lands under 2 MB, so below that
  // there is nothing to gain.
  const SKIP_FLOOR_BYTES   = 2 * 1024 * 1024;

  // Re-encoding within a whisker of the target costs quality and gains
  // nothing, so allow this much headroom before bothering.
  const SKIP_MARGIN        = 1.15;

  const MAX_UPLOAD_BYTES   = 60 * 1024 * 1024;    // hard reject above 60 MB (raw, pre-compression);
                                                 // matches the storage bucket cap set in 0031
  const MAX_DURATION_SECS  = 90;                  // hard reject above 1.5 minutes

  // How far the re-encoded clip may drift from the source before it is thrown
  // away. The canvas + MediaRecorder path records in WALL-CLOCK time, so when
  // the encode cannot keep up with playback the recording simply runs on past
  // the end of the video: measured at 13.0s in, 24.6s out, with the bitrate
  // collapsing to 0.08 Mbps. That is a slow-motion, badly degraded clip, and
  // it was being uploaded silently while the screen reported "95% saved".
  const DURATION_TOLERANCE = 0.10;                // 10%

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

  // Decides whether re-encoding is worth doing.
  //
  // This replaces a flat "skip anything under 50 MB" rule, which meant
  // compression never ran even once: the storage bucket rejects uploads above
  // 60 MB, and phone clips capped at 90 seconds land far below 50 MB. Every
  // video in the library was uploaded exactly as the camera recorded it.
  //
  // A fixed threshold cannot work here because the right size depends on
  // LENGTH. 4 MB is bloated for 10 seconds and already lean for 90. So compare
  // against what this pipeline would actually produce for THIS clip, and skip
  // only when the file is already at or below that.
  async function alreadySmallEnough(file) {
    let duration = null;
    try {
      duration = await readDuration(file);
    } catch (e) {
      // Unreadable metadata is not a reason to fail the upload; fall through
      // to the floor and let the encoder decide.
    }

    if (duration == null || !isFinite(duration) || duration <= 0) {
      return file.size <= SKIP_FLOOR_BYTES;
    }

    const targetBytes = duration * (TARGET_BITRATE + AUDIO_BITRATE) / 8;
    return file.size <= targetBytes * SKIP_MARGIN;
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
        // captureStream samples at 30fps, but requestAnimationFrame fires at
        // the display rate — 60Hz or more — so half of every scale-and-draw
        // was thrown away before it could be sampled. That waste is what
        // pushed the encode below real time, and because MediaRecorder stamps
        // wall-clock time, falling behind is exactly what stretched the output
        // (13.0s in, 24.6s out). Drawing only when a frame is due matches the
        // work to what is actually captured.
        const FRAME_MS = 1000 / 30;
        let lastDraw = -Infinity;
        function drawFrame(now) {
          rafId = requestAnimationFrame(drawFrame);
          const t = typeof now === 'number' ? now : 0;
          if (t - lastDraw < FRAME_MS - 1) return;
          lastDraw = t;
          ctx.drawImage(video, 0, 0, w, h);
          if (onProgress && video.duration) {
            onProgress(Math.min(video.currentTime / video.duration, 0.99));
          }
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

  // ── WebCodecs path ──
  // MediaRecorder ignores videoBitsPerSecond outright: asking for 400 kbps and
  // for 2500 kbps both produced ~2360 kbps, and VP9/VP8 behaved the same way.
  // It runs at a fixed quality we can neither raise nor lower, and on real
  // footage that quality is visibly blocky. VideoEncoder honours `bitrate`,
  // which is the entire reason this path exists.
  //
  // Frames arrive through MediaStreamTrackProcessor, so they carry MEDIA
  // timestamps rather than wall-clock ones. The stretch that MediaRecorder
  // suffered when it fell behind therefore cannot happen here — falling behind
  // costs frames, not duration. It still runs in real time, because the
  // browser has no demuxer to decode a file faster than it plays.
  function webCodecsSupported() {
    return typeof VideoEncoder !== 'undefined'
        && typeof VideoFrame !== 'undefined'
        && typeof MediaStreamTrackProcessor !== 'undefined'
        && !!(window.Mp4Muxer && window.Mp4Muxer.Muxer);
  }

  async function compressViaWebCodecs(file, onProgress) {
    const src = URL.createObjectURL(file);
    const video = Object.assign(document.createElement('video'), {
      src, muted: true, playsInline: true,
    });
    video.setAttribute('playsinline', '');
    // In the document because a detached element is not driven at all. Size and
    // opacity turned out not to matter — throttling follows the window, not the
    // element — so it stays out of the way.
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;' +
                          'opacity:0.01;pointer-events:none;z-index:-1;';
    document.body.appendChild(video);

    const cleanup = () => {
      try { URL.revokeObjectURL(src); } catch (e) {}
      try { video.remove(); } catch (e) {}
    };

    try {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Video load error during compression'));
        video.load();
      });

      const { w, h } = scaleDimensions(video.videoWidth || 720, video.videoHeight || 1280);
      const duration = video.duration || 0;

      const muxer = new window.Mp4Muxer.Muxer({
        target: new window.Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width: w, height: h },
        audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 },
        fastStart: 'in-memory',
      });

      let encodeError = null;
      const vEnc = new VideoEncoder({
        output: (chunk, meta) => {
          try { muxer.addVideoChunk(chunk, meta); } catch (e) { encodeError = e; }
        },
        error: (e) => { encodeError = e; },
      });
      // Configured at the TARGET size while frames arrive at the source size:
      // the encoder rescales them itself. Measured 1080x1920 in, 720x1280 out.
      vEnc.configure({
        codec: 'avc1.42001f', width: w, height: h,
        bitrate: TARGET_BITRATE, framerate: 30, avc: { format: 'avc' },
      });

      // Audio comes off a track, which is fine: audio production is not tied to
      // rendering. Its timestamps are system-clock, so they are rebased to
      // their own zero; both tracks then start at 0, because playback starts
      // them together.
      const stream = video.captureStream ? video.captureStream() : null;
      const aTrack = stream ? (stream.getAudioTracks()[0] || null) : null;
      let audioBase = null;
      let aEnc = null;
      if (aTrack) {
        aEnc = new AudioEncoder({
          output: (chunk, meta) => {
            try {
              if (audioBase === null) audioBase = chunk.timestamp;
              muxer.addAudioChunk(chunk, meta, Math.max(0, chunk.timestamp - audioBase));
            } catch (e) { /* audio is not worth losing the video over */ }
          },
          error: () => {},
        });
        aEnc.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: AUDIO_BITRATE });
      }

      let frameCount = 0, dropped = 0, rafId = null, stopped = false;
      let lastMediaTime = -1;
      const FRAME_US = Math.round(1e6 / 30);
      // Phones commonly record at 60fps; encoding every frame would double the
      // file for motion nobody perceives on a short clip. One frame per ~1/30s
      // of MEDIA time halves it, and works whatever the source rate is.
      const MIN_GAP = 1 / 31;

      const useRVFC = typeof video.requestVideoFrameCallback === 'function';
      function schedule() {
        if (stopped) return;
        if (useRVFC) video.requestVideoFrameCallback(onFrame);
        else rafId = requestAnimationFrame(() => onFrame(0, null));
      }

      function onFrame(now, metadata) {
        schedule();
        if (stopped || video.readyState < 2) return;
        const mediaTime = (metadata && typeof metadata.mediaTime === 'number')
          ? metadata.mediaTime : video.currentTime;
        if (mediaTime - lastMediaTime < MIN_GAP) return;
        lastMediaTime = mediaTime;
        try {
          // Straight from the element. Measured at 0.01ms per frame, against
          // 187ms going through a 2D canvas — that canvas round-trip forced a
          // GPU readback and was the entire reason this ran at 3fps.
          const frame = new VideoFrame(video, {
            timestamp: Math.max(0, Math.round(mediaTime * 1e6)),
            duration: FRAME_US,
          });
          if (vEnc.encodeQueueSize <= 8) {
            vEnc.encode(frame, { keyFrame: frameCount % 60 === 0 });
            frameCount++;
          } else {
            dropped++;
          }
          frame.close();
        } catch (e) { encodeError = encodeError || e; }
        if (onProgress && duration) onProgress(Math.min(mediaTime / duration, 0.99));
      }

      const aReader = (aTrack && aEnc)
        ? new MediaStreamTrackProcessor({ track: aTrack }).readable.getReader() : null;
      const pumpAudio = aReader ? (async () => {
        for (;;) {
          const { value: data, done } = await aReader.read();
          if (done || !data) break;
          try { if (aEnc.encodeQueueSize <= 8) aEnc.encode(data); } catch (e) {}
          data.close();
        }
      })() : Promise.resolve();

      const ended = new Promise((resolve) => {
        video.onended = () => resolve();
        // A stalled file must not hang the upload for ever.
        setTimeout(resolve, Math.max(30000, (duration + 15) * 1000));
      });

      await video.play();
      schedule();
      await ended;
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (aTrack) aTrack.stop();
      await pumpAudio;

      await vEnc.flush();
      if (aEnc) { try { await aEnc.flush(); } catch (e) {} }
      try { vEnc.close(); } catch (e) {}
      if (aEnc) { try { aEnc.close(); } catch (e) {} }
      if (encodeError) throw encodeError;

      const fps = duration ? frameCount / duration : 0;
      console.info('[Compress] webcodecs encoded=' + frameCount + ' dropped=' + dropped +
                   ' fps=' + fps.toFixed(1));
      // Too few frames means a visibly juddering clip. Better to hand back the
      // original than to publish a slideshow.
      if (duration > 1 && fps < 12) throw new Error('too few frames captured (' + fps.toFixed(1) + 'fps)');

      muxer.finalize();
      const buf = muxer.target.buffer;
      cleanup();
      if (onProgress) onProgress(1);
      const name = file.name.replace(/\.[^.]+$/, '') + '-compressed.mp4';
      return new File([buf], name, { type: 'video/mp4' });
    } catch (e) {
      cleanup();
      throw e;
    }
  }

  async function video(file, { onProgress } = {}) {
    if (!file || !file.type.startsWith('video/')) {
      // Not a video (e.g. image) — pass through unchanged
      return { file, originalSize: file.size, compressedSize: file.size, skipped: true, reason: 'not-video' };
    }

    if (await alreadySmallEnough(file)) {
      // Already at or below what re-encoding would produce — skip
      return { file, originalSize: file.size, compressedSize: file.size, skipped: true, reason: 'small-enough' };
    }

    if (!webCodecsSupported() && !window.MediaRecorder) {
      // Nothing here can re-encode; upload what we were given.
      return { file, originalSize: file.size, compressedSize: file.size, skipped: true, reason: 'no-encoder' };
    }

    try {
      // WebCodecs first, because it is the only one of the two that honours a
      // bitrate. MediaRecorder stays as the fallback for runtimes without it —
      // its output is over-compressed and blocky, but a blocky upload beats a
      // failed one, and the duration guard below still applies to both.
      let compressed = null;
      let via = null;
      if (webCodecsSupported()) {
        try {
          compressed = await compressViaWebCodecs(file, onProgress);
          via = 'webcodecs';
        } catch (e) {
          console.warn('[Compress] WebCodecs failed, falling back to MediaRecorder:', e && e.message);
        }
      }
      if (!compressed) {
        if (!window.MediaRecorder) throw new Error('no encoder available');
        compressed = await compressViaMediaRecorder(file, onProgress);
        via = 'mediarecorder';
      }
      if (onProgress) onProgress(1);

      // Sanity check: if compression made it larger, use original
      if (compressed.size >= file.size) {
        return { file, originalSize: file.size, compressedSize: file.size, skipped: true, reason: 'no-gain' };
      }

      // ...and if it came out a different length, it is not the same video.
      // Unverifiable durations fall through rather than blocking the upload:
      // that is how this behaved before, and a clip we cannot measure is not
      // evidence of a bad one.
      const srcDur = await readDuration(file).catch(() => null);
      const outDur = await readDuration(compressed).catch(() => null);
      if (srcDur && outDur && Math.abs(outDur - srcDur) / srcDur > DURATION_TOLERANCE) {
        console.warn('[Compress] output drifted ' + srcDur.toFixed(2) + 's -> ' + outDur.toFixed(2) +
                     's, discarding the re-encode and uploading the original');
        return { file, originalSize: file.size, compressedSize: file.size, skipped: true, reason: 'duration-drift' };
      }

      return {
        file: compressed,
        originalSize: file.size,
        compressedSize: compressed.size,
        skipped: false,
        reason: 'compressed',
        via,
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
