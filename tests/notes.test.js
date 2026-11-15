'use strict';
// Notes: tempel, salin, simpan ke file .txt, hapus dua langkah, dan panel tetap terbuka saat mengetik.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sleep, launch } = require('./helpers');

let t;
before(async () => { t = await launch(); await t.seed(); });
after(async () => { if (t) { assert.deepEqual(t.errors, [], 'tidak boleh ada error di tampilan'); await t.close(); } });

const clip = {
  write: (s) => t.app.evaluate(({ clipboard }, x) => clipboard.writeText(x), s),
  read: () => t.app.evaluate(({ clipboard }) => clipboard.readText()),
};

test('tempel dari clipboard, ketik, lalu tempel lagi di baris baru', async () => {
  const { win } = t;
  await t.open();
  await t.page(5);
  assert.equal((await t.title()).split(' ')[0], 'Notes');
  await clip.write('RM 123456\nNy. A, G2P1A0 38 mgg');
  await win.click('#notePaste');
  await win.click('#noteText');
  await win.keyboard.press('Control+End');
  await win.keyboard.type('\nketik manual');
  await clip.write('tempel kedua');
  await win.click('#notePaste');
  await sleep(400);
  assert.equal(await win.inputValue('#noteText'), 'RM 123456\nNy. A, G2P1A0 38 mgg\nketik manual\ntempel kedua');
  assert.match(await win.textContent('#noteCount'), /56 huruf/);
});

test('salin seluruh catatan ke clipboard', async () => {
  await t.win.click('#noteCopy');
  await sleep(150);
  assert.equal(await clip.read(), await t.win.inputValue('#noteText'));
});

test('simpan menulis file .txt (UTF-8 BOM, baris Windows) tanpa menimpa file sebelumnya', async () => {
  const { win } = t;
  await win.click('#noteSave');
  await sleep(400);
  assert.match(await win.textContent('#noteStatus'), /^Tersimpan: Catatan \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.txt/);
  const dir = path.join(t.dir, 'Documents', 'Dragon Dynamic Island Notes');
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  const buf = fs.readFileSync(path.join(dir, files[0]));
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'diawali BOM');
  assert.equal(buf.toString('utf8').slice(1), (await win.inputValue('#noteText')).replace(/\n/g, '\r\n'));
  await win.click('#noteSave');
  await sleep(300);
  assert.equal(fs.readdirSync(dir).length, 2, 'simpan lagi di menit yang sama membuat file baru');
});

test('panel tetap terbuka saat mengetik walau kursor pergi; Escape menutupnya', async () => {
  const { win } = t;
  await win.click('#noteText');
  await win.mouse.move(t.cx, 400);
  await t.cursor(t.cx, 600, 900);
  assert.match(await t.wrapClass(), /expanded/);
  await win.keyboard.press('Escape');
  await t.cursor(t.cx, 601, 900);
  assert.match(await t.wrapClass(), /collapsed/);
});

test('catatan tersimpan setelah dibuka ulang, dan Hapus perlu dua klik', async () => {
  const { win } = t;
  await win.reload();
  await win.waitForSelector('#wrap');
  await sleep(400);
  assert.equal((await win.inputValue('#noteText')).length, 56);
  await t.open();
  await win.click('#noteClear');
  assert.equal(await win.textContent('#noteClear'), 'Yakin?');
  assert.equal((await win.inputValue('#noteText')).length, 56, 'klik pertama belum menghapus');
  await win.click('#noteClear');
  assert.equal(await win.inputValue('#noteText'), '');
});
