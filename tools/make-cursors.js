'use strict';
// Membuat kursor bertema naga (konsep A: panah bermata) dari assets/cursor/*.svg:
//   renderer/cursors/<nama>.png dan <nama>@2x.png  -> dipakai CSS di dalam pulau (28 px, 56 px untuk layar tajam)
//   dist/cursors/<nama>.cur                        -> opsional, untuk dipasang sendiri di Windows (32/48/64 px)
//   dist/Kursor-Dragon-Windows.zip                 -> .cur + petunjuk pemasangan
// Dijalankan manual setelah mengubah SVG: node tools/make-cursors.js  (butuh playwright; hasil PNG ikut di-commit).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'cursor');
const OUT_PNG = path.join(ROOT, 'renderer', 'cursors');
const OUT_CUR = path.join(ROOT, 'dist', 'cursors');
// Titik ujung (hotspot) pada kanvas 32x32.
const NAMES = { 'a-normal': [3, 2], 'a-link': [3, 2], 'a-busy': [16, 16], 'a-ibeam': [16, 16] };
// nama berkas Windows
const CUR_NAMES = { 'a-normal': 'Normal', 'a-link': 'Tautan', 'a-busy': 'Sibuk', 'a-ibeam': 'Teks' };

async function render(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

function packCur(images, hot) { // images: [{size, png}], hot: [x, y] pada kanvas 32
  const n = images.length;
  const head = Buffer.alloc(6 + 16 * n);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(2, 2); head.writeUInt16LE(n, 4);
  let offset = head.length;
  images.forEach((im, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(im.size >= 256 ? 0 : im.size, o); head.writeUInt8(im.size >= 256 ? 0 : im.size, o + 1);
    head.writeUInt8(0, o + 2); head.writeUInt8(0, o + 3);
    head.writeUInt16LE(Math.round(hot[0] * im.size / 32), o + 4);
    head.writeUInt16LE(Math.round(hot[1] * im.size / 32), o + 6);
    head.writeUInt32LE(im.png.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += im.png.length;
  });
  return Buffer.concat([head, ...images.map((im) => im.png)]);
}

(async () => {
  fs.mkdirSync(OUT_PNG, { recursive: true });
  fs.mkdirSync(OUT_CUR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, hot] of Object.entries(NAMES)) {
    const svg = fs.readFileSync(path.join(SRC, name + '.svg'), 'utf8');
    fs.writeFileSync(path.join(OUT_PNG, name + '.png'), await render(page, svg, 28));
    fs.writeFileSync(path.join(OUT_PNG, name + '@2x.png'), await render(page, svg, 56));
    const imgs = [];
    for (const size of [32, 48, 64]) imgs.push({ size, png: await render(page, svg, size) });
    fs.writeFileSync(path.join(OUT_CUR, `${CUR_NAMES[name]}.cur`), packCur(imgs, hot));
    console.log(name, 'ok');
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT_CUR, 'BACA-SAYA.txt'), [
    'Kursor Dragon Dynamic Island (untuk seluruh Windows, opsional)',
    '',
    'Di dalam pulau kursor naga sudah otomatis dipakai; berkas ini hanya bila Anda ingin kursor yang sama di seluruh Windows.',
    '',
    'Memasang:',
    '1. Ekstrak zip ini ke folder tetap, mis. Dokumen\\Kursor Dragon (jangan dihapus setelah dipasang).',
    '2. Settings > Bluetooth & devices > Mouse > Additional mouse settings > tab Pointers.',
    '3. Pilih "Normal Select" > Browse > Normal.cur. Ulangi:',
    '     Link Select  -> Tautan.cur',
    '     Working in Background dan Busy -> Sibuk.cur (gambar diam, tidak berputar)',
    '     Text Select  -> Teks.cur',
    '4. Save As... beri nama "Dragon" supaya mudah dipilih lagi, lalu OK.',
    '',
    'Mengembalikan: pada tab yang sama pilih Scheme "Windows Default (system scheme)" lalu OK.',
    'Berkas ini tidak mengubah apa pun sampai Anda sendiri memilihnya.',
  ].join('\r\n'));
  const zip = path.join(ROOT, 'dist', 'Kursor-Dragon-Windows.zip');
  fs.rmSync(zip, { force: true });
  execFileSync('zip', ['-qj', zip, ...fs.readdirSync(OUT_CUR).map((f) => path.join(OUT_CUR, f))]);
  console.log('zip:', zip);
})();
