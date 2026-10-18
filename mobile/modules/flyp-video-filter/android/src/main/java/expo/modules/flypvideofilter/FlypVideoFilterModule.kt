package expo.modules.flypvideofilter

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.RgbMatrix
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

// Re-encodes a recorded clip with a colour matrix baked into every frame.
// VisionCamera records straight from the sensor, so this is how a camera
// filter reaches the uploaded file. Media3's default SDR working colour space
// keeps values gamma-encoded, the same space Skia applies the preview matrix in.
@OptIn(UnstableApi::class)
class FlypVideoFilterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FlypVideoFilter")

    // Transformer must be created and driven from a Looper thread.
    AsyncFunction("applyColorMatrix") { inputUri: String, matrix: List<Double>, bitRate: Int, promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      require(matrix.size == 20) { "Expected a 4x5 colour matrix (20 values)" }
      val out = File(context.cacheDir, "flyp-filter-${System.currentTimeMillis()}.mp4")
      val gl = toGlMatrix(matrix)
      val effect = RgbMatrix { _, _ -> gl }

      val uri = if (inputUri.startsWith("/")) Uri.fromFile(File(inputUri)) else Uri.parse(inputUri)
      val item = EditedMediaItem.Builder(MediaItem.fromUri(uri))
        .setEffects(Effects(emptyList(), listOf<Effect>(effect)))
        .build()

      val encoders = DefaultEncoderFactory.Builder(context)
        .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitRate).build())
        .build()

      val transformer = Transformer.Builder(context)
        // H.264 so every phone in the feed can play it; audio is passed through.
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setEncoderFactory(encoders)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            promise.resolve(Uri.fromFile(out).toString())
          }

          override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
            out.delete()
            promise.reject("ERR_FILTER_EXPORT", exportException.message, exportException)
          }
        })
        .build()

      transformer.start(item, out.absolutePath)
    }.runOnQueue(Queues.MAIN)
  }

  // JS sends Skia's 4x5 row-major matrix (offsets in 0..1). Media3 computes
  // uRgbMatrix * vec4(rgb, 1) with a column-major 4x4, so the offset column
  // becomes the fourth column and alpha is left alone.
  private fun toGlMatrix(m: List<Double>): FloatArray {
    val gl = FloatArray(16)
    for (row in 0 until 3) {
      for (col in 0 until 3) gl[col * 4 + row] = m[row * 5 + col].toFloat()
      gl[3 * 4 + row] = m[row * 5 + 4].toFloat()
    }
    gl[15] = 1f
    return gl
  }
}
