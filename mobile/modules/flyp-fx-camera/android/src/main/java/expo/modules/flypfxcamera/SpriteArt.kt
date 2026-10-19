package expo.modules.flypfxcamera

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

// The face-effect art. JS sends the sprite data model once (faceFx.ts SPRITES as
// JSON: vector ops in "face units"); each sprite is rasterised here to a bitmap
// that the GL pass draws as a textured quad. One source of art for the native
// camera, the Skia fallback and the thumbnails.

private class Op(
  val kind: Char, // 'p' path, 'e' ellipse, 'g' radial gradient disc
  val path: Path?,
  val cx: Float, val cy: Float, val rx: Float, val ry: Float,
  val fill: Int?, val stroke: Int?, val strokeWidth: Float, val opacity: Float,
  val c: Int, val a0: Float, val a1: Float, val r: Float,
)

/** One sprite: its bitmap and the face-unit rectangle the bitmap covers. */
internal class SpriteBitmap(val bitmap: Bitmap, val x0: Float, val y0: Float, val x1: Float, val y1: Float)

internal object SpriteArt {
  private const val MAX_PX_PER_UNIT = 160f
  private const val MAX_SIDE = 512f

  fun rasterise(json: String): List<SpriteBitmap?> {
    val sprites = JSONArray(json)
    val out = ArrayList<SpriteBitmap?>(sprites.length())
    for (i in 0 until sprites.length()) {
      out.add(
        try {
          rasteriseOne(sprites.getJSONArray(i))
        } catch (e: Exception) {
          null
        },
      )
    }
    return out
  }

  private fun color(s: String?): Int? = if (s.isNullOrEmpty()) null else Color.parseColor(s)

  private fun parseOp(o: JSONObject): Op {
    val kind = o.getString("k")[0]
    val opacity = o.optDouble("o", 1.0).toFloat()
    val strokeWidth = o.optDouble("w", 0.04).toFloat()
    return when (kind) {
      'p' -> Op(
        'p', parsePath(o.getString("d")), 0f, 0f, 0f, 0f,
        color(o.optString("f")), color(o.optString("s")), strokeWidth, opacity, 0, 0f, 0f, 0f,
      )
      'e' -> Op(
        'e', null,
        o.getDouble("cx").toFloat(), o.getDouble("cy").toFloat(),
        o.getDouble("rx").toFloat(), o.getDouble("ry").toFloat(),
        color(o.optString("f")), color(o.optString("s")), strokeWidth, opacity, 0, 0f, 0f, 0f,
      )
      else -> Op(
        'g', null, o.getDouble("cx").toFloat(), o.getDouble("cy").toFloat(), 0f, 0f,
        null, null, 0f, 1f, Color.parseColor(o.getString("c")),
        o.getDouble("a0").toFloat(), o.getDouble("a1").toFloat(), o.getDouble("r").toFloat(),
      )
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

  private fun rasteriseOne(opsJson: JSONArray): SpriteBitmap? {
    val ops = ArrayList<Op>(opsJson.length())
    for (j in 0 until opsJson.length()) ops.add(parseOp(opsJson.getJSONObject(j)))
    if (ops.isEmpty()) return null

    // Bounds of everything the sprite draws, padded by half the stroke width.
    val bounds = RectF(Float.MAX_VALUE, Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE)
    val tmp = RectF()
    for (op in ops) {
      val pad = if (op.stroke != null) op.strokeWidth / 2f else 0f
      when (op.kind) {
        'p' -> op.path!!.computeBounds(tmp, true)
        'e' -> tmp.set(op.cx - op.rx, op.cy - op.ry, op.cx + op.rx, op.cy + op.ry)
        else -> tmp.set(op.cx - op.r, op.cy - op.r, op.cx + op.r, op.cy + op.r)
      }
      bounds.union(tmp.left - pad, tmp.top - pad, tmp.right + pad, tmp.bottom + pad)
    }
    val margin = 0.03f
    bounds.inset(-margin, -margin)
    val w = bounds.width()
    val h = bounds.height()
    if (w <= 0f || h <= 0f) return null
    val scale = min(MAX_PX_PER_UNIT, MAX_SIDE / max(w, h))
    val bw = max(2, ceil(w * scale).toInt())
    val bh = max(2, ceil(h * scale).toInt())
    // The bitmap covers exactly [x0, x1] x [y0, y1] in face units.
    val x1 = bounds.left + bw / scale
    val y1 = bounds.top + bh / scale

    val bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    canvas.scale(scale, scale)
    canvas.translate(-bounds.left, -bounds.top)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
    }
    for (op in ops) {
      if (op.kind == 'g') {
        val c0 = Color.argb((op.a0 * 255f).toInt().coerceIn(0, 255), Color.red(op.c), Color.green(op.c), Color.blue(op.c))
        val c1 = Color.argb((op.a1 * 255f).toInt().coerceIn(0, 255), Color.red(op.c), Color.green(op.c), Color.blue(op.c))
        fill.shader = RadialGradient(op.cx, op.cy, op.r, c0, c1, Shader.TileMode.CLAMP)
        fill.color = Color.WHITE
        fill.alpha = 255
        canvas.drawCircle(op.cx, op.cy, op.r, fill)
        fill.shader = null
        continue
      }
      val a = (op.opacity * 255f).toInt().coerceIn(0, 255)
      if (op.fill != null) {
        fill.color = op.fill
        fill.alpha = a
        if (op.path != null) canvas.drawPath(op.path, fill)
        else canvas.drawOval(op.cx - op.rx, op.cy - op.ry, op.cx + op.rx, op.cy + op.ry, fill)
      }
      if (op.stroke != null) {
        stroke.color = op.stroke
        stroke.alpha = a
        stroke.strokeWidth = op.strokeWidth
        if (op.path != null) canvas.drawPath(op.path, stroke)
        else canvas.drawOval(op.cx - op.rx, op.cy - op.ry, op.cx + op.rx, op.cy + op.ry, stroke)
      }
    }
    return SpriteBitmap(bmp, bounds.left, bounds.top, x1, y1)
  }
}
