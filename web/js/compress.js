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

  // 720 on the short edge, 1280 on the long one, whichever way the clip is
  // held. Briefly 1080x1920 after testers called uploads "low resolution",
  // but the real cause of that was the in-app camera opening at 640x480 -
  // and on an iPhone, where the phone's own recorder chooses the bitrate,
  // 1080p clips carried about twice the data of 720p ones for a difference
  // nobody can see on a phone screen. Instagram serves 720p to most phones.
  const TARGET_SHORT_EDGE  = 720;
  const TARGET_LONG_EDGE   = 1280;
  // Kept for the messages and callers that think in portrait terms.
  const TARGET_WIDTH       = TARGET_SHORT_EDGE;
  const TARGET_HEIGHT      = TARGET_LONG_EDGE;

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
  // 1.2 Mbps at 720x1280 with the High profile where the encoder has it
  // (see pickAvcCodec): about 2.4 MB for a 15-second reel, against 4-7 MB
  // before. Only the WebCodecs path honours this number at all.
  const TARGET_BITRATE     = 1_200_000;           // 1.2 Mbps video
  const AUDIO_BITRATE      = 128_000;             // 128 kbps audio

  // What MediaRecorder produces at 720p when left to itself - measured at
  // 1.98-2.0 Mbps on the iPhone uploads in the library. On the runtimes
  // where MediaRecorder is the only encoder (iOS), re-encoding a clip that
  // is already this size and this rate cannot make it smaller; it only
  // makes the person wait the clip's own length for an identical file.
  const MR_NATIVE_BITRATE  = 2_000_000;

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
    // Bare 'video/mp4' is deliberately NOT a candidate. When H.264 is
    // unavailable Chrome accepts it and fills the mp4 container with VP9,
    // producing a file named .mp4 that iOS cannot decode - and because the
    // extension is derived from the container, nothing downstream notices.
    // Every mp4 candidate here names its codec, so an mp4 we produce is
    // always H.264. Failing that we fall to webm, which is at least
    // honestly labelled.
    const candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=h264,aac',
      'video/mp4;codecs=avc1',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const m of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  // A media element only has an audio track once it has STARTED PLAYING.
  // Both re-encode paths called video.captureStream() from onloadedmetadata -
  // before play() - where getAudioTracks() returns an empty array. Nothing was
  // added, the catch had no error to swallow, and every clip that went through
  // the compressor came out with picture and no sound. That is every video in
  // the library: they are all named `reencoded-` and all report
  // webkitAudioDecodedByteCount 0 while decoding megabytes of video.
  //
  // It also has to happen BEFORE `new MediaRecorder(stream)`. A track added to
  // a MediaStream after the recorder is constructed is not recorded, so moving
  // the capture without also moving the construction would have fixed nothing
  // and looked right.
  //
  // Returns the number of audio tracks attached, so the caller can decide
  // whether to ask for an audio bitrate at all.
  function attachAudio(video, canvasStream) {
    try {
      const s = video.captureStream ? video.captureStream() : null;
      const tracks = s ? s.getAudioTracks() : [];
      tracks.forEach(t => canvasStream.addTrack(t));
      if (tracks.length) return tracks.length;
    } catch (_) { /* fall through to the Web Audio route */ }

    // WebKit has no captureStream() on media elements - only on <canvas> - so
    // on every iPhone the block above attaches nothing and, until this
    // existed, every upload from an iPhone went out silent. Web Audio can tap
    // the same element and hand back a real MediaStreamTrack.
    //
    // The element must not be muted: on WebKit a muted element feeds silence
    // into the graph. Nothing reaches the speakers regardless, because the
    // graph is never connected to the context's destination - rerouting is
    // total. And createMediaElementSource may be called once per element,
    // ever, so the nodes are kept on the element for any later call.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return 0;
      if (!video._ttAudioTap) {
        const ctx = new AC();
        const src = ctx.createMediaElementSource(video);
        const dest = ctx.createMediaStreamDestination();
        src.connect(dest);
        video._ttAudioTap = { ctx, dest };
      }
      const tap = video._ttAudioTap;
      try { tap.ctx.resume(); } catch (_) {}
      if (!video._ttUnmuteGuard) {
        video._ttUnmuteGuard = true;
        // An engine that wanted a gesture before hearing this element answers
        // the unmute below by pausing it. The re-encode must never stall on
        // that: carry on muted, and accept a silent clip over a hung upload.
        // (The app's WebView asks for no gesture, so this is a safety net.)
        video.addEventListener('pause', () => {
          if (video._ttDone || video.ended) return;
          video.muted = true;
          video.play().catch(() => {});
        });
      }
      video.muted = false;
      video.volume = 1;
      const tracks = tap.dest.stream.getAudioTracks();
      tracks.forEach(t => canvasStream.addTrack(t));
      return tracks.length;
    } catch (_) {
      return 0;   // a source with no audio at all is normal, not an error
    }
  }

  // Reads duration AND frame size in one metadata load.
  function readMeta(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const d = v.duration;
        const out = { duration: isFinite(d) ? d : null, w: v.videoWidth || 0, h: v.videoHeight || 0 };
        URL.revokeObjectURL(url);
        resolve(out);
      };
      v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الفيديو')); };
      v.src = url;
    });
  }

  // H.264 profile and level for the WebCodecs encoder, chosen by asking. The
  // string used to be fixed at Baseline 3.1 ('avc1.42001f'): Baseline is the
  // least efficient profile there is - High gets the same picture from
  // noticeably fewer bits - and level 3.1 tops out at exactly 720x1280, so a
  // larger frame made the encoder close itself, the whole WebCodecs path was
  // abandoned, and the MediaRecorder fallback then produced a file at
  // whatever rate it liked (measured: 9 Mbps). High, then Main, then
  // Baseline; the level that fits the frame, then one bigger.
  async function pickAvcCodec(w, h, bitrate) {
    const big = w * h > 1280 * 720;
    const levels = big ? ['2a', '28'] : ['1f', '28', '2a'];  // 4.2, 4.0 / 3.1, 4.0, 4.2
    for (const lv of levels) {
      for (const pf of ['64', '4d', '42']) {                   // High, Main, Baseline
        const codec = 'avc1.' + pf + '00' + lv;
        try {
          const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: 30, avc: { format: 'avc' } });
          if (r && r.supported) return codec;
        } catch (_) { /* try the next one */ }
      }
    }
    return 'avc1.42001f';
  }

  // Fits the frame inside 720 x 1280 whichever way round it is. This used to
  // treat the two numbers as width and height, so a landscape 1920x1080 clip
  // was squeezed to 720x405.
  function scaleDimensions(vw, vh) {
    const long = Math.max(vw, vh), short = Math.min(vw, vh);
    const ratio = Math.min(TARGET_LONG_EDGE / long, TARGET_SHORT_EDGE / short, 1);
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

        // Audio is attached inside play() below, not here - see attachAudio().
        const mimeType = pickMime();
        const chunks = [];
        let recorder = null;
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
          try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
          canvasStream.getTracks().forEach(t => t.stop());
        };

        video.onerror = () => {
          cancelAnimationFrame(rafId);
          try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
          URL.revokeObjectURL(src);
          reject(new Error('Video load error during compression'));
        };

        // play() FIRST, then capture the audio, then build the recorder. A
        // track added after construction is not recorded, so all three have to
        // happen in this order.
        video.play().then(() => {
          const nAudio = attachAudio(video, canvasStream);
          try {
            const opts = { videoBitsPerSecond: TARGET_BITRATE };
            if (mimeType) opts.mimeType = mimeType;
            if (nAudio) opts.audioBitsPerSecond = AUDIO_BITRATE;
            recorder = new MediaRecorder(canvasStream, opts);
          } catch (e) { URL.revokeObjectURL(src); reject(e); return; }

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
        // mp4-muxer defaults to 'strict', which THROWS unless the first video
        // chunk lands at DTS exactly 0. Measured first DTS of 6.941s and
        // 15.924s on real clips when the encoder was briefly saturated at
        // startup. Belt and braces with the frame-0 guard above: that keeps the
        // rebase sub-frame, so this can never introduce A/V desync.
        firstTimestampBehavior: 'offset',
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
      const codec = await pickAvcCodec(w, h, TARGET_BITRATE);
      vEnc.configure({
        codec, width: w, height: h,
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
          // The first frame must never be dropped. Dropping one mid-stream
          // costs a frame; dropping the FIRST moves the track's first timestamp
          // off zero, which the muxer refuses outright (see
          // firstTimestampBehavior below) - and the whole WebCodecs path is
          // then abandoned for a fallback that stretches the clip, which the
          // drift guard also throws away, so the ORIGINAL uncompressed file is
          // uploaded after 40-60s of apparent work.
          if (vEnc.encodeQueueSize <= 8 || frameCount === 0) {
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

    // MediaRecorder is the only encoder here (every iPhone). It cannot be
    // told a bitrate, so a clip that already fits the frame and is already
    // at the rate it would produce - which is every clip the in-app camera
    // records - would come back the same size after a wait as long as the
    // clip itself. Upload it as it is.
    if (!webCodecsSupported()) {
      const meta = await readMeta(file).catch(() => null);
      if (meta && meta.w && meta.h && meta.duration) {
        const fits = Math.max(meta.w, meta.h) <= TARGET_LONG_EDGE && Math.min(meta.w, meta.h) <= TARGET_SHORT_EDGE;
        const rate = file.size * 8 / meta.duration;
        if (fits && rate <= (MR_NATIVE_BITRATE + AUDIO_BITRATE) * SKIP_MARGIN) {
          return { file, originalSize: file.size, compressedSize: file.size, skipped: true, reason: 'encoder-cannot-shrink' };
        }
      }
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

        const mimeType = pickMime();
        const chunks = [];
        let recorder = null;
        let rafId = null;
        let stopped = false;

        function finish() {
          if (stopped) return;
          stopped = true;
          if (rafId) cancelAnimationFrame(rafId);
          video._ttDone = true;   // an intended pause - see attachAudio()
          try { video.pause(); } catch (_) {}
          try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
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
          // play() FIRST, then capture, then build the recorder. See
          // attachAudio(): the order is the whole bug.
          video.play().then(() => {
            const nAudio = attachAudio(video, canvasStream);
            try {
              const opts = { videoBitsPerSecond: TARGET_BITRATE };
              if (mimeType) opts.mimeType = mimeType;
              if (nAudio) opts.audioBitsPerSecond = AUDIO_BITRATE;
              recorder = new MediaRecorder(canvasStream, opts);
            } catch (e) { cleanup(); reject(e); return; }

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

            recorder.start();
            draw();
          }).catch(err => { cleanup(); reject(err); });
        };
        video.currentTime = from;
      };

      video.onerror = () => { cleanup(); reject(new Error('تعذر قراءة الفيديو')); };
    });
  }

  return { video, validate, trim, readDuration, MAX_UPLOAD_BYTES, MAX_DURATION_SECS };
})();
