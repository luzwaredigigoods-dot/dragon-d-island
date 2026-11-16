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

test('buka catatan tersimpan dengan ‹ ›: urut terakhir diubah, draf aman, tidak keluar folder catatan', async () => {
  const { win } = t;
  const dir = path.join(t.dir, 'Documents', 'Dragon Dynamic Island Notes');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const mk = (name, text, ageMin) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, '\uFEFF' + text.replace(/\n/g, '\r\n'), 'utf8');
    const when = new Date(Date.now() - ageMin * 60000);
    fs.utimesSync(p, when, when);
  };
  mk('a-tertua.txt', 'catatan tertua\nbaris dua', 300);
  mk('b-tengah.txt', 'catatan tengah', 120);
  mk('c-terbaru.txt', 'catatan terbaru', 5);
  fs.writeFileSync(path.join(dir, 'bukan-catatan.docx'), 'x');
  const pos = () => win.textContent('#notePos');
  const text = () => win.inputValue('#noteText');
  const go = async (sel) => { await win.click(sel); await sleep(250); };

  await win.fill('#noteText', 'draf saya yang belum disimpan');
  await sleep(450);
  await t.open();
  await t.page(5);
  assert.equal(await pos(), 'Draf');
  assert.equal(await win.$eval('#noteNewer', (e) => e.disabled), true, 'tidak ada yang lebih baru dari draf');

  await go('#noteOlder');
  assert.equal(await pos(), '1/3');
  assert.equal(await text(), 'catatan terbaru', 'yang pertama dibuka adalah yang terakhir diubah; BOM dan CRLF dibersihkan');
  assert.match(await win.textContent('#noteStatus'), /c-terbaru\.txt · diubah/);
  await go('#noteOlder');
  assert.equal(await text(), 'catatan tengah');
  await go('#noteOlder');
  assert.equal(await pos(), '3/3');
  assert.equal(await text(), 'catatan tertua\nbaris dua');
  assert.equal(await win.$eval('#noteOlder', (e) => e.disabled), true, 'sudah yang paling lama');

  // urutan mengikuti waktu diubah: menyentuh yang tertua menjadikannya yang terbaru
  fs.utimesSync(path.join(dir, 'a-tertua.txt'), new Date(), new Date());
  await go('#noteNewer'); // yang dilihat kini yang terbaru, jadi › kembali ke draf
  assert.equal(await pos(), 'Draf');
  await go('#noteOlder');
  assert.equal(await pos(), '1/3');
  assert.equal(await text(), 'catatan tertua\nbaris dua', 'daftar dimuat ulang: yang baru disentuh kini paling depan');
  await go('#noteOlder');
  assert.equal(await text(), 'catatan terbaru');

  // kembali ke draf lewat ›, isinya utuh
  await go('#noteNewer');
  await go('#noteNewer');
  assert.equal(await pos(), 'Draf');
  assert.equal(await text(), 'draf saya yang belum disimpan');

  // mengubah berkas lalu pindah: peringatan dulu, tekan lagi baru lanjut; draf tidak tertimpa
  await go('#noteOlder');
  await win.fill('#noteText', 'berkas diubah');
  await go('#noteOlder');
  assert.match(await win.textContent('#noteStatus'), /belum disimpan/);
  assert.equal(await text(), 'berkas diubah', 'peringatan: belum pindah');
  await go('#noteNewer');
  assert.equal(await pos(), 'Draf');
  assert.equal(await text(), 'draf saya yang belum disimpan');
  await sleep(400);
  assert.equal(JSON.parse(await win.evaluate(() => localStorage.getItem('note'))), 'draf saya yang belum disimpan');

  // Simpan saat melihat berkas membuat berkas baru, berkas asli tidak ditimpa
  await go('#noteOlder');
  const original = await text();
  await win.fill('#noteText', original + ' + tambahan');
  await win.click('#noteSave');
  await sleep(400);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).length, 4);
  assert.equal(await pos(), '1/4');
  assert.match(fs.readFileSync(path.join(dir, 'a-tertua.txt'), 'utf8'), /^\uFEFFcatatan tertua/);

  // hanya berkas .txt di folder catatan yang boleh dibaca
  const bad = await win.evaluate(() => Promise.all([
    window.api.noteRead('C:\\Windows\\win.ini'), window.api.noteRead('../../etc/passwd'),
  ]));
  assert.deepEqual(bad.map((r) => r.ok), [false, false]);
  const docx = await win.evaluate((p) => window.api.noteRead(p), path.join(dir, 'bukan-catatan.docx'));
  assert.equal(docx.ok, false);
});
