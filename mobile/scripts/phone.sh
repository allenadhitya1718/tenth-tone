#!/usr/bin/env bash
# Drive the development build on a USB-connected Android phone.
#
#   scripts/phone.sh connect          forward Metro (port 8081) over USB
#   scripts/phone.sh restart          close FLYP and open it again
#   scripts/phone.sh shot [file.png]  screenshot, only if FLYP is in front
#   scripts/phone.sh log [lines]      FLYP's JavaScript log and crashes
#   scripts/phone.sh install <apk>    install a build (falls back to copying
#                                     it to Download/ when MIUI blocks USB installs)
#
# Launching goes through `monkey` (a launcher-style start): MIUI refuses
# `am start` from adb for an app that is not already in front.
set -euo pipefail

ADB="${ADB:-$HOME/Android/platform-tools/adb}"
PKG=com.flyp.app

in_front() {
  "$ADB" shell dumpsys activity activities 2>/dev/null | grep -m1 mResumedActivity | grep -q "$PKG"
}

case "${1:-}" in
  connect)
    "$ADB" reverse tcp:8081 tcp:8081 >/dev/null && echo "Metro forwarded over USB"
    ;;
  restart)
    "$ADB" reverse tcp:8081 tcp:8081 >/dev/null
    "$ADB" shell am force-stop "$PKG"
    sleep 1
    "$ADB" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    for _ in $(seq 1 15); do in_front && { echo "FLYP is open"; exit 0; }; sleep 1; done
    echo "FLYP did not come to the front" >&2; exit 1
    ;;
  shot)
    out="${2:-/tmp/flyp-shot.png}"
    if in_front; then "$ADB" exec-out screencap -p > "$out" && echo "$out"
    else echo "FLYP is not in front; no screenshot taken" >&2; exit 1; fi
    ;;
  log)
    "$ADB" logcat -d -s ReactNativeJS:V ReactNative:E AndroidRuntime:E 2>/dev/null | tail -n "${2:-40}"
    ;;
  install)
    apk="${2:?path to .apk}"
    if ! timeout 120 "$ADB" install -r "$apk"; then
      "$ADB" push "$apk" /sdcard/Download/FLYP-dev.apk >/dev/null
      echo "USB install blocked; copied to Download/FLYP-dev.apk - tap it in File Manager to install"
    fi
    ;;
  *)
    sed -n '2,11p' "$0"; exit 1
    ;;
esac
