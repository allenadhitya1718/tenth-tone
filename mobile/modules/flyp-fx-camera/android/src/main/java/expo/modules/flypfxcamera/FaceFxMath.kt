package expo.modules.flypfxcamera

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

// Native port of mobile/src/features/camera/faceFx.ts: pose from an ML Kit face,
// the per-frame smoothing and the sprite placements. Keep the two in step: the
// constants and formulas are intentionally identical so an effect behaves the
// same here as in the Skia fallback preview.
//
// A pose is 9 floats: [visible 0..1, eye-mid x, eye-mid y, eye distance,
// roll (rad), x squash, nose y, mouth y, mouth open 0..1]. Positions are in
// pixels of the "display picture" (upright, mirrored for the front camera).

internal const val POSE_LEN = 9

internal fun poseEmpty(): FloatArray = floatArrayOf(0f, 0f, 0f, 1f, 0f, 1f, 0.95f, 1.55f, 0f)

internal class Pt(val x: Float, val y: Float)

/** Landmarks already expressed in display pixels. Null when ML Kit did not report one. */
internal class FaceLandmarks(
  val leftEye: Pt?,
  val rightEye: Pt?,
  val noseBase: Pt?,
  val mouthLeft: Pt?,
  val mouthRight: Pt?,
  val mouthBottom: Pt?,
  /** Face box centre x, top y and size, for the no-landmark fallback. */
  val boxCx: Float,
  val boxTop: Float,
  val boxW: Float,
  val boxH: Float,
  val yawDeg: Float,
)

private fun clampN(v: Float, lo: Float, hi: Float): Float = if (v < lo) lo else if (v > hi) hi else v

internal fun poseFromFace(f: FaceLandmarks): FloatArray {
  val yaw = abs(f.yawDeg)
  val sx = clampN(cos(yaw * PI.toFloat() / 180f), 0.55f, 1f)
  val le = f.leftEye
  val re = f.rightEye
  if (le != null && re != null) {
    var ax = le.x
    var ay = le.y
    var bx = re.x
    var by = re.y
    // Left/right labels are not trusted: the eyes are sorted by x.
    if (ax > bx) {
      val tx = ax
      val ty = ay
      ax = bx
      ay = by
      bx = tx
      by = ty
    }
    val dx = bx - ax
    val dy = by - ay
    val d = sqrt(dx * dx + dy * dy)
    if (d > 4f) {
      val ex = (ax + bx) / 2f
      val ey = (ay + by) / 2f
      val ux = dx / d
      val uy = dy / d
      // Position of a landmark down the face, in eye-distance units.
      fun down(p: Pt): Float = ((p.x - ex) * -uy + (p.y - ey) * ux) / d
      var noseY = 0.95f
      f.noseBase?.let { noseY = clampN(down(it), 0.5f, 1.6f) }
      var mouthY = 1.55f
      var open = 0f
      val ml = f.mouthLeft
      val mr = f.mouthRight
      val mb = f.mouthBottom
      if (ml != null && mr != null) {
        mouthY = clampN((down(ml) + down(mr)) / 2f, 1.0f, 2.4f)
        if (mb != null) open = clampN((down(mb) - mouthY - 0.16f) / 0.4f, 0f, 1f)
      } else if (mb != null) {
        mouthY = clampN(down(mb) - 0.2f, 1.0f, 2.4f)
      }
      return floatArrayOf(1f, ex, ey, d, atan2(uy, ux), sx, noseY, mouthY, open)
    }
  }
  // No landmarks: place from the face box, upright.
  return floatArrayOf(1f, f.boxCx, f.boxTop + f.boxH * 0.38f, max(8f, f.boxW * 0.4f), 0f, sx, 0.95f, 1.55f, 0f)
}

