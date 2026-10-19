package expo.modules.flypvideofilter

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.RadialGradient
import android.graphics.Shader
import androidx.annotation.OptIn
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.CanvasOverlay
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

// Face-effect sprites for the export. JS sends the sprite art (vector ops in
// "face units") and, for every output frame, the placements (a 2x3 matrix and
// an alpha per sprite) that its tracking replay computed from the detections
// logged while recording. This class only rasterises them, frame by frame,
// into an overlay the size of the video.
internal class SpriteOp(
  val kind: Char, // 'p' path, 'e' ellipse, 'g' radial gradient disc
  val path: Path?,
  val cx: Float, val cy: Float, val rx: Float, val ry: Float,
  val fill: Int?, val stroke: Int?, val strokeWidth: Float, val opacity: Float,
  val gradient: Shader?, val radius: Float,
)

internal class FxTimeline(
  val fps: Float,
  val width: Float,
  val height: Float,
  internal val sprites: List<List<SpriteOp>>,
  // Per frame: stride-8 groups [sprite, a, b, c, d, e, f, alpha].
  val frames: List<FloatArray>,
) {
  companion object {
    fun parse(o: JSONObject): FxTimeline {
      val spritesJson = o.getJSONArray("sprites")
      val sprites = ArrayList<List<SpriteOp>>(spritesJson.length())
      for (i in 0 until spritesJson.length()) {
        val ops = spritesJson.getJSONArray(i)
        val list = ArrayList<SpriteOp>(ops.length())
        for (j in 0 until ops.length()) list.add(parseOp(ops.getJSONObject(j)))
        sprites.add(list)
      }
      val framesJson = o.getJSONArray("frames")
      val frames = ArrayList<FloatArray>(framesJson.length())
      for (i in 0 until framesJson.length()) {
        val f = framesJson.getJSONArray(i)
        val out = FloatArray(f.length() * 8)
        for (j in 0 until f.length()) {
          val p = f.getJSONArray(j)
          for (k in 0 until 8) out[j * 8 + k] = p.getDouble(k).toFloat()
        }
        frames.add(out)
      }
      return FxTimeline(
        o.getDouble("fps").toFloat(),
        o.getDouble("w").toFloat(),
        o.getDouble("h").toFloat(),
        sprites,
        frames,
      )
    }

    private fun color(s: String?): Int? = if (s == null) null else Color.parseColor(s)

    private fun parseOp(o: JSONObject): SpriteOp {
      val kind = o.getString("k")[0]
      val opacity = o.optDouble("o", 1.0).toFloat()
      val strokeWidth = o.optDouble("w", 0.04).toFloat()
      return when (kind) {
        'p' -> SpriteOp(
          'p', parsePath(o.getString("d")), 0f, 0f, 0f, 0f,
          color(o.optString("f").ifEmpty { null }), color(o.optString("s").ifEmpty { null }),
          strokeWidth, opacity, null, 0f,
        )
        'e' -> SpriteOp(
          'e', null,
          o.getDouble("cx").toFloat(), o.getDouble("cy").toFloat(),
          o.getDouble("rx").toFloat(), o.getDouble("ry").toFloat(),
          color(o.optString("f").ifEmpty { null }), color(o.optString("s").ifEmpty { null }),
          strokeWidth, opacity, null, 0f,
        )
        else -> {
          val base = Color.parseColor(o.getString("c"))
          val a0 = (o.getDouble("a0") * 255).toInt().coerceIn(0, 255)
          val a1 = (o.getDouble("a1") * 255).toInt().coerceIn(0, 255)
          val c0 = Color.argb(a0, Color.red(base), Color.green(base), Color.blue(base))
          val c1 = Color.argb(a1, Color.red(base), Color.green(base), Color.blue(base))
          val cx = o.getDouble("cx").toFloat()
          val cy = o.getDouble("cy").toFloat()
          val r = o.getDouble("r").toFloat()
          SpriteOp('g', null, cx, cy, 0f, 0f, null, null, 0f, 1f, RadialGradient(cx, cy, r, c0, c1, Shader.TileMode.CLAMP), r)
        }
      }
    }

    // The sprite path subset: absolute M, L, C, Q and Z, space separated.
    private fun parsePath(d: String): Path {
      val path = Path()
      val t = d.trim().split(Regex("\\s+"))
      var i = 0
      fun n(k: Int) = t[i + k].toFloat()
      while (i < t.size) {
        when (t[i]) {
          "M" -> { path.moveTo(n(1), n(2)); i += 3 }
          "L" -> { path.lineTo(n(1), n(2)); i += 3 }
          "C" -> { path.cubicTo(n(1), n(2), n(3), n(4), n(5), n(6)); i += 7 }
          "Q" -> { path.quadTo(n(1), n(2), n(3), n(4)); i += 5 }
          "Z" -> { path.close(); i += 1 }
          else -> throw IllegalArgumentException("Unsupported path command: ${t[i]}")
        }
      }
      return path
    }
  }
}

