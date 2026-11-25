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

const NOTES = (t) => path.join(t.dir, 'Documents', 'Dragon Dynamic Island Notes');
function resetNotes(t, files) { // files: [[nama, isi, umurMtimeMenit]]
  const dir = NOTES(t);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text, ageMin] of files) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, '\uFEFF' + text.replace(/\n/g, '\r\n'), 'utf8');
    const when = new Date(Date.now() - ageMin * 60000);
    fs.utimesSync(p, when, when);
  }
  return dir;
}

test('buka catatan tersimpan dengan ‹ › »: urut waktu dibuat, draf aman, tidak keluar folder catatan', async () => {
  const { win } = t;
  // Waktu dibuat (dari nama) sengaja berlawanan dengan waktu diubah: yang terbaru dibuat justru paling lama diubah.
  const dir = resetNotes(t, [
    ['Catatan 2026-11-10 08.00.txt', 'catatan tertua\nbaris dua', 1],
    ['Catatan 2026-11-12 09.30.txt', 'catatan tengah', 120],
    ['Catatan 2026-11-14 18.45.txt', 'catatan terbaru', 300],
    ['bukan-catatan.docx', 'x', 5],
  ]);
  const pos = () => win.textContent('#notePos');
  const text = () => win.inputValue('#noteText');
  const dis = (id) => win.$eval(id, (e) => e.disabled);
  const go = async (sel) => { await win.click(sel); await sleep(250); };

  await win.fill('#noteText', 'draf saya yang belum disimpan');
  await sleep(450);
  await t.open();
  await t.page(5);
  assert.equal(await pos(), 'Draf');
  assert.equal(await dis('#noteNewer'), true, 'tidak ada yang lebih baru dari draf');
  assert.equal(await dis('#noteLatest'), true, 'sudah di yang terbaru');
  assert.equal(await dis('#noteOlder'), false);

  await go('#noteOlder');
  assert.equal(await pos(), '1/3');
  assert.equal(await text(), 'catatan terbaru', 'urut waktu dibuat, bukan waktu diubah; BOM dan CRLF dibersihkan');
  assert.match(await win.textContent('#noteStatus'), /Catatan 2026-11-14 18\.45\.txt · dibuat/);
  assert.equal(await dis('#noteNewer'), false); assert.equal(await dis('#noteLatest'), false);
  // label posisi tidak melebar (pernah bentrok dengan kelas .file milik shelf dan mendorong » keluar panel)
  const right = await win.evaluate(() => ({ l: document.getElementById('noteLatest').getBoundingClientRect().right, p: document.querySelector('.page.active').getBoundingClientRect().right }));
  assert.ok(right.l <= right.p + 0.5, `» keluar dari panel: ${right.l} > ${right.p}`);
  await go('#noteOlder');
  assert.equal(await text(), 'catatan tengah');
  await go('#noteOlder');
  assert.equal(await pos(), '3/3');
  assert.equal(await text(), 'catatan tertua\nbaris dua');
  assert.equal(await dis('#noteOlder'), true, 'sudah yang paling lama');

  // › selangkah lebih baru; » langsung ke yang terbaru (draf)
  await go('#noteNewer');
  assert.equal(await pos(), '2/3');
  assert.equal(await text(), 'catatan tengah');
  await go('#noteLatest');
  assert.equal(await pos(), 'Draf');
  assert.equal(await text(), 'draf saya yang belum disimpan');
  assert.equal(await dis('#noteLatest'), true, 'di draf » nonaktif');

  // mengubah berkas lalu pindah: peringatan dulu, tekan lagi baru lanjut; draf tidak tertimpa
  await go('#noteOlder');
  await win.fill('#noteText', 'berkas diubah');
  await go('#noteLatest');
  assert.match(await win.textContent('#noteStatus'), /belum disimpan/);
  assert.equal(await text(), 'berkas diubah', 'peringatan: belum pindah');
  await go('#noteLatest');
  assert.equal(await pos(), 'Draf');
  assert.equal(await text(), 'draf saya yang belum disimpan');
  await sleep(400);
  assert.equal(JSON.parse(await win.evaluate(() => localStorage.getItem('note'))), 'draf saya yang belum disimpan');

  // Simpan saat membuka berkas lama menimpa berkas itu, dan urutannya tetap (menurut waktu dibuat)
  await go('#noteOlder'); await go('#noteOlder'); await go('#noteOlder');
  assert.equal(await pos(), '3/3');
  assert.equal(await text(), 'catatan tertua\nbaris dua');
  await win.fill('#noteText', 'catatan tertua\nbaris dua + tambahan');
  await win.click('#noteSave');
  await sleep(400);
  assert.match(await win.textContent('#noteStatus'), /^Ditimpa: Catatan 2026-11-10 08\.00\.txt/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Catatan 2026-11-10 08.00.txt', 'Catatan 2026-11-12 09.30.txt', 'Catatan 2026-11-14 18.45.txt', 'bukan-catatan.docx']);
  const buf = fs.readFileSync(path.join(dir, 'Catatan 2026-11-10 08.00.txt'));
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(buf.toString('utf8').slice(1), 'catatan tertua\r\nbaris dua + tambahan');
  assert.equal(await pos(), '3/3', 'ditimpa tidak mengubah urutan: tetap yang paling lama dibuat');

  // Simpan dari draf membuat berkas baru yang menjadi yang terbaru dibuat
  await go('#noteLatest');
  await win.click('#noteSave');
  await sleep(400);
  assert.match(await win.textContent('#noteStatus'), /^Tersimpan: Catatan /);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).length, 4);
  await go('#noteOlder');
  assert.equal(await pos(), '1/4');
  assert.equal(await text(), 'draf saya yang belum disimpan', 'berkas yang baru disimpan ada di urutan pertama');

  // hanya berkas .txt di folder catatan yang boleh dibaca
  const bad = await win.evaluate(() => Promise.all([
    window.api.noteRead('C:\\Windows\\win.ini'), window.api.noteRead('../../etc/passwd'),
  ]));
  assert.deepEqual(bad.map((r) => r.ok), [false, false]);
  const docx = await win.evaluate((p) => window.api.noteRead(p), path.join(dir, 'bukan-catatan.docx'));
  assert.equal(docx.ok, false);
});

