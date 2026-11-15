'use strict';
// Seret file ke pulau lewat jendela penangkap (jendela transparan tidak menerima seretan dari Windows).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT, sleep, launch } = require('./helpers');

let t;
before(async () => { t = await launch(); await t.seed({ shelf: [] }); });
after(async () => { if (t) { assert.deepEqual(t.errors, [], 'tidak boleh ada error di tampilan'); await t.close(); } });

const catcherInfo = () => t.app.evaluate(({ BrowserWindow }) => {
  const k = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('catcher.html'));
  return { bounds: k.getBounds(), visible: k.isVisible() };
});
const shelfNames = () => t.win.$$eval('.file .nm', (l) => l.map((e) => e.textContent));

test('jendela penangkap berada tepat di bawah pil dan mengikuti ukuran panel', async () => {
  await t.cursor(t.cx + 500, 600, 500);
  const pill = await catcherInfo();
  assert.equal(pill.visible, true);
  assert.ok(Math.abs(pill.bounds.x + pill.bounds.width / 2 - t.cx) <= 2, 'di tengah layar');
  assert.ok(pill.bounds.width < 200 && pill.bounds.height < 30, `kecil saat pil: ${JSON.stringify(pill.bounds)}`);
  await t.catcher.evaluate(() => window.catchApi.enter(['Files']));
  await sleep(700);
  const panel = await catcherInfo();
  assert.ok(panel.bounds.width > 300 && panel.bounds.height > 100, `besar saat panel: ${JSON.stringify(panel.bounds)}`);
  await sleep(1500);
});

test('seret masuk membuka Shelf, panel bertahan selama seretan, lepas menambah file', async () => {
  const { win, catcher } = t;
  await catcher.evaluate(() => window.catchApi.enter(['Files']));
  await sleep(400);
  assert.match(await t.wrapClass(), /expanded/);
  assert.match(await t.wrapClass(), /dragover/);
  assert.match(await t.title(), /^Shelf/);
  assert.match(await t.dragonClass(), /hungry/);
  for (let i = 0; i < 6; i++) { await catcher.evaluate(() => window.catchApi.over()); await sleep(250); }
  assert.match(await t.wrapClass(), /dragover/, 'masih menunggu file setelah 1,5 detik');
  await catcher.evaluate((paths) => window.catchApi.drop(paths, 'tes'), [path.join(ROOT, 'package.json'), path.join(ROOT, 'icon.png'), path.join(ROOT, 'tidak-ada.lnk')]);
  await sleep(700);
  assert.deepEqual(await shelfNames(), ['package.json', 'icon.png'], 'file yang tidak ada dilewati');
  assert.equal(await win.$$eval('.file img.ic', (l) => l.length), 2, 'setiap file punya ikon');
});

test('panel menutup bila seretan pergi tanpa melepas file', async () => {
  await t.cursor(t.cx + 500, 600, 3500);
  await t.catcher.evaluate(() => window.catchApi.enter(['Files']));
  await sleep(400);
  assert.match(await t.wrapClass(), /expanded/);
  await sleep(2200);
  assert.match(await t.wrapClass(), /collapsed/);
});

test('melepas item tanpa file memberi pesan, bukan diam', async () => {
  await t.catcher.evaluate(() => window.catchApi.enter(['text/plain']));
  await sleep(300);
  await t.catcher.evaluate(() => window.catchApi.drop([], 'jenis=text/plain file=0'));
  await sleep(500);
  assert.match(await t.win.textContent('#shelfHint span'), /tidak punya file/);
});

test('jendela penangkap ikut hilang saat pulau menyingkir', async () => {
  await sleep(3000);
  await t.send('dodge', true);
  await t.cursor(t.cx + 40, 60, 600);
  assert.match(await t.wrapClass(), /hidden/);
  assert.equal((await catcherInfo()).visible, false);
  await t.send('dodge', false);
  await t.cursor(t.cx + 500, 700, 600);
  assert.equal((await catcherInfo()).visible, true);
});
