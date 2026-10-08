#!/usr/bin/env bash
#
# Baut die APK auf dem eigenen Rechner (Linux, macOS).
# Gegenstück zum Cloud-Build (.github/workflows/build-apk.yml).
#
# Voraussetzung: Node.js und das Android-SDK (ANDROID_HOME gesetzt oder
# android/local.properties mit "sdk.dir=…").
#
# Aufruf:  android/build-apk.sh
#
set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HIER/.."

echo "[1/3] Spiel bauen …"
npm ci
npm run build

echo "[2/3] Spiel in die App legen …"
WWW=android/app/src/main/assets/www
rm -rf "$WWW"
mkdir -p "$WWW"
cp -r dist/. "$WWW/"
rm -f "$WWW/sw.js"

echo "[3/3] APK bauen …"
cd android
./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../Nachtfall.apk
echo
echo "Fertig: $(cd .. && pwd)/Nachtfall.apk"
echo "Aufs Handy übertragen, antippen, installieren."