/** One smoothing step of the state S towards the latest detection T. Returns a new state. */
internal fun stepPose(s: FloatArray, t: FloatArray): FloatArray {
  val out = s.copyOf()
  if (t[0] > 0.5f) {
    if (s[0] < 0.05f) {
      for (i in 1 until 9) out[i] = t[i]
      out[0] = 0.5f
      return out
    }
    val dist = sqrt((t[1] - s[1]) * (t[1] - s[1]) + (t[2] - s[2]) * (t[2] - s[2])) / max(s[3], 1f)
    val a = clampN(0.3f + dist * 1.5f, 0.3f, 0.85f)
    out[1] = s[1] + a * (t[1] - s[1])
    out[2] = s[2] + a * (t[2] - s[2])
    out[3] = s[3] + 0.35f * (t[3] - s[3])
    var dr = t[4] - s[4]
    val twoPi = (2.0 * PI).toFloat()
    while (dr > PI.toFloat()) dr -= twoPi
    while (dr < -PI.toFloat()) dr += twoPi
    out[4] = s[4] + 0.45f * dr
    out[5] = s[5] + 0.3f * (t[5] - s[5])
    out[6] = s[6] + 0.25f * (t[6] - s[6])
    out[7] = s[7] + 0.25f * (t[7] - s[7])
    out[8] = s[8] + 0.5f * (t[8] - s[8])
    out[0] = min(1f, s[0] + 0.34f)
  } else {
    out[0] = max(0f, s[0] - 0.13f)
  }
  return out
}

/** [sprite, a, b, c, d, e, f, alpha]: x' = a x + c y + e, y' = b x + d y + f. */
internal const val PLACEMENT_LEN = 8

internal class Placements {
  var data = FloatArray(PLACEMENT_LEN * 16)
  var count = 0

  fun clear() {
    count = 0
  }

  fun add(sprite: Int, a: Float, b: Float, c: Float, d: Float, e: Float, f: Float, alpha: Float) {
    if (!(a.isFinite() && b.isFinite() && c.isFinite() && d.isFinite() && e.isFinite() && f.isFinite() && alpha.isFinite())) return
    if ((count + 1) * PLACEMENT_LEN > data.size) data = data.copyOf(data.size * 2)
    val o = count * PLACEMENT_LEN
    data[o] = sprite.toFloat()
    data[o + 1] = a
    data[o + 2] = b
    data[o + 3] = c
    data[o + 4] = d
    data[o + 5] = e
    data[o + 6] = f
    data[o + 7] = alpha
    count++
  }
}

private fun fract(x: Double): Double = x - floor(x)

// Face matrix * local (translate, rotate, scale) matrix.
private fun put(out: Placements, sprite: Int, s: FloatArray, lx: Float, ly: Float, lsx: Float, lsy: Float, lrot: Float, alpha: Float) {
  val d = s[3]
  val cr = cos(s[4])
  val sr = sin(s[4])
  val fa = cr * d * s[5]
  val fb = sr * d * s[5]
  val fc = -sr * d
  val fd = cr * d
  val cl = cos(lrot)
  val sl = sin(lrot)
  val la = cl * lsx
  val lb = sl * lsx
  val lc = -sl * lsy
  val ld = cl * lsy
  out.add(
    sprite,
    fa * la + fc * lb,
    fb * la + fd * lb,
    fa * lc + fc * ld,
    fb * lc + fd * ld,
    fa * lx + fc * ly + s[1],
    fb * lx + fd * ly + s[2],
    alpha * s[0],
  )
}

