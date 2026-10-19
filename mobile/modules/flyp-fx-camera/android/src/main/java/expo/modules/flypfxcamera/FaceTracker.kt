package expo.modules.flypfxcamera

import android.graphics.Matrix
import android.util.Log
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import java.util.concurrent.Executor

private const val TAG = "FlypFxFace"

/**
 * ML Kit face detection on the ImageAnalysis stream. The detections are mapped
 * with CameraX's own transforms (analysis buffer -> sensor -> the effect's
 * buffer) so they land on the same picture the GL pass draws, whatever the
 * rotation, crop or mirroring; the pose is then handed to [FxProcessor], which
 * smooths it and draws the sprites in the frame it is rendering.
 */
internal class FaceTracker(
  private val processor: FxProcessor,
  private val mainExecutor: Executor,
  private val onFaces: (count: Int) -> Unit,
  private val onFail: (message: String) -> Unit,
) : ImageAnalysis.Analyzer {
  private val detector: FaceDetector = FaceDetection.getClient(
    FaceDetectorOptions.Builder()
      .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
      .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
      .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
      .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
      .setMinFaceSize(0.2f)
      .build(),
  )

  /** Detection only runs while a face effect is selected. */
  @Volatile var enabled = false

  /** The front camera is shown (and recorded) mirrored. */
  @Volatile var mirrored = false

  private var errors = 0
  private var lastCount = -1
  private var closed = false

  @OptIn(ExperimentalGetImage::class)
  override fun analyze(image: ImageProxy) {
    val media = image.image
    val geo = processor.geometry
    if (!enabled || closed || media == null || geo == null) {
      image.close()
      return
    }
    val rotation = image.imageInfo.rotationDegrees
    val toDisplay: Matrix
    val displayToBuffer: Matrix
    try {
      val bufferToDisplay = bufferToDisplay(rotation, geo.width, geo.height, mirrored)
      displayToBuffer = Matrix()
      if (!bufferToDisplay.invert(displayToBuffer)) {
        image.close()
        return
      }
      // ML Kit reports points in the upright analysis picture (rotation applied).
      val analysisToUpright = rotationMatrix(rotation, image.width, image.height)
      val uprightToAnalysis = Matrix()
      val sensorToAnalysis = image.imageInfo.sensorToBufferTransformMatrix
      val analysisToSensor = Matrix()
      if (!analysisToUpright.invert(uprightToAnalysis) || !sensorToAnalysis.invert(analysisToSensor)) {
        image.close()
        return
      }
      toDisplay = Matrix(uprightToAnalysis)
      toDisplay.postConcat(analysisToSensor)
      toDisplay.postConcat(geo.sensorToBuffer)
      toDisplay.postConcat(bufferToDisplay)
    } catch (e: Exception) {
      image.close()
      return
    }
    val values = FloatArray(9)
    displayToBuffer.getValues(values)

    val input = InputImage.fromMediaImage(media, rotation)
    detector.process(input)
      .addOnSuccessListener(mainExecutor) { faces ->
        errors = 0
        publish(faces, toDisplay, values)
      }
      .addOnFailureListener(mainExecutor) { e ->
        Log.w(TAG, "detect failed", e)
        errors++
        if (errors >= 4) {
          enabled = false
          onFail(e.message ?: "face detector failed")
        }
      }
      .addOnCompleteListener(mainExecutor) { image.close() }
  }

  private fun publish(faces: List<Face>, toDisplay: Matrix, d2b: FloatArray) {
    var best: Face? = null
    var bestArea = 0
    for (f in faces) {
      val area = f.boundingBox.width() * f.boundingBox.height()
      if (area > bestArea) {
        bestArea = area
        best = f
      }
    }
    val target = if (best == null) poseEmpty() else poseFromFace(landmarksOf(best, toDisplay))
    processor.faceFrame = FaceFrame(target, d2b)
    val count = if (best == null) 0 else faces.size
    if (count != lastCount) {
      lastCount = count
      onFaces(count)
    }
  }

  private fun landmarksOf(face: Face, m: Matrix): FaceLandmarks {
    val pts = FloatArray(2)
    fun lm(type: Int): Pt? {
      val p = face.getLandmark(type)?.position ?: return null
      pts[0] = p.x
      pts[1] = p.y
      m.mapPoints(pts)
      return Pt(pts[0], pts[1])
    }
    val box = face.boundingBox
    val bp = floatArrayOf(
      box.left.toFloat(), box.top.toFloat(), box.right.toFloat(), box.top.toFloat(),
      box.left.toFloat(), box.bottom.toFloat(), box.right.toFloat(), box.bottom.toFloat(),
    )
    m.mapPoints(bp)
    var minX = Float.MAX_VALUE
    var maxX = -Float.MAX_VALUE
    var minY = Float.MAX_VALUE
    var maxY = -Float.MAX_VALUE
    for (i in 0 until 4) {
      minX = minOf(minX, bp[i * 2])
      maxX = maxOf(maxX, bp[i * 2])
      minY = minOf(minY, bp[i * 2 + 1])
      maxY = maxOf(maxY, bp[i * 2 + 1])
    }
    return FaceLandmarks(
      lm(FaceLandmark.LEFT_EYE), lm(FaceLandmark.RIGHT_EYE), lm(FaceLandmark.NOSE_BASE),
      lm(FaceLandmark.MOUTH_LEFT), lm(FaceLandmark.MOUTH_RIGHT), lm(FaceLandmark.MOUTH_BOTTOM),
      (minX + maxX) / 2f, minY, maxX - minX, maxY - minY, face.headEulerAngleY,
    )
  }

  fun close() {
    closed = true
    enabled = false
    detector.close()
  }

  companion object {
    /** The matrix that turns a buffer upright: clockwise by [degrees], moved back into the positive quadrant. */
    fun rotationMatrix(degrees: Int, w: Int, h: Int): Matrix {
      val m = Matrix()
      m.setRotate(degrees.toFloat())
      when (((degrees % 360) + 360) % 360) {
        90 -> m.postTranslate(h.toFloat(), 0f)
        180 -> m.postTranslate(w.toFloat(), h.toFloat())
        270 -> m.postTranslate(0f, w.toFloat())
      }
      return m
    }

    /** Effect buffer pixels -> display pixels (upright, mirrored for the front camera). */
    fun bufferToDisplay(rotation: Int, w: Int, h: Int, mirrored: Boolean): Matrix {
      val m = rotationMatrix(rotation, w, h)
      if (mirrored) {
        val r = ((rotation % 360) + 360) % 360
        val displayW = if (r == 90 || r == 270) h else w
        m.postScale(-1f, 1f)
        m.postTranslate(displayW.toFloat(), 0f)
      }
      return m
    }
  }
}
