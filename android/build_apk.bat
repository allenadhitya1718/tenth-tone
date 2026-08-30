@echo off
REM ---------------------------------------------------------------
REM  Local debug APK build.
REM
REM  The sync step is not optional. Gradle packages whatever sits in
REM  android\app\src\main\assets\public - it never looks at web\. That
REM  copy only happens on "npx cap sync", so without it the APK is
REM  built from whatever was last copied there, however old.
REM
REM  This script used to call gradlew alone. The result was an APK
REM  pinned to an old snapshot: config.js, compress.js, nsfw-check.js
REM  and deeplink.js were absent because they were added to web\ after
REM  the last sync, and with config.js missing the app fell back to
REM  demo data with no way to switch it off.
REM
REM  The CI workflow (.github/workflows/android-build.yml) has always
REM  run the sync, which is why CI builds were fine and local ones
REM  were not.
REM ---------------------------------------------------------------

REM Run from the project root, where package.json and capacitor.config.json live.
cd /d "%~dp0\.."

echo.
echo === Syncing web assets into the Android project ===
call npx cap sync android
if errorlevel 1 (
  echo.
  echo FAILED: cap sync did not complete. Not building — the APK would
  echo be stale. Check that dependencies are installed ^(npm install^).
  exit /b 1
)

echo.
echo === Building debug APK ===
cd android
call gradlew.bat assembleDebug
if errorlevel 1 (
  echo.
  echo FAILED: gradle build did not complete.
  exit /b 1
)

echo.
echo === Done ===
echo APK: android\app\build\outputs\apk\debug\app-debug.apk