@OptIn(UnstableApi::class)
internal class FxOverlay(private val timeline: FxTimeline) : CanvasOverlay(/* useInputFrameSize= */ true) {
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val matrix = Matrix()
  private val values = FloatArray(9)
  private var scale = 1f
  private var offsetX = 0f
  private var offsetY = 0f
  private var blank = true

  override fun configure(videoSize: Size) {
    super.configure(videoSize)
    // The placements are in the preview's pixels; the video has the same
    // picture at a higher resolution. Cover-fit them, like the preview did.
    val sx = videoSize.width / timeline.width
    val sy = videoSize.height / timeline.height
    scale = max(sx, sy)
    offsetX = (videoSize.width - timeline.width * scale) / 2f
    offsetY = (videoSize.height - timeline.height * scale) / 2f
  }

  override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
    val index = min(max(Math.round(presentationTimeUs / 1_000_000.0 * timeline.fps).toInt(), 0), timeline.frames.size - 1)
    val frame = timeline.frames[index]
    if (frame.isEmpty()) {
      // Nothing to show: clear once, then leave the bitmap untouched so the
      // texture is not uploaded again.
      if (!blank) {
        canvas.drawColor(0, PorterDuff.Mode.CLEAR)
        blank = true
      }
      return
    }
    canvas.drawColor(0, PorterDuff.Mode.CLEAR)
    blank = false
    var g = 0
    while (g < frame.size) {
      val sprite = timeline.sprites.getOrNull(frame[g].toInt())
      val alpha = frame[g + 7]
      if (sprite != null && alpha > 0.01f) {
        canvas.save()
        canvas.translate(offsetX, offsetY)
        canvas.scale(scale, scale)
        // x' = a x + c y + e ; y' = b x + d y + f
        values[0] = frame[g + 1]
        values[1] = frame[g + 3]
        values[2] = frame[g + 5]
        values[3] = frame[g + 2]
        values[4] = frame[g + 4]
        values[5] = frame[g + 6]
        values[6] = 0f
        values[7] = 0f
        values[8] = 1f
        matrix.setValues(values)
        canvas.concat(matrix)
        for (op in sprite) drawOp(canvas, op, alpha)
        canvas.restore()
      }
      g += 8
    }
  }

  private fun drawOp(canvas: Canvas, op: SpriteOp, alpha: Float) {
    if (op.kind == 'g') {
      fillPaint.shader = op.gradient
      fillPaint.color = Color.WHITE
      fillPaint.alpha = (alpha * 255f).toInt().coerceIn(0, 255)
      canvas.drawCircle(op.cx, op.cy, op.radius, fillPaint)
      fillPaint.shader = null
      return
    }
    val a = (op.opacity * alpha * 255f).toInt().coerceIn(0, 255)
    if (op.fill != null) {
      fillPaint.color = op.fill
      fillPaint.alpha = a
      if (op.path != null) canvas.drawPath(op.path, fillPaint)
      else canvas.drawOval(op.cx - op.rx, op.cy - op.ry, op.cx + op.rx, op.cy + op.ry, fillPaint)
    }
    if (op.stroke != null) {
      strokePaint.color = op.stroke
      strokePaint.alpha = a
      strokePaint.strokeWidth = op.strokeWidth
      if (op.path != null) canvas.drawPath(op.path, strokePaint)
      else canvas.drawOval(op.cx - op.rx, op.cy - op.ry, op.cx + op.rx, op.cy + op.ry, strokePaint)
    }
  }
}
