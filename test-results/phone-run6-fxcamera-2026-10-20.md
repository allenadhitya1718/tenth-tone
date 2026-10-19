# Phone run 6: native fx camera (build 06e2353), Redmi 9 Power, 2026-10-20

Tester: automated agent via adb. Phone was lying flat most of the run (back camera sees the table), owner did not hold it upright, so face-sprite checks are NEEDS-HUMAN.

| # | Item | Result |
|---|------|--------|
| 1 | Native path active, back/Normal live preview | PASS |
| 2 | Looks cycle, beauty, no black/crash | PASS (one slow-render line) |
| 3 | 10 face effects on front camera | NEEDS-HUMAN (all 10 selectable, no face in view; Halo seen once on owner's face, plausible) |
| 4 | Record back + front, straight to Post | PASS (file not readable, private cacheDir) |
| 5 | Flip, torch, 1x/2x, double-tap, reopen x5, background | PASS (see FAIL-1 below for a related bug) |
| 6 | Fallback | FAIL-1: native path demoted to fallback once (camera error 6) |

## Evidence
- Native path: logcat shows CameraX (CXCP) opening camera 0 for com.flyp.app, no `native fx camera failed`, `FlypFx: render is slow: quality level 1` (the native pipeline's own adaptive line). Preview pixel stats live (mean 60-190, std 17-37 on lit scenes).
- Looks: 6 consecutive swipes gave 6 distinct colour grades (mean RGB 188/178/173, 208/175/149, 184/189/197, 184/171/160, 159/155/160, 194/176/182), no black.
- Adaptive quality: `W/FlypFx: render is slow: quality level 1` at 00:29:39 (pid 15286) and 00:31:35 (pid 22429). Frame rate not measurable via adb; no other lag lines.
- Recording: stop went directly to Post (no Applying effects), both back (2x, Puppy fx, torch) and front (6 s). Post preview playback is live and matches the preview. Recorded file lives in app cacheDir (`flyp-rec-*.mp4`, FlypFxCameraView.kt:320); app is not debuggable so run-as/pull impossible; ffprobe/ffmpeg not installed. Resolution, fps, bitrate, audio, effect-in-file NOT measured. There is no `onRecordingFinished` log line in the module either.
- Reopen camera 5 times: camera opened each time (camera 0 open, torch responded, front live), no stuck camera. Double-tap flip works (via a single shell invocation). Torch works (black table -> lit).
- Background (HOME 4 s, return): camera alive, torch still responds.

## FAIL-1: transient CameraX fatal error permanently drops to fallback
Sequence at 00:30:30 (the MIUI system Camera app took the camera while FLYP was in a floating window):
```
00:30:30.926 W ReactNativeJS 'fx camera:', 'CAMERA_STATE', 'camera error 6'
00:30:30.927 W ReactNativeJS 'native fx camera failed:', 'CAMERA_STATE: camera error 6'
00:30:32.509 W ReactNativeJS 'camera:', 'java.lang.Error: Encountered a fatal Camera error!'
00:30:33.185 W ReactNativeJS 'camera:', 'tu: Camera is not active.' / 'No flash unit'
```
The error fired after a good first frame; CameraScreen.tsx set `nativeFailed` (sticky state), so the screen switched to VisionCamera/Skia for the rest of the process (the `camera:` lines are the fallback component). Later the OS killed the backgrounded process (low-memory, no FATAL/AndroidRuntime), which reset it to native.
Suspect: CameraScreen.tsx onError of FxCamera -> nativeFailedNow (sticky). Module side: FlypFxCameraView.kt:269 reports code >= 5 (6 = ERROR_CAMERA_FATAL_ERROR).
Fix applied (typecheck + eslint clean, not built or device-tested): in CameraScreen.tsx, a CAMERA_STATE error after the first frame, not recording, remounts FxCamera (new `nativeKey`) up to 2 times before falling back. Changes: added `nativeKey` state and `nativeRetries` ref, `key={nativeKey}` on `<FxCamera>`, new `else if` branch in its onError.

## Other notes
- Process death was a system low-memory kill of the backgrounded app (Instagram etc. resident), not an app crash.
- Selecting a face effect then swiping looks does not move the strip highlight (stripFocus prefers fx): by design.
- Beauty slider dragging could not be checked accurately: a drag starting near the slider edge may be treated as a look swipe on the preview.

## For the owner to check by eye
- Hold the phone upright on the front camera: each of the 10 sprites (ears, shades, glasses, crown, hearts, sweet, hero mask, halo) at plausible position, rotation, mirroring; tilt head.
- Recorded file (post-record playback): effect/look present, front video not mirrored wrongly, audio present, 1080x1920.
- While the camera screen is open, open another camera app and return: preview should recover (needs the fix built).
