'use strict';
// Pil, panel, navigasi halaman, media, todo, dan ukuran.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, sleep, launch } = require('./helpers');

let t;
before(async () => { t = await launch(); await t.seed(); });
after(async () => { if (t) { assert.deepEqual(t.errors, [], 'tidak boleh ada error di tampilan'); await t.close(); } });

test('pil menampilkan tanggal dan jam, lalu panel terbuka saat kursor di atasnya', async () => {
  const { win } = t;
  await t.cursor(t.cx + 400, 600);
  assert.match(await t.wrapClass(), /collapsed/);
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const pill = (await win.textContent('#pill')).replace(/\s+/g, ' ');
  assert.ok(pill.includes(String(d.getDate())), `tanggal di pil: "${pill}"`);
  assert.ok(pill.includes(time) || pill.includes(':'), `jam di pil: "${pill}"`);
  assert.ok(await win.$eval('#pill', (e) => e.scrollWidth <= e.clientWidth), 'isi pil harus muat');
  await t.open();
  assert.match(await t.wrapClass(), /expanded/);
  await win.mouse.move(t.cx, 400);
  await sleep(900);
  assert.match(await t.wrapClass(), /collapsed/);
});

test('enam halaman, tombol navigasi di bawah berputar, isi tidak menabrak baris navigasi', async () => {
  const { win } = t;
  await t.open();
  assert.deepEqual(await win.$$eval('#dots .navicon', (l) => l.map((e) => e.title)), ['Media', 'Shelf', 'Todo List', 'Jadwal Sholat', 'Notes', 'Claude']);
  await t.page(1);
  const titles = [];
  for (let i = 0; i < 6; i++) {
    titles.push(await t.title());
    const overlap = await win.evaluate(() => {
      const nav = document.getElementById('navrow').getBoundingClientRect();
      let worst = 0;
      document.querySelector('.page.active').querySelectorAll('*').forEach((e) => {
        if (e.closest('[hidden]') || !e.getClientRects().length) return;
        const r = e.getBoundingClientRect();
        if (r.width && r.bottom > nav.top + 1) worst = Math.max(worst, r.bottom - nav.top);
      });
      return Math.round(worst);
    });
    assert.equal(overlap, 0, `halaman ${titles[i]} menabrak baris navigasi`);
    await win.click('#next');
    await sleep(300);
  }
  assert.deepEqual(titles.map((x) => x.split(' ')[0]), ['Media', 'Shelf', 'Todo', 'Jadwal', 'Notes', 'Claude']);
  assert.equal((await t.title()).split(' ')[0], 'Media', 'next dari halaman terakhir kembali ke awal');
  await win.click('#prev');
  await sleep(300);
  assert.equal((await t.title()).split(' ')[0], 'Claude');
});

test('ikon halaman: klik langsung ke halaman itu; dari Claude (panel tinggi) pulau tidak langsung menutup', async () => {
  const { win } = t;
  await t.open();
  await t.page(6);
  assert.match(await t.title(), /^Claude/);
  assert.match(await win.$eval('#dots .navicon:nth-child(6)', (e) => e.className), /\bon\b/);
  await win.click('#dots .navicon:nth-child(2)');
  await sleep(700);
  assert.match(await t.title(), /^Shelf/);
  assert.match(await t.wrapClass(), /expanded/, 'panel mengecil tapi pulau tetap terbuka sesaat');
});

test('media: judul, waktu, sampul, dan gelombang di pil', async () => {
  const { win } = t;
  await t.open();
  await t.page(1);
  await t.send('media:update', { has: true, title: 'Sisa Rasa', artist: 'Monsza', status: 'Playing', position: 65, duration: 200 });
  await sleep(200);
  assert.equal(await win.textContent('#mediaTitle'), 'Sisa Rasa');
  assert.equal(await win.textContent('#mediaPos'), '01:05');
  assert.equal(await win.textContent('#mediaRem'), '-02:15');
  assert.equal(await win.evaluate(() => document.getElementById('pillWave').hidden), false);
  assert.match(await t.dragonClass(), /bob/, 'naga mengangguk saat musik diputar');
  const png = fs.readFileSync(path.join(ROOT, 'icon.png')).toString('base64');
  await t.send('media:thumb', { title: 'Sisa Rasa', thumb: 'data:image/png;base64,' + png });
  await sleep(200);
  assert.match(await win.$eval('#mediaArt', (e) => e.className), /thumb/);
  await t.send('media:update', { has: true, title: 'Lagu Lain', artist: 'X', status: 'Paused', position: 1, duration: 100 });
  await sleep(200);
  assert.doesNotMatch(await win.$eval('#mediaArt', (e) => e.className), /thumb/, 'sampul lama hilang saat lagu berganti');
  await t.send('media:update', { has: false });
});

test('todo: tambah, centang, hapus, dan tugas belum selesai terbawa ke hari berikutnya', async () => {
  const { win } = t;
  await t.open();
  await t.page(3);
  for (const x of ['visite pagi', 'laporan operasi', 'hapus saya']) {
    await win.fill('#todoInput', x);
    await win.press('#todoInput', 'Enter');
  }
  await win.click('#todoList li:first-child');
  await win.click('#todoEdit');
  await win.click('#todoList li:nth-child(3) .del');
  await win.click('#todoEdit');
  assert.equal(await win.textContent('#todoCount'), '1/2');
  const items = await win.$$eval('#todoList li', (l) => l.map((x) => (x.classList.contains('done') ? '✓' : '·') + x.querySelector('.tx').textContent));
  assert.deepEqual(items, ['✓visite pagi', '·laporan operasi']);
  // pura-pura kemarin: tugas selesai dibuang, yang belum dibawa
  await win.evaluate(() => { const v = JSON.parse(localStorage.getItem('todo')); v.day = '2000-1-1'; localStorage.setItem('todo', JSON.stringify(v)); });
  await win.reload();
  await win.waitForSelector('#wrap');
  await sleep(1300);
  assert.deepEqual(await win.$$eval('#todoList li .tx', (l) => l.map((x) => x.textContent)), ['laporan operasi']);
});

test('ukuran dari menu tray mengubah skala dan tersimpan', async () => {
  const { win } = t;
  const width = () => win.$eval('#island', (e) => Math.round(e.getBoundingClientRect().width));
  await t.cursor(t.cx + 400, 600, 400);
  const kecil = await width();
  await t.send('scale', 1);
  await sleep(500);
  const sedang = await width();
  assert.ok(sedang > kecil, `Sedang (${sedang}) harus lebih lebar dari Kecil (${kecil})`);
  await win.reload();
  await win.waitForSelector('#wrap');
  await sleep(500);
  assert.equal(await width(), sedang, 'ukuran tersimpan setelah dibuka ulang');
  await t.send('scale', 0.82);
  await sleep(400);
});

test('peringatan saat berjalan sebagai administrator', async () => {
  await t.send('admin', true);
  await sleep(200);
  assert.match(await t.win.textContent('#shelfHint span'), /administrator/);
});
