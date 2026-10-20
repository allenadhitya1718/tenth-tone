package expo.modules.flypfxcamera

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.util.Log
import android.util.Rational
import android.util.Size
import android.view.Surface
import android.view.ViewGroup
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.AspectRatio
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.MirrorMode
import androidx.camera.core.Preview
import androidx.camera.core.ResolutionInfo
import androidx.camera.core.UseCase
import androidx.camera.core.UseCaseGroup
import androidx.camera.core.ViewPort
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LiveData
import androidx.lifecycle.Observer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.Executors

private const val TAG = "FlypFxCamera"

// The tag of the one-line size report (adb logcat -s FlypFx).
private const val LOG_FX = "FlypFx"

/**
 * The camera. CameraX Preview + VideoCapture (+ ImageAnalysis for ML Kit) with
 * one [FxEffect] on Preview | VideoCapture: the picture is graded and decorated
 * once, on the GPU, and that finished picture is both shown and recorded.
 */
class FlypFxCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onReady by EventDispatcher<Map<String, Any>>()
  private val onFirstFrame by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any>>()
  private val onFacesCount by EventDispatcher<Map<String, Any>>()
  private val onRecordingFinished by EventDispatcher<Map<String, Any>>()

  override val shouldUseAndroidLayout = true

  private val mainExecutor: Executor = ContextCompat.getMainExecutor(context)
  private val previewView = PreviewView(context).apply {
    // A TextureView, so React Native views can sit on top of it freely.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
    layoutParams = LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
  }
  private val analysisExecutor = Executors.newSingleThreadExecutor()

  // Props (set on the UI thread).
  private var facing = "back"
  private var torch = false
  private var zoom = 1.0
  private var active = true
  private var bitRate = 7_000_000
  private var lookFragment: String? = null
  private var lookUniforms: FloatArray? = null
  private var fxIndex = -1
  private var spritesJson: String? = null

  // Camera objects.
  private var processor: FxProcessor? = null
  private var effect: FxEffect? = null
  private var tracker: FaceTracker? = null
  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var useCases: List<UseCase> = emptyList()
  private var videoCapture: VideoCapture<Recorder>? = null
  private var boundFacing: String? = null
  private var boundBitRate = 0
  private var binding = false
  private var generation = 0
  private var stateData: LiveData<CameraState>? = null
  private var stateObserver: Observer<CameraState>? = null
  private var recording: Recording? = null
  private var released = false
  private var sizesLine = ""

  init {
    addView(previewView)
  }

  // ---------------------------------------------------------------- props

  fun setFacing(v: String) { facing = if (v == "front") "front" else "back" }
  fun setTorch(v: Boolean) { torch = v }
  fun setZoom(v: Double) { zoom = v }
  fun setActive(v: Boolean) { active = v }
  fun setBitRate(v: Int) { bitRate = v }
  fun setLookFragment(v: String?) { lookFragment = v }
  fun setLookUniforms(v: List<Double>?) { lookUniforms = v?.let { l -> FloatArray(l.size) { l[it].toFloat() } } }
  fun setFxIndex(v: Int) { fxIndex = v }
  fun setSpritesJson(v: String?) { spritesJson = v }

  /** Called after React Native has applied a batch of props. */
  fun applyProps() {
    if (released) return
    ensurePipeline()
    processor?.setLook(lookFragment, lookUniforms)
    processor?.setFx(fxIndex, spritesJson)
    tracker?.enabled = fxIndex >= 0
    tracker?.mirrored = facing == "front"

    val want = active && isAttachedToWindow
    if (want) {
      if (recording == null && (boundFacing != facing || boundBitRate != bitRate || (useCases.isEmpty() && !binding))) bind()
      applyCameraControls()
    } else if (useCases.isNotEmpty() || binding) {
      if (recording == null) unbind()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    applyProps()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    if (recording == null) unbind()
  }

  // ------------------------------------------------------------- pipeline

  private fun report(code: String, message: String, fatal: Boolean) {
    mainExecutor.execute {
      if (!released) onError(mapOf("code" to code, "message" to message, "fatal" to fatal))
    }
  }

  private fun ensurePipeline() {
    if (processor != null) return
    val p = FxProcessor(
      onFirstFrame = {
        mainExecutor.execute {
          if (!released) {
            // One line per camera session with every size that decides sharpness.
            val fx = processor
            Log.i(LOG_FX, "input ${fx?.inputSize ?: "?"}, effect output ${fx?.outputSize ?: "?"}, $sizesLine")
            onFirstFrame(emptyMap())
          }
        }
      },
      // A look shader the GPU rejects is not fatal for the camera: the plain picture keeps running.
      onFatal = { code, message -> report(code, message, code != "SHADER") },
    )
    processor = p
    effect = FxEffect(p)
    tracker = FaceTracker(
      p,
      mainExecutor,
      onFaces = { n -> if (!released) onFacesCount(mapOf("count" to n)) },
      onFail = { message -> report("FACE", message, false) },
    )
  }

  private fun displayRotation(): Int = display?.rotation ?: Surface.ROTATION_0

  @SuppressLint("RestrictedApi", "MissingPermission")
  private fun bind() {
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      report("NO_ACTIVITY", "No activity to bind the camera to", true)
      return
    }
    val gen = ++generation
    binding = true
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (gen != generation || released) return@addListener
      try {
        val cp = future.get()
        provider = cp
        unbindUseCases(cp)

        val front = facing == "front"
        val selector = pickSelector(cp, front)
        if (!cp.hasCamera(selector)) {
          binding = false
          report("NO_CAMERA", "No $facing camera", true)
          return@addListener
        }
        val rotation = displayRotation()

        // First try with every Preview/Video size strictly 16:9 (see buildGroup);
        // a camera without 16:9 PRIV sizes gets the lenient (old) selectors instead
        // of failing to open.
        var built = buildGroup(rotation, strict = true)
        val cam = try {
          cp.bindToLifecycle(owner, selector, built.group)
        } catch (e: IllegalArgumentException) {
          Log.w(TAG, "strict 16:9 bind failed, retrying with fallback sizes", e)
          built = buildGroup(rotation, strict = false)
          cp.bindToLifecycle(owner, selector, built.group)
        }
        val preview = built.preview
        val video = built.video
        val analysis = built.analysis
        camera = cam
        useCases = listOf(preview, video, analysis)
        videoCapture = video
        boundFacing = facing
        boundBitRate = bitRate
        binding = false
        sizesLine = describeSizes(cam, preview, video, analysis, built.strict)
        Log.i(LOG_FX, "bound: $sizesLine")
        watchState(cam, owner)
        applyCameraControls()

        val info = cam.cameraInfo
        val zs = info.zoomState.value
        onReady(
          mapOf(
            "facing" to facing,
            "minZoom" to (zs?.minZoomRatio ?: 1f).toDouble(),
            "maxZoom" to (zs?.maxZoomRatio ?: 1f).toDouble(),
            "hasTorch" to info.hasFlashUnit(),
          ),
        )
      } catch (e: Exception) {
        binding = false
        Log.e(TAG, "bind failed", e)
        report("BIND", e.message ?: "camera bind failed", true)
      }
    }, mainExecutor)
  }

  private class Built(
    val preview: Preview,
    val video: VideoCapture<Recorder>,
    val analysis: ImageAnalysis,
    val group: UseCaseGroup,
    val strict: Boolean,
  )

  /**
   * The use cases. Why every Preview/Video size is pinned to 16:9 and 1080p:
   *
   * Our effect targets PREVIEW | VIDEO_CAPTURE, so CameraX (CameraUseCaseAdapter
   * .getStreamSharingChildren / isSharingEffect) puts Preview and VideoCapture
   * behind ONE StreamSharing camera stream, and the effect draws into a buffer
   * the size of that stream's crop. That stream's size comes from
   * ResolutionsMerger.selectParentResolutions: when any child accepts a non-16:9
   * size (the old Preview used RATIO_16_9_FALLBACK_AUTO, and the default Recorder
   * aspect ratio adds the CamcorderProfile sizes such as 720x480), the SENSOR's
   * aspect ratio (4:3) is tried first. With the separate YUV ImageAnalysis
   * stream, a LIMITED/LEGACY front camera only guarantees PRIV <= PREVIEW size
   * (1080p area) next to it, so the parent became 1440x1080; the 9:16 viewport
   * then cropped that to 1440x810 and CameraX scaled it UP to the 1080x1920
   * preview and video: the soft front-camera picture.
   *
   * With only 16:9 child sizes, needToAddSensorResolutions() is false and the
   * parent is the smallest 16:9 size that holds both children: 1920x1080, which
   * the 9:16 viewport does not crop at all, so the effect renders at full 1080p.
   */
  private fun buildGroup(rotation: Int, strict: Boolean): Built {
    val ratio = if (strict) {
      AspectRatioStrategy(AspectRatio.RATIO_16_9, AspectRatioStrategy.FALLBACK_RULE_NONE)
    } else {
      AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY
    }
    // 1080p exactly when the camera has it, else the closest smaller, else the closest larger.
    val fhd = ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)

    val preview = Preview.Builder()
      .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(ratio).setResolutionStrategy(fhd).build())
      .setTargetRotation(rotation)
      .build()
    preview.surfaceProvider = previewView.surfaceProvider

    val recorderBuilder = Recorder.Builder()
      .setQualitySelector(QualitySelector.from(Quality.FHD, FallbackStrategy.lowerQualityOrHigherThan(Quality.FHD)))
      .setTargetVideoEncodingBitRate(bitRate)
    // Without this the recorder offers the CamcorderProfile sizes (RATIO_DEFAULT), which include non-16:9 ones.
    if (strict) recorderBuilder.setAspectRatio(AspectRatio.RATIO_16_9)
    val video = VideoCapture.Builder<Recorder>(recorderBuilder.build())
      // The front camera is shown mirrored, and the file is the same picture.
      .setMirrorMode(MirrorMode.MIRROR_MODE_ON_FRONT_ONLY)
      .setTargetRotation(rotation)
      .build()

    // Its own small YUV stream for ML Kit: ImageAnalysis cannot be a StreamSharing
    // child, so it never sets the size of the shared (effect) stream.
    val analysis = ImageAnalysis.Builder()
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setResolutionSelector(
        ResolutionSelector.Builder()
          .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
          .setResolutionStrategy(ResolutionStrategy(Size(640, 360), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
          .build(),
      )
      .setTargetRotation(rotation)
      .build()
    tracker?.let { analysis.setAnalyzer(analysisExecutor, it) }

    // One 9:16 field of view for all three, so the face coordinates, the
    // preview and the recorded file cover the same picture.
    val viewPort = ViewPort.Builder(Rational(9, 16), rotation).setScaleType(ViewPort.FILL_CENTER).build()
    val group = UseCaseGroup.Builder()
      .addUseCase(preview)
      .addUseCase(video)
      .addUseCase(analysis)
      .setViewPort(viewPort)
      .addEffect(effect!!)
      .build()
    return Built(preview, video, analysis, group, strict)
  }

  /**
   * The back camera is CameraX's default (the first back id, the main lens). For
   * the front, when the phone exposes more than one front camera, the one with
   * the largest pixel array is the main selfie sensor (not an aux/depth one).
   */
  private fun pickSelector(cp: ProcessCameraProvider, front: Boolean): CameraSelector {
    if (!front) return CameraSelector.DEFAULT_BACK_CAMERA
    return try {
      val fronts = cp.availableCameraInfos.filter { it.lensFacing == CameraSelector.LENS_FACING_FRONT }
      if (fronts.size <= 1) return CameraSelector.DEFAULT_FRONT_CAMERA
      val best = fronts.maxByOrNull { info ->
        val px = Camera2Interop.getCameraCharacteristics(info).get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
        if (px == null) 0L else px.width.toLong() * px.height.toLong()
      }
      best?.cameraSelector ?: CameraSelector.DEFAULT_FRONT_CAMERA
    } catch (e: Exception) {
      Log.w(TAG, "front camera pick", e)
      CameraSelector.DEFAULT_FRONT_CAMERA
    }
  }

  private fun sizeOf(r: ResolutionInfo?): String =
    if (r == null) "?" else "${r.resolution.width}x${r.resolution.height} crop ${r.cropRect.width()}x${r.cropRect.height()} rot ${r.rotationDegrees}"

  private fun describeSizes(cam: Camera, preview: Preview, video: VideoCapture<Recorder>, analysis: ImageAnalysis, strict: Boolean): String {
    val camInfo = try {
      val info = cam.cameraInfo
      val chars = Camera2Interop.getCameraCharacteristics(info)
      val level = when (chars.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)) {
        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "LEGACY"
        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "LIMITED"
        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "FULL"
        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "LEVEL_3"
        else -> "other"
      }
      val px = chars.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
      "camera ${Camera2Interop.getCameraId(info)} ($facing, $level, sensor ${px?.width}x${px?.height})"
    } catch (e: Exception) {
      "camera ? ($facing)"
    }
    return "$camInfo, preview ${sizeOf(preview.resolutionInfo)}, video ${sizeOf(video.resolutionInfo)}, " +
      "analysis ${sizeOf(analysis.resolutionInfo)}, ${if (strict) "strict 16:9" else "fallback sizes"}, bitrate $bitRate"
  }

  private fun watchState(cam: Camera, owner: LifecycleOwner) {
    stateData?.let { d -> stateObserver?.let { d.removeObserver(it) } }
    val data = cam.cameraInfo.cameraState
    val obs = Observer<CameraState> { s ->
      val err = s.error
      // 1-3 are transient (camera busy); 4+ end the session.
      if (err != null && err.code >= CameraState.ERROR_CAMERA_DISABLED) {
        report("CAMERA_STATE", "camera error ${err.code}", true)
      }
    }
    stateData = data
    stateObserver = obs
    data.observe(owner, obs)
  }

  private fun applyCameraControls() {
    val cam = camera ?: return
    try {
      val zs = cam.cameraInfo.zoomState.value
      val z = zoom.toFloat().coerceIn(zs?.minZoomRatio ?: 1f, zs?.maxZoomRatio ?: 1f)
      cam.cameraControl.setZoomRatio(z)
      if (cam.cameraInfo.hasFlashUnit()) cam.cameraControl.enableTorch(torch && facing == "back")
    } catch (e: Exception) {
      Log.w(TAG, "camera controls", e)
    }
  }

  private fun unbindUseCases(cp: ProcessCameraProvider) {
    stateData?.let { d -> stateObserver?.let { d.removeObserver(it) } }
    stateData = null
    stateObserver = null
    if (useCases.isNotEmpty()) cp.unbind(*useCases.toTypedArray())
    useCases = emptyList()
    videoCapture = null
    camera = null
    boundFacing = null
  }

  private fun unbind() {
    generation++
    binding = false
    provider?.let { unbindUseCases(it) }
  }

  // ------------------------------------------------------------ recording

  @SuppressLint("MissingPermission")
  fun startRecording(maxSeconds: Int, promise: Promise) {
    val vc = videoCapture
    if (vc == null || camera == null) {
      promise.reject("E_NOT_READY", "The camera is not running", null)
      return
    }
    if (recording != null) {
      promise.reject("E_BUSY", "A recording is already in progress", null)
      return
    }
    val file = File(context.cacheDir, "flyp-rec-${System.currentTimeMillis()}.mp4")
    val options = FileOutputOptions.Builder(file)
      .setDurationLimitMillis(if (maxSeconds > 0) maxSeconds * 1000L else 0L)
      .build()
    var pending = vc.output.prepareRecording(context, options)
    if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      pending = pending.withAudioEnabled()
    }
    var answered = false
    recording = pending.start(mainExecutor) { event ->
      when (event) {
        is VideoRecordEvent.Start -> if (!answered) {
          answered = true
          promise.resolve(file.absolutePath)
        }
        is VideoRecordEvent.Finalize -> {
          recording = null
          val code = event.error
          // Reaching the duration or size limit still leaves a complete file.
          val usable = !event.hasError() ||
            code == VideoRecordEvent.Finalize.ERROR_DURATION_LIMIT_REACHED ||
            code == VideoRecordEvent.Finalize.ERROR_FILE_SIZE_LIMIT_REACHED
          if (!answered) {
            answered = true
            if (!usable) promise.reject("E_RECORD", "Recording failed ($code)", event.cause) else promise.resolve(file.absolutePath)
          }
          if (usable && file.exists() && file.length() > 0) {
            onRecordingFinished(
              mapOf(
                "path" to file.absolutePath,
                "durationMs" to (event.recordingStats.recordedDurationNanos / 1_000_000L).toDouble(),
                "ok" to true,
              ),
            )
          } else {
            file.delete()
            onRecordingFinished(mapOf("path" to "", "durationMs" to 0.0, "ok" to false, "message" to (event.cause?.message ?: "recording failed ($code)")))
          }
        }
        else -> {}
      }
    }
  }

  fun stopRecording() {
    recording?.stop()
  }

  // -------------------------------------------------------------- cleanup

  fun destroy() {
    if (released) return
    try {
      recording?.stop()
    } catch (_: Exception) {
    }
    recording = null
    unbind()
    released = true
    tracker?.close()
    analysisExecutor.shutdown()
    processor?.release()
    processor = null
    effect = null
  }
}