/** The sprites to draw for effect `fx` (index into FACE_FX_IDS) at time `t` seconds. */
internal fun placeEffect(fx: Int, s: FloatArray, t: Double, out: Placements) {
  out.clear()
  if (s[0] < 0.02f) return
  val noseY = s[6]
  val mouthY = s[7]
  fun sn(v: Double): Float = sin(v).toFloat()
  when (fx) {
    0 -> {
      val sway = sn(t * 3.1) * 0.05f
      put(out, 0, s, -0.7f, -1.0f, 1f, 1f, 0.12f + sway, 1f)
      put(out, 0, s, 0.7f, -1.0f, -1f, 1f, -0.12f - sway, 1f)
      put(out, 1, s, 0f, noseY - 0.02f, 1f, 1f, 0f, 1f)
      if (s[8] > 0.25f) put(out, 2, s, 0f, mouthY + 0.02f, 1f, 0.5f + s[8] * 0.7f, 0f, 1f)
    }
    1 -> {
      put(out, 3, s, -0.8f, -1.05f, 1f, 1f, -0.28f, 1f)
      put(out, 3, s, 0.8f, -1.05f, -1f, 1f, 0.28f, 1f)
      put(out, 4, s, 0f, noseY - 0.06f, 1f, 1f, 0f, 1f)
      put(out, 5, s, -0.55f, noseY + 0.12f, 1f, 1f, 0f, 1f)
      put(out, 5, s, 0.55f, noseY + 0.12f, -1f, 1f, 0f, 1f)
    }
    2 -> {
      val sway = sn(t * 2.4) * 0.05f
      put(out, 6, s, -0.55f, -1.05f, 1f, 1f, -0.1f + sway, 1f)
      put(out, 6, s, 0.55f, -1.05f, -1f, 1f, 0.1f - sway, 1f)
      put(out, 7, s, 0f, noseY - 0.04f, 1f, 1f, 0f, 1f)
      put(out, 8, s, 0f, (noseY + mouthY) / 2f + 0.06f, 1f, 1f, 0f, 1f)
      put(out, 5, s, -0.5f, noseY + 0.1f, 0.9f, 1f, 0f, 1f)
      put(out, 5, s, 0.5f, noseY + 0.1f, -0.9f, 1f, 0f, 1f)
    }
    3 -> put(out, 9, s, 0f, 0.1f, 1f, 1f, 0f, 1f)
    4 -> put(out, 10, s, 0f, 0.02f, 1f, 1f, 0f, 1f)
    5 -> put(out, 11, s, 0f, -1.2f + sn(t * 2.2) * 0.02f, 1.1f, 1.1f, 0f, 1f)
    6 -> {
      for (i in 0 until 8) {
        val ph = fract(t * 0.32 + i * 0.125 + (i % 3) * 0.07)
        val side = if (i % 2 == 0) -1.0 else 1.0
        val lx = (side * (0.75 + 0.6 * fract(i * 0.618)) + sin(ph * 9.4 + i) * 0.14).toFloat()
        val ly = (1.0 - ph * 3.4).toFloat()
        val sc = (0.5 + 0.45 * fract(i * 0.37 + 0.2)).toFloat()
        val al = sin(ph * PI).toFloat()
        put(out, 12, s, lx, ly, sc, sc, sn(ph * 5 + i) * 0.4f, al)
      }
    }
    7 -> {
      put(out, 13, s, -0.92f, noseY + 0.05f, 1f, 0.9f, 0f, 1f)
      put(out, 13, s, 0.92f, noseY + 0.05f, 1f, 0.9f, 0f, 1f)
      put(out, 14, s, 0f, noseY - 0.32f, 1f, 1f, 0f, 1f)
    }
    8 -> put(out, 15, s, 0f, 0.04f, 1f, 1f, 0f, 1f)
    9 -> {
      put(out, 16, s, 0f, -1.85f + sn(t * 2.0) * 0.05f, 1f, 1f, sn(t * 1.5) * 0.04f, 1f)
      for (i in 0 until 4) {
        val tw = (0.5 + 0.5 * sin(t * 3 + i * 1.7)).toFloat()
        val sx = if (i < 2) -1f else 1f
        put(
          out, 17, s,
          sx * (0.95f + 0.4f * (i % 2)),
          -1.55f - 0.35f * (i % 2) + 0.3f * (if (i > 1) 1f else 0f),
          0.45f + tw * 0.4f, 0.45f + tw * 0.4f, tw, tw,
        )
      }
    }
  }
}
