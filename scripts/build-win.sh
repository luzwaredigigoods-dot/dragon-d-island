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
SETUP="$ROOT/dist/Dragon-Dynamic-Island-Setup-v${VERSION}.exe"
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
# Bahasa antarmuka Chromium: cukup Inggris dan Indonesia (yang lain ~40 MB).
find "$APPDIR/locales" -name '*.pak' ! -name 'en-US.pak' ! -name 'id.pak' -delete

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
# SDK Anthropic (chat Claude) digabung ke dalam claude-chat.js dengan esbuild: satu berkas ~1 MB
# menggantikan folder node_modules (~31 MB, ribuan berkas).
npx esbuild claude-chat.js --bundle --platform=node --target=node20 --external:electron \
  --log-level=warning --outfile="$APPDIR/resources/app/claude-chat.js" --allow-overwrite
node -e "
const p = require(process.argv[1]); delete p.dependencies;
require('fs').writeFileSync(process.argv[1], JSON.stringify(p, null, 2));
" "$APPDIR/resources/app/package.json"

rm -f "$OUT" "$SETUP"
(cd "$WORK" && zip -9 -qr "$OUT" "$NAME")
echo "Selesai: $OUT"

# Pemasang satu berkas (NSIS, kompresi LZMA): jauh lebih kecil dari zip.
if command -v makensis >/dev/null; then
  makensis -V2 -DVERSION="$VERSION" -DSRC="$APPDIR" -DOUT="$SETUP" -DICON="$ROOT/icon.ico" scripts/installer.nsi
  echo "Selesai: $SETUP"
else
  echo "makensis tidak ada: pemasang tidak dibuat (apt-get install nsis)."
fi
