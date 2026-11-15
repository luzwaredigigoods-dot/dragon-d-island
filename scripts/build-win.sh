#!/usr/bin/env bash
# Membuat dist/Dragon-Dynamic-Island-v<versi>-win-x64.zip: folder siap pakai untuk Windows 64-bit
# (ekstrak, lalu jalankan "Dragon Dynamic Island.exe"). Bisa dijalankan dari Linux, macOS, atau Git Bash.
# Butuh: node, npm, curl, unzip, zip.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -d node_modules ] || npm install

VERSION="$(node -p "require('./package.json').version")"
ELECTRON="$(node -p "require('electron/package.json').version")"
WORK="$ROOT/build"
NAME="Dragon Dynamic Island"
OUT="$ROOT/dist/Dragon-Dynamic-Island-v${VERSION}-win-x64.zip"
ZIP="$WORK/electron-v${ELECTRON}-win32-x64.zip"

mkdir -p "$WORK" "$ROOT/dist"
if [ ! -f "$ZIP" ]; then
  echo "Mengunduh Electron ${ELECTRON} untuk Windows..."
  curl -fSL --retry 3 -o "$ZIP" \
    "https://github.com/electron/electron/releases/download/v${ELECTRON}/electron-v${ELECTRON}-win32-x64.zip"
fi

APPDIR="$WORK/$NAME"
rm -rf "$APPDIR"
mkdir -p "$APPDIR"
unzip -q "$ZIP" -d "$APPDIR"
mv "$APPDIR/electron.exe" "$APPDIR/$NAME.exe"
rm -f "$APPDIR/resources/default_app.asar"

# Logo dan nama di dalam file .exe (Explorer, Desktop, taskbar)
node scripts/set-exe-icon.js "$APPDIR/$NAME.exe" icon.ico

# Kode aplikasi
mkdir -p "$APPDIR/resources/app"
cp -r main.js preload.js catcher.html catcher.js catcher-preload.js \
      claude-chat.js claude-monitor.js statusline.ps1 \
      media.ps1 winwatch.ps1 iconhelper.ps1 icon.png tray.png renderer \
      "$APPDIR/resources/app/"
node -e "
const p = require('./package.json');
delete p.devDependencies; delete p.scripts;
require('fs').writeFileSync(process.argv[1], JSON.stringify(p, null, 2));
" "$APPDIR/resources/app/package.json"
# Dependensi yang dipakai saat berjalan (SDK Anthropic untuk chat Claude); tanpa paket pengembangan.
cp package-lock.json "$APPDIR/resources/app/"
(cd "$APPDIR/resources/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
rm -f "$APPDIR/resources/app/package-lock.json"

rm -f "$OUT"
(cd "$WORK" && zip -qr "$OUT" "$NAME")
echo "Selesai: $OUT"
