#!/usr/bin/env bash
# Membuat dist/Pulau-v<versi>-win-x64.zip: folder siap pakai untuk Windows 64-bit
# (ekstrak, lalu jalankan Pulau.exe). Bisa dijalankan dari Linux, macOS, atau Git Bash.
# Butuh: node, npm, curl, unzip, zip.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -d node_modules ] || npm install

VERSION="$(node -p "require('./package.json').version")"
ELECTRON="$(node -p "require('electron/package.json').version")"
WORK="$ROOT/build"
OUT="$ROOT/dist/Pulau-v${VERSION}-win-x64.zip"
ZIP="$WORK/electron-v${ELECTRON}-win32-x64.zip"

mkdir -p "$WORK" "$ROOT/dist"
if [ ! -f "$ZIP" ]; then
  echo "Mengunduh Electron ${ELECTRON} untuk Windows..."
  curl -fSL --retry 3 -o "$ZIP" \
    "https://github.com/electron/electron/releases/download/v${ELECTRON}/electron-v${ELECTRON}-win32-x64.zip"
fi

APPDIR="$WORK/Pulau"
rm -rf "$APPDIR"
mkdir -p "$APPDIR"
unzip -q "$ZIP" -d "$APPDIR"
mv "$APPDIR/electron.exe" "$APPDIR/Pulau.exe"
rm -f "$APPDIR/resources/default_app.asar"

# Logo di dalam Pulau.exe (Explorer, Desktop, taskbar)
node scripts/set-exe-icon.js "$APPDIR/Pulau.exe" icon.ico

# Kode aplikasi
mkdir -p "$APPDIR/resources/app"
cp -r main.js preload.js catcher.html catcher.js catcher-preload.js \
      media.ps1 winwatch.ps1 iconhelper.ps1 icon.png tray.png renderer \
      "$APPDIR/resources/app/"
node -e "
const p = require('./package.json');
delete p.devDependencies; delete p.scripts;
require('fs').writeFileSync(process.argv[1], JSON.stringify(p, null, 2));
" "$APPDIR/resources/app/package.json"

rm -f "$OUT"
(cd "$WORK" && zip -qr "$OUT" Pulau)
echo "Selesai: $OUT"