test('Baru: draf yang belum disimpan otomatis tersimpan lalu kotak kosong; yang sudah disimpan tidak digandakan', async () => {
  const { win } = t;
  const dir = resetNotes(t, []);
  await win.evaluate(() => localStorage.removeItem('noteSaved'));
  const files = () => fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
  const text = () => win.inputValue('#noteText');
  const status = () => win.textContent('#noteStatus');
  await t.open();
  await t.page(5);
  await win.fill('#noteText', 'isi draf A');
  await sleep(450);

  await win.click('#noteNew');
  await sleep(500);
  assert.equal(await text(), '', 'kotak dikosongkan');
  assert.match(await status(), /^Draf lama disimpan: Catatan .*\.txt\. Catatan baru dibuka/);
  assert.equal(files().length, 1, 'draf lama jadi berkas');
  assert.match(fs.readFileSync(path.join(dir, files()[0]), 'utf8'), /isi draf A/);
  assert.equal(await win.textContent('#notePos'), 'Draf');
  assert.equal(await win.evaluate(() => document.activeElement.id), 'noteText', 'siap diketik');

  await win.click('#noteNew'); // kotak kosong: tidak ada berkas baru
  await sleep(300);
  assert.equal(files().length, 1);
  assert.equal(await status(), 'Catatan baru');

  // draf yang sudah disimpan lewat Simpan tidak disimpan dua kali
  await win.fill('#noteText', 'isi draf B');
  await win.click('#noteSave');
  await sleep(500);
  assert.equal(files().length, 2);
  await win.click('#noteNew');
  await sleep(500);
  assert.equal(files().length, 2, 'sudah tersimpan: tidak digandakan');
  assert.equal(await text(), '');
  assert.equal(await status(), 'Catatan baru');
  assert.equal(JSON.parse(await win.evaluate(() => localStorage.getItem('note'))), '', 'draf tersimpan kosong');

  // dari catatan tersimpan yang diubah: peringatan dulu; berkas aslinya tidak berubah
  await win.fill('#noteText', 'isi draf C belum disimpan');
  await sleep(450);
  await win.click('#noteOlder'); // buka yang terbaru (B); draf C aman di penyimpanan
  await sleep(300);
  assert.equal(await text(), 'isi draf B');
  await win.fill('#noteText', 'B diubah tanpa simpan');
  await win.click('#noteNew');
  await sleep(300);
  assert.match(await status(), /belum disimpan/);
  assert.equal(await text(), 'B diubah tanpa simpan');
  await win.click('#noteNew');
  await sleep(600);
  assert.equal(await text(), '');
  assert.match(await status(), /^Draf lama disimpan: /, 'draf C yang belum tersimpan ikut diselamatkan');
  assert.equal(files().length, 3);
  const contents = files().map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, ''));
  assert.ok(contents.some((c) => c === 'isi draf B'), 'B asli tidak berubah');
  assert.ok(contents.some((c) => c === 'isi draf C belum disimpan'));
  assert.ok(!contents.some((c) => c.includes('B diubah')), 'perubahan yang dibuang tidak tersimpan');
});
